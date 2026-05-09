# Schedule → WhatsApp Notifications

This doc describes the path from a scheduled prompt completing to a WhatsApp
message arriving on the user's phone, and the design choices behind it. It
is the canonical reference for anyone debugging the notification flow or
adding a sibling channel (Telegram, Slack, etc.).

## Goals

1. When a scheduled prompt finishes, the user gets a WhatsApp message with
   the outcome — they don't have to open Stratos to see what happened.
2. The Manager is the single point of contact. Replies on WhatsApp continue
   the conversation in the same Manager thread, with full context of the
   notification it just sent.
3. Per-schedule control: noisy hourly schedules can opt out without
   disabling the WhatsApp integration globally.
4. Disconnected WhatsApp doesn't silently drop notifications — they queue
   and flush on reconnect.

## Non-goals

- Sending the agent's raw transcript verbatim. The Manager curates first.
- Telegram parity (in v1; the design supports it but it isn't wired).
- Reaching multiple recipients. WhatsApp is single-user (`trustedPhone`).

## End-to-end flow

```
SchedulerManager.executePrompt
   │
   ▼
agent runs (claude-code / codex / opencode)
   │
   ▼
finalizeRun(prompt, folder, threadId, status, errorMessage)
   ├─ recordScheduleRun(record)        always — writes to schedule-runs.json
   └─ shouldNotifyManager(prompt, status)?
         ├─ status == "error"     → ManagerSession.reportScheduleFailure
         └─ status == "completed" → ManagerSession.reportScheduleSuccess
                │
                ▼
         enqueueNotification(directive)  Manager's standard queue, coalesced by scheduleId
                │
                ▼
         drainNotificationQueue → send(directive)
                │ (Manager LLM turn fires; may call mcp__stratos__get_session to fetch transcript)
                ▼
         ManagerSession.send finally:
            if (isNotificationInFlight && notificationForwardFn && mode==="remote")
                forwardFn(replyText || fallback)
                       │
                       ▼
            forwardOrQueue(text)        in whatsapp.ipc.ts
                │
                ▼
         resolveForwardJid()
            ├─ lastGatewayJid (set on each inbound)
            └─ phoneToJid(trustedPhone) (fallback)
                │
                ▼
         status === "connected"?
            ├─ yes → sendProactiveWhatsApp(jid, text)
            └─ no  → enqueuePendingWhatsApp(text) → drained on next "connected"
```

## Why "Manager as single point of contact"

The earlier design had the scheduler send WhatsApp messages directly. We
chose against it because:

1. **One channel, not two.** With Manager-as-relay, the WhatsApp thread is
   continuous. The user replies "what was that error?" and the same Manager
   that just sent the alert has full context to answer.
2. **Curation.** The Manager decides whether to pass through the agent's
   summary, fetch the full transcript, or condense — it's an LLM, that's
   what it's for. Direct sends would have to pick one rigid format.
3. **Existing forward path.** `manager-session.ts` already had a forward
   path for child-completion notifications triggered by inbound WhatsApp
   messages. Reusing it for schedule-triggered notifications was a small
   delta vs. building a parallel path.

The cost is one LLM turn per notified run. The user explicitly accepted
this — schedules already cost LLM credit; one more turn is rounding error.

## Configuration model

### Per-schedule field — `ScheduledPrompt.notify`

```ts
type ScheduleNotifyMode = "always" | "errors-only" | "never";
notify?: ScheduleNotifyMode;
```

- `"always"` — Manager turn fires on every run → WhatsApp message every run
- `"errors-only"` — Manager turn fires only on errors → WhatsApp on errors
- `"never"` — no Manager turn, no WhatsApp

Set via:

- The schedule editor dialog (`ScheduledPromptsDialog.tsx`) — "Notify on
  completion" dropdown with a fourth option "Use global default" that
  saves as `undefined`
- The `schedule_create`/`schedule_update` MCP tools (passes through)

### Global default — WhatsApp settings

```ts
interface WhatsAppSettings {
  trustedPhone: string;
  notifySchedules?: ScheduleNotifyMode; // default "errors-only"
}
```

Stored in `~/Library/Application Support/Stratos/whatsapp-settings.json`.
Surfaced in the WhatsApp settings panel as a 3-way radio.

### Resolution order

```ts
// scheduler/notify-policy.ts
shouldNotifyManager(prompt.notify, getGlobalNotifyDefault(), status);
```

If `prompt.notify` is set, it wins. Otherwise the global default applies.
If neither is set, fall back to `"errors-only"` so the cost-aware default
matches prior behavior.

## Mode gating: when WhatsApp is _not_ sent

The forward path checks `this.mode === "remote"`. When the user is actively
using the Stratos UI, `mode` is `"local"` and the Manager turn still runs
(the manager chat updates) but the WhatsApp forward is suppressed.

- `mode` flips to `"local"` whenever `sendFromUI()` is called
- `mode` flips back to `"remote"` after 5 minutes of UI inactivity
  (`IDLE_TIMEOUT_MS`)
- `setNotificationForward()` also flips to `"remote"` on inbound WhatsApp

Rationale: a phone ping while you're at the desk is noise. The Manager
chat in the UI carries the same content, and idle-back-to-remote ensures
async notifications resume the moment the user steps away.

## JID resolution

`sendProactiveWhatsApp(jid, text)` requires a Baileys JID, but only the
`trustedPhone` (E.164 string) is durably stored. Resolution:

```ts
resolveForwardJid()
  → lastGatewayJid    // set on each inbound message — canonical multi-device JID
  → phoneToJid(trustedPhone)  // "+15551234567" → "15551234567@s.whatsapp.net"
```

Inbound JIDs from Baileys are preferred because they may include
multi-device qualifiers that a naive `phoneToJid` would miss. The fallback
exists so schedules can fire and forward even before the user's first
inbound message in this session — important because the first time
schedules notify is often before the user has WhatsApp'd in.

## Disconnect handling: pending queue

When WhatsApp is disconnected (or `sendProactiveWhatsApp` throws), the
message is enqueued to `~/.stratos/manager/pending-whatsapp.json` instead
of being lost. The queue is:

- **FIFO**, capped at 20 entries (oldest dropped on overflow — schedule
  notifications are time-sensitive enough that a stale 24-hour-old "X
  completed" is worse than no message).
- **Atomic** — temp-file + rename so a crash mid-write can't corrupt.
- **Drained on `onStatus("connected")`** in `whatsapp.ipc.ts`. If a drain
  send fails, the remaining tail stays queued for the next reconnect.

## Empty-reply fallback

The forward path used to gate on `replyText` being non-empty, which meant a
tool-only Manager turn (e.g. "I called get_session and decided no action")
would silently drop the notification. The new path always forwards: empty
replies become `"Stratos: scheduled run completed (no summary)."` so the
user always hears something.

## Files

| File                                                                  | Role                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/types/scheduled-prompt.ts`                         | `ScheduleNotifyMode`, `ScheduledPrompt.notify` field                                                           |
| `packages/desktop/src/main/scheduler/notify-policy.ts`                | Pure `shouldNotifyManager` policy function (testable)                                                          |
| `packages/desktop/src/main/scheduler/scheduler.ts`                    | `finalizeRun` calls success/failure per policy                                                                 |
| `packages/desktop/src/main/manager/manager-session.ts`                | `reportScheduleSuccess`, updated `reportScheduleFailure`, empty-reply fallback in forward path                 |
| `packages/desktop/src/main/integrations/whatsapp.ipc.ts`              | Always-on `notificationForwardFn` install on connect, `getGlobalNotifyDefault`, JID resolution, queue draining |
| `packages/desktop/src/main/integrations/jid.ts`                       | `phoneToJid` helper                                                                                            |
| `packages/desktop/src/main/integrations/pending-whatsapp.ts`          | Persistent FIFO queue for disconnected sends                                                                   |
| `packages/desktop/src/renderer/components/ScheduledPromptsDialog.tsx` | "Notify on completion" dropdown                                                                                |
| `packages/ui/src/components/WhatsAppSettings.tsx`                     | Global notify-default radio                                                                                    |

## Tests

| Test file                            | Covers                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `__tests__/jid.test.ts`              | `phoneToJid` normalization (formatting, leading +, length floor)                                  |
| `__tests__/pending-whatsapp.test.ts` | Enqueue/persist, FIFO order, MAX_ENTRIES cap, drain-leaves-tail-on-failure, corrupt-file recovery |
| `__tests__/scheduler-notify.test.ts` | `shouldNotifyManager` matrix sweep across (notify × global × status)                              |

End-to-end behavior is verified manually via CDP after a real schedule
fires (see verification recipe at the bottom of this doc).

## Edge cases

### Coalescing

`enqueueNotification` already replaces queued entries by `scheduleId`. If
the same hourly schedule fires twice while the Manager is busy, the second
notification supersedes the first. The disk log
(`schedule-runs.json`) still records every run.

### `routeToManager: true` schedules

These are dispatched by the Manager itself (which calls `create_session`).
When the spawned child completes, `executeViaManager`'s callback runs
`finalizeRun` exactly like the direct path, so notification policy applies
identically. Note: there's no double-notification because the Manager's
own dispatch turn doesn't go through `reportScheduleSuccess`.

### One-shot schedules

`finalizeRun` is called for one-shots after they disable themselves; the
notification path is the same.

### Two messages on error?

Yes, by user choice (Edge case 7 in the design discussion). The notifier
fires `reportScheduleFailure` which always triggers a Manager turn with
the failure directive. There's no parallel "raw alert" — the Manager's
reply _is_ the message. So one error = one WhatsApp message.

### App not running when cron should fire

Out of scope. node-cron only fires when the app is up. Missed runs are
not retroactively notified.

### Long replies

Manager's directive instructs it to keep replies under ~600 chars and use
plain text (no markdown). WhatsApp text messages have a soft limit around
4096 chars; we don't hard-truncate but trust the prompt.

## Adding a new notification channel (e.g. Telegram)

The forward fn is a single `(text) => Promise<void>` callback. To add
Telegram:

1. In `telegram.ipc.ts`, mirror `whatsapp.ipc.ts`'s `forwardOrQueue` logic
   targeting Telegram's send API.
2. Decide the priority — does Telegram override WhatsApp, or do both fire?
   Currently `setNotificationForward` is single-slot. To support multi-fan-out,
   change the field to an array and call all of them. (Probably what you
   want — a user with both connected likely wants both to ping.)
3. Make sure `reportScheduleSuccess` / `reportScheduleFailure` directives
   stay channel-neutral. They already are.

## Verification recipe (manual)

```bash
# 1. Start the app with CDP
pnpm --filter @stratosapp/desktop dev:debug

# 2. Connect WhatsApp via the settings panel; confirm "connected"

# 3. Tail the gateway log
tail -f ~/.stratos/instances/$(ls ~/.stratos/instances/)/logs/gateway.log

# 4. Create a one-shot schedule via UI or MCP that fires in ~60s
#    Set "Notify on completion" to "Always"

# 5. Watch the log:
#    [scheduler] Schedule "X" succeeded
#    [manager-session] notification dispatched
#    [forward] sent N chars to <jid>@s.whatsapp.net

# 6. Phone receives the WhatsApp message. Reply on WhatsApp; the Manager
#    handles the follow-up in the same thread.
```

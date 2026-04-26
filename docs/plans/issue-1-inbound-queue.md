# Issue 1: No Incoming WhatsApp Message Queue

## Problem

In `whatsapp.ipc.ts`, `onMessage` checks `manager.isActive` and immediately throws
`"Manager is busy"` if a turn is in progress. The gateway treats this as a delivery
failure and the message is lost. Any WhatsApp message that arrives while the Manager
is processing (which can take 10–60 seconds for complex orchestrations) is silently
dropped.

## Root Cause

```ts
// whatsapp.ipc.ts ~168
if (manager.isActive) {
  writeGatewayLog("[ipc] manager is busy");
  throw new Error("Manager is busy");
}
```

There is no retry, no acknowledgement, no queue — the message is gone.

## Fix

Add a small in-process FIFO queue (`inboundGatewayQueue`) inside `ManagerSession`.
When `sendFromGateway` is called while a turn is active, the message is pushed onto
the queue and the caller's `Promise<string>` stays pending. Once the active turn
finishes, `drainInboundQueue()` is called from the `send()` finally-block, exactly
like the existing `drainNotificationQueue()` for child-completion notifications.

### Changes

#### `packages/desktop/src/main/manager/manager-session.ts`

1. Add private field:
   ```ts
   private inboundGatewayQueue: Array<{
     prompt: string;
     onReply: (r: string) => void;
     forwardFn: ((text: string) => Promise<void>) | null;
   }> = [];
   ```

2. Change `sendFromGateway` signature to accept an optional `forwardFn`:
   ```ts
   async sendFromGateway(
     prompt: string,
     onReply: (reply: string) => void,
     forwardFn?: (text: string) => Promise<void>,
   ): Promise<void>
   ```
   - If `activeStream`, push `{ prompt, onReply, forwardFn: forwardFn ?? null }` to
     the queue and return (the caller's Promise remains pending until `onReply` fires).
   - Otherwise, process immediately (existing behaviour, extended to wire `forwardFn`).

3. Add `private drainInboundQueue(): void`:
   - If `activeStream` or queue is empty, return.
   - Shift the next item, wire `notificationForwardFn` and `gatewayReplyFn`, then
     call `send()` via `setImmediate` (same scheduling discipline as
     `drainNotificationQueue`).

4. Call `this.drainInboundQueue()` in `send()` finally-block, after
   `drainNotificationQueue()`.

5. Clear `inboundGatewayQueue` in `switchProvider()` (provider reset = lose pending
   msgs, consistent with existing notification queue clear).

#### `packages/desktop/src/main/integrations/whatsapp.ipc.ts`

1. Remove the `manager.isActive` guard and the `throw new Error("Manager is busy")`.

2. Remove `lastGatewayJid` (the forward function now travels with each queued item).

3. Pass a per-message `forwardFn` to `sendFromGateway`:
   ```ts
   manager.sendFromGateway(
     text,
     (reply) => { writeGatewayLog(...); resolve(reply); },
     (replyText) => sendProactiveWhatsApp(from, replyText),
   )
   ```

4. Remove the `manager.setNotificationForward(...)` call that was co-located with
   `sendFromGateway` (it's now handled inside the drain path).

5. Keep the `manager.setNotificationForward(null)` in the DISCONNECT handler (still
   needed to clear the forward fn when the user disconnects WhatsApp).

### Queue Safety

- **Max depth**: cap at 20 items. If the queue is full, drop the oldest message and
  log a warning. Prevents unbounded memory growth during long outages.
- **Ordering**: FIFO — messages are processed in arrival order.
- **No timeout inside the queue**: the gateway's own transport timeout governs the
  outer `Promise<string>`. If the gateway times out and disconnects, the queued
  resolve is orphaned (never called), which is safe — no crash.
- **Mode**: each item restores `remote` mode (via `setNotificationForward`) when
  dequeued, matching the behaviour of a direct delivery.

## Edge Cases Considered

| Case | Behaviour |
|---|---|
| Manager receives UI message while WhatsApp msgs queued | `send()` finishes, `drainInboundQueue` runs next WhatsApp msg |
| Multiple WhatsApp senders queued | Each item carries its own `forwardFn`, so replies go to the right JID |
| Provider switch while queue non-empty | Queue is cleared in `switchProvider()` — pending Promises left dangling, gateway transport will eventually time out |
| App crash with items in queue | Items are in-memory only; they vanish. Caller's Promises never resolve. Same behaviour as today for the first message. |
| Queue overflow (>20 items) | Oldest item dropped; a warning is logged to gateway.log |

## How to Verify

1. Build passes: `pnpm build`
2. Tests pass: `pnpm test`
3. CDP: launch app, connect WhatsApp, simulate a long-running Manager turn by sending
   a complex prompt, then send a second WhatsApp message while the first is processing.
   Confirm the second message is delivered after the first turn completes.

---

## Verification Summary

**Build:** `pnpm build` passes cleanly (4/4 tasks, full turbo cache on repeat run).

**Tests:** `pnpm test` — 3 pre-existing failures in `handlers-manager.test.ts`,
`mcp-parity.test.ts`, and `sdk-mcp-policy.integration.test.ts` (MCP tool count
assertions expecting 19 but getting 20). These failures exist on the base commit
before any of my changes (confirmed via `git stash`). All other 131 tests pass.

**Code review:** No UI changes — this fix is entirely in the main process. CDP
verification not applicable. Key correctness properties confirmed by reading the code:
- `drainInboundQueue` is guarded by `activeStream` so it cannot re-enter.
- The `setImmediate` scheduling matches `drainNotificationQueue` to ensure the
  caller's finally-block has fully unwound before the next turn starts.
- `forwardFn` travels with each queue item so multi-sender scenarios route replies
  to the correct JID.
- Queue is cleared in `switchProvider()` to avoid stale items after a provider reset.
- Overflow at 20 items drops oldest with a console warning (logged to gateway.log).

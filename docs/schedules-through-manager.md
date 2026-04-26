# Schedules → Manager: Design Document

## Chosen Approach: Option A + Option B

- **Option A (all schedules)**: Manager is notified when any schedule completes.
  No routing, no bottleneck — pure visibility. Failures trigger a real Manager LLM
  turn; successes are recorded as lightweight metadata.
- **Option B (opt-in, agent-authored only)**: A `routeToManager: boolean` flag on
  `ScheduledPrompt`. When true, execution is posted to the Manager at fire time.
  This flag is intended for schedules created by the Manager or other agents, not
  for human-created automations.

Human-created schedules stay deterministic and independent. Agent-created schedules
that need Manager intelligence opt in explicitly.

---

## Current Architecture (Baseline)

### Schedules (direct path)

```
node-cron / setTimeout fires
  → SchedulerManager.executePrompt()
  → storage.createThread()
  → agentManager.runScheduledPrompt()   # fire-and-forget, bypassPermissions
  → on completion: update ScheduledPrompt status, show desktop notification
```

### Manager (orchestration path)

```
User / WhatsApp / child-completion
  → ManagerSession.send()               # singleton LLM call
  → Manager LLM decides what to do
  → calls create_session MCP tool
  → agentManager.startStream()
  → on child completion: handleChildCompletion() notifies Manager
```

### Current Integration

None. Completely independent codepaths sharing only the `AgentManager` runner.

---

## Notification Design (Option A)

### Two-tier model

Not all notifications should trigger a Manager LLM turn. That adds to Manager's
conversation history, costs tokens, and makes Manager "busy" processing noise.

| Event                               | Action                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| Schedule starts                     | UI metadata only — store start time, show status indicator |
| Schedule completes (success)        | Lightweight metadata record; no LLM turn                   |
| Schedule completes (failure)        | Full Manager LLM turn — error needs a decision             |
| Schedule completes (routeToManager) | Full Manager LLM turn — Manager owns this result           |

### Why not LLM turn for every completion?

5 daily schedules × 2 (start + end) = 10 extra Manager LLM calls/day. Over a
month: 300 additional interactions in Manager's context. This degrades reasoning
quality and inflates cost with no user benefit for successful automations.

### Agent-authored completion report

The child agent can call `schedule_report` during its run to deposit a summary
and metadata. This is the only thing the tool does — it stores data, triggers
nothing. The scheduler always sends a notification to Manager when the run
finishes, using whatever the agent deposited. If the agent never called the tool,
the notification goes out anyway with basic metadata only.

**`schedule_report` MCP tool** (called by the child agent at end of run):

```typescript
schedule_report({
  scheduleId: string, // injected into prompt so agent knows it
  summary: string, // 1-3 sentences: what was done, found, or changed
});
```

No `status` or `errorMessage` on the tool — the agent only provides the summary.
The scheduler determines final status from the run outcome.

**Stored record format** (written by the tool, read by the scheduler on completion):

```typescript
{
  scheduleId: string,
  summary: string,          // agent-authored
  depositedAt: number,
}
```

### How the agent knows to call it

The scheduler injects a postscript into every scheduled prompt before execution:

```
---
[SCHEDULED TASK — {name}]
Schedule ID: {scheduleId}
Workspace: {folder}
Provider: {provider}

When you finish, call schedule_report with scheduleId="{id}" and a concise
1-3 sentence summary of what you accomplished, found, or changed.
```

### Notification to Manager (always sent by scheduler)

When a scheduled run completes — regardless of whether the agent called
`schedule_report` — the scheduler sends a notification to Manager. The record
format:

```typescript
{
  type: "schedule_run",
  scheduleId: string,
  scheduleName: string,
  threadId: string,
  workspace: string,
  provider: string,
  status: "completed" | "error",
  summary?: string,         // present if agent called schedule_report
  durationMs: number,
  errorMessage?: string,    // present if status === "error"
  completedAt: number,
}
```

**Notification weight by outcome:**

| Outcome                        | Manager notification                           |
| ------------------------------ | ---------------------------------------------- |
| Completed, agent filed summary | Lightweight record — no LLM turn               |
| Completed, no summary filed    | Lightweight record — no LLM turn               |
| Error                          | Full Manager LLM turn — error needs a decision |

The lightweight record is stored on Manager's thread without triggering `send()`.
Manager can query it ("what ran today?", "what did the PR review find last Monday?")
without it ever polluting the live conversation. Failures always trigger a real
LLM turn because they may require action.

**Failure LLM turn format:**

```
[SCHEDULE FAILURE] "{name}" failed after {duration}s
Error: {errorMessage}
Thread: {threadId}
Schedule ID: {scheduleId}
Workspace: {folder}
Summary: {summary if filed, else "agent did not file a report"}
```

---

## Opt-In Routing Design (Option B)

### Who sets `routeToManager: true`?

Only agents — specifically the Manager and any agent with access to `schedule_create`
MCP tool. The UI schedule creation form does NOT expose this toggle. This enforces
the intent: human-written automations are deterministic; agent-authored automations
can be intelligent.

### Self-describing prompt requirement

When an agent creates a schedule with `routeToManager: true`, the `prompt` field
MUST be fully self-contained. When the schedule fires (potentially weeks later),
the Manager's conversation history from the creation session is gone. The prompt
cannot reference prior context implicitly.

The `schedule_create` MCP tool description should enforce this:

> When routeToManager is true, the prompt must be fully self-describing — include
> all relevant context, goals, and constraints inline. Do not reference "earlier
> discussion" or "the analysis above."

### Execution flow when `routeToManager: true`

```
node-cron / setTimeout fires
  → SchedulerManager.executePrompt()
  → prompt.routeToManager === true
  → managerSession.sendFromScheduler(prompt, onComplete)
    → Manager receives: "[SCHEDULED TASK] {name}\n{prompt}\nWorkspace: {folder}\nProvider: {provider}"
    → Manager LLM: check list_sessions for conflicts, then create_session
    → child thread runs with spawnedBy: "manager", scheduledPromptId: {id}
    → on child completion: handleChildCompletion() detects scheduledPromptId
    → calls registered onComplete(status)
  → SchedulerManager.onComplete:
    → update ScheduledPrompt.lastRunStatus / lastRunAt
    → disable one-time schedules
    → show desktop notification
```

The scheduler still owns status lifecycle — `onComplete` callback bridges Manager
execution back to scheduler bookkeeping.

### Manager system prompt addition

```
## Scheduled Task Dispatch

When you receive a message prefixed with [SCHEDULED TASK]:
1. DO NOT modify or summarize the task prompt — pass it verbatim to create_session
2. Check list_sessions for any running session doing the same work
3. If a conflict exists: report it; do not spawn a duplicate
4. Create the session with the specified provider and workspace
5. Reply with the spawned threadId only — no commentary
```

This narrows LLM non-determinism for schedule dispatch: the Manager becomes a
smart router, not a rewriter.

---

## Manager as Schedule Author (Option C, included)

Manager gains `schedule_create` and `schedule_list` in its MCP tool set. This
allows conversations like:

> "Run a PR review summary every Monday at 9am and send it to WhatsApp"

Manager creates the schedule with `routeToManager: true` and a self-describing
prompt. When it fires, execution comes back through Manager, which has the WhatsApp
forwarding capability.

This is the natural end-to-end use case that makes `routeToManager` valuable.

---

## Implementation Plan

### Phase 1 — Data Model

**`packages/core/src/types/scheduled-prompt.ts`**

- Add `routeToManager?: boolean` to `ScheduledPrompt`
- No migration needed — undefined === false

### Phase 2 — Schedule Report MCP Tool + Notification (Option A)

**`packages/desktop/src/main/mcp/handlers/scheduler.ts`**

- Add `schedule_report(scheduleId, summary)` MCP tool
- On call: store `{ scheduleId, summary, depositedAt }` in a transient in-memory
  map (keyed by `scheduleId`) — no Manager interaction, no side effects
- The scheduler reads from this map when the run finishes

**`packages/desktop/src/main/scheduler/scheduler.ts`**

- Before calling `agentManager.runScheduledPrompt()`, prepend the postscript
  to the prompt:
  ```
  ---
  [SCHEDULED TASK — {name}]
  Schedule ID: {scheduleId}
  Workspace: {folder}
  When you finish, call schedule_report with scheduleId="{id}" and a concise summary.
  ```
- After run completes (success or error): build a `ScheduleRunRecord` — check
  the in-memory map for an agent-filed summary, include it if present
- Call `managerSession.recordScheduleRun(record)` unconditionally
- If the run errored: additionally call `managerSession.reportScheduleFailure(record)`
  to trigger a Manager LLM turn
- Clear the in-memory summary entry after consuming it

**`packages/desktop/src/main/manager/manager-session.ts`**

- Add `recordScheduleRun(record: ScheduleRunRecord)` — writes record to Manager
  thread storage without triggering `send()`
- Add `reportScheduleFailure(record: ScheduleRunRecord)` — calls `send()` with
  the `[SCHEDULE FAILURE]` directive

### Phase 3 — ManagerSession: Scheduler Entry Point (Option B)

**`packages/desktop/src/main/manager/manager-session.ts`**

- Add `sendFromScheduler(prompt: ScheduledPrompt, onComplete: (status: "completed" | "error") => void)`
- Distinct from `sendFromGateway` — carries schedule metadata in message prefix
- Registers `onComplete` keyed by `prompt.id` in a `Map<string, callback>`
- Extend `handleChildCompletion()`: if completed thread has `scheduledPromptId`,
  look up and call the registered callback, then delete it from the map

### Phase 4 — Scheduler: Routing Fork (Option B)

**`packages/desktop/src/main/scheduler/scheduler.ts`**

- `SchedulerManager` constructor receives `managerSession: ManagerSession` reference
  (injected in `main/index.ts` after both are initialized)
- In `executePrompt()`:
  - If `!prompt.routeToManager`: existing path unchanged
  - If `prompt.routeToManager`: skip `createThread` + `runScheduledPrompt`; call
    `managerSession.sendFromScheduler(prompt, statusCallback)`
- Status callback updates `ScheduledPrompt` record and disables one-time schedules

### Phase 5 — Manager MCP: Schedule Tools (Option C)

**`packages/desktop/src/main/mcp/handlers/manager.ts`**

- Add `schedule_create` tool (thin wrapper over existing `SchedulerManager.create()`)
- Add `schedule_list` tool (wrapper over `SchedulerManager.list()`)
- Add `schedule_disable` / `schedule_enable` tools
- Update Manager system prompt to document these tools and the self-describing
  prompt requirement for `routeToManager: true`

**`packages/desktop/src/main/manager/manager-session.ts`**

- Pass `schedulerManager` reference into the MCP handler so schedule tools can
  call it

### Phase 6 — Wiring in `main/index.ts`

- `SchedulerManager` receives `managerSession` after both are initialized
- `ManagerSession` MCP handler receives `schedulerManager` reference
- Initialization order: `storage` → `agentManager` → `schedulerManager` (no
  manager dep yet) → `managerSession` → inject `managerSession` into
  `schedulerManager`

### Phase 7 — Manager System Prompt

Update `manager-session.ts` system prompt:

- Add "Scheduled Task Dispatch" section (see above)
- Add "Schedule Authoring" section documenting `schedule_create` tool and the
  self-describing prompt rule
- Add "Schedule Awareness" section noting Manager can call `schedule_list` to
  check what automations exist before making decisions

---

## Resolved Design Decisions

| Question                                | Decision                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| LLM turn for every schedule completion? | No — only failures and `routeToManager` completions; successes stored as agent-authored metadata records |
| `routeToManager` default                | `false` — opt-in only                                                                                    |
| Who can set `routeToManager: true`?     | Agents only (via MCP); not exposed in UI form                                                            |
| Manager busy when schedule fires?       | Queue it (existing `notificationQueue` mechanism)                                                        |
| Prompt self-containment enforcement     | MCP tool description + system prompt instruction                                                         |
| Start notifications                     | UI metadata only, no LLM turn                                                                            |
| Schedule authoring by Manager           | Yes, via new schedule tools in manager MCP handler                                                       |

---

## What Does NOT Change

- Human-created schedules: identical behavior — deterministic, direct, no Manager hop
- Permission model: all scheduled threads still run `bypassPermissions`
- Scheduler lifecycle ownership: `lastRunStatus`, `lastRunAt`, one-time disabling
  remain scheduler responsibilities (callback pattern bridges Manager execution)
- Manager singleton constraint: no parallel streams introduced

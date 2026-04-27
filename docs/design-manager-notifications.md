# Design: Manager Notification System

**Status:** Analysis / Recommendation  
**Context:** `packages/desktop/src/main/manager/manager-session.ts`, `packages/desktop/src/main/agent-manager.ts`

---

## 1. What is `reportedToManager` actually trying to solve?

The `reportedToManager` boolean on `Thread` was introduced to solve two problems:

**Problem A — duplicate notifications within a single run.** The stale-session retry path in `runStream` can, in theory, re-enter the `finally` block twice (once for the failed attempt, once for the retry). Without a guard, each entry emits a `streamCompleted` event, which would inject two notifications into the Manager's queue for the same logical completion. `reportedToManager` makes the second emission a no-op.

**Problem B — duplicate notifications across app restarts.** If the process crashes between stream completion and the Manager's `send()` finishing, a naive restart could re-scan all `spawnedBy === "manager"` threads and re-notify for ones that already fired. The flag, being persistent on disk, survives the crash and prevents the replay.

The invariant it is trying to enforce:
> For any given thread run, the Manager receives exactly one completion notification.

### Is it the right abstraction?

No. The fatal flaw is that the flag is **per-thread**, not **per-run**. A thread is a conversation that can have arbitrarily many runs (initial prompt + N `send_message` follow-ups). The invariant "notify exactly once per run" cannot be expressed by a boolean that resets only once per thread lifetime. The current quick fix (resetting at stream start) is correct for the happy path but still leaks semantics: `reportedToManager = false` at stream start means "this thread has not been reported yet", which is true both for brand-new threads and for threads whose prior report already succeeded. The flag collapses two distinct states into one.

---

## 2. First-principles requirements

A correct Manager notification system must satisfy:

| # | Requirement | Rationale |
|---|---|---|
| R1 | **One notification per run** | Each `runStream` invocation is an independent unit of work. The Manager cares about the result of that specific work, not the thread's history. |
| R2 | **No notification is ever permanently lost** | The Manager is the user's proxy. A silently dropped notification means the user never hears what happened. This is the bug. |
| R3 | **No duplicate notification for the same run** | Two notifications for one run confuse the Manager LLM and waste a turn. |
| R4 | **Works for initial runs and `send_message` follow-ups** | A thread can have many runs. Notification should fire for all of them. |
| R5 | **Works across app restarts** | A crash between stream end and notification delivery should not silently drop the notification. |
| R6 | **Manager-busy does not cause loss** | If the Manager is mid-stream when a child completes, the notification should queue and fire when the Manager is free, not be dropped. |
| R7 | **Notification carries enough context** | The Manager LLM needs: thread ID, title, status (completed/error/interrupted), error message if applicable. It should not need to remember prior state. |
| R8 | **Reconciliation on startup** | On boot, the system should find any completions that were never notified (process crash, power loss) and replay them. |

---

## 3. What is wrong with the current design

### 3.1 `reportedToManager` is per-thread, not per-run

The fundamental mismatch. Once set to `true`, it suppresses notifications for all future runs of the same thread. The quick fix (resetting at stream start) patches this, but the underlying abstraction is still wrong: the flag does not identify *which* run it corresponds to. If two runs complete in rapid succession (unusual but possible if `send_message` is called while the notification is in-flight), the reset may clear the flag for run N+1 before run N's notification has been processed.

### 3.2 The notification is keyed to the thread, not the run

`handleChildCompletion` receives `StreamCompletedEvent { threadId, status, errorMessage }`. There is no run ID. This means:
- The notification queue entry has no stable identity.
- There is no way to deduplicate by run at the queue level.
- There is no way to tell, on restart, whether "this thread's last completion was already notified."

### 3.3 No queue overflow strategy — but also no cap

Currently `notificationQueue` is an unbounded array. The issue description mentions `MAX_NOTIFICATION_QUEUE = 5` but that constant does not exist in the code. The queue does not drop items; however, it has no upper bound, so if many sessions complete while the Manager is busy (fan-out pattern), the queue grows without limit and all items eventually fire sequentially. This is not a correctness bug but it creates UX noise: a burst of 10 completions produces 10 sequential Manager turns. There is no coalescing or thread-based deduplication at the queue level.

### 3.4 The backoff silently delays but does not lose notifications

When `send()` throws, `drainNotificationQueue` re-queues the failed notification at the front and sets `notificationBackoffUntil = Date.now() + 10_000`. During the backoff window, new notifications can queue up freely, and the backoff only delays firing — it does not drop. This is actually correct behavior. The design doc in the issue description was wrong on this point: the backoff does not swallow notifications.

However, there is a subtle interaction: `drainNotificationQueue` is only called from two places — `handleChildCompletion` (immediate) and `send()`'s finally (after a turn completes). If the Manager never gets another user message and no child completes, a queued notification that failed will sit forever unless there is a heartbeat or retry timer. In practice, the user eventually sends another message, which triggers `send()`, whose finally calls `drainNotificationQueue`. But in a long-idle scenario, this could delay notification by minutes.

### 3.5 Stale-session retry race in `runStream`

When `runStream` detects a stale session, it sets `isRetrying = true`, skips the `finally` block's completion logic (does not call `emitStreamCompleted`), and tail-calls `runStream` recursively. The retry's own `finally` fires the event. This is correct for the normal case. But consider:

```
run → stale detected → retry starts
retry → completes → finally resets reportedToManager = false, emits event
handleChildCompletion fires → sets reportedToManager = true, queues notification
```

This is fine. But if the initial run's `finally` somehow fires (which it explicitly avoids via `isRetrying`), you'd get a double emit. This is not currently broken but is fragile: the correctness depends on `isRetrying` being set before any `await` after the retry starts.

### 3.6 No startup reconciliation

On boot, `detectOrphanedThreads()` checks for threads with a `sessionId` but no active stream, and reports them to the renderer as orphaned for UI recovery. There is no equivalent check for "manager-spawned threads that completed but were never notified." If the process crashes after `emitStreamCompleted` fires but before the Manager's `send()` finishes and persists the turn to disk, the notification is lost. The `reportedToManager = true` flag was already written before the notification was delivered, so on restart the thread looks "already reported" and is silently skipped. R5 is violated.

---

## 4. What the ideal design looks like

### 4.1 Run IDs: make each stream invocation a first-class identity

Every `runStream` call should generate a unique `runId` (already done as `streamId = \`${threadId}-${Date.now()}\``; this just needs to be promoted and persisted). The `StreamCompletedEvent` should carry this `runId`, and notification tracking should be keyed by `runId`, not `threadId`.

```ts
// Thread storage
interface Thread {
  lastRunId?: string;             // ID of the most recent stream run
  lastReportedRunId?: string;     // ID of the last run that was successfully notified
}
```

The notification guard in `handleChildCompletion` becomes:

```ts
if (thread.lastReportedRunId === event.runId) return; // already notified this run
```

And on successful delivery (after `send()` completes), persist:

```ts
this.storage.updateThread(event.threadId, { lastReportedRunId: event.runId });
```

This is better than a boolean in several ways:
- It identifies *which* run was reported, not just "some run was reported."
- It survives restarts without false positives: the guard only fires when the exact same run was already delivered.
- It makes the reset at stream-start unnecessary: a new `runId` naturally bypasses an old `lastReportedRunId`.

### 4.2 Persist pending notifications to disk, not just in-memory queue

The in-memory `notificationQueue` is lost on crash. Instead, persist a "pending notification" record when the completion event fires, and remove it when the Manager's `send()` succeeds.

```ts
interface PendingNotification {
  runId: string;
  threadId: string;
  status: "completed" | "error" | "interrupted";
  errorMessage?: string;
  queuedAt: number;
}
```

Storage location: `~/.stratos/manager/pending-notifications.json` (or alongside thread storage). On startup, `setup()` reads this file and re-queues any surviving entries before subscribing to new events. This satisfies R5.

### 4.3 Delivery acknowledgment: update `lastReportedRunId` after send, not before

The current code writes `reportedToManager = true` before calling `send()` to prevent duplicates on crash. But this creates a different failure: if `send()` fails or the process crashes mid-send, the notification is marked delivered when it was not.

The right model is **optimistic dedup with post-delivery acknowledgment**:

1. When `handleChildCompletion` fires: write a `PendingNotification` record to disk. Check `lastReportedRunId !== event.runId` to guard against duplicates.
2. Queue the notification in-memory.
3. When `send()` completes successfully: write `lastReportedRunId = event.runId` to the thread, then remove the `PendingNotification` record.
4. If `send()` fails: the `PendingNotification` record remains on disk. Retry after backoff.

On startup: scan for surviving `PendingNotification` records. Re-queue any whose `lastReportedRunId` does not match their `runId` (i.e., delivery was not confirmed).

This satisfies R2 and R5 at the cost of a tiny risk of duplicate delivery (if the process crashes after `send()` succeeds but before `lastReportedRunId` is written). The duplicate is recoverable: the Manager LLM will call `get_session` twice and produce a repeated summary, which is annoying but not catastrophic. "At-least-once delivery with idempotent consumer" is the right tradeoff here.

### 4.4 Queue coalescing: replace, not append, for the same thread

If thread X completes run 1, then before the notification fires, runs run 2 and completes that too, there are now two notifications in the queue for X. Delivering both produces two sequential Manager turns that each call `get_session` on the same thread. The second is redundant.

Better strategy: when pushing to the notification queue, check if there is already an entry for the same `threadId`. If so, replace it (keeping the more recent `runId`). This reduces fan-out noise and is safe because the Manager only cares about the *current* state of the thread, which `get_session` reflects.

```ts
// Replace existing entry for same threadId, or append
const existingIdx = this.notificationQueue.findIndex(
  (n) => n.threadId === event.threadId
);
if (existingIdx >= 0) {
  this.notificationQueue[existingIdx] = notification;
} else {
  this.notificationQueue.push(notification);
}
```

### 4.5 Startup reconciliation

In `setup()`, after subscribing to completion events, also scan for unreported completions:

```ts
private reconcileMissedNotifications(): void {
  const threads = this.storage.listThreads();
  for (const thread of threads) {
    if (thread.spawnedBy !== "manager") continue;
    if (!thread.lastRunId) continue;
    if (thread.lastReportedRunId === thread.lastRunId) continue;
    if (!thread.lastCompletionStatus) continue;
    // This thread completed but was never notified
    this.handleChildCompletion({
      runId: thread.lastRunId,
      threadId: thread.id,
      status: thread.lastCompletionStatus,
      errorMessage: thread.lastCompletionError,
    });
  }
}
```

This satisfies R8. It fires on every app startup, catches anything that fell through cracks, and is idempotent because `lastReportedRunId` guards against re-notifying already-delivered runs.

### 4.6 Retry heartbeat for stuck queues

Add a 60-second `setInterval` in `ManagerSession` that calls `drainNotificationQueue()`. This ensures that a backoff window or an idle Manager eventually clears without requiring a user message. Very low overhead.

---

## 5. Recommendation and migration path

### Short term (current state)

The quick fix (reset `reportedToManager = false` at `runStream` start) is shipped and solves the immediate regression for `send_message` follow-ups. It is safe to merge.

### Medium term: run IDs (recommended next PR)

This is the correct fix with low implementation risk:

1. **Add `runId` to `StreamCompletedEvent`** — generate it in `runStream` (already have `streamId`; just expose it on the event).
2. **Add `lastRunId` and `lastReportedRunId` to `Thread`** — persist `lastRunId` at stream start, `lastReportedRunId` after successful notification.
3. **Change `handleChildCompletion` guard** from `thread.reportedToManager` to `thread.lastReportedRunId === event.runId`.
4. **Change acknowledgment** from "write before send" to "write after send succeeds."
5. **Add `reconcileMissedNotifications()`** to `setup()`.
6. **Add coalescing** in the notification push path.

Estimated scope: ~100 lines across `agent-manager.ts`, `manager-session.ts`, and `thread.ts`. No schema migration needed — `lastRunId` and `lastReportedRunId` are optional fields on an existing JSONL schema.

### Long term: persistent notification log

If Stratos grows to support many concurrent manager-spawned sessions (>10 simultaneous), the in-memory queue + coalescing strategy above is still adequate but the `pending-notifications.json` disk layer becomes more important for reliability. This is a follow-up that can be deferred until the fan-out use case is more common.

The persistent notification log also enables a future "missed notifications" UI — e.g., a badge on the Manager thread showing N undelivered completions when the Manager was offline or errored.

---

## Summary of failure modes in current design

| Failure mode | Severity | Fixed by quick fix? | Fixed by run-ID design? |
|---|---|---|---|
| `send_message` follow-up completion not notified | High | Yes | Yes |
| Crash after `reportedToManager=true` before `send()` succeeds | Medium | No (made worse: flag never written) | Yes (post-delivery ack) |
| Burst of completions produces redundant notifications | Low | No | Yes (coalescing) |
| App restart after crash misses completions | Medium | No | Yes (reconciliation) |
| Stuck queue in idle Manager never retried | Low | No | Yes (heartbeat) |
| Stale-session retry double-emits completion | Low | No (pre-existing) | Yes (runId dedup) |

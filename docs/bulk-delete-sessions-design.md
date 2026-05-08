# Design: `bulk_delete_sessions` MCP Tool

**Status:** Draft  
**Scope:** Design only — no implementation yet

---

## Problem Statement

`delete_session` deletes one thread at a time. Users regularly accumulate dozens of completed automation threads (scheduled digests, scout runs, platform reviews) and must loop through 50–100 individual tool calls to clean up a workspace. A `bulk_delete_sessions` tool collapses that to a single call.

---

## 1. Tool Signature

### Name

`bulk_delete_sessions`

### Parameters

```ts
{
  // Explicit list of thread IDs to delete.
  // Required if filter is omitted; optional if filter is provided.
  threadIds?: string[];

  // Declarative filter — delete threads matching all specified criteria.
  // Required if threadIds is omitted; optional alongside threadIds (union).
  filter?: {
    workspace?: string;       // Match thread.cwd (exact)
    titlePattern?: string;    // JS regex string, tested against thread.title
    scheduleId?: string;      // Match thread.scheduledPromptId
    olderThan?: string;       // ISO 8601 datetime; matches thread.updatedAt < date
    status?: "idle" | "running"; // "idle" = !isStreaming, "running" = isStreaming
    spawnedBy?: "manager";    // Limit to manager-spawned threads only
  };

  // Thread IDs to protect from deletion even if they match the filter/threadIds list.
  exclude?: string[];

  // If true, return what would be deleted without deleting anything.
  dryRun?: boolean;
}
```

At least one of `threadIds` or `filter` must be provided. Providing neither is a validation error.

### Return Type

```ts
{
  deleted: string[];   // Thread IDs successfully deleted
  skipped: string[];   // Thread IDs that were resolved but protected (Manager thread,
                       //   exclude list, or active with no interrupt)
  errors: {
    threadId: string;
    reason: string;
  }[];
  dryRun?: boolean;    // Echo back true when dryRun was requested
}
```

On `dryRun: true`, `deleted` contains the IDs that _would_ be deleted and no side effects occur.

---

## 2. Implementation Sketch

### 2.1 File Location

Add the handler alongside `delete_session` in:

```
packages/desktop/src/main/mcp/handlers/manager.ts
```

It follows the same `defineHandler()` pattern and accesses the same `agentManager` + `storage` + `window` deps already in scope for `createManagerHandlers()`.

### 2.2 Resolution Phase — Building the Candidate Set

```
candidates = union(resolveExplicit(threadIds), resolveFilter(filter))
candidates = candidates.filter(id => !exclude.includes(id))
candidates = candidates.filter(id => id !== managerThreadId)
```

**`resolveExplicit(threadIds)`** — look up each ID via `storage.getThread()`. IDs not found go directly to `errors` with `reason: "not found"`.

**`resolveFilter(filter)`** — evaluate in-process against `storage.listThreads()` (already loads the full thread list from `~/.stratos/threads/threads.json` into memory; no separate DB query needed):

| Filter field   | Thread field checked           | Match condition                                    |
| -------------- | ------------------------------ | -------------------------------------------------- |
| `workspace`    | `thread.cwd`                   | Strict equality                                    |
| `titlePattern` | `thread.title`                 | `new RegExp(titlePattern, 'i').test(thread.title)` |
| `scheduleId`   | `thread.scheduledPromptId`     | Strict equality                                    |
| `olderThan`    | `thread.updatedAt`             | `thread.updatedAt < Date.parse(olderThan)`         |
| `status`       | `agentManager.isStreaming(id)` | `"running"` → streaming; `"idle"` → not streaming  |
| `spawnedBy`    | `thread.spawnedBy`             | Strict equality (`"manager"`)                      |

Multiple filter fields are ANDed together.

`titlePattern` is compiled once before the loop. If it throws (invalid regex), the tool returns immediately with an error before touching any threads.

### 2.3 Deletion Phase — Best-Effort with Partial Results

The tool uses **best-effort semantics** (not fail-fast). Each deletion is attempted independently; a failure on one thread does not block the rest. This matches the real-world use case: a transient error on one thread should not prevent cleanup of 49 others.

For each candidate:

```
1. thread = storage.getThread(id)
   → not found: push to errors("not found"), continue

2. if thread.isManagerThread:
   → push to skipped("Manager thread"), continue

3. if agentManager.isStreaming(id):
   a. await agentManager.interruptSession(id)   // mirrors delete_session
   b. if interrupt throws: push to errors(err.message), continue

4. agentManager.clearSession(id)                // clears in-memory SDK state

5. storage.deleteThread(id)                     // atomic write to threads.json
   → returns false: push to errors("storage delete failed"), continue

6. push to deleted
```

After the loop, if `deleted.length > 0`, broadcast once:

```ts
broadcast(window, IPC_CHANNELS.THREADS_CHANGED);
```

A single broadcast after the batch is sufficient — the UI rebuilds from the full thread list, so one notification is as correct as N.

### 2.4 `storage.deleteThread` and Batch Writes

`FileStorageAdapter.deleteThread()` (in `packages/core/src/storage/file-adapter.ts`) does a full atomic `threads.json` read-modify-write per call. For a batch of N threads this means N round-trips to disk.

For the initial implementation, accept N serial writes — it is simpler and `threads.json` is typically small (< 100 KB). If profiling shows this is slow for large batches (> 100 threads), a follow-up can add `StorageAdapter.deleteThreads(ids: string[]): { deleted: string[]; missing: string[] }` that does a single read-modify-write.

---

## 3. Edge Cases & Safety

### 3.1 Active / Streaming Sessions

`delete_session` already handles this: call `agentManager.interruptSession()` before clearing. `bulk_delete_sessions` follows the same pattern. If `interruptSession` throws (e.g. the SDK doesn't allow interruption mid-tool), the thread goes to `errors` — it is not silently skipped or force-deleted.

### 3.2 Manager-Spawned Sessions with Pending Callbacks

Threads with `spawnedBy: "manager"` and `lastRunId !== lastReportedRunId` have a completion notification that has not yet been delivered to the Manager. Deleting these threads before the notification fires will silently drop the callback — the Manager never learns the task finished.

**Proposed handling:** treat `spawnedBy === "manager" && lastRunId !== lastReportedRunId` as an active-like state. If `status: "idle"` is not explicitly requested in the filter, add such threads to `skipped` with `reason: "pending manager callback"`. If the caller explicitly passes the thread ID in `threadIds`, delete it anyway (the caller opted in) — but append a warning in the `errors` array with `reason: "warning: pending manager callback — deleted on explicit request"`.

### 3.3 Worktree Sessions

Threads with `worktree` set (`thread.worktreeMode === "worktree"`) have an associated git worktree on disk (at `thread.worktree.path`). `storage.deleteThread()` deletes the thread record and its messages/traces but does **not** clean up the worktree directory.

`delete_session` has the same gap today. For `bulk_delete_sessions`, make the gap explicit: include worktree threads in `deleted` (thread data is gone) but document that worktree directories are not removed. Log a console warning for each worktree thread deleted. A proper fix belongs in `storage.deleteThread()` itself and will benefit both tools.

### 3.4 The `exclude` List as a Safety Net

`exclude` protects specific thread IDs from filter-driven deletion. The intended use is:

```json
{
  "filter": { "workspace": "/path/to/project" },
  "exclude": ["thread-abc-123"]
}
```

Excluded threads appear in `skipped` with `reason: "in exclude list"`. The Manager thread is always implicitly excluded regardless of whether its ID appears in `exclude`.

### 3.5 Filter-Only Calls (No `threadIds`)

A filter-only call that matches 0 threads succeeds and returns empty arrays — not an error. A filter-only call that would match the Manager thread silently skips it (same as today).

### 3.6 Empty or Duplicate `threadIds`

Duplicates in `threadIds` are deduplicated before resolution. An empty `threadIds: []` with no `filter` is a validation error ("must provide threadIds or filter").

---

## 4. MCP JSON Schema

This is the `inputSchema` as it would appear in `socket-mcp-server.ts` after `z.toJSONSchema(z.object(...))`:

```json
{
  "type": "object",
  "properties": {
    "threadIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Explicit list of thread IDs to delete. Required if filter is omitted."
    },
    "filter": {
      "type": "object",
      "description": "Declarative filter — delete all threads matching all specified criteria. Required if threadIds is omitted.",
      "properties": {
        "workspace": {
          "type": "string",
          "description": "Match thread.cwd exactly (e.g. '/Users/me/project')"
        },
        "titlePattern": {
          "type": "string",
          "description": "Case-insensitive JS regex tested against thread.title (e.g. 'digest|scout')"
        },
        "scheduleId": {
          "type": "string",
          "description": "Match thread.scheduledPromptId exactly"
        },
        "olderThan": {
          "type": "string",
          "format": "date-time",
          "description": "Delete threads whose last activity is before this ISO 8601 timestamp"
        },
        "status": {
          "type": "string",
          "enum": ["idle", "running"],
          "description": "'idle' = not currently streaming; 'running' = currently streaming"
        },
        "spawnedBy": {
          "type": "string",
          "enum": ["manager"],
          "description": "Limit to threads created by the Manager Agent"
        }
      },
      "additionalProperties": false
    },
    "exclude": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Thread IDs to protect from deletion even if they match the filter or threadIds list"
    },
    "dryRun": {
      "type": "boolean",
      "description": "If true, return what would be deleted without actually deleting anything"
    }
  },
  "additionalProperties": false
}
```

The corresponding Zod `inputSchema` shape (as passed to `defineHandler`):

```ts
{
  threadIds: z
    .array(z.string())
    .optional()
    .describe("Explicit list of thread IDs to delete. Required if filter is omitted."),
  filter: z
    .object({
      workspace: z.string().optional().describe("Match thread.cwd exactly"),
      titlePattern: z.string().optional().describe("Case-insensitive JS regex on thread.title"),
      scheduleId: z.string().optional().describe("Match thread.scheduledPromptId exactly"),
      olderThan: z.string().optional().describe("ISO 8601 timestamp; matches updatedAt < date"),
      status: z.enum(["idle", "running"]).optional(),
      spawnedBy: z.enum(["manager"]).optional(),
    })
    .optional()
    .describe("Declarative filter. Required if threadIds is omitted."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Thread IDs to protect even if they match"),
  dryRun: z
    .boolean()
    .optional()
    .describe("Return what would be deleted without deleting"),
}
```

The at-least-one-of `threadIds | filter` constraint cannot be expressed in JSON Schema or Zod without a `refine`. Check it at the top of the handler body and return `textResult("...", true)` if violated, matching the pattern used by other handlers.

---

## 5. Open Questions

| #   | Question                                            | Options                                       | Recommendation                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Max batch size**                                  | None / 100 / 500                              | Cap at 200 threads per call. Avoids runaway filter matches on large installations. Return an error if the resolved candidate set exceeds the cap (before any deletions).                                                                                                 |
| 2   | **Filter-only confirmation**                        | Require `dryRun` first / no constraint        | No hard requirement, but the Manager's system prompt should encourage `dryRun: true` before destructive filter-only calls. Keep the tool itself permissive — callers opt in.                                                                                             |
| 3   | **`titlePattern` as regex vs. substring**           | Regex / plain substring / glob                | Regex is already used in `search_sessions` (line 407 in manager.ts). Keep it consistent. Document the risk that an untrusted caller could supply a ReDoS pattern; since this runs in-process and the string set is bounded by `storage.listThreads()`, it is acceptable. |
| 4   | **`olderThan` field — `updatedAt` vs. `createdAt`** | `updatedAt` / `createdAt` / both              | `updatedAt` is the right default (last activity time). Expose `createdBefore` as a separate optional if callers need to filter on creation time — avoids overloading one field.                                                                                          |
| 5   | **Worktree cleanup**                                | In-tool / leave gap / block deletion          | Document the gap now, fix in `storage.deleteThread()` separately so both tools benefit. Do not block `bulk_delete_sessions` on it.                                                                                                                                       |
| 6   | **Transaction semantics**                           | Best-effort / atomic                          | Best-effort is correct for this use case. Atomic would require a batch write API on `StorageAdapter` and is premature — add it only if the N-serial-write path shows measurable latency.                                                                                 |
| 7   | **IPC broadcast frequency**                         | Once after batch / per deletion               | Once after the batch. The UI rebuilds from the full list; intermediate broadcasts would only cause unnecessary re-renders.                                                                                                                                               |
| 8   | **`dryRun` output format**                          | Mirror `deleted` / separate `wouldDelete` key | Mirror `deleted` (populate it with IDs that would be deleted). Simpler for callers to handle the same return shape regardless of `dryRun`.                                                                                                                               |

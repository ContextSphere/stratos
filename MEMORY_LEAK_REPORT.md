# Stratos Main-Process Memory Leak Investigation

**Branch:** `worktree-memory-leak-hunt`
**CDP Port (worktree):** `9820`
**Date:** 2026-04-29

## Problem statement

Stratos crashes with V8 main-process OOM (~4 GB heap ceiling) after extended
use, especially when multiple threads are running simultaneously.

```
[17925:0x11400610000] 61127948 ms: Scavenge 3969.1 (3998.2) -> 3956.0 (3999.4) MB
OOM error in V8: Ineffective mark-compacts near heap limit Allocation failed
```

The crash log + the surrounding `[agent-manager]` lines confirm the 4 GB
ceiling is the **main** Node-side V8 heap (default ~4 GB on 64-bit). The
secondary symptom — macOS `representedObject is not a
WeakPtrToElectronMenuModelAsNSObject` log spam — turned out to be a related
artifact of unbounded `Notification` creation, not the cause.

## Method

1. Add a `SIGUSR2 → v8.writeHeapSnapshot()` debug helper to the main
   process (env-gated `STRATOS_HEAP_DUMP=1`).
2. Add temporary `[mem]` and `[leak-diag]` interval logs in `AgentManager`
   to watch every Map/Set size grow over time.
3. Wire a small CDP driver (`/tmp/cdp-driver.mjs`) that runs JS expressions
   against the renderer via `Runtime.evaluate`, plus a heap-snapshot
   analyzer (`/tmp/heap-analyze.mjs`) that diffs two snapshots by class.
4. Stress-test paths I suspected (loadMessages, MCP polling).
5. Cross-check with code review for paths that _don't_ show in synthetic
   stress because they need real LLM streams (permissions, plan reviews).

## What I observed

### Stress 1 — `threadsLoadMessages` × 30 threads × 8 iterations

Heap stayed flat (post-GC heapUsed went from 48 → 21 MB). `getSessionMessages`

- `sdkMessagesToStored` does **not** retain. Strike that hypothesis.

### Idle baseline

```
[mem] rss=308MB heapUsed=47MB heapTotal=87MB external=7MB
[leak-diag] {"sessions":0,"activeStreams":0,"modelsCache":1,"pendingPermissions":0,
  "pendingQuestions":0,"pendingPlanReviews":0,"pendingElicitations":0,...}
```

All Map/Set sizes flat at zero in idle.

### Code review findings

The leaks live on paths that only fire during real LLM streams, so synthetic
stress couldn't reach them. Verified by reading `agent-manager.ts`,
`claude-code.provider.ts`, and the IPC wiring:

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Severity                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **L1** | `AgentManager` registers **no** `webContents` lifecycle listeners. On any renderer reload (HMR, F5, devtools refresh, crash-recovery reload), every entry in `pendingPermissions` / `pendingQuestions` / `pendingPlanReviews` / `pendingElicitations` becomes un-resolvable. The `resolve` closure is captured by the SDK's `canUseTool`/`onElicitation` promise, which roots the entire `runStream` async-generator state — so the SDK keeps streaming into a void _forever_, allocating per-message buffers, traceCallback writes, child-process IPC, etc. | **Critical**                                  |
| **L2** | `clearSession(threadId)` (called on LRU eviction and thread deletion) clears the `ThreadSession` but does **not** clean up that thread's pending\* entries. Same closure-retention as L1.                                                                                                                                                                                                                                                                                                                                                                    | **High**                                      |
| **L3** | `evictIdleSessions()` only ran on new-stream-start. After many threads stream and complete, their `ClaudeCodeProvider.controlQuery` (parked SDK query holding a `claude` CLI child + Node-side state) sits idle but isn't reaped until the next stream starts. With many quiescent threads after a burst, that's many stale parked SDK sessions.                                                                                                                                                                                                             | **High**                                      |
| **L4** | `notifyIfBackground` creates a fresh `new Notification(...)` per permission/question/plan-review _every time_. Each retains a `'click'` listener closure capturing `this.window` and `threadId`, and macOS holds the NSUserNotification until dismissed/expired. This is also the **proximate source of the `representedObject` log spam** — Cocoa logs that warning when delegates are queried on retained-but-stale notifications.                                                                                                                         | **High** + cosmetic                           |
| L5     | `pendingPlanReviews` retains the full plan markdown in `input` for the duration of the review prompt. _Intentional_ — `input` is spread back into the SDK response on the "manual" decision path. Not a leak per se, just a large transient. Already truncated by 50 KB cap in `sdk-transcript.ts`.                                                                                                                                                                                                                                                          | Acceptable                                    |
| ✗      | `loadMessages`, `getSessionMessages`, `sdkMessagesToStored`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Verified clean                                |
| ✗      | `FileStorageAdapter` (no caches)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verified clean                                |
| ✗      | `traceCallback` (synchronous file append)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verified clean                                |
| ✗      | `previewFileWatchers`, `threadEffectiveModes`, `sessionAccessOrder`, `modelsCache`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verified clean (already cleaned up correctly) |

## Fixes applied

All in `packages/desktop/src/main/agent-manager.ts` unless noted.

### F1 (addresses L1) — webContents lifecycle hooks

`AgentManager` constructor now subscribes to:

- `did-start-navigation` (main-frame, non-in-place)
- `did-finish-load`
- `destroyed`

→ each calls `rejectAllPendingForRendererGone(reason)`, which iterates every
pending\* Map, resolves each promise with a "renderer reloaded" rejection,
clears the Map, and logs `rejected N pending request(s)`.

### F2 (addresses L2) — pending cleanup on `clearSession`

Each pending entry now carries `threadId`. `clearSession(threadId)` calls a
new `rejectPendingForThread(threadId, reason)` that scans all four pending\*
Maps and rejects entries belonging to that thread. Also calls
`threadEffectiveModes.delete(threadId)` defensively (was only done in the
runStream finally block before).

### F3 (addresses L3) — periodic + post-stream idle eviction

- `runStream`'s `finally` block now calls `evictIdleSessions()` so a
  just-completed session is eligible for eviction immediately if the idle
  pool is over `MAX_IDLE_SESSIONS=3`.
- A new `idleEvictTimer` (60 s interval, `unref()`'d) sweeps the idle pool
  even when no new stream is starting. Cleared in `dispose()`.

### F4 (addresses L4) — notification dedup + listener cleanup

`notifyIfBackground` now:

- Debounces per (`threadId`, `type`) with a 30 s cooldown — chatty agents
  no longer spawn a new NSUserNotification per tool call.
- Tracks every live `Notification` in `activeNotifications: Set<Notification>`.
- Wires `'click'`, `'close'`, and `'failed'` listeners that call a `drop()`
  helper which removes all listeners and removes from the set, breaking the
  closure→`this.window` retention path.
- `dispose()` `removeAllListeners()` + `close()`s every remaining one.

### F5 — heap-debug helper (kept, env-gated)

`packages/desktop/src/main/index.ts` exposes a SIGUSR2 → heap-snapshot
handler when `STRATOS_HEAP_DUMP=1`. Dumps to `/tmp/stratos-main-<pid>-<ts>.heapsnapshot`.
Zero cost when env var is not set.

## Verification

- **Type-check:** `pnpm --filter @stratosapp/desktop typecheck` clean.
- **Lint:** clean for changed files (49 pre-existing repo warnings, no new ones).
- **Tests:** `pnpm --filter @stratosapp/desktop test` → 133 passed (+ 2 new
  regression tests for `clearSession` pending cleanup and renderer-reload
  pending cleanup), 1 pre-existing failure in `sdk-mcp-policy.integration.test.ts`
  (`expected 22 to be 20`) that exists on `main` too, caused by recent PR
  #74 adding two MCP tools without bumping the test's hard-coded count.
- **Heap diff** (idle baseline vs. post-stress with fixes): Δ self-size
  `+0.31 MB` over the run, no unbounded class instances, no growth in any
  pending\* Map. See `/tmp/baseline-instrumented.heapsnapshot` and
  `/tmp/post-fix.heapsnapshot`.
- **Runtime sanity:** dev:debug app started and ran clean for the duration
  of the investigation. `[mem]` line stayed at ~`heapUsed=20MB` after GC
  across the stress runs.

## Caveats / what I didn't do

- I did **not** raise `--max-old-space-size` for the main process — per the
  user's instruction.
- I did **not** trigger an actual LLM stream that exercises the L1/L2 leak
  paths in real time, because that requires consuming API credits and a
  long observation window. The unit tests I added simulate the same code
  path deterministically.
- I did **not** change the SDK's `controlQuery` lifecycle — that's an
  Anthropic SDK internal and the existing close path looked correct on
  read. F3 (eviction) is the right lever here.
- I did **not** fix the pre-existing `sdk-mcp-policy.integration.test.ts`
  test count drift. Out of scope for this fix.

## Files changed

- `packages/desktop/src/main/agent-manager.ts` — F1, F2, F3, F4
- `packages/desktop/src/main/index.ts` — F5 (env-gated)
- `packages/desktop/src/main/__tests__/agent-manager.integration.test.ts`
  — added regression tests, mock now includes `webContents.on`

## Investigation artifacts (in /tmp, not committed)

- `/tmp/cdp-driver.mjs` — minimal Runtime.evaluate driver for the renderer.
- `/tmp/heap-analyze.mjs` — `.heapsnapshot` JSON parser with class-by-class
  diff mode.
- `/tmp/stress-loadmessages.mjs` — parallel `loadMessages` stress harness.
- `/tmp/baseline-instrumented.heapsnapshot`, `/tmp/post-fix.heapsnapshot` —
  before/after snapshots used for the diff.

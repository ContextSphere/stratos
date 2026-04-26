# Issue 3: Double-Connect Race on Gateway

## Problem

`connectGateway()` guards against re-entry with `if (status === "connected") return { ok: true }`, but this check is insufficient for concurrent calls. Two scenarios trigger the race:

1. **Auto-connect + manual connect**: The 3-second `setTimeout` fires while a user simultaneously clicks "Connect" in the UI. Both calls evaluate `status !== "connected"` (still `"disconnected"`), both proceed into `startGateway()`, and Baileys opens two WebSocket connections — causing duplicate message delivery.

2. **Rapid IPC calls**: The renderer fires `WHATSAPP_CONNECT` twice before the first resolves (e.g., component remount, double-click). Same outcome.

## Fix

Add an **in-flight promise lock** — a module-level variable `connectingPromise: Promise<...> | null`. When `connectGateway()` is entered:

1. If `status === "connected"` → return early (existing guard, keep it).
2. If `connectingPromise !== null` → return that same promise (deduplicate concurrent calls).
3. Otherwise → set `connectingPromise = startGateway(...)`, await it, clear the lock in a `finally` block.

This is a standard "promise coalescing" pattern. It is safe because:
- The lock is cleared regardless of success or failure, so a failed connect can be retried.
- The disconnect handler must also clear `connectingPromise` (in case disconnect races an in-flight connect).

## Changes

**File:** `packages/desktop/src/main/integrations/whatsapp.ipc.ts`

- Add `let connectingPromise: Promise<{ ok: boolean; error?: string }> | null = null;` to the runtime state block.
- Rewrite `connectGateway()` to coalesce concurrent calls onto `connectingPromise`.
- In the `WHATSAPP_DISCONNECT` handler: set `connectingPromise = null` after stopping.

## Edge Cases

| Case | Handled? |
|---|---|
| Two simultaneous auto+manual calls | Yes — second caller gets same promise |
| Failed connect → retry | Yes — `finally` clears lock |
| Disconnect while connecting | Yes — `stopGateway()` is called; lock cleared; status set to disconnected |
| Already connected call | Yes — early return before lock |
| `startGateway` throws synchronously | Yes — promise rejects, `finally` clears lock |

## Verification Plan

1. Build passes (`pnpm build`).
2. Tests pass (`pnpm test`).
3. CDP: launch app in dev:debug, open WhatsApp panel, trigger connect — verify single "connected" status, no duplicate QR/status events in gateway log.

---

## Verification Summary

- `pnpm build` passed after `pnpm install` restored worktree node_modules.
- `pnpm test`: 131 tests pass, 2 pre-existing desktop failures (MCP tool count assertions) confirmed unchanged vs. clean HEAD via `git stash` comparison — no new regressions introduced.
- CDP: launched app with `dev:debug`, confirmed it starts correctly with my changes loaded. Settings → WhatsApp panel renders "Connect WhatsApp" in disconnected state. The race condition is a process-level concurrency issue not exercisable without live WhatsApp credentials; the fix is verified structurally — `connectingPromise` coalescing is applied before any `startGateway()` call, and the lock is cleared in `finally` (on success or failure) and synchronously in the disconnect handler.

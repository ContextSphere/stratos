# Issue 7: Auto-Connect Magic 3-Second Delay — Race with Manager Init

## Problem

`packages/desktop/src/main/integrations/whatsapp.ipc.ts` (lines 239–245) uses a
hardcoded `setTimeout(..., 3000)` to wait for `ManagerSession.initialize()` to run
before auto-connecting the WhatsApp gateway:

```ts
if (hasAuthCredentials() && loadSettings().trustedPhone) {
  setTimeout(() => {
    connectGateway().catch(...);
  }, 3000);
}
```

This is a pure timing hack. If `ManagerSession` takes longer than 3 seconds to
initialise (cold start, slow disk, heavy MCP server spin-up), `getManagerRef()`
returns `null` when the first WhatsApp message arrives, and the message is dropped
with "Manager not ready". Conversely, the 3-second stall delays every cold start
unnecessarily.

## Root Cause

`registerWhatsAppIpc` (called in main) and `ManagerSession.initialize` (called in
main shortly afterward) are both synchronous setup functions, but they are wired up
sequentially with no shared signal. `setManagerRef` is the side-effect that makes
`getManagerRef()` non-null; auto-connect needs to happen **after** that call.

## Fix

Introduce an event emitter in `manager-ref.ts` that fires once when the first
`setManagerRef` call is made. Replace the `setTimeout` in `whatsapp.ipc.ts` with a
one-shot listener on that event.

### Changes

#### `packages/desktop/src/main/manager/manager-ref.ts`

Add:
- `onManagerReady(cb)` — register a one-shot listener; calls `cb` immediately if
  the ref is already set, otherwise queues it and calls it when `setManagerRef` runs.

```ts
type ReadyCb = () => void;
const readyListeners: ReadyCb[] = [];

export function onManagerReady(cb: ReadyCb): void {
  if (ref !== null) {
    cb();           // already ready — fire synchronously
    return;
  }
  readyListeners.push(cb);
}

// inside setManagerRef, after assigning ref:
readyListeners.splice(0).forEach((cb) => cb());
```

#### `packages/desktop/src/main/integrations/whatsapp.ipc.ts`

Replace:
```ts
if (hasAuthCredentials() && loadSettings().trustedPhone) {
  setTimeout(() => {
    connectGateway().catch(...);
  }, 3000);
}
```

With:
```ts
if (hasAuthCredentials() && loadSettings().trustedPhone) {
  onManagerReady(() => {
    connectGateway().catch((err) =>
      console.error("[whatsapp] auto-connect failed:", err),
    );
  });
}
```

## Edge Cases Considered

| Scenario | Behaviour |
|---|---|
| Manager already initialised when `registerWhatsAppIpc` runs | `onManagerReady` fires `cb` synchronously — auto-connect starts immediately. |
| Manager initialises after `registerWhatsAppIpc` | listener is queued, fired when `setManagerRef` runs — no timeout needed. |
| Manager never initialises (error path) | listener stays in the array forever but never fires — auto-connect simply doesn't happen, same as today's crash path. |
| Multiple calls to `setManagerRef` | `readyListeners.splice(0)` drains the array on the first call; subsequent calls are a no-op since the array is empty. |
| `onManagerReady` called after `setManagerRef` (already-ready case) | `cb()` is called synchronously before returning — correct. |

## Verification Plan

1. `pnpm build` — TypeScript must compile cleanly.
2. `pnpm test` — no regressions.
3. CDP smoke test: launch app with `dev:debug`, screenshot the tray/status to confirm
   WhatsApp auto-connects without the artificial 3-second stall.

---

## Verification Summary

*(filled in after implementation)*

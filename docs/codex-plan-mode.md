# Codex Plan Mode — Design Doc

## Overview

When Stratos uses the Codex provider in **plan mode**, the `collaborationMode` parameter must be sent in `turn/start` for the server to enter plan mode. This document describes the empirically verified app-server behavior and the model resolution fix.

## App-Server Behavior (Empirically Verified)

Tested against Codex app-server v0.111.0.

### Protocol Requirements

- **`experimentalApi` capability** must be set in the `initialize` handshake for `collaborationMode` to be accepted. Stratos already sends this.
- **`collaborationMode.settings.model`** must be a non-empty string. Empty `""` or `null` causes a server error. The server does NOT auto-select a model.
- **`collaborationMode/list`** returns available modes (plan, default) with `model: null`, meaning the server supports plan mode but the client must provide a model.

### Plan Mode Notification Flow

When `collaborationMode: { mode: "plan", settings: { model: "gpt-5.4", ... } }` is sent in `turn/start`:

```
turn/start (with collaborationMode)
  → task_started (collaboration_mode_kind: "plan")
  → turn/started
  → item/started (userMessage)
  → item/completed (userMessage)
  → item/agentMessage/delta (text streaming)
  → item/agentMessage/delta ...
  → item/completed (agentMessage)
  → item/started (commandExecution)     ← server may execute read-only commands
  → item/completed (commandExecution)
  → item/agentMessage/delta ...         ← more text
  → item/completed (agentMessage)
  → item/tool/requestUserInput          ← server asks user a clarifying question
  ← (client responds with user's answers)
  → turn/completed
```

Key observations:

1. **No plan-specific notifications**: `item/plan/delta` and `turn/plan/updated` are never sent. All content comes as `item/agentMessage/delta`.
2. **Multiple agentMessage items**: The server sends several agentMessage items per turn (one per "thought"). Each `item/started(agentMessage)` resets the streaming context.
3. **`requestUserInput` is NOT a plan approval gate**: It is a genuine user question (e.g., "which backend do you want?"). These must be forwarded to the user, not auto-approved.
4. **Commands still execute**: Even in plan mode, the server may run read-only commands to gather context.

### Without `collaborationMode`

If `collaborationMode` is omitted from `turn/start`:

- `task_started` reports `collaboration_mode_kind: "default"`
- The server runs in default mode — may execute write commands, behaves like a normal turn
- No `requestUserInput` for plan approval
- Text content may look plan-like but the server treats it as a regular turn

## Problem: `collaborationMode` not sent (no model)

```typescript
// Old code
const modelForPlanMode = collaborationMode.settings.model || model || this.config.model;
if (modelForPlanMode) {  // ← guard prevented sending when model was undefined
  turnParams.collaborationMode = { ... };
}
```

`thread.model` is often `undefined` because the model picker selection doesn't always persist to the thread object (separate bug). Without a model, the guard prevented `collaborationMode` from being sent, so the server ran in default mode instead of plan mode.

### Fix: Model fallback chain

Added `cachedModels?.[0]?.value` to the fallback chain, and `await getAvailableModels()` if cache is empty:

```typescript
// Ensure we have a model for plan mode — fetch from server if needed.
if (!this.cachedModels) {
  try {
    await this.getAvailableModels();
  } catch {}
}
const modelForPlanMode =
  collaborationMode.settings.model ||
  model ||
  this.config.model ||
  this.cachedModels?.[0]?.value;
```

This ensures `collaborationMode` is sent whenever possible, so the server correctly enters plan mode.

## Open Questions

- **Plan content identification**: The app-server sends plan content as regular `agentMessage` deltas, identical to non-plan text. How should Stratos distinguish plan content from regular agent conversation to trigger the plan review UI? The Codex app presumably has custom logic for this.
- **`requestUserInput` role in plan mode**: The server uses `requestUserInput` for genuine clarifying questions during planning. Stratos should display these to the user normally (which it already does via `handleRequestUserInput`).
- **Plan review trigger**: Currently Stratos only triggers plan review when it receives `plan_update` messages. Since the app-server never sends plan-specific notifications, we need a different mechanism to detect when the plan is complete and show the review UI.

## Files Modified

| File                                            | Change                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `packages/core/src/providers/codex.provider.ts` | Model fallback chain for `collaborationMode` in plan mode |

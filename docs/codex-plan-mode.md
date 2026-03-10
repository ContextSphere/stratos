# Codex Plan Mode — Design Doc

## Overview

When Stratos uses the Codex provider in **plan mode**, the app-server behaves differently from what the original code expected. This document describes the actual app-server behavior, the issues that caused plans to not render, and the solution.

## App-Server Behavior (Empirically Verified)

Tested via `scripts/test-codex-plan.mjs` against Codex app-server v0.111.0.

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
  → item/agentMessage/delta (text streaming — plan content)
  → item/agentMessage/delta ...
  → item/completed (agentMessage)
  → item/started (commandExecution)     ← server may execute commands
  → item/completed (commandExecution)
  → item/agentMessage/delta ...         ← more plan text
  → item/completed (agentMessage)
  → item/tool/requestUserInput          ← plan approval point (server request with id)
  ← (client responds with answers)
  → turn/completed
```

Key observations:

1. **No plan-specific notifications**: `item/plan/delta` and `turn/plan/updated` are never sent. All plan content comes as `item/agentMessage/delta`.
2. **Multiple agentMessage items**: The server sends several agentMessage items per turn (one per "thought"). Each `item/started(agentMessage)` resets the current streaming context.
3. **`requestUserInput` is the approval gate**: The server pauses the turn and sends a JSON-RPC request (has `id` field) asking for plan approval. `turn/completed` only fires after the client responds.
4. **Commands still execute**: Even in plan mode, the server may run read-only commands (ls, grep, etc.) to gather context before producing the plan.

### Without `collaborationMode`

If `collaborationMode` is omitted from `turn/start`:

- `task_started` reports `collaboration_mode_kind: "default"`
- No `requestUserInput` is sent
- Turn completes normally
- Text content is identical (plan-like) but the server treats it as a regular turn

## Root Causes

### Issue 1: `collaborationMode` not sent (no model)

```typescript
// Old code
const modelForPlanMode = collaborationMode.settings.model || model || this.config.model;
if (modelForPlanMode) {  // ← guard prevented sending when model was undefined
  turnParams.collaborationMode = { ... };
}
```

`thread.model` is often `undefined` because the model picker selection doesn't always persist to the thread object. Without `collaborationMode`, the server runs in default mode.

**Fix**: Added `cachedModels?.[0]?.value` to the fallback chain, and `await getAvailableModels()` if cache is empty:

```typescript
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

### Issue 2: `streamingText` reset per item

```typescript
case "item/started":
  if (itemType === "agentMessage") streamingText = "";  // ← reset!
case "item/completed":
  if (item?.type === "agentMessage") streamingText = "";  // ← reset!
```

The server sends multiple `agentMessage` items per turn. By the time `requestUserInput` arrived, the last `agentMessage` was already completed and `streamingText` was empty.

**Fix**: Added `allTurnText` — a separate accumulator that is never reset:

```typescript
let allTurnText = ""; // Accumulates ALL agentMessage text across the turn

case "item/agentMessage/delta":
  streamingText += delta;
  allTurnText += delta;  // ← never reset
```

### Issue 3: `requestUserInput` not converted to plan review

The existing `handleRequestUserInput` showed raw server questions to the user via the permission system, which is wrong for plan mode — the plan content should trigger Stratos's own plan review UI.

**Fix**: In plan mode, intercept `requestUserInput`, emit `plan_update` with `allTurnText`, and auto-approve the server request:

```typescript
case "item/tool/requestUserInput":
  if (params.mode === "plan" && allTurnText && !streamingPlan) {
    yield { type: "plan_update", content: allTurnText, isStreaming: false };
    // Auto-approve — Stratos's plan review handles user approval
    this.sendResponse(requestId, { answers: { ... } });
  } else {
    yield* this.handleRequestUserInput(p, requestId, params);
  }
```

## Data Flow

```
App-Server                    Codex Provider                Agent Manager              Renderer
    │                              │                             │                        │
    │ item/agentMessage/delta      │                             │                        │
    ├─────────────────────────────►│ yield {type:"text"}         │                        │
    │                              ├────────────────────────────►│ STREAM_MESSAGE          │
    │                              │                             ├───────────────────────►│
    │                              │ allTurnText += delta        │                        │ (shows text
    │                              │                             │                        │  in chat)
    │ ... (more deltas, commands)  │                             │                        │
    │                              │                             │                        │
    │ requestUserInput (id:0)      │                             │                        │
    ├─────────────────────────────►│ yield {type:"plan_update"}  │                        │
    │                              ├────────────────────────────►│ sawPlanUpdate = true    │
    │                              │                             │ latestPlanContent += .. │
    │                              │ sendResponse(0, answers)    │                        │
    │◄─────────────────────────────┤                             │                        │
    │                              │                             │                        │
    │ turn/completed               │                             │                        │
    ├─────────────────────────────►│ (generator returns)         │                        │
    │                              │                             │ requestPlanReview()     │
    │                              │                             ├───────────────────────►│
    │                              │                             │                        │ (shows plan
    │                              │                             │                        │  review UI)
```

## Fallback Path

When `collaborationMode` can't be sent (no model available at all), the server runs in default mode. The turn completes normally without `requestUserInput`. The fallback at the end of `processTurnNotifications` catches this:

```typescript
// After while loop exits (turn/completed)
if (params.mode === "plan" && allTurnText && !streamingPlan) {
  yield { type: "plan_update", content: allTurnText, isStreaming: false };
}
```

## Testing

- **Diagnostic script**: `node scripts/test-codex-plan.mjs [prompt]` spawns the app-server and logs all notifications for a plan turn.
- **Manual**: Codex + Plan mode in dev app, verify plan text renders inline and "Plan is ready" review dialog appears.
- **Unit tests**: `pnpm test` — all existing tests pass.

## Files Modified

| File                                            | Change                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/core/src/providers/codex.provider.ts` | Model fallback, allTurnText accumulator, requestUserInput interception, post-turn fallback |
| `scripts/test-codex-plan.mjs`                   | New diagnostic script                                                                      |

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
  → item/agentMessage/delta (text streaming)    ← commentary / thinking
  → item/agentMessage/delta ...
  → item/completed (agentMessage)
  → item/started (commandExecution)              ← read-only commands for context
  → item/completed (commandExecution)
  → item/agentMessage/delta ...                  ← more commentary
  → item/completed (agentMessage)
  → item/tool/requestUserInput                   ← clarifying question (has id)
  ← (client responds with user's answers)
  → item/plan/delta (× many)                     ← plan content as markdown
  → item/completed (plan)                        ← plan finalized
  → turn/completed
```

Key observations:

1. **`item/plan/delta` IS sent** — but only AFTER `requestUserInput` is answered. In testing, 559 plan deltas were emitted streaming a full markdown plan (with headings, steps, code snippets).
2. **Multiple agentMessage items precede the plan**: The server sends commentary as `agentMessage` deltas while gathering context. These are NOT the plan — they are thinking/status updates.
3. **`requestUserInput` is a genuine clarifying question**: It asks real questions (e.g., "which backend do you want?") with multiple-choice options. Must be forwarded to user, never auto-approved.
4. **Commands still execute**: Even in plan mode, the server runs read-only commands to gather context before asking questions.
5. **Plan comes last**: The plan is only generated after the server has gathered context and received user input on any clarifying questions.

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

## Status

The model fallback chain fix ensures `collaborationMode` is sent, which causes the server to enter plan mode. The server then sends `item/plan/delta` notifications containing the plan as markdown. Stratos already handles these at `codex.provider.ts:1042` by yielding `plan_update` messages, which trigger the plan review UI via `agent-manager.ts`.

## Files Modified

| File                                            | Change                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `packages/core/src/providers/codex.provider.ts` | Model fallback chain for `collaborationMode` in plan mode |

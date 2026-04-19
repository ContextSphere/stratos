# Manager Agent UI Polish

Two small UX changes for the Manager agent thread:

1. Hide the permission-mode toggle (and Shift+Tab cycle) — always force `bypassPermissions`.
2. Replace the generic empty state ("Stratos" / "Type a message to get started") with a Manager-specific one that explains what it does.

## Current state

- Manager thread is detected in the renderer via `isManagerActive` — `packages/desktop/src/renderer/App.tsx:100-101`.
- Backend **already forces** `bypassPermissions` for the manager in two places:
  - Thread creation: `packages/desktop/src/main/manager/manager-session.ts:158`
  - Every `sendMessage` call: `packages/desktop/src/main/manager/manager-session.ts:212`
- Because of this, the visible `ModeToggle` on the manager thread is a leaky UI: the user can click between "Default" and "Bypass", the thread record updates, but the backend ignores it. Removing the toggle just aligns the UI with existing behavior.
- Empty state is hardcoded in `packages/ui/src/components/ChatView.tsx:174-185`.

## Plan

### 1. Hide the mode toggle for the manager thread

**File:** `packages/desktop/src/renderer/App.tsx`

- Wrap the `<ModeToggle … />` render (lines 1187–1203) in `{!isManagerActive && …}` so it does not appear in the manager toolbar.
- Guard the Shift+Tab cycle-modes shortcut (lines 763–783): early-return when `isManagerActive` is true so the keybinding is a no-op in the manager.
- Belt-and-braces: in `handleModeChange` (lines 611–621) no-op when `isManagerActive`. Prevents any remaining code path from mutating the manager thread's mode.

No backend changes needed — mode is already hardcoded to `bypassPermissions` server-side.

### 2. Manager-specific empty state

Keep the UI package platform-agnostic: the manager concept lives in desktop, so don't import it into `@stratosapp/ui`. Instead, make the empty state injectable.

**File:** `packages/ui/src/components/ChatView.tsx`

- Add an optional prop `emptyState?: ReactNode` to `ChatView`.
- At the empty-state render site (lines 174–185), use `emptyState` when provided, else fall back to the current "Stratos" / "Type a message to get started" content.

**File:** `packages/desktop/src/renderer/App.tsx`

- Where `ChatView` is rendered for the active thread, pass an `emptyState` node when `isManagerActive`:
  - Title: **Manager**
  - Body (2–3 short lines), e.g.:
    - "Orchestrates agent sessions across your workspaces."
    - "Dispatch tasks, check on progress, and relay messages."
    - "Runs in bypass mode — no permission prompts."
- Non-manager threads pass no `emptyState` prop, preserving existing behavior.

Exact copy is easy to tweak later; the plan is the structure.

## Files touched

| File                                      | Change                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/renderer/App.tsx`   | Guard ModeToggle render, Shift+Tab handler, and `handleModeChange` with `!isManagerActive`; pass `emptyState` to ChatView when `isManagerActive` |
| `packages/ui/src/components/ChatView.tsx` | Add optional `emptyState?: ReactNode` prop; render it in place of the default when provided                                                      |

No changes required in `@stratosapp/core` or in `packages/desktop/src/main/manager/*`.

## Test plan

- **Unit (`@stratosapp/ui`):** ChatView renders the custom `emptyState` when provided; falls back to the default title/subtitle when omitted.
- **Manual / CDP MCP verification:**
  - Open the manager thread with zero messages → empty state shows "Manager" + description; no ModeToggle in toolbar; Shift+Tab does nothing.
  - Send a message in the manager thread → streams and uses bypass (no permission prompts) as today.
  - Open a regular thread with zero messages → default "Stratos" empty state; ModeToggle present; Shift+Tab cycles modes as today.

## Non-goals

- No change to backend manager permission handling — already bypass.
- No change to `ModelSelector` on the manager toolbar — user can still pick a provider/model.
- No change to non-manager threads' mode UX or defaults.

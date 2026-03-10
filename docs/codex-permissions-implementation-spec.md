# Codex Permissions Implementation Spec

## Status

Proposed. Not implemented.

## Goal

Update the Stratos Codex provider and UI so Codex permission modes match the
Codex app model instead of Claude-derived modes.

## Scope

In scope:

- Codex mode model
- Codex provider mapping to app-server fields
- Codex mode picker labels
- Codex thread-mode normalization and migration
- Desktop permission-resolution behavior for Codex
- Tests and docs

Out of scope:

- Claude Code mode behavior
- Broad rework of shared provider abstractions beyond what is needed
- Switching the entire provider to new structured `sandboxPolicy` objects unless
  required for this change

## Desired UX

Codex should expose exactly three selectable modes:

- `Plan`
- `Default permissions`
- `Full access`

Internal stored value names:

- `plan`
- `default`
- `fullAccess`

Notes:

- Keep `default` as the stored value for stability
- Do not expose `acceptEdits` for Codex
- Do not expose `bypassPermissions` for Codex

## Validated Low-Level Mapping

Validated against the installed `codex-cli 0.111.0` app-server:

- `default`
  - `approvalPolicy = "on-request"`
  - `sandbox = "workspace-write"`
- `fullAccess`
  - `approvalPolicy = "never"`
  - `sandbox = "danger-full-access"`
- `plan`
  - `approvalPolicy = "never"`
  - `sandbox = "read-only"`

Important validation note:

- Do not use `approvalPolicy = "unlessTrusted"` in Stratos. The shipped
  app-server rejects it.

## Design Decisions

### 1. Keep shared storage value `default`

Decision:

- Keep `default` as the persisted mode value
- Change only the Codex UI label to `Default permissions`

Rationale:

- Avoid unnecessary migration churn
- Preserve compatibility with existing thread records
- Match your explicit preference

### 2. Introduce `fullAccess` as a first-class mode

Decision:

- Add `fullAccess` to the shared mode union
- Use it for Codex only initially

Rationale:

- `bypassPermissions` is Claude-oriented naming
- Codex app language is `Full access`

### 3. Provider-aware mode availability

Decision:

- Mode availability and labels must become provider-aware

Expected mode sets:

- Claude Code
  - `plan`
  - `default`
  - `acceptEdits`
  - `bypassPermissions`
- Codex
  - `plan`
  - `default`
  - `fullAccess`

Rationale:

- A single shared mode list is the root of the current mismatch

### 4. Keep current `thread/start` and `turn/start` field style for this change

Decision:

- For this permission-mode change, keep Stratos using:
  - `thread/start` with `approvalPolicy` + `sandbox`
  - `turn/start` with `approvalPolicy` + `sandbox`

Rationale:

- This is already accepted by the shipped app-server
- It minimizes change surface
- Moving to structured `sandboxPolicy` can be a separate cleanup

Follow-up:

- A later refactor can migrate `turn/start` to structured `sandboxPolicy`

## Implementation Plan

### Step 1. Update mode types

Files:

- [`packages/core/src/types/thread.ts`](/Users/ajay/stratos/packages/core/src/types/thread.ts)
- [`packages/core/src/types/mode.ts`](/Users/ajay/stratos/packages/core/src/types/mode.ts)
- [`packages/ui/src/utils/modes.ts`](/Users/ajay/stratos/packages/ui/src/utils/modes.ts)

Changes:

- Add `fullAccess` to `AgentMode`
- Keep `default`
- Keep `acceptEdits` and `bypassPermissions` in the union only if still needed
  for Claude and migration
- Make mode config lookup provider-aware instead of a single shared list

Suggested shape:

- shared mode union may remain broad
- exported helper returns per-provider modes and labels

### Step 2. Add provider-specific mode configuration

Files:

- [`packages/core/src/types/mode.ts`](/Users/ajay/stratos/packages/core/src/types/mode.ts)
- [`packages/ui/src/utils/modes.ts`](/Users/ajay/stratos/packages/ui/src/utils/modes.ts)

Changes:

- Replace the single `MODE_CONFIGS` / `AGENT_MODES` assumption with:
  - provider-specific mode arrays
  - provider-specific labels/descriptions

Codex target copy:

- `plan`
  - label: `Plan`
  - description: `Read-only. Plans without modifying files.`
- `default`
  - label: `Default permissions`
  - description: `Lets Codex edit and run commands in the workspace. Prompts before network or actions outside that scope.`
- `fullAccess`
  - label: `Full access`
  - description: `Allows unrestricted file access and network access without permission prompts.`

### Step 3. Change Codex provider mapping

File:

- [`packages/core/src/providers/codex.provider.ts`](/Users/ajay/stratos/packages/core/src/providers/codex.provider.ts)

Changes:

- Replace current Claude-derived mapping logic:
  - remove Codex mapping for `acceptEdits`
  - remove Codex mapping for `bypassPermissions`
- Add mapping for `fullAccess`

Target mapping function:

- `plan` -> `{ approvalPolicy: "never", sandbox: "read-only" }`
- `default` -> `{ approvalPolicy: "on-request", sandbox: "workspace-write" }`
- `fullAccess` -> `{ approvalPolicy: "never", sandbox: "danger-full-access" }`

Fallback behavior:

- Unknown Codex mode should default to `default`

### Step 4. Make desktop approval behavior provider-aware

File:

- [`packages/desktop/src/main/agent-session-logic.ts`](/Users/ajay/stratos/packages/desktop/src/main/agent-session-logic.ts)

Problem:

- Current logic encodes Claude-style semantics:
  - `acceptEdits` auto-approves a large tool set
  - `bypassPermissions` auto-approves everything

Changes:

- Add provider-aware resolution path, or add a Codex-specific resolver

Codex behavior target:

- `plan`
  - `ExitPlanMode` still opens plan review
- `default`
  - normal prompt flow
- `fullAccess`
  - auto-approve everything

Important detail:

- Codex app-server already enforces sandbox/approval behavior
- The desktop resolver still matters for Stratos UI behavior around generic
  dialogs and special plan handling

### Step 5. Normalize existing stored Codex threads

File:

- [`packages/core/src/types/thread.ts`](/Users/ajay/stratos/packages/core/src/types/thread.ts)

Changes:

- Keep global normalization for legacy `execute -> default`
- Add provider-aware normalization path when loading Codex threads:
  - `acceptEdits` -> `default`
  - `bypassPermissions` -> `fullAccess`

Recommended approach:

- Do not change global normalization for Claude
- Normalize in the layer that knows the provider

Likely touch points:

- thread load path in desktop/main
- any place that creates mode defaults for a thread

### Step 6. Update UI mode picker

Likely files:

- renderer mode picker components
- any place that renders mode pills or tooltips

Expected behavior:

- Codex threads show only:
  - `Plan`
  - `Default permissions`
  - `Full access`
- Claude threads retain their current set

### Step 7. Update tests

Files likely affected:

- [`packages/core/src/__tests__/codex.provider.test.ts`](/Users/ajay/stratos/packages/core/src/__tests__/codex.provider.test.ts)
- [`packages/ui/src/__tests__/ModeToggle.test.tsx`](/Users/ajay/stratos/packages/ui/src/__tests__/ModeToggle.test.tsx)
- desktop tests that assert approval behavior

Add assertions for:

- Codex `default` maps to `on-request` + `workspace-write`
- Codex `fullAccess` maps to `never` + `danger-full-access`
- legacy Codex `acceptEdits` normalizes to `default`
- legacy Codex `bypassPermissions` normalizes to `fullAccess`
- Codex UI does not render `acceptEdits` / `bypassPermissions`

## Risks

### Shared-mode coupling

Risk:

- Claude and Codex currently share common mode helpers and assumptions

Mitigation:

- Make mode config/provider mapping explicitly provider-aware

### Persisted thread behavior drift

Risk:

- Old stored Codex threads may open in an unavailable mode

Mitigation:

- Add provider-aware normalization on read/load

### Dual protocol surface in app-server

Risk:

- `thread/start` uses string sandbox enums while `turn/start` also supports
  structured sandbox policy objects

Mitigation:

- Keep current legacy-compatible request format for this change
- Document the future cleanup separately

## Acceptance Criteria

1. A Codex thread only offers `Plan`, `Default permissions`, and `Full access`.
2. Selecting Codex `Default permissions` sends `approvalPolicy = "on-request"`
   and `sandbox = "workspace-write"`.
3. Selecting Codex `Full access` sends `approvalPolicy = "never"` and
   `sandbox = "danger-full-access"`.
4. Codex no longer references `acceptEdits` or `bypassPermissions` in visible
   UI.
5. Existing stored Codex threads with legacy modes normalize cleanly.
6. Claude mode behavior remains unchanged.

## Deferred Follow-Ups

- Migrate Codex `turn/start` from legacy `sandbox` strings to structured
  `sandboxPolicy`
- Consider whether `plan` should also use structured `sandboxPolicy.readOnly`
  for parity with app-server v2
- Revisit whether shared `AgentMode` should be split into provider-specific
  unions

## References

- [Codex permissions research notes](/Users/ajay/stratos/docs/codex-permissions.md)
- https://developers.openai.com/codex/cli/features#approval-modes
- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/app-server

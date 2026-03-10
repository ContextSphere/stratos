# Codex Permissions Research Notes

## Purpose

This document captures how permission handling works in Codex today across the:

- Codex app / CLI user-facing presets
- Codex CLI config surface
- Codex SDK types
- Codex app-server protocol
- Stratos Codex provider integration

It exists because Stratos previously mapped Claude-specific permission modes onto
Codex, which no longer matches the Codex product model.

## Executive Summary

Codex currently has two layers of permission concepts:

1. Product-level presets shown to users
2. Low-level protocol/config fields used by CLI, SDK, and app-server

The important distinction is:

- The Codex app and CLI present `Auto`, `Read-only`, and `Full Access`
- The app-server and SDK deal in approval policy values and sandbox values
- Stratos should model Codex using Codex-facing presets, not Claude-facing
  intermediate modes like `acceptEdits`

For Stratos, the correct user-facing Codex modes are:

- `plan`
- `default` (label: `Default permissions`)
- `fullAccess` (label: `Full access`)

## User-Facing Codex Presets

Current Codex CLI docs describe three interactive approval modes:

- `Auto` (default)
- `Read-only`
- `Full Access`

Meaning:

- `Auto` lets Codex read files, make edits, and run commands inside the working
  directory. It still asks before leaving that scope or using network access.
- `Read-only` keeps Codex consultative. It can inspect files but should not make
  changes or run commands without approval.
- `Full Access` removes sandbox and approval constraints and allows network
  access.

Sources:

- https://developers.openai.com/codex/cli/features#approval-modes
- https://developers.openai.com/codex/agent-approvals-security

## CLI / Config Layer

At the config layer, Codex permission handling is split into:

- `approval_policy`
- `sandbox_mode`

Current config reference values:

- `approval_policy`
  - `untrusted`
  - `on-request`
  - `never`
  - `{ reject = { ... } }`
- `sandbox_mode`
  - `read-only`
  - `workspace-write`
  - `danger-full-access`

Notes:

- The docs now describe `on-failure` as deprecated in config docs, but the
  installed SDK/app-server typings still include it.
- `workspace-write` defaults to network disabled unless separately enabled.
- `danger-full-access` removes sandbox restrictions.

Relevant docs:

- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/agent-approvals-security

## Preset-to-Low-Level Mapping

The current Codex docs make these preset mappings explicit:

- `Auto`
  - sandbox: `workspace-write`
  - approval: `on-request`
- `Read-only`
  - sandbox: `read-only`
  - approval: typically interactive approval when escalation is needed
- `Full Access`
  - sandbox: `danger-full-access`
  - approval: `never`

The security docs also state:

- `--full-auto` is an alias for `--sandbox workspace-write --ask-for-approval on-request`
- `--yolo` / `--dangerously-bypass-approvals-and-sandbox` maps to dangerous full
  access without prompts

Source:

- https://developers.openai.com/codex/agent-approvals-security

## SDK Layer

Installed package:

- `@openai/codex-sdk` version `0.111.0`

The shipped SDK types still expose the lower-level fields rather than the
product presets:

- `ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted"`
- `SandboxMode = "read-only" | "workspace-write" | "danger-full-access"`

Source in this repo:

- [`node_modules/.pnpm/@openai+codex-sdk@0.111.0/node_modules/@openai/codex-sdk/dist/index.d.ts`](/Users/ajay/stratos/node_modules/.pnpm/@openai+codex-sdk@0.111.0/node_modules/@openai/codex-sdk/dist/index.d.ts)

Implication:

- The SDK surface does not expose `Auto`, `Read-only`, or `Full Access`
  directly.
- Any product-style mode picker must be translated by the client.

## App-Server v2 Protocol

The installed Codex binary is:

- `codex-cli 0.111.0`

The generated app-server v2 protocol types show:

- `thread/start`
  - accepts `approvalPolicy?: AskForApproval`
  - accepts `sandbox?: SandboxMode`
- `turn/start`
  - accepts `approvalPolicy?: AskForApproval`
  - accepts `sandboxPolicy?: SandboxPolicy`

Generated type files:

- [`/tmp/codex-app-ts/v2/ThreadStartParams.ts`](/tmp/codex-app-ts/v2/ThreadStartParams.ts)
- [`/tmp/codex-app-ts/v2/TurnStartParams.ts`](/tmp/codex-app-ts/v2/TurnStartParams.ts)
- [`/tmp/codex-app-ts/v2/AskForApproval.ts`](/tmp/codex-app-ts/v2/AskForApproval.ts)
- [`/tmp/codex-app-ts/SandboxPolicy.ts`](/tmp/codex-app-ts/SandboxPolicy.ts)

### Important v2 detail

The newer `turn/start` protocol prefers structured sandbox objects, not the old
string enum:

- `sandboxPolicy.type = "workspaceWrite"`
- `sandboxPolicy.type = "readOnly"`
- `sandboxPolicy.type = "danger-full-access"`
- `sandboxPolicy.type = "external-sandbox"`

Field naming is camelCase in the generated TypeScript.

## Live Validation Against Shipped Binary

Validation was run locally against:

- `node_modules/.pnpm/node_modules/.bin/codex app-server`

### Confirmed behaviors

1. `thread/start` accepts:
   - `approvalPolicy: "on-request"`
   - `sandbox: "workspace-write"`

2. `thread/start` rejects:
   - `approvalPolicy: "unlessTrusted"`

   Returned error:
   - `unknown variant 'unlessTrusted', expected one of 'untrusted', 'on-failure', 'on-request', 'reject', 'never'`

3. `turn/start` still accepts Stratos's current legacy fields:
   - `approvalPolicy: "on-request"`
   - `sandbox: "workspace-write"`

4. `turn/start` also accepts the newer structured sandbox form when the enum
   name is correct:
   - `sandboxPolicy: { type: "workspaceWrite", ... }`
   - `sandboxPolicy: { type: "readOnly", ... }`

5. `turn/start` rejects the kebab-case variant in `sandboxPolicy.type`:
   - `"workspace-write"` is invalid there
   - `"workspaceWrite"` is required

### Interpretation

For the shipped app-server version in this repo:

- `on-request` is the correct low-level approval value for Codex default mode
- `unlessTrusted` should not be used by Stratos
- Stratos can keep using the existing legacy `sandbox` string on `turn/start`
  for now, but the protocol direction is moving toward structured
  `sandboxPolicy`

## Approval Requests

At runtime, Codex app-server sends permission prompts back to the client as
server requests, including:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`

The generated protocol also includes:

- `execCommandApproval`
- `applyPatchApproval`

Current Stratos already handles the command/file approval request flow in the
Codex provider and forwards it through `permissionHandler`.

Relevant files:

- [`packages/core/src/providers/codex.provider.ts`](/Users/ajay/stratos/packages/core/src/providers/codex.provider.ts)
- [`packages/desktop/src/main/agent-manager.ts`](/Users/ajay/stratos/packages/desktop/src/main/agent-manager.ts)

## What Was Wrong In Stratos

Stratos currently exposes these shared modes to Codex:

- `plan`
- `default`
- `acceptEdits`
- `bypassPermissions`

That mapping is inherited from Claude-style semantics and is incorrect for
Codex UX because:

- `acceptEdits` is not a Codex app mode
- `bypassPermissions` is not the Codex app label
- the Codex app presents `Default permissions` and `Full access`

Affected files:

- [`packages/core/src/types/mode.ts`](/Users/ajay/stratos/packages/core/src/types/mode.ts)
- [`packages/ui/src/utils/modes.ts`](/Users/ajay/stratos/packages/ui/src/utils/modes.ts)
- [`packages/core/src/providers/codex.provider.ts`](/Users/ajay/stratos/packages/core/src/providers/codex.provider.ts)
- [`packages/desktop/src/main/agent-session-logic.ts`](/Users/ajay/stratos/packages/desktop/src/main/agent-session-logic.ts)

## Recommended Stratos Model

Keep internal stored value:

- `default`

Introduce Codex-specific mode set:

- `plan`
- `default`
- `fullAccess`

Use Codex UI labels:

- `Plan`
- `Default permissions`
- `Full access`

Low-level mapping:

- `plan`
  - thread start: sandbox `read-only`
  - turns: plan collaboration mode + read-only sandbox
- `default`
  - approval `on-request`
  - sandbox `workspace-write`
- `fullAccess`
  - approval `never`
  - sandbox `danger-full-access`

## Sources

- https://developers.openai.com/codex/cli/features#approval-modes
- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/app-server
- [`node_modules/.pnpm/@openai+codex-sdk@0.111.0/node_modules/@openai/codex-sdk/dist/index.d.ts`](/Users/ajay/stratos/node_modules/.pnpm/@openai+codex-sdk@0.111.0/node_modules/@openai/codex-sdk/dist/index.d.ts)
- [`/tmp/codex-app-ts/v2/ThreadStartParams.ts`](/tmp/codex-app-ts/v2/ThreadStartParams.ts)
- [`/tmp/codex-app-ts/v2/TurnStartParams.ts`](/tmp/codex-app-ts/v2/TurnStartParams.ts)
- [`/tmp/codex-app-ts/v2/AskForApproval.ts`](/tmp/codex-app-ts/v2/AskForApproval.ts)
- [`/tmp/codex-app-ts/SandboxPolicy.ts`](/tmp/codex-app-ts/SandboxPolicy.ts)

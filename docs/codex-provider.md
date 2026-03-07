# OpenAI Codex Provider — Design & Implementation

## Overview

AgentPanel supports **OpenAI Codex** as a second provider alongside Claude Code. Users can select which provider to use per-thread via the provider toggle in the bottom toolbar.

## Architecture

### Provider Abstraction

The `AgentProvider` interface in `packages/core/src/providers/types.ts` defines the contract all providers must implement:

```typescript
interface AgentProvider {
  readonly name: string
  initialize(config: ProviderConfig): Promise<void>
  sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage>
  interrupt(): Promise<void>
  canResume(sessionId: string): boolean
  getAvailableModels(): Promise<ModelInfo[]>
  discoverSlashCommands(): Promise<{ name: string; description?: string }[]>
  dispose(): Promise<void>
}
```

### Thread-Level Provider Selection

Each thread stores a `provider` field (`'claude-code' | 'codex'`). Default is `'claude-code'` for backward compatibility. The `AgentManager` in `packages/desktop/src/main/agent-manager.ts` uses `createProvider(thread.provider)` to instantiate the correct provider per thread.

## App-Server Protocol (JSON-RPC 2.0 over stdio)

### Why Not the SDK?

The original implementation used `@openai/codex-sdk`'s TypeScript API which internally spawns `codex exec --experimental-json`. This mode has a critical limitation: **it only emits `item.completed` events** — there are no `item.started` or `item.updated` events, meaning no token-by-token text streaming. Text appears all at once after the model finishes.

This was confirmed through exhaustive testing across multiple models (`gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex`) and SDK versions (`0.1.0-alpha.12`, `0.1.0-alpha.15`). The `codex exec` protocol simply does not support streaming deltas.

### App-Server Protocol

The **app-server** is a different subcommand (`codex app-server`) that uses bidirectional JSON-RPC 2.0 over stdio and supports true token-by-token streaming via `item/agentMessage/delta` notifications.

**Key documentation:** [developers.openai.com/codex/app-server](https://developers.openai.com/codex/app-server/)

### Protocol Flow

```
Client                          Server (codex app-server)
  |                                 |
  |-- initialize ------------------>|  (handshake)
  |<------------ initializeResult --|
  |-- initialized (notification) -->|  (required, confirms handshake)
  |                                 |
  |-- thread/start ---------------->|  (create thread with config)
  |<------------ thread/started ----|  (notification with threadId)
  |<----------- threadStartResult --|
  |                                 |
  |-- turn/start ------------------>|  (send user message)
  |<------------ turn/started ------|
  |<-- item/started ----------------|  (agentMessage begins)
  |<-- item/agentMessage/delta -----|  (token-by-token streaming)
  |<-- item/agentMessage/delta -----|
  |<-- ...                          |
  |<-- item/completed --------------|  (agentMessage finalized)
  |<-- item/started ----------------|  (commandExecution begins)
  |<-- item/commandExecution/       |
  |    outputDelta -----------------|  (streaming command output)
  |<-- item/completed --------------|
  |<-- turn/completed --------------|  (turn done with status + usage)
```

### Message Types

**Client → Server (requests):**

| Method | Purpose |
|---|---|
| `initialize` | Handshake with client info and capabilities |
| `thread/start` | Create new thread with model, cwd, sandbox, approval settings |
| `thread/resume` | Resume existing thread by threadId |
| `turn/start` | Send user message, start a new turn |
| `turn/steer` | Append input to an in-flight turn |
| `turn/interrupt` | Cancel the current turn |
| `model/list` | Discover available models dynamically |
| `skills/list` | Discover available skills (slash commands) |

**Client → Server (notifications):**

| Method | Purpose |
|---|---|
| `initialized` | Required after `initialize` response — confirms handshake |

**Server → Client (notifications):**

| Method | Purpose |
|---|---|
| `item/agentMessage/delta` | Token-by-token text streaming (the key event) |
| `item/reasoning/summaryTextDelta` | Reasoning summary streaming |
| `item/reasoning/textDelta` | Raw reasoning streaming |
| `item/plan/delta` | Plan streaming |
| `item/commandExecution/outputDelta` | Command stdout/stderr streaming |
| `item/fileChange/outputDelta` | File diff streaming |
| `item/started` | Item begins (agentMessage, commandExecution, fileChange, etc.) |
| `item/completed` | Item finalized with full data |
| `turn/started` | Turn begins |
| `turn/completed` | Turn ends with status and token usage |
| `thread/tokenUsage/updated` | Running token usage updates |
| `thread/name/updated` | Auto-generated thread name |
| `thread/compacted` | Context window was compacted |
| `model/rerouted` | Server rerouted to a different model |

**Server → Client (requests, require response):**

| Method | Purpose |
|---|---|
| `item/commandExecution/requestApproval` | Command needs user approval |
| `item/fileChange/requestApproval` | File change needs user approval |

### Item Types (camelCase)

| Type | Description |
|---|---|
| `agentMessage` | Text response from the model |
| `reasoning` | Model's internal reasoning (summary + content) |
| `plan` | Structured plan for the task |
| `commandExecution` | Shell command with command, cwd, exitCode, aggregatedOutput, durationMs |
| `fileChange` | File modifications with changes array (kind: add/update/delete, path) |
| `mcpToolCall` | MCP server tool invocation |
| `dynamicToolCall` | Dynamic tool invocation |
| `webSearch` | Web search query |
| `imageView` | Image file viewed |
| `imageGeneration` | Image generated |
| `contextCompaction` | Context window compacted |
| `error` | Error item |

### Type Bindings

Generated TypeScript types are available from the binary itself:

```bash
codex app-server generate-ts --out /tmp/codex-ts
```

Key type files:
- `ServerNotification.ts` — Full union of all notification types
- `ClientRequest.ts` — Full union of all RPC methods
- `ServerRequest.ts` — Server-initiated requests (approvals, dynamic tools)
- `v2/ThreadStartParams.ts` — Thread configuration
- `v2/TurnStartParams.ts` — Turn input parameters
- `v2/UserInput.ts` — Input types (text, image, localImage, skill, mention)
- `v2/AskForApproval.ts` — Approval policy enum
- `v2/SandboxMode.ts` — Sandbox policy enum
- `v2/Model.ts` — Model metadata from `model/list`

## Streaming Contract

The UI expects each `{ type: 'text', content, isStreaming: true }` message to contain **only the new delta characters**, not the accumulated text. The UI appends each delta.

```
// CORRECT — send just the delta
yield { type: 'text', content: delta, isStreaming: true }

// WRONG — would cause text duplication
yield { type: 'text', content: accumulatedText, isStreaming: true }
```

On `item/completed` for `agentMessage`, if deltas were already streamed, emit empty content to finalize:
```
yield { type: 'text', content: '', isStreaming: false }
```

## Mode Mapping

AgentPanel has four permission modes that map to Codex approval policies and sandbox modes:

| AgentPanel Mode | Claude Code Behavior | Codex `approvalPolicy` | Codex `sandbox` |
|---|---|---|---|
| **plan** | Read-only, no file modifications | `never` | `read-only` |
| **default** | Prompts for every tool use | `untrusted` | `workspace-write` |
| **acceptEdits** | Auto-accepts edits, prompts for commands | `on-request` | `workspace-write` |
| **bypassPermissions** | Skips all permission prompts | `never` | `danger-full-access` |

### Codex Approval Policy Semantics

| Policy | Behavior |
|---|---|
| `untrusted` | Always ask for approval before any tool execution (most restrictive) |
| `on-request` | Ask when the model explicitly requests it (file changes auto-approve, commands may prompt) |
| `on-failure` | Ask only when a command fails |
| `never` | Never ask — auto-approve everything |
| `{ reject: {...} }` | Granular auto-reject of specific categories (sandbox_approval, rules, mcp_elicitations) |

### Codex Sandbox Policies

| Policy | Behavior |
|---|---|
| `read-only` | Read-only filesystem access — no file writes, no commands that modify state |
| `workspace-write` | Write access restricted to workspace directory (default) |
| `danger-full-access` | No filesystem restrictions — full access |

## Approval Flow

When `approvalPolicy` is `untrusted` or `on-request`, the server sends approval requests as JSON-RPC server requests (have both `id` and `method`). These require a response:

**Command approval:**
```json
// Server → Client
{ "jsonrpc": "2.0", "id": 42, "method": "item/commandExecution/requestApproval",
  "params": { "threadId": "...", "turnId": "...", "itemId": "...",
    "command": "npm install", "cwd": "/project" }}

// Client → Server
{ "jsonrpc": "2.0", "id": 42, "result": { "decision": "accept" }}
// or: "acceptForSession", "decline", "cancel"
```

**File change approval:**
```json
// Server → Client
{ "jsonrpc": "2.0", "id": 43, "method": "item/fileChange/requestApproval",
  "params": { "threadId": "...", "turnId": "...", "itemId": "...",
    "reason": "Write access to /outside/project" }}

// Client → Server
{ "jsonrpc": "2.0", "id": 43, "result": { "decision": "accept" }}
```

The provider routes these through `SendMessageParams.permissionHandler` which is the same handler used by the Claude provider, ensuring consistent UX.

## Thinking Effort Mapping

| AgentPanel | Codex (`ReasoningEffort`) |
|---|---|
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `max` | `xhigh` |

Note: Codex also supports `none` and `minimal` but AgentPanel doesn't expose these.

## Binary Discovery

The Codex CLI binary is bundled inside `@openai/codex-sdk` under a platform-specific path:
```
node_modules/@openai/codex/vendor/<target-triple>/codex/codex
```

**Challenge:** The SDK package has `"type": "module"` with restricted ESM `exports` — `require.resolve('@openai/codex-sdk')` fails in Electron's CJS context.

**Solution:** Walk up the directory tree from `__dirname`, `process.cwd()`, and Electron's `resourcesPath`, checking:
1. pnpm hoisted layout: `node_modules/.pnpm/@openai+codex@*-<platform>-<arch>/...`
2. Direct `node_modules/@openai/codex/` layout (npm/yarn)
3. SDK symlink chain: `node_modules/@openai/codex-sdk/node_modules/@openai/codex/`

## Available Models

Models are discovered dynamically via `model/list` RPC. With ChatGPT Plus auth (not API key), the available models are the GPT-5.x family:

| Model | Description |
|---|---|
| `gpt-5.3-codex` | Latest frontier agentic coding model |
| `gpt-5.2-codex` | Advanced agentic coding model |
| `gpt-5.1-codex` | Agentic coding model with deep reasoning |
| `gpt-5.1-codex-mini` | Fast, lightweight coding model |
| `gpt-5.4` | Latest general-purpose model |
| `gpt-5.2` | General-purpose model with coding capabilities |

**Note:** Models like `codex-mini-latest`, `o4-mini`, `gpt-4.1` require an API key and are NOT available with ChatGPT Plus auth. The `model/list` RPC returns only models the user can actually use.

## Key Learnings

1. **SDK `codex exec` does NOT support text streaming** — only `item.completed` events. This was confirmed across 3 models and 2 SDK versions. The app-server protocol is required for real streaming.

2. **The `initialized` notification is required** — Without sending `initialized` after the `initialize` handshake, subsequent RPC calls may fail or behave unexpectedly.

3. **`persistExtendedHistory: true` requires `experimentalApi` capability** — Set to `false` unless the `experimentalApi` flag is enabled in the initialize handshake.

4. **Server requests vs notifications** — Approval requests are server-initiated *requests* (have `id` + `method`) and require a JSON-RPC response. Regular streaming events are *notifications* (only `method`, no `id`). Both arrive on the same stdout line stream.

5. **ChatGPT auth vs API key** — The available models differ significantly depending on auth type. Use `model/list` for dynamic discovery instead of hardcoding.

6. **`untrusted` is not deprecated** — Despite earlier documentation suggestions, `untrusted` is the correct policy for "ask for everything" behavior (matching Claude Code's `default` mode).

## Files

| File | Description |
|---|---|
| `packages/core/src/providers/codex.provider.ts` | CodexProvider implementation (app-server protocol) |
| `packages/core/src/providers/types.ts` | Provider interface, AgentMessage types, ProviderConfig |
| `packages/core/src/providers/index.ts` | Provider registry |
| `packages/core/src/types/thread.ts` | `ProviderType` type, `provider` field on Thread |
| `packages/core/src/types/mode.ts` | Mode configs (plan/default/acceptEdits/bypassPermissions) |
| `packages/desktop/src/main/agent-manager.ts` | Provider instantiation per thread |
| `packages/desktop/package.json` | `@openai/codex-sdk` dependency (for binary) |
| `packages/ui/src/components/ProviderToggle.tsx` | Provider toggle UI component |

## References

- [Codex App-Server Protocol](https://developers.openai.com/codex/app-server/) — Primary protocol documentation
- [Codex Agent Approvals & Security](https://developers.openai.com/codex/agent-approvals-security) — Approval policies and sandbox modes
- [Codex Config Reference](https://developers.openai.com/codex/config-reference/) — Configuration options
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/) — CLI subcommands
- [Codex SDK (TypeScript)](https://github.com/openai/codex/tree/main/sdk/typescript) — SDK source (not used directly, but provides the binary)
- [GitHub: openai/codex](https://github.com/openai/codex) — Main repository

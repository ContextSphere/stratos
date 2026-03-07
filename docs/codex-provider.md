# OpenAI Codex Provider — Design & Implementation

## Overview

AgentPanel now supports **OpenAI Codex** as a second provider alongside Claude Code. Users can select which provider to use per-thread, enabling them to leverage different AI coding models for different tasks.

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

Providers are registered in `packages/core/src/providers/index.ts`:

```typescript
const registry = {
  'claude-code': ClaudeCodeProvider,
  'codex': CodexProvider
}
```

### Thread-Level Provider Selection

Each thread stores a `provider` field (`'claude-code' | 'codex'`). Default is `'claude-code'` for backward compatibility. The `AgentManager` in `packages/desktop/src/main/agent-manager.ts` uses `createProvider(thread.provider)` to instantiate the correct provider per thread.

## Codex SDK Integration

### Package

- **npm:** `@openai/codex-sdk`
- **Requires:** Node.js 18+, `codex` CLI installed globally
- **API key:** Reads `OPENAI_API_KEY` from environment

### How It Works

The Codex SDK wraps the `codex` CLI, communicating via JSONL events over stdin/stdout. The `CodexProvider` uses:

1. `new Codex({ config })` — creates an instance with approval and sandbox settings
2. `codex.startThread({ workingDirectory })` or `codex.resumeThread(threadId)` — manages conversation threads
3. `thread.runStreamed(prompt)` — returns an async iterable of events

### Event Mapping

The SDK emits two event types from `runStreamed()`:

| Codex Event | AgentMessage(s) |
|---|---|
| `item.completed` — agentMessage | `{ type: 'text', content, isStreaming: false }` |
| `item.completed` — commandExecution | `tool_use` (Bash) + `tool_result` (stdout/stderr/exitCode) |
| `item.completed` — fileChange | `tool_use` (Write/Edit per change) + `tool_result` (diff) |
| `item.completed` — mcpToolCall | `tool_use` (mcp__server__tool) + `tool_result` |
| `item.completed` — webSearch | `tool_use` (WebSearch) + `tool_result` |
| `turn.completed` | `{ type: 'result', content, usage }` |

### Available Models

The provider returns a curated list of Codex-compatible models:

| Model ID | Display Name |
|---|---|
| `codex-mini-latest` | Codex Mini |
| `o4-mini` | o4-mini |
| `o3` | o3 |
| `gpt-4.1` | GPT-4.1 |
| `gpt-4.1-mini` | GPT-4.1 Mini |

## Approval & Security Model

### Key Difference from Claude

Claude Code uses a `canUseTool` callback — every tool call pauses for UI-level approval. The Codex SDK **does not expose approval callbacks**. Instead, it uses startup-level policies.

### Codex App-Server Protocol (Background)

Under the hood, the Codex CLI uses a bidirectional JSON-RPC 2.0 protocol (the "app-server protocol") that supports interactive approvals:

1. **Command execution:** Server sends `item/commandExecution/requestApproval` → client responds with `accept`, `acceptForSession`, `decline`, `cancel`
2. **File changes:** Server sends `item/fileChange/requestApproval` → same response options

However, the TypeScript SDK only exposes `item.completed` and `turn.completed` events — it does not surface these approval requests to SDK consumers.

### Our Approach

The `CodexProvider` runs with:

```typescript
config: {
  approval_policy: 'never',    // Auto-approve all tool calls
  sandbox: 'workspace-write'   // Sandboxed to workspace directory
}
```

This means:
- **All tool calls auto-execute** within the sandbox — no per-tool UI approval
- **Safety is enforced by the Codex sandbox** — file writes are restricted to the workspace directory
- Users see tool executions in the ChatView after they happen
- This is a different UX from Claude's interactive approval model

### Future Enhancement: Full Approval Flow

To match Claude's per-tool approval UX, we could bypass the SDK and talk directly to the Codex app-server via JSON-RPC over stdio. This would give us:
- `item/commandExecution/requestApproval` events to intercept
- `item/fileChange/requestApproval` events to intercept
- Full control over approval decisions

This is documented at [developers.openai.com/codex/app-server](https://developers.openai.com/codex/app-server/).

### Approval Modes Available in Codex

| Mode | Behavior |
|---|---|
| `on-request` | Interactive — pauses for approval before command execution |
| `never` | Auto-approve everything (what we use) |
| `untrusted` | Deprecated — similar to `on-request` |
| `reject` object | Granular auto-reject of specific categories |

### Sandbox Policies

| Policy | Behavior |
|---|---|
| `read-only` | Read-only filesystem access |
| `workspace-write` | Write access to workspace directory (our default) |
| `danger-full-access` | No restrictions |

## Files Modified/Created

| File | Change |
|---|---|
| `packages/core/src/providers/codex.provider.ts` | **NEW** — CodexProvider implementation |
| `packages/core/src/providers/index.ts` | Register CodexProvider in registry |
| `packages/core/src/providers/types.ts` | Provider-agnostic AgentDefinition, added `sandboxPolicy` to ProviderConfig |
| `packages/core/src/types/thread.ts` | Added `ProviderType` type and `provider` field to `Thread` |
| `packages/core/src/index.ts` | Export `CodexProvider` and `ProviderType` |
| `packages/core/src/storage/types.ts` | `createThread()` accepts `provider` param |
| `packages/core/src/storage/file-adapter.ts` | Persist `provider` field on thread creation |
| `packages/core/package.json` | Added `@openai/codex-sdk` dependency |
| `packages/desktop/src/main/agent-manager.ts` | Use `createProvider()` registry instead of hardcoded `ClaudeCodeProvider` |
| `packages/desktop/src/main/threads/thread.ipc.ts` | Accept `provider` in thread create/update |
| `packages/desktop/src/preload/index.ts` | Pass `provider` through IPC bridge |
| `packages/desktop/src/renderer/hooks/useThreads.ts` | `createThread()` accepts `provider` |
| `packages/desktop/src/renderer/App.tsx` | Added `ProviderToggle` to toolbar, wired provider selection |
| `packages/ui/src/components/ProviderToggle.tsx` | **NEW** — Provider toggle UI component |
| `packages/ui/src/index.ts` | Export `ProviderToggle` |

## Usage

### Prerequisites

1. Install the Codex CLI: `npm install -g @openai/codex`
2. Set your API key: `export OPENAI_API_KEY=sk-...`
3. Authenticate: `codex login`

### In AgentPanel

1. Click the **provider toggle** in the bottom toolbar (shows "Claude" / "Codex")
2. Select **Codex** before creating a new thread (or switch on an existing thread)
3. The model dropdown updates to show Codex-compatible models
4. Send messages as usual — tool executions appear in the chat

### Switching Providers

Switching provider on an existing thread clears the session (since sessions are provider-specific). A new session will be created on the next message.

## Limitations

1. **No streaming text:** The SDK provides `item.completed` events (final state only). Text appears all at once, not token-by-token like Claude.
2. **No approval UI:** Tool calls auto-execute within sandbox. No per-tool approve/deny.
3. **No slash commands:** Codex doesn't support slash commands.
4. **Image support:** Limited — Codex SDK uses `local_image` with file paths, not base64. Base64 images from the UI are not yet converted.
5. **No thinking/reasoning stream:** Unlike Claude's `thinking` blocks, Codex reasoning is not surfaced.

## References

- [Codex SDK Documentation](https://developers.openai.com/codex/sdk/)
- [Codex App-Server Protocol](https://developers.openai.com/codex/app-server/)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Codex Agent Approvals & Security](https://developers.openai.com/codex/agent-approvals-security)
- [Codex Config Reference](https://developers.openai.com/codex/config-reference/)
- [GitHub: openai/codex](https://github.com/openai/codex)
- [GitHub: openai/codex SDK TypeScript](https://github.com/openai/codex/tree/main/sdk/typescript)

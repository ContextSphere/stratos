# Copilot SDK Provider — Design & Implementation Plan

**Status:** Draft / pre-implementation
**Audience:** Engineers landing the Copilot provider into Stratos
**Scope:** Add `@github/copilot-sdk` as a first-class agent backend, parallel in capability to the existing Claude Code provider.

---

## 0. TL;DR

Stratos currently ships three agent providers (`claude-code`, `codex`, `opencode`) behind a single `AgentProvider` interface that yields a normalized `AgentMessage` async stream. GitHub now publishes `@github/copilot-sdk` — an event-based SDK that talks JSON-RPC to a Copilot CLI runtime and surfaces ~89 fine-grained session events covering streaming text, reasoning, tool calls, sub-agents, plan changes, hooks, MCP, and lifecycle.

This document plans a fourth provider, `copilot`, that:

1. Adds a `CopilotProvider` class implementing the existing `AgentProvider` contract — no breaking changes to UI, IPC, or storage.
2. Bridges the SDK's event-emitter model into Stratos's `AsyncGenerator<AgentMessage>` shape via an internal queue.
3. Maps Copilot's 89-event surface onto Stratos's 11-variant `AgentMessage` union without losing fidelity.
4. Generalises ~12 hardcoded `"claude-code"` defaults across the codebase to accept `copilot` as a `ProviderType`.
5. Adds `COPILOT_CONNECT`/`COPILOT_CHECK_CLI` IPC channels and a settings panel mirroring the Claude/Codex auth flow.

We will **not** implement in this doc — only specify what must change, where, and why.

---

## 1. Goals & Non-Goals

### Goals

- Full feature parity with the Claude Code provider for the following capabilities:
  - Streaming assistant text
  - Streaming reasoning ("thinking")
  - Tool calls (built-in + custom + MCP-exposed) with permission prompts
  - Tool result streaming and display
  - Sub-agents / Copilot custom agents
  - TODO / plan tracking
  - File-edit diffs in the UI
  - Session resume across app restarts
  - Context-window usage breakdown
  - Image input
  - Slash-command discovery
  - Interrupt / abort
  - MCP server status, toggle, reconnect, OAuth elicitation
- No regression in the existing three providers.
- No new dependencies in `@stratosapp/ui` — the bridge stays platform-agnostic.

### Non-Goals

- **Not** unifying the three existing providers' implementations — that's a separate refactor.
- **Not** building a Copilot-specific UI surface (Canvas) yet. Canvas events will be captured and logged but not rendered. A follow-up doc will scope Canvas UX.
- **Not** implementing the Java/Go/Rust/.NET Copilot SDKs — Node.js only (`@github/copilot-sdk`).
- **Not** building BYOK key management for Copilot in v1. v1 assumes GitHub-signed-in auth via the Copilot CLI's stored OAuth.

---

## 2. Background: How the Existing Provider Layer Works

The relevant abstractions (file paths verified against the worktree):

| Concept                   | File                                                   | Notes                                                               |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `AgentProvider` interface | `packages/core/src/providers/types.ts:21`              | 8 required + 4 optional methods                                     |
| `AgentMessage` union      | `packages/core/src/providers/types.ts:69`              | 11 variants — the normalized stream shape                           |
| Provider registry         | `packages/core/src/providers/index.ts:17`              | `Record<name, Constructor>` — `createProvider(name)`                |
| `ProviderType` literal    | `packages/core/src/types/thread.ts:61`                 | `"claude-code" \| "codex" \| "opencode"`                            |
| Mode mappings             | `packages/core/src/types/mode.ts:50`                   | Per-provider allowed modes + overrides                              |
| Agent manager             | `packages/desktop/src/main/agent-manager.ts`           | Owns lifecycle, IPC, MCP server building                            |
| MCP build helper          | `packages/desktop/src/main/agent-manager.ts:85`        | Per-provider transport selection                                    |
| IPC channels              | `packages/desktop/src/common/ipc-channels.ts`          | Provider-agnostic chat channels; provider-specific connect channels |
| Settings store            | `packages/desktop/src/main/settings/settings.store.ts` | `providers: Record<string, ProviderPrefs>` already generic          |
| Transcript normalisation  | `packages/core/src/storage/sdk-transcript.ts`          | Hard-coded to Claude SDK JSONL paths today                          |
| Trace store               | `packages/core/src/storage/trace.store.ts`             | Provider-neutral — reuse as-is                                      |

The provider abstraction is already designed for this. The chat IPC channels are provider-agnostic. The work splits roughly:

- 70% inside a new `CopilotProvider` class (the bulk of the SDK event → AgentMessage mapping)
- 20% in cross-cutting generalisations (defaults, settings keys, mode tables)
- 10% in new auth / IPC / UI pickers (mirror the `CLAUDE_CONNECT` pattern)

---

## 3. Copilot SDK Surface

Source of truth: `@github/copilot-sdk` (Node.js TypeScript). Package versions checked at time of writing — public preview.

### 3.1 Top-level exports

- **`CopilotClient`** — owns the JSON-RPC runtime connection. One client per process is enough; multiple sessions can share it.
- **`CopilotSession`** — one per conversation. Created via `client.createSession(SessionConfig)`.
- **`defineTool(name, spec)`** — host-side tool factory (Zod-schema parameters + async handler).
- **`BuiltInTools`**, **`ToolSet`** — opaque IDs / collections for filtering the model's tool list.
- **`Canvas`**, **`createCanvas`** — Canvas (interactive UI surface) — out of scope for v1, but events must be captured.
- **`SYSTEM_MESSAGE_SECTIONS`**, **`approveAll`**, **`convertMcpCallToolResult`**, **`createSessionFsAdapter`** — utility helpers we'll likely use as-is.

### 3.2 `CopilotClient` lifecycle

```
const client = new CopilotClient({
  connection: { type: "stdio" } | { type: "tcp", port } | { type: "uri", uri },
  mode: "copilot-cli" | "empty",
  workingDirectory: string,
  logLevel: "none" | "error" | "warning" | "info" | "debug" | "all",
  // auth, telemetry, tracing, session FS config
});
```

- `connection: stdio` (default) spawns the `copilot` CLI subprocess and pipes JSON-RPC over stdio.
- `connection: tcp` / `uri` connects to an externally managed Copilot runtime (e.g. a remote server).
- `mode: "copilot-cli"` enables the full CLI feature set (built-in tools, MCP, agents); `mode: "empty"` is a bare runtime for unit tests.

### 3.3 `CopilotSession` public API (from `nodejs/src/session.ts`)

| Method                                                                       | Purpose                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `send(prompt: string \| MessageOptions): Promise<string>`                    | Fire-and-forget; returns the message ID.                                    |
| `sendAndWait(opts, timeoutMs?): Promise<AssistantMessageEvent \| undefined>` | Blocks until `session.idle`.                                                |
| `on(handler)` / `on(eventType, handler)`                                     | Subscribe; returns unsubscribe fn.                                          |
| `abort(): Promise<void>`                                                     | Cancel the in-flight turn.                                                  |
| `disconnect(): Promise<void>`                                                | Tear down handlers; conversation persists on disk for later resume.         |
| `getEvents(): Promise<SessionEvent[]>`                                       | Full history (for resume / replay).                                         |
| `setModel(model, options?)`                                                  | Mid-session model swap; supports `reasoningEffort` + capabilities override. |
| `log(message, options?)`                                                     | Write to the session timeline (level, ephemeral).                           |
| `ui.elicitation(params)`                                                     | Show a form (replaces our MCP `onElicitation`).                             |
| `ui.confirm(msg)`                                                            | yes/no.                                                                     |
| `ui.select(msg, options)`                                                    | pick one.                                                                   |
| `ui.input(msg, opts?)`                                                       | free-form text.                                                             |

Internal registration (`@internal`) methods accept config-time callbacks:

- `registerTools(tools)` — host tool handlers
- `registerCommands(commands)` — slash commands
- `registerPermissionHandler(handler)` — gate every privileged action
- `registerUserInputHandler(handler)` — answer `user_input.requested`
- `registerElicitationHandler(handler)` — answer `elicitation.requested`
- `registerHooks(hooks)` — `onPreToolUse` / `onPostToolUse` / `onPostToolUseFailure` / `onUserPromptSubmitted` / `onSessionStart` / `onSessionEnd` / `onErrorOccurred`
- `registerTransformCallbacks(map)` — per-system-message-section transformers

### 3.4 `SessionConfig` (from `types.ts`)

```
{
  clientName?: string,
  model?: string,              // e.g. "gpt-4.1", "claude-3.5-sonnet"
  reasoningEffort?: "minimal" | "low" | "medium" | "high",
  tools?: Tool<any>[],         // host-defined
  systemMessage?: SystemMessageConfig,
  availableTools?: string[] | ToolSet,  // allowlist built-ins
  excludedTools?: string[] | ToolSet,
  hooks?: SessionHooks,
  commands?: { name, handler }[],
  mcpServers?: Record<string, MCPStdioServerConfig | MCPHTTPServerConfig>,
  customAgents?: CustomAgentConfig[],
  // …
}
```

### 3.5 `Tool<TArgs>`

```
{
  name: string,
  description?: string,
  parameters?: ZodSchema | JSONSchemaRecord,
  handler?: ToolHandler<TArgs>,
  overridesBuiltInTool?: boolean,
  skipPermission?: boolean,
}
```

`ToolHandler` returns `string | ToolResultObject` where `ToolResultObject` carries `{ textResultForLlm, resultType: "success" | "failure" | "rejected" | "denied" | "timeout" }`.

### 3.6 `CustomAgentConfig`

```
{
  name: string,
  displayName?: string,
  tools?: string[] | null,
  prompt: string,
  mcpServers?: Record<string, MCPServerConfig>,
  skills?: string[],
}
```

### 3.7 `MessageOptions`

```
{
  prompt: string,
  attachments?: Array<
    | { type: "file", path }
    | { type: "directory", path }
    | { type: "selection", uri, range }
    | { type: "blob", mimeType, data }
  >,
  mode?: "enqueue" | "immediate",
  agentMode?: "interactive" | "plan" | "autopilot" | "shell",
}
```

### 3.8 Authentication (from `docs/auth/*`)

- **Default:** GitHub-signed-in user — Copilot CLI's stored OAuth. The SDK piggybacks on `gh auth login` / `copilot` first-run flow.
- **Env vars:** `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.
- **OAuth GitHub App:** programmatic token issuance.
- **BYOK:** `ProviderConfig` with `type: "openai" | "azure" | "anthropic"`, `baseUrl`, `apiKey | bearerToken`, `modelId`, `wireModel` — out of scope for v1.

### 3.9 Event surface

89 event types emitted on `session.on(handler)`. Full index in **§ Appendix A**. Categorised:

| Category                  | Events                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle                 | `session.start`, `session.resume`, `session.shutdown`, `session.idle`, `session.error`, `session.handoff`, `session.snapshot_rewind`, `session.title_changed`, `session.remote_steerable_changed`                                                                                                   |
| Conversation              | `user.message`, `assistant.turn_start`, `assistant.turn_end`, `assistant.intent`, `assistant.message`, `assistant.message_start`, `assistant.message_delta`, `assistant.streaming_delta`, `assistant.usage`, `pending_messages.modified`, `abort`                                                   |
| Reasoning                 | `assistant.reasoning`, `assistant.reasoning_delta`                                                                                                                                                                                                                                                  |
| Tools                     | `tool.user_requested`, `tool.execution_start`, `tool.execution_partial_result`, `tool.execution_progress`, `tool.execution_complete`, `external_tool.requested`, `external_tool.completed`, `command.queued`, `command.execute`, `command.completed`, `tools.updated`, `mcp_app_tool_call.complete` |
| Permissions               | `permission.requested`, `permission.completed`                                                                                                                                                                                                                                                      |
| Elicitation / UI input    | `user_input.requested`, `user_input.completed`, `elicitation.requested`, `elicitation.completed`, `sampling.requested`, `sampling.completed`                                                                                                                                                        |
| Sub-agents                | `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`, `subagent.deselected`, `custom_agents.updated`                                                                                                                                                                    |
| Plan / mode               | `session.plan_changed`, `session.mode_changed`, `exit_plan_mode.requested`, `exit_plan_mode.completed`, `session.autopilot_objective_changed`                                                                                                                                                       |
| Hooks / skills            | `hook.start`, `hook.end`, `hook.progress`, `skill.invoked`, `skills.loaded`                                                                                                                                                                                                                         |
| MCP                       | `mcp_servers.loaded`, `mcp_server_status.changed`, `mcp_oauth.required`, `mcp_oauth.completed`                                                                                                                                                                                                      |
| Context                   | `session.usage_info`, `session.context_changed`, `session.truncation`, `session.compaction_start`, `session.compaction_complete`                                                                                                                                                                    |
| Files                     | `session.workspace_file_changed`                                                                                                                                                                                                                                                                    |
| Notifications / status    | `session.info`, `session.warning`, `system.notification`, `system.message`, `custom_notification`, `session.task_complete`                                                                                                                                                                          |
| Config                    | `session.permissions_changed`, `session.model_change`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.requested`, `auto_mode_switch.completed`, `extensions.loaded`                                                                                                                  |
| Scheduling (Copilot-side) | `session.schedule_created`, `session.schedule_cancelled`                                                                                                                                                                                                                                            |
| Canvas (deferred)         | `canvas.opened`, `canvas_registry.changed`                                                                                                                                                                                                                                                          |
| Model failure             | `model.call_failure`                                                                                                                                                                                                                                                                                |

---

## 4. Event Mapping: Copilot `SessionEvent` → Stratos `AgentMessage`

This is the central design decision. The mapping must be lossless enough that the existing UI components (`ChatView`, `MessageBubble`, tool-call cards, plan/diff renderers) need no Copilot-specific code. We add new `AgentMessage` variants only where an event has no Claude equivalent.

### 4.1 Direct mappings (no new types needed)

| Copilot event                                                | Stratos `AgentMessage`                                                                   | Notes                                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session.start`                                              | `{ type: "session_init", sessionId, tools, slashCommands, mcpServers }`                  | Pull `tools` from `tools.updated` (fires shortly after), `slashCommands` from `commands.changed`. Buffer until all three arrive then emit once.                                 |
| `session.resume`                                             | `{ type: "session_init", … }`                                                            | Same as `session.start` but include resumed event count for trace.                                                                                                              |
| `assistant.message_delta`                                    | `{ type: "text", content: deltaContent, isStreaming: true }`                             | Direct stream.                                                                                                                                                                  |
| `assistant.message` (final)                                  | `{ type: "text", content, isStreaming: false }`                                          | Final text block; flush deltas.                                                                                                                                                 |
| `assistant.reasoning_delta`                                  | `{ type: "thinking", content: deltaContent, isStreaming: true }`                         | Direct stream.                                                                                                                                                                  |
| `assistant.reasoning` (final)                                | `{ type: "thinking", content, isStreaming: false }`                                      | Final reasoning block.                                                                                                                                                          |
| `tool.execution_start`                                       | `{ type: "tool_use", toolName, input, toolCallId, parentToolUseId? }`                    | `parentToolUseId` set when fired from a sub-agent — see § 5.3.                                                                                                                  |
| `external_tool.requested`                                    | `{ type: "tool_use", … }`                                                                | Host-side custom tool — same shape. Disambiguate origin via internal flag for routing.                                                                                          |
| `tool.execution_complete`                                    | `{ type: "tool_result", toolCallId, output }`                                            | Concatenate any `partial_result` chunks first; cap output via `capStreamingToolOutput()`.                                                                                       |
| `tool.execution_partial_result`                              | `{ type: "tool_result", toolCallId, output (accumulated) }`                              | Optional — gate behind a feature flag; default emit only the final `_complete`.                                                                                                 |
| `permission.requested`                                       | `{ type: "permission_request", toolName, input, requestId }`                             | Maps onto the existing UI flow. The response is sent back via the SDK's `registerPermissionHandler`.                                                                            |
| `session.idle` + `session.task_complete` + `assistant.usage` | `{ type: "result", content: lastFinalText, cost?, usage?, contextWindow?, stop_reason }` | Synthesise from the trailing burst of events.                                                                                                                                   |
| `session.error` / `model.call_failure`                       | `{ type: "error", message, code? }`                                                      | Map error codes (rate_limit / quota / auth / context_limit) to a small Stratos enum.                                                                                            |
| `session.plan_changed` (create/update)                       | `{ type: "plan_update", content, isStreaming: false, title? }`                           | Copilot stores the plan as a file; emit its rendered markdown.                                                                                                                  |
| `exit_plan_mode.requested`                                   | Existing plan-review UX                                                                  | Forward `action` (`exit_only` / `interactive` / `autopilot` / `autopilot_fleet`) via the existing `PLAN_REVIEW` IPC. The user's choice maps back to `exit_plan_mode.completed`. |

### 4.2 Mappings requiring new `AgentMessage` variants

We extend the union with **3** new variants. Each is additive — existing renderers ignore unknown types.

```
| { type: "subagent_event";
    subagentId: string;
    name: string;
    parentToolUseId?: string;
    status: "started" | "completed" | "failed" | "selected" | "deselected";
    summary?: string;
  }

| { type: "hook_event";
    hookName: string;
    phase: "start" | "progress" | "end";
    message?: string;
  }

| { type: "file_changed";
    path: string;
    changeType: "create" | "modify" | "delete" | "rename";
    oldPath?: string;
  }
```

- **`subagent_event`** subsumes `subagent.started/completed/failed/selected/deselected`. Renderer reuses the existing sub-agent card from the Task notification UI.
- **`hook_event`** surfaces `hook.start/end/progress` so the user sees pre/post-tool-use hooks in the timeline (Stratos's Claude provider has no analog). Cheap to add; renderer can no-op initially.
- **`file_changed`** surfaces `session.workspace_file_changed`. The file-explorer panel already has a watcher; this event lets the chat timeline annotate "Edited foo.ts" even when the change happened outside a `tool_use`.

### 4.3 Mappings folded into existing variants

| Copilot event                                                                                        | Folded into                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `assistant.intent`                                                                                   | `{ type: "thinking", … }` with a stable marker prefix `[intent]` so the UI can style it differently (or ignore).                 |
| `assistant.streaming_delta` (byte-count progress)                                                    | Dropped — not user-visible. Trace only.                                                                                          |
| `session.info` / `session.warning`                                                                   | Trace only by default. Surface as `{ type: "text", content: "ℹ︎ " + msg, isStreaming: false }` only for `category: notification`. |
| `system.notification` (`agent_completed`, `agent_idle`, `shell_completed`, `instruction_discovered`) | Map to `{ type: "task_notification", … }` where applicable (sub-agent completion). Otherwise trace only.                         |
| `command.execute` / `command.completed`                                                              | Map to `{ type: "tool_use" }` + `{ type: "tool_result" }` with `toolName: "Bash"` for parity with Claude's shell-tool UI.        |
| `mcp_server_status.changed`                                                                          | Emit nothing new — re-fetch `getMcpServerStatus()` on the next IPC poll; broadcast `MCP_STATUS_CHANGED`.                         |
| `mcp_oauth.required`                                                                                 | Route through existing `onElicitation` callback (`mode: "url"`).                                                                 |
| `session.compaction_start` / `_complete`                                                             | Trace only. Eventually surface a "Compacted history" pill in chat.                                                               |
| `session.truncation`                                                                                 | Trace only.                                                                                                                      |
| `session.usage_info`                                                                                 | Update `contextWindow` field on the next `result` message. Power the `/context` panel via `getContextUsage()` (see § 5.10).      |
| `tools.updated`                                                                                      | Update the cached `sessionTools`; re-emit `session_init` only if the change is material (additions).                             |
| `commands.changed`                                                                                   | Update cached `slashCommands`; re-broadcast.                                                                                     |
| `session.workspace_file_changed`                                                                     | New `file_changed` variant (§ 4.2).                                                                                              |
| `session.handoff`                                                                                    | Trace only in v1. Long-term: surface in UI.                                                                                      |
| `capabilities.changed`                                                                               | Update `sessionTools` flag set; trace.                                                                                           |
| `session.mode_changed`                                                                               | Re-broadcast via existing `MODE_CHANGED` IPC channel.                                                                            |
| `session.permissions_changed`                                                                        | Trace + re-broadcast `MODE_CHANGED` if Stratos's effective mode shifts.                                                          |
| `session.model_change`                                                                               | Update the thread's `model` field.                                                                                               |
| `session.shutdown`                                                                                   | Final `result` emission, then close the AsyncGenerator.                                                                          |
| `session.title_changed`                                                                              | Persist as `thread.title` via `ThreadStorage.update()`.                                                                          |
| `auto_mode_switch.requested`                                                                         | Surface as a permission-style prompt (extends `permission_request` with a `mode_switch` flavour).                                |
| `session.autopilot_objective_changed`                                                                | Trace only in v1; render as a status pill in v2.                                                                                 |
| `session.schedule_created` / `_cancelled`                                                            | Forward to the existing scheduler IPC if it originated from Stratos; otherwise trace.                                            |
| `canvas.*` / `canvas_registry.changed`                                                               | Trace only in v1.                                                                                                                |
| `skill.invoked` / `skills.loaded`                                                                    | Trace only. Long-term: render skill cards.                                                                                       |

### 4.4 Buffering & coalescing rules

- **Delta coalescing:** Deliver `assistant.message_delta` and `assistant.reasoning_delta` at the SDK's native cadence; the renderer already handles 30Hz+ updates. No batching needed.
- **Tool partial results:** Default-off. The UI's `TOOL_OUTPUT_DISPLAY_LIMIT` (50KB) and main-process `STREAM_TOOL_OUTPUT_CAP` (256KB) already prevent flooding when enabled.
- **Init coalescing:** `session.start` fires before `tools.updated` and `commands.changed`. Hold `session_init` until either (a) both fire, or (b) 250ms elapses — whichever first.
- **Result synthesis:** A "turn" ends with the sequence `assistant.turn_end` → `assistant.usage` → `session.task_complete` → `session.idle`. Synthesise one `result` message after `session.idle`; carry final text from the last `assistant.message`, usage from `assistant.usage`, and `stop_reason` from `assistant.message` (mapped: `end_turn` ↔ Copilot's normal completion, `max_tokens` ↔ truncated).

---

## 5. Feature Designs

Each subsection answers: what does Copilot emit, how do we map it, what does the user see, what's tricky.

### 5.1 Streaming (text + reasoning)

**Emits:**

- `assistant.message_start` → mark the in-progress assistant bubble.
- `assistant.message_delta` (deltaContent) → append.
- `assistant.message` (final) → flush, close.
- Same trio for reasoning: `_start` (carried in `assistant.reasoning` first fire) → `assistant.reasoning_delta` → terminal `assistant.reasoning`.

**Mapping:** Direct — see § 4.1.

**Tricky bits:**

- The SDK fires reasoning _concurrently_ with assistant text on models that emit both (e.g. GPT-5 reasoning models). The Stratos renderer must keep them in separate streaming buckets — already supported via `streamCtx.textWasStreamed` vs `streamCtx.thinkingWasStreamed` in `claude-code.provider.ts:287`. Mirror that pattern.
- `assistant.streaming_delta` only carries byte counts. Skip.
- Final-text dedup: When `assistant.message` fires after a sequence of `_delta`s, do not re-emit; the renderer reconciles via `isStreaming: false`.

### 5.2 Tool Calls

Copilot has **three** distinct tool-call origins. Each must surface identically as a `tool_use` → `tool_result` pair to the UI, but their permission and result routing differs.

#### (a) Built-in tools (Read/Write/Edit/Bash/Glob/Grep/…)

- The Copilot CLI executes these in-process; the SDK fires `tool.execution_start` → optional `tool.execution_partial_result` → `tool.execution_complete`.
- No handler registration needed.
- Permission flow: gated by `permission.requested` for the relevant scope (read / write / shell / mcp / url / memory / custom_tool / hook / extension).
- **Built-in tool name translation table:** Map Copilot tool names to Claude's so the existing tool-card components (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, NotebookEdit, TodoWrite) render unchanged. Anything Copilot-only (e.g. its plan tool) renders via a fallback generic card.

| Copilot built-in       | Stratos canonical name |
| ---------------------- | ---------------------- |
| `read`                 | `Read`                 |
| `write`                | `Write`                |
| `edit` / `str_replace` | `Edit`                 |
| `bash` / `shell`       | `Bash`                 |
| `glob`                 | `Glob`                 |
| `grep`                 | `Grep`                 |
| `web_search`           | `WebSearch`            |
| `web_fetch`            | `WebFetch`             |
| `todo` / `update_plan` | `TodoWrite`            |
| `notebook_edit`        | `NotebookEdit`         |
| `ask_user`             | `AskUserQuestion`      |

A small `normalizeCopilotToolName(raw): string` helper in the provider handles this.

#### (b) Host-side custom tools (`defineTool`)

- Stratos passes Tools into `SessionConfig.tools`.
- SDK fires `external_tool.requested { toolName, args, requestId }`. The session looks up our handler and runs it (we register handlers via `registerTools`).
- Stratos's existing pattern: tools are added per-turn via the MCP layer, not via direct host tools. **v1 will not use** `defineTool` for Stratos's own tools (Manager Agent, Preview, Scheduler) — those continue to ride MCP. Reserve `defineTool` for future Copilot-only integrations.

#### (c) MCP tools

- `tool.execution_start` with `mcpServerName` set. Handled exactly like built-ins for the UI.
- See § 5.9 for MCP wiring.

#### (d) Permission flow

- `permission.requested` arrives with one of: `shell`, `write`, `read`, `mcp`, `url`, `memory`, `custom_tool`, `hook`, `extension`.
- Map each to a single `{ type: "permission_request", toolName, input, requestId }`.
- The `toolName` field is synthesised: `"Bash"` for shell, `"Edit"`/`"Write"` for write, `"Read"` for read, `"MCP:" + serverName + ":" + toolName` for mcp, `"WebFetch"` for url. The existing approval UI already keys off `toolName`.
- The renderer's response routes through `registerPermissionHandler` we install at session creation:
  - `{ approved: true, ... }` → `{ outcome: "approved" }`
  - `{ approved: true, modifiedInput }` → unsupported in Copilot's API today — fall back to denying with a hint. Open question (§ 15.4).
  - `{ approved: false, denyMessage }` → `{ outcome: "denied", reason }`.

### 5.3 Sub-agents / Custom Agents

Copilot has a first-class custom-agent system distinct from Claude's `agents: Record<string, AgentDefinition>` config.

**Wiring:**

- `ProviderConfig.agents` (Claude shape: `Record<string, AgentDefinition>`) → translate into Copilot's `customAgents: CustomAgentConfig[]`.
  ```
  // Claude
  { "code-reviewer": { description, prompt, tools, model? } }
  // Copilot
  [{ name: "code-reviewer", displayName: "Code Reviewer", prompt, tools, skills?: [] }]
  ```
- One-to-one field rename; preserve unknown fields under `_claudeMetadata` for round-trip.

**Runtime events:**

- `subagent.selected` → renderer logs "Selected agent: code-reviewer".
- `subagent.started` → emit `subagent_event { status: "started", subagentId, name, parentToolUseId }`.
- `subagent.completed` / `subagent.failed` → `subagent_event { status, summary }`.
- The sub-agent's _own_ tool calls and assistant messages arrive interleaved on the main session stream with `parentToolUseId` set. The existing `MessageBubble` task-card recursion handles nesting.

**Mapping to existing UI:** Stratos's Claude provider already renders Task-tool subprocesses via `task_notification`. Reuse that path for `subagent.*` by translating into `task_notification` _and_ `subagent_event` — `task_notification` keeps the existing card visuals, `subagent_event` lets future renderers do richer work.

### 5.4 TODOs / Plan tracking

Two distinct Copilot concepts:

**(a) TODOs** — written by the model via the `todo` / `update_plan` built-in tool.

- Arrives as `tool.execution_start { name: "update_plan", input: { plan: [...] } }`.
- Provider parses `input.plan` (array of `{ content, status, activeForm }`-shaped items) and emits `{ type: "todo_update", todos }` — exactly like the Claude `TodoWrite` parser at `claude-code.provider.ts:813`.
- The `tool.execution_complete` for the same `toolCallId` becomes a no-op `tool_result` (already absorbed).

**(b) Plan file** — Copilot's plan-mode writes a persistent plan to disk and fires `session.plan_changed { operation: "create" | "update" | "delete", path, content }`.

- Map to `{ type: "plan_update", content, title }` for `create` / `update`.
- For `delete`, emit `{ type: "plan_update", content: "", title }` (renderer treats empty content as cleared).

**`exit_plan_mode.requested`** → use existing `PLAN_REVIEW` IPC channel; user's `{ accept, reject, edit }` decision is forwarded back as `exit_plan_mode.completed { action }`.

### 5.5 Edit Diffs

Stratos renders file diffs by inspecting `tool_use` input for `Edit`/`MultiEdit`/`Write` tools (input has `old_string` / `new_string` / `content`). The MessageBubble's diff renderer keys off the canonical tool name.

**Copilot's edit format** (verified from `tool.execution_complete` payload structure — `text` / `terminal` / `image` / `audio` / `resource` result blocks):

- A successful `edit` returns a `resource` block with `{ uri: "file://...", mimeType, text: <full file after edit> }`. The diff is not in the event — the provider must compute it.
- A successful `write` returns the same.
- A successful `str_replace` returns the spliced excerpt or full file.

**Provider responsibility:**

- Capture the file's _pre-edit_ contents at `tool.execution_start` time (we have the path from `input.path`). Read it from disk synchronously _before_ the SDK applies the edit, OR use the `onPreToolUse` hook to capture.
- After `_complete`, compute a unified diff via the existing `diff` package already in `@stratosapp/ui`.
- Synthesise a `tool_use` input that matches the Stratos `Edit` shape: `{ file_path, old_string, new_string }`. The renderer renders it identically to a Claude Edit.

**Open question (§ 15.6):** is pre-read reliable, or do we need to register a hook? Hooks are the safer path — `onPreToolUse({ name, input }) → captureCurrentContents(input.path)`.

**Performance:** Cap captured file contents at 1 MB; for larger files emit a "file too large to diff" placeholder.

### 5.6 Reasoning

Copilot's reasoning surface maps cleanly:

- `reasoningEffort: "minimal" | "low" | "medium" | "high"` ↔ Stratos's `thinkingEffort: "low" | "medium" | "high" | "max"`. Provider translates: `low→low`, `medium→medium`, `high→high`, `max→high` (Copilot tops at "high"). Need to surface `minimal` as a Stratos-level option or hide it; v1 hides — Stratos has no `minimal`.
- `assistant.reasoning_delta` streams the thinking text.
- `assistant.reasoning` (final) carries the consolidated block.
- Some reasoning models emit _encoded_ reasoning tokens (OpenAI's o1/o3 pattern) that aren't human-readable. If `assistant.reasoning` has a `reasoningId` but no `text`, render a `thinking` block with content `[reasoning: <id>]` so the user sees _something_ happened.

### 5.7 Permissions

Already covered in § 5.2(d). Additional notes:

- `permission.completed` → trace only. The provider's `registerPermissionHandler` already returned the answer; the SDK echoes it back as the completion event.
- `session.permissions_changed { allow_all }` → if Copilot enters "allow all" via the user's CLI config, broadcast `MODE_CHANGED { mode: "bypassPermissions" }`. The reverse (`allow_all → false`) reverts to the mode the thread thinks it's in.

### 5.8 Session lifecycle, persistence, resume

- **Persistence:** Copilot CLI persists sessions to disk under (typically) `~/.copilot/sessions/<sessionId>.jsonl`. The SDK's `getEvents()` returns the canonical replay. The exact path is determined by `sessionFsProvider` — we can supply our own via `createSessionFsAdapter` to put sessions inside `~/.stratos/instances/<hash>/copilot-sessions/` for worktree isolation.
- **Resume:** Call `client.createSession({ sessionId: existing })` — the SDK rehydrates from disk. `canResume(sessionId)` checks the FS adapter for the file.
- **Disconnect vs abort:**
  - `abort()` cancels the current turn but keeps the session.
  - `disconnect()` releases handlers; session lives on disk.
- **Multi-thread:** One `CopilotClient` instance shared across all Stratos threads (saves CLI subprocesses). Per-thread `CopilotSession` instances are created on demand. The `CopilotProvider` class holds the client as a static singleton; each `provider` instance is a thin facade around one `Session`.

### 5.9 MCP integration

Copilot config shape per server:

```
MCPStdioServerConfig: { type: "stdio", command, args?, env? }
MCPHTTPServerConfig:  { type: "http", url, headers? }
```

Stratos's existing `mcpServers` config (shared between Claude and Codex providers) uses a near-identical shape minus the `type` discriminator. Translation:

- Stratos `{ command, args, env }` (no `type`) → Copilot `{ type: "stdio", … }`.
- Stratos `{ type: "http", url }` → Copilot `{ type: "http", url }` direct.
- The SDK MCP variant Stratos uses for Claude (`type: "sdk"` — in-process) has _no_ Copilot equivalent in v1. Decision: route Stratos's bundled MCP server (`stratos`) over **stdio** for Copilot — same path Codex uses. Reuse `getStratosMcpPath()` from `agent-manager.ts:54`.

**Status queries:** `getMcpServerStatus()` synthesises from `mcp_servers.loaded` + `mcp_server_status.changed` events. Cache last-known status (mirror `claude-code.provider.ts:133`).

**Toggle:** Copilot has no runtime toggle in v1's public preview. Decision: surface toggling as a deferred operation — disabled servers omitted from the next session's `mcpServers` config; reconnect requires a new session. Document this limitation in the UI tooltip.

**Reconnect:** `mcp_oauth.required` arrives via `elicitation.requested { mode: "url" }`. Route through `onElicitation` — mirror the Claude flow.

### 5.10 Context window usage

`getContextUsage()` returns the Stratos `ContextUsage` shape (~30 fields, see `types.ts:250`). Copilot's `session.usage_info` carries:

```
{ totalTokens, maxTokens, model, percentage, ...messageBreakdown, ...mcpTools, ...skills }
```

Direct field mapping. Missing fields default to `undefined`. The renderer already handles partial data.

Strategy: subscribe to `session.usage_info` on the live session and cache the last payload. `getContextUsage({ sessionId? })`:

- If `sessionId` matches the live session → return cached.
- If `sessionId` differs → no control-query equivalent in Copilot. Open a transient session via `client.createSession({ sessionId, ephemeral: true })`, wait for the first `session.usage_info`, return, `disconnect()`. Mirror the Claude one-shot probe pattern.

### 5.11 Images / attachments

Copilot's `MessageOptions.attachments` accepts:

- `{ type: "file", path }`
- `{ type: "directory", path }`
- `{ type: "selection", uri, range }`
- `{ type: "blob", mimeType, data }`

Stratos's `SendMessageParams.images: { dataUrl, mimeType }[]` → translate to `{ type: "blob", mimeType, data: base64-strip(dataUrl) }`.

For Stratos's `fileAttachments` (file paths), prefer `{ type: "file", path }` so Copilot reads from disk directly — no base64 round-trip.

Apply the same per-image cap (`STREAM_IMAGE_DATA_CAP = 512_000`) as Claude before sending.

### 5.12 Slash commands

`discoverSlashCommands()`:

- Create a throwaway session (`mode: "empty"` is fine), let `commands.changed` fire once, collect `{ name, description }[]`, disconnect.
- Cache for the process lifetime (slash commands rarely change).

Runtime: when `commands.changed` fires on a live session, re-emit `session_init` with updated `slashCommands`.

### 5.13 Hooks

Copilot's `SessionHooks` (`onPreToolUse` / `onPostToolUse` / `onPostToolUseFailure` / `onUserPromptSubmitted` / `onSessionStart` / `onSessionEnd` / `onErrorOccurred`) overlap conceptually with Claude's plugin hooks (`settings.json`-driven).

v1 strategy:

- We do **not** expose hook configuration to the user yet (no UI).
- We **do** register two internal hooks:
  - `onPreToolUse({ name, input })` → capture file pre-edit contents for diff synthesis (§ 5.5).
  - `onPostToolUseFailure({ name, error })` → propagate as `{ type: "error", message }` so failures aren't silent.
- Hook lifecycle events (`hook.start` / `hook.end` / `hook.progress`) become `hook_event` (§ 4.2) — surfaced in trace, optionally rendered.

### 5.14 Error handling

| Source                                         | Stratos response                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `session.error`                                | `{ type: "error", message, code }` — close the AsyncGenerator.                                                         |
| `model.call_failure { code: "rate_limit" }`    | `{ type: "error", message: "Rate limited", code: "rate_limit" }`. Retry policy: out of scope; surface for user action. |
| `model.call_failure { code: "context_limit" }` | `{ type: "error", code: "context_limit" }`. Suggest `/compact` in UI.                                                  |
| Connection drop (stdio EOF)                    | Emit error, attempt re-spawn on next `sendMessage`.                                                                    |
| Permission handler throws                      | Treat as `{ approved: false, denyMessage: "Permission handler error" }`.                                               |
| Tool handler throws                            | SDK auto-converts to `tool_result` with `resultType: "failure"`. No special handling.                                  |

### 5.15 Interrupt / abort

`provider.interrupt()` → `session.abort()`. Returns once the SDK acknowledges. The current AsyncGenerator finishes naturally with whatever events arrive before `session.idle`. The renderer already shows interrupt UX.

### 5.16 Steering & queueing

Copilot supports:

- `MessageOptions.mode: "enqueue"` — queue while a turn is running.
- `MessageOptions.mode: "immediate"` — interrupt + send.
- `pending_messages.modified` — fires when the queue changes.

v1: hardcode `mode: "immediate"` (matches Claude semantics — user message starts a turn). Surface `pending_messages.modified` in trace only. v2 explores queueing.

---

## 6. Cross-cutting Architecture

### 6.1 The `CopilotProvider` class skeleton

```
class CopilotProvider implements AgentProvider {
  readonly name = "copilot";

  private static client?: CopilotClient;        // process-wide singleton
  private session?: CopilotSession;             // per-instance
  private sessionId?: string;
  private config: ProviderConfig = {};
  private lastKnownMcpStatus: McpServerInfo[] = [];
  private cachedSlashCommands?: { name: string; description?: string }[];
  private cachedTools?: string[];
  private cachedContextUsage?: ContextUsage;
  private pendingPreEditContents = new Map<string /* path */, string>();

  async initialize(config: ProviderConfig): Promise<void> { … }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // 1. Ensure client + session
    // 2. Register permission/elicitation handlers per-turn (params.permissionHandler, params.onElicitation)
    // 3. Build queue and subscribe to all events; push into queue
    // 4. Call session.send(prompt) with translated MessageOptions
    // 5. Drain the queue, transform each event, yield AgentMessage
    // 6. Terminate when session.idle fires
  }

  async interrupt(): Promise<void> { await this.session?.abort(); }
  canResume(sessionId: string): boolean { … fs adapter check … }
  async getAvailableModels(): Promise<ModelInfo[]> { … query CLI capabilities … }
  async discoverSlashCommands(): Promise<{ name; description? }[]> { … throwaway session … }
  async getMcpServerStatus?(): Promise<McpServerInfo[]> { … return cache … }
  async toggleMcpServer?(name, enabled): Promise<void> { … re-session … }
  async reconnectMcpServer?(name): Promise<{ authUrl? } | void> { … }
  async getContextUsage?(opts?): Promise<ContextUsage | null> { … cached or transient session … }
  async dispose(): Promise<void> { await this.session?.disconnect(); }
}
```

### 6.2 Event-to-AsyncGenerator bridge

Copilot's `session.on(handler)` is push-based; `sendMessage` must yield pull-based. Use a bounded queue:

```
class EventQueue<T> {
  private waiters: Array<(value: T | DONE) => void> = [];
  private queue: T[] = [];
  private closed = false;
  push(v: T) { … }
  done() { … }
  async *drain(): AsyncIterator<T> { … }
}
```

Pattern: `sendMessage` subscribes, pushes every event into the queue, then `for await (const evt of queue.drain())` and `yield* transform(evt)`. Backpressure isn't a problem in practice — the SDK fires at human-readable rates and our queue is short-lived (per turn).

### 6.3 Tool name normalization

A pure function (`normalizeCopilotToolName(raw: string): string`) + a small mapping table (§ 5.2(a)). Lives in `packages/core/src/providers/copilot.tools.ts`. Re-used by transcript loader.

### 6.4 Diff extraction

Helper module: `packages/core/src/providers/copilot.diff.ts`. Public API:

- `captureFileSnapshot(path: string): Promise<string | null>` — bounded by 1 MB.
- `synthesizeEditInput(path, before, after): { file_path, old_string, new_string }` — minimal-diff extraction. Falls back to `{ file_path, content: after }` (Write-style) if the file is new.

### 6.5 Lifetimes & disposal

- `CopilotClient` singleton is created on first `provider.initialize()` and lives until app shutdown.
- Per-thread `CopilotSession` is created on first `sendMessage` for that thread (or on `canResume`-triggered rehydrate), disposed when the thread is closed.
- `dispose()` closes the per-instance session; it does NOT close the client. App-level shutdown closes the client (in `agent-manager.ts` cleanup path).

---

## 7. Generalization Required Across the Codebase

A grep audit (full results in the research phase) identified 12 surface-area generalisations:

### 7.1 `ProviderType` union

`packages/core/src/types/thread.ts:61` →

```
export type ProviderType = "claude-code" | "codex" | "opencode" | "copilot";
```

### 7.2 Provider registry

`packages/core/src/providers/index.ts:17` — add `copilot: CopilotProvider`.

### 7.3 Mode tables

`packages/core/src/types/mode.ts:50` — add:

```
copilot: ["plan", "default", "acceptEdits", "fullAccess"],
```

Mode mapping (Copilot's `agentMode`):

- `plan` → `interactive` + `permissionMode-like: plan` (Copilot uses `agentMode: "plan"`)
- `default` → `interactive`
- `acceptEdits` → `interactive` with `allow_all_writes`
- `fullAccess` → `autopilot` (full autonomy)

Add to `PROVIDER_MODE_CONFIG_OVERRIDES`:

```
copilot: {
  default: { label: "Interactive", description: "Prompts for write/shell/network." },
  fullAccess: { label: "Autopilot", description: "Autonomous; no prompts.", dangerous: true },
}
```

### 7.4 Default fallbacks

12 hardcoded `?? "claude-code"` defaults in:

- `agent-manager.ts:551, 559, 842, 1074, 1177, 1276, 2036`
- `App.tsx:600, 621`
- `ChatView.tsx:53`
- `ProviderToggle.tsx:47`
- `MessageBubble.tsx:173`
- `utils/modes.ts:68`
- `file-adapter.ts:241, 244, 274`

Plan:

- Leave them alone for backward compat. Threads created before Copilot existed have no `provider` field; they should still default to `"claude-code"`.
- New threads get the user's last-selected provider (already persisted in `providers.<name>.lastUsedModel`).

### 7.5 Settings shape

`packages/desktop/src/main/settings/settings.store.ts:39` — add:

```
copilotConfig?: {
  authMethod?: "github" | "byok";
  byok?: { type: "openai" | "azure" | "anthropic"; baseUrl: string; modelId?: string };
  // tokens are NOT stored here — see § 8
};
```

`providers: Record<string, ProviderPrefs>` already accommodates `providers.copilot.lastUsedModel`.

### 7.6 Transcript loader

`packages/core/src/storage/sdk-transcript.ts:8` imports `getSessionMessages` from the Claude SDK. We add a parallel path for Copilot:

- Detect provider by `thread.provider` field.
- For `copilot`, call `session.getEvents()` via a freshly resumed session and translate events through the same mapping table (§ 4) to `StoredMessage[]`.
- Refactor: extract the existing Claude flow into `loadClaudeTranscript()`; add `loadCopilotTranscript()`. The top-level `loadTranscript(thread)` dispatches.

### 7.7 Provider-specific MCP build

`agent-manager.ts:85 buildMcpServers()` — extend the `providerName` switch to include `copilot` with the same stdio transport as `codex`/`opencode`. The `sdk` MCP type stays Claude-only.

---

## 8. Authentication & CLI Management

### 8.1 CLI detection

Mirror `CLAUDE_CHECK_CLI` / `CODEX_CHECK_CLI`:

- New IPC: `INTEGRATION_COPILOT_CHECK_CLI` → spawns `copilot --version`, parses output, returns `{ installed, version?, path? }`.
- Resolve installation path via the same `which copilot` + bundled-binary fallback used for Codex.

### 8.2 Connect / Disconnect

- `INTEGRATION_COPILOT_CONNECT` → runs `copilot auth login` (interactive). On macOS this opens a browser to GitHub's device-code flow. The IPC returns once the CLI confirms authenticated state (poll `copilot auth status` until success or timeout).
- `INTEGRATION_COPILOT_DISCONNECT` → runs `copilot auth logout`. Clears Stratos's cached connection state.
- `INTEGRATION_COPILOT_GET_CONNECTION` → returns `{ status: "connected" | "disconnected" | "needs-auth", login?: string, subscription?: "individual" | "business" | "enterprise" }`.

### 8.3 Token storage

**We do not store the GitHub token.** The Copilot CLI manages its own token under `~/.copilot/`. Stratos only checks status via `copilot auth status`. This matches the Claude CLI pattern (`claude auth status`).

For env-var override (`COPILOT_GITHUB_TOKEN` etc.), document the workflow; do not surface a UI for it in v1.

### 8.4 Settings UI

A new `CopilotConnectPanel.tsx` component in `packages/ui` mirroring `CodexConnectPanel.tsx`:

- "Check CLI" button → calls `INTEGRATION_COPILOT_CHECK_CLI`. Shows install instructions on miss.
- "Connect to GitHub" → runs `_CONNECT`. Shows polling spinner. Renders subscription tier on success.
- "Disconnect" — only when connected.

---

## 9. Model Picker

`getAvailableModels()` strategy:

- Create a throwaway session in `mode: "copilot-cli"`. Wait for `capabilities.changed` and `session.start` (which carries the active model). Use the session's `getModels()` if exposed by the SDK, else parse the capabilities payload for the model registry.
- Cache the result in-memory and on disk (`~/.stratos/instances/<hash>/copilot-models.json`) with a 1-hour TTL.
- The Stratos `ModelInfo` shape is identical (`value`, `displayName`, `description`, `supportsEffort?`).
- Copilot's `supportedReasoningEfforts` populates `supportsEffort: true` if non-empty.

Models known to be available via Copilot today (subject to subscription tier): `gpt-4.1`, `gpt-5`, `claude-3.5-sonnet`, `claude-3.7-sonnet`, `o3`, `o4-mini`, plus future additions. Do not hardcode — always query.

---

## 10. Mode Mapping (Stratos `AgentMode` ↔ Copilot `agentMode`)

| Stratos `AgentMode` | Copilot `MessageOptions.agentMode`                                      | Permission posture                                                                                    |
| ------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `plan`              | `"plan"`                                                                | Read-only; no write/shell. Maps to Copilot's plan-mode where the model proposes but does not execute. |
| `default`           | `"interactive"`                                                         | Prompts for write/shell/network/MCP.                                                                  |
| `acceptEdits`       | `"interactive"` + auto-approve `permission.requested { kind: "write" }` | Prompts for shell/MCP/url; auto-approves writes.                                                      |
| `bypassPermissions` | n/a (not supported for Copilot; hidden from picker)                     | —                                                                                                     |
| `fullAccess`        | `"autopilot"`                                                           | Full autonomy. Dangerous.                                                                             |

Auto-approve is implemented inside the `registerPermissionHandler` closure: inspect the `kind`, return `{ outcome: "approved" }` immediately when the Stratos mode says so.

`shell` mode (a Copilot-only mode that lets the user run terminal commands interactively) is **out of scope for v1**.

---

## 11. New / Modified IPC Channels

Additions to `packages/desktop/src/common/ipc-channels.ts`:

```
COPILOT_CHECK_CLI: "integration:copilot:check-cli",
COPILOT_CONNECT: "integration:copilot:connect",
COPILOT_DISCONNECT: "integration:copilot:disconnect",
COPILOT_GET_CONNECTION: "integration:copilot:get-connection",
COPILOT_GET_BYOK: "integration:copilot:get-byok",           // v2 / opt-in only
COPILOT_SET_BYOK: "integration:copilot:set-byok",           // v2
COPILOT_CLEAR_BYOK: "integration:copilot:clear-byok",       // v2
```

No other IPC channels change. Existing `SEND_MESSAGE`, `STREAM_MESSAGE`, `TOOL_PERMISSION`, `INTERRUPT`, `MCP_*`, `CONTEXT_USAGE_GET`, `MODE_CHANGED`, `PLAN_REVIEW`, `ASK_USER_QUESTION`, `THREADS_*` all flow through the provider-agnostic agent-manager dispatch.

---

## 12. Settings Additions

`AppSettings` extensions (additive — no migration needed):

```
copilot?: {
  authMethod?: "github" | "byok";
  byok?: CopilotBYOKConfig;
};
```

- `providers.copilot.lastUsedModel` reuses the existing per-provider prefs slot.
- BYOK credentials, if/when added, store under `~/.stratos/copilot-byok.json` with `0600` perms — not in `app-settings.json` plaintext.

---

## 13. Process & Binary Management

- The Copilot CLI is **not** bundled in `node_modules` (unlike Codex). Users install it via `brew install gh; gh extension install github/gh-copilot` or the official installer.
- Provide a clear error path in `COPILOT_CHECK_CLI` when missing: "Install via `brew install gh && gh extension install github/gh-copilot`".
- Worktree isolation: pass `workingDirectory: cwd` to `CopilotClient` so all sessions for a thread inherit the right cwd. Session files live under `~/.stratos/instances/<hash>/copilot-sessions/` via a custom `sessionFsProvider`.
- Subprocess lifecycle: the SDK manages the subprocess. We do not need to spawn manually. On Electron-renderer crash, the orphaned subprocess is reaped by the SDK on next `client.dispose()` call from the new process.

---

## 14. Testing Strategy

### 14.1 Unit tests (`packages/core/src/__tests__/copilot.provider.test.ts`)

Mirror the structure of `claude-code.provider.test.ts`:

- `name === "copilot"`.
- `canResume()` returns false when no session file exists.
- `normalizeCopilotToolName` cases (one per row of the table in § 5.2(a)).
- Tool-output cap helpers (re-use the existing `stripOversizedImageData` and `capStreamingToolOutput` — both already provider-neutral).
- Mode → `agentMode` translation matrix.
- Reasoning effort translation (`max` → `high`, etc.).
- `subagent_event` synthesis from `subagent.*` event fixtures.
- `tool_use` → `tool_result` pairing across `tool.execution_start` → `_partial_result` → `_complete`.

### 14.2 Event-mapping fixture tests

For each Copilot event in § Appendix A, a `fixtures/copilot-events/<eventName>.json` capturing a representative payload. A single parameterised test asserts the resulting `AgentMessage[]` matches a `.golden.json`. This is the regression net — every SDK release runs against the golden set.

### 14.3 Integration tests

- `copilot.provider.integration.test.ts`: gated behind `RUN_COPILOT_INTEGRATION=1` env var (CI doesn't have a Copilot subscription). Boots a real CLI, runs a simple `2+2` prompt, asserts a `result` message arrives.

### 14.4 Transcript round-trip

- `sdk-transcript.test.ts`: add a `parseSessionCompleteNotification` case with `provider="copilot"`.
- Add a `loadCopilotTranscript` test against a captured JSONL session file.

### 14.5 UI smoke (Chrome DevTools MCP per `CLAUDE.md`)

- Switch provider to Copilot via the picker. Verify model dropdown populates.
- Send "hello". Verify streaming, reasoning bubble, result card.
- Send "edit foo.ts to add a comment". Verify diff renders identically to Claude.
- Send "/help" — verify slash commands populate.

---

## 15. Risks & Open Questions

| #   | Risk / Question                                                                     | Mitigation                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Copilot SDK is in public preview; type changes may break us.                        | Pin to a known-good version (`~0.X`). Wrap all SDK types behind our own interface layer. Re-run fixture tests on bumps.                                         |
| 2   | Reasoning tokens may not surface as text (e.g. o-series).                           | Render placeholder `[reasoning: <id>]`. Confirm with a manual test before shipping.                                                                             |
| 3   | Diff synthesis depends on pre-edit file capture; race possible.                     | Use `onPreToolUse` hook for guaranteed pre-edit timing.                                                                                                         |
| 4   | `modifiedInput` on permission approval is unsupported by Copilot.                   | v1: ignore modifications, log a warning. v2: file an upstream issue.                                                                                            |
| 5   | MCP runtime toggle missing in Copilot.                                              | Toggling rebuilds the session — slow but correct. Document in tooltip.                                                                                          |
| 6   | `pre-read` reliability for diffs on tools that don't touch disk.                    | Hooks only fire for tools that take a path. Edge cases (e.g. shell-driven edits) won't diff — fall back to "file changed: X" notice via `file_changed` variant. |
| 7   | One subprocess vs many — is the singleton client safe across threads?               | The SDK supports multiple sessions per client. Audit before final landing. If not, fall back to per-thread client.                                              |
| 8   | `getContextUsage` for non-live sessions creates throwaway sessions — possibly slow. | Cache aggressively. Use `mode: "empty"` if it's faster (probably not — we need real usage).                                                                     |
| 9   | Copilot's `customAgents` shape doesn't include Claude's `model` per-agent.          | v1: drop the per-agent model in translation. Document.                                                                                                          |
| 10  | The CLI may prompt interactively on first run (e.g. EULA).                          | Detect and surface via elicitation flow. Worst case: instruct user to run `copilot` once in a terminal.                                                         |
| 11  | Copilot subscription billing model (premium request quotas).                        | Surface `assistant.usage.cost` and `quotas` fields in the result message.                                                                                       |
| 12  | Sub-agent tool calls may not include `parentToolUseId` reliably.                    | Verify with fixture. If unreliable, infer from subagent.started timestamps.                                                                                     |

---

## 16. Phased Rollout (Milestones)

### Milestone 1 — Skeleton & connectivity (1–2d)

- Add `ProviderType: "copilot"`, registry entry, mode table, settings shape.
- Stub `CopilotProvider` returning `{ type: "error", message: "Not implemented" }`.
- Add `COPILOT_CHECK_CLI`/`CONNECT`/`DISCONNECT` IPC.
- Add `CopilotConnectPanel.tsx`.
- Provider picker shows "Copilot" option.

**Exit criteria:** Picking Copilot in the UI, with the CLI installed and authenticated, runs without crashing and shows the error stub.

### Milestone 2 — Streaming text + reasoning (1–2d)

- Implement `CopilotClient` singleton, `CopilotSession` per-instance.
- Event-to-AsyncGenerator bridge (§ 6.2).
- Map `assistant.message_start/_delta/.message` → `text`.
- Map `assistant.reasoning/_delta` → `thinking`.
- Map `session.idle` + `assistant.usage` → `result`.

**Exit criteria:** "Hello" returns streamed text + usage. Reasoning model returns thinking bubble.

### Milestone 3 — Tool calls + permissions + edits (2–3d)

- Tool name normalisation table.
- `tool.execution_start/_complete` → `tool_use`/`tool_result`.
- `permission.requested` → `permission_request` + permission handler.
- Pre-edit capture hook + diff synthesis.

**Exit criteria:** "Read package.json" works. "Edit foo.ts to add comment" shows diff. Permission prompt appears and blocks until answered.

### Milestone 4 — Sub-agents + plan + TODOs (2d)

- `customAgents` translation from Claude's `agents` config.
- `subagent.*` → `subagent_event` + task notification.
- `session.plan_changed` → `plan_update`.
- `exit_plan_mode.requested` → existing `PLAN_REVIEW` flow.
- `update_plan`/`todo` tool → `todo_update`.

**Exit criteria:** Spawning a sub-agent via Copilot custom agent works. Plan mode lifecycle works end-to-end. TodoWrite card renders.

### Milestone 5 — MCP + context usage + slash commands (2d)

- `mcpServers` translation (Stratos shape → Copilot shape).
- `mcp_servers.loaded` / `mcp_server_status.changed` → status cache + `MCP_STATUS_CHANGED` broadcast.
- `mcp_oauth.required` → elicitation flow.
- `session.usage_info` → cache; `getContextUsage()` wiring.
- `commands.changed` → slash command discovery + re-emit on `session_init`.

**Exit criteria:** Stratos's bundled MCP tools available in Copilot. `/context` panel populates. Slash command palette works.

### Milestone 6 — Persistence + resume + transcript loader (2d)

- Custom `sessionFsProvider` puts sessions under `~/.stratos/instances/<hash>/copilot-sessions/`.
- `canResume()` checks the FS adapter.
- `loadCopilotTranscript()` translates persisted events to `StoredMessage[]`.

**Exit criteria:** Quitting + relaunching Stratos resumes a Copilot thread with its history intact.

### Milestone 7 — Edge cases + polish + tests (2–3d)

- Error event mapping coverage.
- Image input.
- All fixture tests passing.
- UI smoke tests via Chrome DevTools MCP.

**Exit criteria:** All Goals in § 1 ticked. CI green.

**Total estimate:** 12–18 person-days.

---

## 17. File-by-file Change List

### New files

| Path                                                               | Purpose                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/core/src/providers/copilot.provider.ts`                  | The `CopilotProvider` class.                                                  |
| `packages/core/src/providers/copilot.tools.ts`                     | Tool name normalisation table + helper.                                       |
| `packages/core/src/providers/copilot.diff.ts`                      | Diff synthesis from before/after file contents.                               |
| `packages/core/src/providers/copilot.events.ts`                    | `transformEvent(rawEvent, ctx): AgentMessage[]` — the central mapping fn.     |
| `packages/core/src/providers/copilot.queue.ts`                     | `EventQueue<T>` async generator bridge.                                       |
| `packages/core/src/providers/copilot.translate.ts`                 | Mode / reasoningEffort / mcpServers / customAgents / attachments translators. |
| `packages/core/src/storage/copilot-transcript.ts`                  | Transcript loader (parallel to `sdk-transcript.ts`).                          |
| `packages/core/src/__tests__/copilot.provider.test.ts`             | Unit tests.                                                                   |
| `packages/core/src/__tests__/copilot.provider.integration.test.ts` | Live integration (gated).                                                     |
| `packages/core/src/__tests__/fixtures/copilot-events/*.json`       | Event fixture set.                                                            |
| `packages/desktop/src/main/integrations/copilot-path.ts`           | CLI detection + path resolution.                                              |
| `packages/desktop/src/main/integrations/copilot-auth.ipc.ts`       | `_CHECK_CLI` / `_CONNECT` / `_DISCONNECT` / `_GET_CONNECTION` handlers.       |
| `packages/ui/src/components/CopilotConnectPanel.tsx`               | Settings panel.                                                               |
| `docs/copilot-provider-design.md`                                  | This document.                                                                |

### Modified files

| Path                                                   | Change                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `packages/core/src/providers/index.ts`                 | Register `copilot: CopilotProvider`.                                                                  |
| `packages/core/src/providers/types.ts`                 | Extend `AgentMessage` union with `subagent_event`, `hook_event`, `file_changed`.                      |
| `packages/core/src/types/thread.ts`                    | `ProviderType` adds `"copilot"`.                                                                      |
| `packages/core/src/types/mode.ts`                      | Mode mapping for `copilot` + `PROVIDER_MODE_CONFIG_OVERRIDES.copilot`.                                |
| `packages/core/src/storage/sdk-transcript.ts`          | Dispatch to `loadCopilotTranscript` when `thread.provider === "copilot"`.                             |
| `packages/core/package.json`                           | Add `@github/copilot-sdk` dep.                                                                        |
| `packages/desktop/src/main/agent-manager.ts`           | `buildMcpServers` adds `copilot` case (stdio, same as codex). Other default-fallback sites unchanged. |
| `packages/desktop/src/main/settings/settings.store.ts` | Add `copilot?: CopilotConfig` to `AppSettings`.                                                       |
| `packages/desktop/src/main/settings/settings.ipc.ts`   | (Indirect) register new auth IPC handlers.                                                            |
| `packages/desktop/src/common/ipc-channels.ts`          | Add `COPILOT_CHECK_CLI`/`CONNECT`/`DISCONNECT`/`GET_CONNECTION`.                                      |
| `packages/ui/src/components/ProviderToggle.tsx`        | Add Copilot entry to the provider list.                                                               |
| `packages/ui/src/components/MessageBubble.tsx`         | Handle `subagent_event` + `hook_event` + `file_changed` (initial: just render or no-op).              |
| `packages/desktop/src/renderer/hooks/useChat.ts`       | Pass through new `AgentMessage` variants to `StoredMessage`.                                          |
| `packages/desktop/src/renderer/App.tsx`                | Provider picker wiring (additive).                                                                    |

### Unchanged but verified compatible

- `packages/core/src/storage/trace.store.ts` (provider-neutral).
- `packages/core/src/storage/file-adapter.ts` (provider field already supported).
- `packages/desktop/src/main/mcp/handlers/index.ts` (handlers are provider-agnostic).
- `packages/ui/src/components/ChatView.tsx` (props already accept any `ProviderType`).

---

## 18. Appendix A — Full Copilot SessionEvent Index

For reference, the 89 event types emitted by `@github/copilot-sdk` and their target mapping. **`→`** indicates the resulting Stratos `AgentMessage` variant (or "trace" for trace-only).

| #   | Event                                                              | Stratos target                                     |
| --- | ------------------------------------------------------------------ | -------------------------------------------------- |
| 1   | `session.start`                                                    | `session_init` (coalesced)                         |
| 2   | `session.resume`                                                   | `session_init` (coalesced)                         |
| 3   | `session.remote_steerable_changed`                                 | trace                                              |
| 4   | `session.error`                                                    | `error`                                            |
| 5   | `session.idle`                                                     | terminates turn; triggers `result`                 |
| 6   | `session.title_changed`                                            | persist thread title; no `AgentMessage`            |
| 7   | `session.schedule_created`                                         | scheduler bridge / trace                           |
| 8   | `session.schedule_cancelled`                                       | scheduler bridge / trace                           |
| 9   | `session.autopilot_objective_changed`                              | trace (v2: status pill)                            |
| 10  | `session.info`                                                     | trace (selective `text` for notifications)         |
| 11  | `session.warning`                                                  | trace                                              |
| 12  | `session.model_change`                                             | persist; broadcast                                 |
| 13  | `session.mode_changed`                                             | `MODE_CHANGED` broadcast                           |
| 14  | `session.permissions_changed`                                      | `MODE_CHANGED` if effective mode shifts            |
| 15  | `session.plan_changed`                                             | `plan_update`                                      |
| 16  | `session.workspace_file_changed`                                   | `file_changed`                                     |
| 17  | `session.handoff`                                                  | trace                                              |
| 18  | `session.truncation`                                               | trace                                              |
| 19  | `session.snapshot_rewind`                                          | trace                                              |
| 20  | `session.shutdown`                                                 | finalises `result`                                 |
| 21  | `session.context_changed`                                          | trace                                              |
| 22  | `session.usage_info`                                               | cache for `getContextUsage`                        |
| 23  | `session.compaction_start`                                         | trace                                              |
| 24  | `session.compaction_complete`                                      | trace                                              |
| 25  | `session.task_complete`                                            | feeds `result` synthesis                           |
| 26  | `user.message`                                                     | already echoed by UI                               |
| 27  | `pending_messages.modified`                                        | trace (v2: queue badge)                            |
| 28  | `assistant.turn_start`                                             | trace                                              |
| 29  | `assistant.intent`                                                 | `thinking` (prefixed)                              |
| 30  | `assistant.reasoning`                                              | `thinking` (final)                                 |
| 31  | `assistant.reasoning_delta`                                        | `thinking` (streaming)                             |
| 32  | `assistant.streaming_delta`                                        | trace                                              |
| 33  | `assistant.message`                                                | `text` (final)                                     |
| 34  | `assistant.message_start`                                          | mark streaming start                               |
| 35  | `assistant.message_delta`                                          | `text` (streaming)                                 |
| 36  | `assistant.turn_end`                                               | feeds `result` synthesis                           |
| 37  | `assistant.usage`                                                  | populates `result.cost` / `result.usage`           |
| 38  | `model.call_failure`                                               | `error` (with code)                                |
| 39  | `abort`                                                            | trace; turn ends via `session.idle`                |
| 40  | `tool.user_requested`                                              | `tool_use`                                         |
| 41  | `tool.execution_start`                                             | `tool_use`                                         |
| 42  | `tool.execution_partial_result`                                    | `tool_result` (incremental, opt-in)                |
| 43  | `tool.execution_progress`                                          | trace                                              |
| 44  | `tool.execution_complete`                                          | `tool_result` (final)                              |
| 45  | `skill.invoked`                                                    | trace (v2: card)                                   |
| 46  | `subagent.started`                                                 | `subagent_event` + `task_notification`             |
| 47  | `subagent.completed`                                               | `subagent_event` + `task_notification`             |
| 48  | `subagent.failed`                                                  | `subagent_event` + `task_notification`             |
| 49  | `subagent.selected`                                                | `subagent_event`                                   |
| 50  | `subagent.deselected`                                              | `subagent_event`                                   |
| 51  | `hook.start`                                                       | `hook_event`                                       |
| 52  | `hook.end`                                                         | `hook_event`                                       |
| 53  | `hook.progress`                                                    | `hook_event`                                       |
| 54  | `system.message`                                                   | trace                                              |
| 55  | `system.notification`                                              | `task_notification` when applicable                |
| 56  | `permission.requested`                                             | `permission_request`                               |
| 57  | `permission.completed`                                             | trace                                              |
| 58  | `user_input.requested`                                             | `AskUserQuestion` IPC                              |
| 59  | `user_input.completed`                                             | trace                                              |
| 60  | `elicitation.requested`                                            | `MCP_ELICITATION` IPC                              |
| 61  | `elicitation.completed`                                            | trace                                              |
| 62  | `sampling.requested`                                               | trace                                              |
| 63  | `sampling.completed`                                               | trace                                              |
| 64  | `mcp_oauth.required`                                               | `MCP_ELICITATION` (mode: url)                      |
| 65  | `mcp_oauth.completed`                                              | trace                                              |
| 66  | `custom_notification`                                              | trace                                              |
| 67  | `external_tool.requested`                                          | `tool_use`                                         |
| 68  | `external_tool.completed`                                          | `tool_result`                                      |
| 69  | `command.queued`                                                   | trace                                              |
| 70  | `command.execute`                                                  | `tool_use` (name: `Bash`)                          |
| 71  | `command.completed`                                                | `tool_result`                                      |
| 72  | `auto_mode_switch.requested`                                       | `permission_request` (mode_switch flavour)         |
| 73  | `auto_mode_switch.completed`                                       | trace                                              |
| 74  | `commands.changed`                                                 | update slash command cache; re-emit `session_init` |
| 75  | `capabilities.changed`                                             | update tool/capabilities cache                     |
| 76  | `exit_plan_mode.requested`                                         | `PLAN_REVIEW` IPC                                  |
| 77  | `exit_plan_mode.completed`                                         | trace                                              |
| 78  | `tools.updated`                                                    | update tool cache; re-emit `session_init`          |
| 79  | `background_tasks.changed`                                         | trace                                              |
| 80  | `skills.loaded`                                                    | trace                                              |
| 81  | `custom_agents.updated`                                            | trace (v2: agent palette refresh)                  |
| 82  | `mcp_servers.loaded`                                               | populate status cache                              |
| 83  | `mcp_server_status.changed`                                        | update status cache; `MCP_STATUS_CHANGED`          |
| 84  | `extensions.loaded`                                                | trace                                              |
| 85  | `canvas.opened`                                                    | trace (v2: Canvas UI)                              |
| 86  | `canvas_registry.changed`                                          | trace                                              |
| 87  | `mcp_app_tool_call.complete`                                       | `tool_result` (MCP-app flavour)                    |
| 88  | `tool.user_requested` (duplicate-id; user-initiated tool from CLI) | `tool_use`                                         |
| 89  | (reserve)                                                          | future SDK additions — fallback: trace + warn      |

---

## 19. Appendix B — Open follow-up docs

After v1 ships, we should write:

- **Copilot Canvas UX** — how to render the interactive Canvas surface in the chat pane.
- **BYOK key management** — UI for entering OpenAI/Azure/Anthropic credentials.
- **Provider unification refactor** — collapse the four providers' duplicated patterns (event-bridging, MCP translation, mode mapping) into shared helpers.
- **Subagent UX upgrade** — first-class sub-agent panel that shows tree of nested invocations.

---

_End of plan. Implementation will proceed against the milestones in § 16._

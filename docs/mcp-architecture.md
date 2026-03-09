# MCP Architecture in Stratos

> Design doc for how MCP (Model Context Protocol) servers are managed in Stratos.
> Written as a reference for implementing MCP support in new providers (e.g., Codex).

## Overview

MCP servers give the AI agent access to external tools (Linear, GitHub, Slack, etc.). Stratos manages MCP server lifecycle across three layers:

```
┌─────────────────────────────────────────────────────┐
│  UI (packages/ui)                                   │
│  ToolsPopover.tsx — displays servers, toggles, auth │
│  useChat.ts — holds mcpServers state                │
├─────────────────────────────────────────────────────┤
│  Desktop (packages/desktop)                         │
│  agent-manager.ts — IPC handlers, push notifications│
│  preload/index.ts — IPC bridge to renderer          │
│  App.tsx — wires callbacks to ToolsPopover          │
├─────────────────────────────────────────────────────┤
│  Core (packages/core)                               │
│  AgentProvider interface — defines MCP methods      │
│  ClaudeCodeProvider — implements via SDK query obj   │
└─────────────────────────────────────────────────────┘
```

## Data Types

### `McpServerInfo` (`packages/core/src/providers/types.ts`)

```ts
interface McpServerInfo {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  scope?: string; // "project" | "user" | "local" | "claudeai" | "managed"
  configPath?: string; // resolved path to .mcp.json
  tools: string[]; // tool names provided by this server
  error?: string;
  configType?: string; // "stdio" | "sse" | "http" | "claudeai-proxy"
  configId?: string; // for claudeai-proxy auth URL construction
}
```

### `AgentProvider` MCP methods (`packages/core/src/providers/types.ts`)

```ts
interface AgentProvider {
  // ... other methods ...
  getMcpServerStatus?(): Promise<McpServerInfo[]>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
  reconnectMcpServer?(serverName: string): Promise<{ authUrl?: string } | void>;
}
```

All three methods are optional — providers that don't support MCP simply omit them.

## How MCP Works in the Claude Provider

### The "query object" problem

The Claude Agent SDK exposes MCP operations as methods on the `query()` return value:

```ts
const q = query({ prompt, options: { mcpServers: {...} } });
q.mcpServerStatus()        // get status of all servers
q.toggleMcpServer(name, v) // enable/disable
q.mcpAuthenticate(name)    // trigger OAuth flow
q.reconnectMcpServer(name) // reconnect failed server
```

**The catch:** these methods only work while the query's transport is alive. When a conversation turn ends (the `for await` loop over the query finishes), the transport closes and all MCP methods stop working.

### Solution: the "control query" pattern

`ClaudeCodeProvider` maintains two query objects:

| Query          | Lifetime                                          | Purpose                                            |
| -------------- | ------------------------------------------------- | -------------------------------------------------- |
| `currentQuery` | During a turn (`sendMessage` generator is active) | Handles the conversation, MCP ops during streaming |
| `controlQuery` | Between turns (after `sendMessage` returns)       | Keeps transport alive for MCP toggle/status/auth   |

The `mcpQuery` getter returns whichever is available:

```ts
private get mcpQuery() {
  return this.currentQuery ?? this.controlQuery;
}
```

### Control query lifecycle

```
sendMessage() called
  ├── closeControlQuery()         // tear down previous control query
  ├── this.currentQuery = query({...})
  ├── for await (msg of currentQuery) { yield... }
  ├── this.currentQuery = undefined  // transport is now closed
  └── ensureControlQuery()         // spin up new control query
```

The control query uses a "parked prompt" — an async generator that never yields, keeping the SDK transport alive indefinitely without consuming tokens:

```ts
async function* parkedPrompt() {
  await new Promise<void>(resolve => { resolveParked = resolve; });
}

const controlQ = query({
  prompt: parkedPrompt(),
  options: { resume: this.sessionId, permissionMode: "plan", ... }
});
```

Key details:

- Uses `resume: sessionId` so the SDK reuses the existing session
- Uses `permissionMode: "plan"` (read-only) for safety
- Passes `mcpServers` config so the SDK knows about MCP servers
- Passes `onElicitation` handler (stored from last `sendMessage`) so OAuth popups still work between turns
- The background async drain loop (`for await (const _msg of controlQ)`) must run to keep the transport open
- `closeControlQuery()` unparks the promise and calls `q.close()` to tear it down

### Reconnect / authenticate flow

`reconnectMcpServer(serverName)` handles three server types differently:

1. **claudeai-proxy** servers (Google Calendar, Gmail, etc.):
   - Constructs auth URL directly: `https://claude.ai/api/organizations/{orgId}/mcp/start-auth/{serverId}`
   - Uses `q.accountInfo()` to get the org UUID
   - Falls back to `https://claude.ai/settings/connectors`

2. **SSE/HTTP servers** with OAuth (e.g., Linear):
   - Calls `q.mcpAuthenticate(serverName)` which returns `{ authUrl }` for the OAuth flow
   - The agent-manager opens the URL via `shell.openExternal()`

3. **Failed/disconnected servers** (stdio, etc.):
   - Calls `q.reconnectMcpServer(serverName)` as a simple retry

## IPC Channels

| Channel                    | Direction                  | Purpose                                         |
| -------------------------- | -------------------------- | ----------------------------------------------- |
| `mcp:server-status`        | renderer → main → renderer | Request/response: fetch current server statuses |
| `mcp:toggle-server`        | renderer → main            | Toggle a server on/off                          |
| `mcp:reconnect-server`     | renderer → main            | Trigger reconnect/auth                          |
| `mcp:status-changed`       | main → renderer (push)     | Push updated statuses after toggle/reconnect    |
| `mcp:open-config`          | renderer → main            | Open .mcp.json in system editor                 |
| `mcp:elicitation`          | main → renderer (push)     | MCP server requests user input (OAuth form)     |
| `mcp:elicitation-response` | renderer → main            | User's response to elicitation                  |

### Event-driven status updates (this session's work)

Before: App.tsx polled `mcp:server-status` 12 times at 5-second intervals after reconnect.

After: The main process pushes `mcp:status-changed` after every toggle/reconnect:

```
User clicks toggle in ToolsPopover
  → App.tsx calls window.api.mcpToggleServer(threadId, name, enabled)
  → IPC to agent-manager MCP_TOGGLE_SERVER handler
    → provider.toggleMcpServer(name, enabled)
    → pushMcpStatus(threadId)
      → getMcpStatusForThread(threadId)  // fetch + resolve configPaths
      → sendToRenderer("mcp:status-changed", { threadId, servers })
  → useChat.ts onMcpStatusChanged listener fires
    → setMcpServers(servers)
  → ToolsPopover re-renders with new state
```

### `getMcpStatusForThread` (agent-manager.ts)

This is a private helper that:

1. Calls `provider.getMcpServerStatus()` to get raw statuses
2. Resolves `configPath` from `scope` + thread's `cwd`:
   - `project` → `{cwd}/.mcp.json`
   - `user` → `~/.claude/.mcp.json`
   - `local` → `{cwd}/.claude/.mcp.json`
3. Returns the enriched status array

Used by both the pull (`MCP_SERVER_STATUS`) and push (`pushMcpStatus`) paths.

## Initial MCP status loading

When a session first starts, status arrives in two phases:

1. **session_init event** — the SDK's `system/init` message includes `mcp_servers` with basic name+status (no scope, no tools, no configPath). `useChat.ts` sets `mcpServers` from this.

2. **Auto-fetch** — immediately after `session_init`, `useChat.ts` calls `window.api.mcpServerStatus(threadId)` to get full status with scope, tools, and configPaths. This overwrites the basic data.

## UI: ToolsPopover

`packages/ui/src/components/ToolsPopover.tsx` renders the MCP server list.

Key props from App.tsx:

- `mcpServers` — the `McpServerInfo[]` from `useChat`
- `onToggleServer(name, enabled)` — calls `mcpToggleServer` IPC
- `onReconnectServer(name)` — calls `mcpReconnectServer` IPC
- `onOpenConfig(path)` — calls `mcpOpenConfig` IPC

Visual states per server:

- **connected** — green dot, green toggle, tool count shown
- **disabled** — gray dot, gray toggle, "Enable server" title
- **needs-auth** — yellow dot, "Authenticate" button (except claudeai-proxy)
- **failed** — red dot, "Connection failed" + "Retry" button

## Implementing MCP for a New Provider (e.g., Codex)

### Minimum viable implementation

Implement the three optional methods on `AgentProvider`:

```ts
class CodexProvider implements AgentProvider {
  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    // Return status of all configured MCP servers
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    // Enable/disable a server
  }

  async reconnectMcpServer(name: string): Promise<{ authUrl?: string } | void> {
    // Reconnect or return authUrl for OAuth
  }
}
```

### What to watch out for

1. **Transport lifetime** — If the Codex SDK has a similar pattern where MCP methods require an active connection, you'll need an equivalent of the control query pattern to keep MCP operations working between turns.

2. **Status push** — The agent-manager's `pushMcpStatus` calls `provider.getMcpServerStatus()` and pushes via IPC. This works automatically for any provider that implements the method — no desktop-layer changes needed.

3. **configPath resolution** — The agent-manager resolves `configPath` from `scope` + `cwd`. If the Codex provider returns `scope` values, this works automatically. If Codex uses a different config structure, you may need to set `configPath` directly in the provider.

4. **Elicitation** — MCP OAuth flows use the elicitation system (`onElicitation` callback in `SendMessageParams`). The agent-manager already wires this to an IPC channel (`mcp:elicitation` / `mcp:elicitation-response`). The provider just needs to pass the callback through to whatever SDK mechanism handles it.

5. **Server config** — MCP servers are passed via `ProviderConfig.mcpServers` (a `Record<string, any>`). The format follows the Claude Agent SDK convention. Check if Codex uses the same format or needs adaptation.

## File Reference

| File                                         | Role                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| `core/src/providers/types.ts`                | `McpServerInfo`, `AgentProvider` interface             |
| `core/src/providers/claude-code.provider.ts` | Claude implementation with control query pattern       |
| `desktop/src/common/ipc-channels.ts`         | IPC channel constants                                  |
| `desktop/src/main/agent-manager.ts`          | IPC handlers, `getMcpStatusForThread`, `pushMcpStatus` |
| `desktop/src/preload/index.ts`               | `onMcpStatusChanged` listener + all MCP API bridges    |
| `desktop/src/renderer/hooks/useChat.ts`      | `mcpServers` state, `onMcpStatusChanged` subscription  |
| `desktop/src/renderer/App.tsx`               | Wires toggle/reconnect callbacks (fire-and-forget)     |
| `ui/src/components/ToolsPopover.tsx`         | Visual server list with toggles and auth buttons       |
| `ui/src/bridges/types.ts`                    | `McpServerInfo` (UI-side mirror of core type)          |

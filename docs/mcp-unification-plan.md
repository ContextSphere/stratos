# Stratos MCP Unification Plan (single server, stdio transport)

**Status:** Approved — implementation in progress.
**Constraints:** stdio only (no HTTP); one unified MCP server (`stratos`) replacing today's three.

## Why one server, not three

"MCP server" is just a tool-name namespace. The three servers (`stratos-scheduler`, `stratos-preview`, `stratos-manager`) are historical accident — they grew at different times and each got its own stdio binary. There are no tool-name collisions across them, so folding them into one `stratos` server loses zero disambiguation while eliminating:

- 2 extra stdio entries per provider config
- 2 extra MCP connections per session (init + tools/list × 3)
- The `server` selector that would otherwise be needed in the stdio proxy
- The separate handler factories + deps bags

## Target architecture

```
     ┌──────────────────────────────────────────────────────────────┐
     │  Electron main (packages/desktop)                            │
     │                                                              │
     │  mcp/handlers/scheduler.ts  ┐                                │
     │  mcp/handlers/preview.ts    ├─ split by domain for           │
     │  mcp/handlers/manager.ts    ┘  source organisation           │
     │         │                                                    │
     │         └─→ createStratosHandlers(deps): HandlerDef[]        │
     │                     (19 tools: 6+2+11; single flat list)    │
     │                     │                                        │
     │                     ├─→ mcp/sdk-adapter.ts                   │
     │                     │     handlersToSdkMcp("stratos", defs)  │
     │                     │     → used for Claude Code (in-proc)   │
     │                     │                                        │
     │                     └─→ mcp/socket-mcp-server.ts             │
     │                          Unix-socket MCP dispatcher          │
     │                          (one server, one namespace)         │
     └────────────────────────────────┬─────────────────────────────┘
                                      │ stream-json over UDS
                                      │ ~/.stratos/mcp-<hash>.sock
                                      ▼
                     ┌────────────────────────────────┐
                     │ ~/.stratos/bin/stratos-mcp     │  One script,
                     │ generic stdio ⇄ socket proxy   │  ~90 LOC,
                     │ (no schemas, no logic,         │  schema-free,
                     │ no server selector)            │  stateless.
                     └───────────────┬────────────────┘
                                     │ MCP stdio
                                     ▼
                     ┌───────────────────────────┐
                     │ Codex / Opencode CLI      │
                     └───────────────────────────┘
```

Claude Code uses the SDK adapter (in-process, bypasses LinkedIn allowlist).
Codex + Opencode spawn the stdio proxy; proxy forwards frames to the main-process socket, which dispatches to the right handler.

## Tool surface after unification

Every existing tool keeps its name — only the MCP server prefix changes:

| Before                                     | After                             |
| ------------------------------------------ | --------------------------------- |
| `mcp__stratos-scheduler__schedule_create`  | `mcp__stratos__schedule_create`   |
| `mcp__stratos-scheduler__schedule_list`    | `mcp__stratos__schedule_list`     |
| `mcp__stratos-scheduler__schedule_delete`  | `mcp__stratos__schedule_delete`   |
| `mcp__stratos-scheduler__schedule_enable`  | `mcp__stratos__schedule_enable`   |
| `mcp__stratos-scheduler__schedule_disable` | `mcp__stratos__schedule_disable`  |
| `mcp__stratos-scheduler__schedule_folders` | `mcp__stratos__schedule_folders`  |
| `mcp__stratos-preview__preview_open_file`  | `mcp__stratos__preview_open_file` |
| `mcp__stratos-preview__preview_close`      | `mcp__stratos__preview_close`     |
| `mcp__stratos-manager__create_session`     | `mcp__stratos__create_session`    |
| `mcp__stratos-manager__send_message`       | `mcp__stratos__send_message`      |
| `mcp__stratos-manager__stop_session`       | `mcp__stratos__stop_session`      |
| `mcp__stratos-manager__delete_session`     | `mcp__stratos__delete_session`    |
| `mcp__stratos-manager__list_sessions`      | `mcp__stratos__list_sessions`     |
| `mcp__stratos-manager__get_session`        | `mcp__stratos__get_session`       |
| `mcp__stratos-manager__search_sessions`    | `mcp__stratos__search_sessions`   |
| `mcp__stratos-manager__get_dashboard`      | `mcp__stratos__get_dashboard`     |
| `mcp__stratos-manager__list_workspaces`    | `mcp__stratos__list_workspaces`   |
| `mcp__stratos-manager__create_workspace`   | `mcp__stratos__create_workspace`  |
| `mcp__stratos-manager__remove_workspace`   | `mcp__stratos__remove_workspace`  |

19 tools in one flat namespace.

## HandlerDef shape

```ts
export interface HandlerDef<Schema extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Schema;
  handler: (args: InferShape<Schema>) => Promise<ToolResult>;
  annotations?: ToolAnnotations;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};
```

## Handler deps (unchanged)

```ts
interface StratosHandlerDeps {
  storage: FileStorageAdapter;
  agentManager: AgentManager;
  window: BrowserWindow;
  sendToRenderer: (channel: string, data: unknown) => void;
}

export function createStratosHandlers(deps: StratosHandlerDeps): HandlerDef[] {
  return [
    ...createSchedulerHandlers(deps), // 6 tools
    ...createPreviewHandlers(deps), // 2 tools
    ...createManagerHandlers(deps), // 11 tools
  ];
}
```

## Stdio proxy

`~/.stratos/bin/stratos-mcp` — ~90 LOC, no dependencies, no schemas, no server selector:

```js
const sock = process.env.STRATOS_MCP_SOCK;
const conn = net.createConnection(sock);
readline
  .createInterface({ input: process.stdin })
  .on("line", (l) => conn.write(l + "\n"));
readline
  .createInterface({ input: conn })
  .on("line", (l) => process.stdout.write(l + "\n"));
// + error handling, exit on close, short retry if socket not ready at spawn
```

The proxy is a pure pipe. Every MCP frame (initialize / tools/list / tools/call / notifications/initialized / ping) is handled by main via the socket.

## Socket MCP server

One Unix-domain-socket server (`~/.stratos/mcp-<instance-hash>.sock`, mode 0600) that speaks MCP JSON-RPC:

- `initialize` → returns `{ serverInfo: { name: "stratos", version: "1.0.0" }, capabilities: { tools: {} } }`
- `tools/list` → enumerates the `HandlerDef[]`, converts zod → JSON Schema via `zod-to-json-schema`
- `tools/call` → looks up by tool name, zod-validates args, invokes handler, returns `ToolResult`
- `notifications/initialized`, `ping` → standard

Multiple concurrent connections are supported (each Codex/Opencode subprocess gets its own stateless connection).

## Codex / Opencode wiring

**Codex (via `-c` overrides):**

```
-c mcp_servers.stratos.command="node"
-c mcp_servers.stratos.args=["/Users/…/.stratos/bin/stratos-mcp"]
-c mcp_servers.stratos.env.STRATOS_MCP_SOCK="/Users/…/.stratos/mcp-<hash>.sock"
```

**Opencode (inside `OPENCODE_CONFIG_CONTENT.mcp`):**

```json
{
  "stratos": {
    "type": "local",
    "command": ["node", "/Users/…/.stratos/bin/stratos-mcp"],
    "enabled": true,
    "environment": { "STRATOS_MCP_SOCK": "/Users/…/.stratos/mcp-<hash>.sock" }
  }
}
```

One entry per provider instead of three.

## Claude wiring (unchanged in spirit)

`buildMcpServers({ providerName: "claude-code", ... })` returns a single SDK config:

```ts
{
  stratos: handlersToSdkMcp("stratos", "1.0.0", createStratosHandlers(deps));
}
```

## System-prompt updates (find/replace)

- `packages/desktop/src/main/agent-manager.ts:991-1003` → change `stratos-scheduler` / `stratos-preview` references to `stratos`
- `packages/desktop/src/main/agent-manager.ts:1685-1694` → same for scheduled-prompt flow
- `packages/desktop/src/main/manager/manager-session.ts:43, 55-59` → Manager Agent prompt: `stratos-manager` + `stratos-scheduler` references collapse to `stratos`

The tool-name literals in the prompt text (`schedule_create`, `preview_open_file`, etc.) are unchanged — only the server-prefix references.

## What gets deleted

| Path                                                                                                     |
| -------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/main/scheduler/schedule-mcp-source.ts`                                             |
| `packages/desktop/src/main/preview-mcp-source.ts`                                                        |
| `packages/desktop/src/main/preview-mcp.ts`                                                               |
| `packages/desktop/src/main/manager/manager-mcp-source.ts`                                                |
| `packages/desktop/src/main/manager/manager-bridge.ts`                                                    |
| `packages/desktop/src/main/mcp/{scheduler,preview,manager}-sdk.ts` (replaced by one unified entry point) |
| `installPreviewMcp()`, `installSchedulerMcp()`, `installManagerMcp()` and their call sites               |
| `~/.stratos/bin/stratos-{schedule,preview,manager}-mcp` — removed by startup cleanup                     |

## What gets added

| Path                                                         |
| ------------------------------------------------------------ |
| `mcp/handlers/types.ts`                                      |
| `mcp/handlers/scheduler.ts`                                  |
| `mcp/handlers/preview.ts`                                    |
| `mcp/handlers/manager.ts`                                    |
| `mcp/handlers/index.ts` (re-exports `createStratosHandlers`) |
| `mcp/sdk-adapter.ts`                                         |
| `mcp/socket-mcp-server.ts`                                   |
| `mcp/stdio-proxy.ts` + `stdio-proxy-source.ts`               |

## Implementation steps

1. `mcp/handlers/types.ts` — `HandlerDef`, `ToolResult`, `textResult()`.
2. Port handlers from the existing SDK adapters into `mcp/handlers/{scheduler,preview,manager}.ts`. Each exports a factory taking deps and returning `HandlerDef[]`.
3. `mcp/handlers/index.ts` — `createStratosHandlers(deps)` concatenates all three.
4. `mcp/sdk-adapter.ts` — `handlersToSdkMcp(name, version, defs)`.
5. `mcp/socket-mcp-server.ts` — Unix-socket MCP dispatcher. Uses `zod-to-json-schema`.
6. `mcp/stdio-proxy.ts` + `stdio-proxy-source.ts` — installer + embedded generic proxy.
7. Wire into `AgentManager`: start socket server + install proxy in constructor; dispose on quit.
8. Update `buildMcpServers` + `manager-session.ts` `mcpServers`:
   - claude-code: one `stratos` SDK entry
   - codex/opencode: one `stratos` stdio entry pointing at the proxy
9. Update `buildCodexMcpArgs` / `buildOpencodeMcpConfig` tests for the new shape (same signatures, one entry in + one entry out).
10. Update system prompts in `agent-manager.ts` and `manager-session.ts` (`stratos-*` → `stratos`).
11. Delete the 6 dead files listed above.
12. Startup cleanup: `rmSync` legacy `~/.stratos/bin/stratos-{schedule,preview,manager}-mcp` + legacy `.sock` files.
13. Update unit tests:
    - `scheduler-sdk.test.ts`, `preview-sdk.test.ts`, `manager-sdk.test.ts` → fold into `handlers/{scheduler,preview,manager}.test.ts` operating on `HandlerDef[]` directly.
    - Add `socket-mcp-server.test.ts` for the socket dispatcher.
    - Add `stdio-proxy.integration.test.ts` that spawns the proxy against the socket.
14. Update docs (`docs/mcp-sdk-migration.md`) to reflect the unified architecture.

## Tests

- **Handler unit tests** — call handlers directly with mocked deps. Same coverage as today's SDK tests.
- **SDK adapter contract test** — `handlersToSdkMcp("stratos", "1.0.0", defs)` produces `{ type: "sdk", name: "stratos" }` and lists all 19 tools via an in-memory client.
- **Socket server tests** — `initialize`, `tools/list` (all 19), `tools/call` dispatch, unknown tool error path, invalid args zod-reject.
- **Stdio proxy integration test** — spawn the proxy as a real subprocess, pipe MCP frames through its stdin, read responses from stdout, assert round-trip works.
- **Cross-transport parity test** — SDK adapter and socket server must yield byte-identical `tools/list` output.
- **Existing policy integration test** stays — `sdk-mcp-policy.integration.test.ts` asserts the Claude SDK path bypasses LinkedIn's allowlist.

## CDP end-to-end verification (required to declare done)

All 9 (provider × domain) cells of:

| Provider    | Scheduler tool                   | Preview tool                      | Manager tool                  |
| ----------- | -------------------------------- | --------------------------------- | ----------------------------- |
| claude-code | `mcp__stratos__schedule_folders` | `mcp__stratos__preview_open_file` | `mcp__stratos__list_sessions` |
| codex       | `mcp__stratos__schedule_folders` | `mcp__stratos__preview_open_file` | `mcp__stratos__list_sessions` |
| opencode    | `stratos_schedule_folders`       | `stratos_preview_open_file`       | `stratos_list_sessions`       |

(Opencode uses `_` instead of `__` — their convention.)

No `Warning: MCP server blocked by enterprise policy` in the dev-target console anywhere.

## Risks & mitigations

| Risk                                                                                                             | Mitigation                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing saved schedules reference `provider: "claude-code"` etc but no tool-name literals — no migration needed | —                                                                                                                                                                  |
| Someone has a skill / external config referencing the old `mcp__stratos-scheduler__*` names                      | Stratos is self-contained; no external consumers. Internal references (system prompts, docs) are find/replaced in this change.                                     |
| Zod→JSON-Schema converter shape differs between SDK and our socket server                                        | Cross-transport parity test asserts byte-identical output; fix the converter if needed (SDK uses `zod-to-json-schema` — we use the same library).                  |
| Startup race: Codex spawns the proxy before the socket is ready                                                  | `AgentManager` starts the socket synchronously in its constructor, before any provider is initialised. Proxy retries `createConnection` for ≤2s with 50ms backoff. |
| Permissions: other users on the machine could connect to the socket                                              | `chmodSync(socketPath, 0o600)` immediately after `listen()`.                                                                                                       |

## Open questions — resolved

1. Unified vs three servers → **one server**, confirmed.
2. Delete old `*-sdk.ts` wrappers → **delete** (cleaner; the tests fold into handler-level tests).
3. Socket auth beyond 0600 perms → **skip** (per-worktree instance isolation + user-only perms suffice).

## Deliverables

- [ ] Handler modules under `mcp/handlers/` with transport-agnostic unit tests
- [ ] `sdk-adapter.ts` (unified, one-server)
- [ ] `socket-mcp-server.ts` + its own tests
- [ ] `stdio-proxy.ts` + `stdio-proxy-source.ts` + spawn integration test
- [ ] Updated `buildMcpServers` + `manager-session.ts` + Codex/Opencode helpers for ONE `stratos` entry
- [ ] Renamed system-prompt references (`stratos-*` → `stratos`)
- [ ] Deletion of 6 dead files
- [ ] Startup cleanup of legacy bin files + legacy sockets
- [ ] Cross-transport parity test
- [ ] CDP end-to-end verified across all 9 combinations
- [ ] Updated `docs/mcp-sdk-migration.md`

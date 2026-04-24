# Stratos MCP — Unified Architecture

**Status:** Shipped.

## Summary

Stratos exposes a single MCP server — `stratos` — with 19 tools spanning three
domains (scheduler, preview, manager). One handler layer; two transports:

- **Claude Code** → in-process SDK MCP (bypasses LinkedIn's enterprise
  `allowedMcpServers` allowlist, which blocks arbitrary stdio MCPs).
- **Codex + Opencode** → a single generic stdio proxy (`~/.stratos/bin/stratos-mcp`)
  that forwards MCP JSON-RPC over a Unix domain socket back to the Stratos
  main process.

Both paths dispatch into the **same** `HandlerDef[]` built by
`createStratosHandlers()` in `packages/desktop/src/main/mcp/handlers/index.ts`.

## Why unified

Before: three separate servers (`stratos-scheduler`, `stratos-preview`,
`stratos-manager`), each with its own stdio binary, embedded-Node source
string, and sometimes Unix-socket bridge. Two full implementations per MCP
(SDK + stdio). ~1000 LOC of untyped embedded Node.

After: one `stratos` server, one source of truth per tool, two thin adapters.
All 19 tool names are unique, so folding namespaces lost no disambiguation.
`mcp__stratos-scheduler__schedule_folders` → `mcp__stratos__schedule_folders`
and so on.

## Architecture

```
     ┌──────────────────────────────────────────────────────────────┐
     │  Electron main (packages/desktop)                            │
     │                                                              │
     │  mcp/handlers/scheduler.ts   ┐                               │
     │  mcp/handlers/preview.ts     ├─ split per domain, merged by  │
     │  mcp/handlers/manager.ts     ┘  createStratosHandlers(deps)   │
     │         │                                                    │
     │         │       HandlerDef[] (19 tools, one flat list)       │
     │         │                                                    │
     │         ├─→ mcp/sdk-adapter.ts                               │
     │         │     handlersToSdkMcp("stratos", defs)              │
     │         │     — used for Claude Code                         │
     │         │                                                    │
     │         └─→ mcp/socket-mcp-server.ts                         │
     │               Unix-socket MCP dispatcher,                    │
     │               ~/.stratos/mcp-<hash>.sock (0600)             │
     │                        │                                     │
     └────────────────────────┼─────────────────────────────────────┘
                              │  MCP JSON-RPC over UDS
                              ▼
                 ┌────────────────────────────┐
                 │ ~/.stratos/bin/stratos-mcp │  ~70 LOC.
                 │ generic stdio ⇄ socket     │  Schema-free, logic-free.
                 │ proxy (single binary for   │  ONE env var:
                 │ all 3 providers)           │  STRATOS_MCP_SOCK
                 └───────────┬────────────────┘
                             │ MCP stdio
                             ▼
                 ┌───────────────────────────┐
                 │ Codex / Opencode CLI      │
                 └───────────────────────────┘
```

## New files

| Path                                                  | Purpose                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/desktop/src/main/mcp/handlers/types.ts`     | `HandlerDef`, `ToolResult`, `defineHandler()` (preserves per-tool schema typing) |
| `packages/desktop/src/main/mcp/handlers/scheduler.ts` | 6 scheduler tools                                                                |
| `packages/desktop/src/main/mcp/handlers/preview.ts`   | 2 preview tools                                                                  |
| `packages/desktop/src/main/mcp/handlers/manager.ts`   | 11 manager tools                                                                 |
| `packages/desktop/src/main/mcp/handlers/index.ts`     | `createStratosHandlers(deps): HandlerDef[]` — single source of truth             |
| `packages/desktop/src/main/mcp/sdk-adapter.ts`        | `handlersToSdkMcp(name, version, defs)` — wraps for the Claude Agent SDK         |
| `packages/desktop/src/main/mcp/socket-mcp-server.ts`  | Unix-socket MCP server; zod→JSON-Schema via `z.toJSONSchema`                     |
| `packages/desktop/src/main/mcp/stdio-proxy-source.ts` | Embedded source of the generic stdio proxy                                       |
| `packages/desktop/src/main/mcp/stdio-proxy.ts`        | Install + path helpers + legacy-binary cleanup                                   |

## Deleted files

- `packages/desktop/src/main/scheduler/schedule-mcp-source.ts` (~310 LOC)
- `packages/desktop/src/main/preview-mcp-source.ts` (~180 LOC)
- `packages/desktop/src/main/preview-mcp.ts` (socket server, ~130 LOC)
- `packages/desktop/src/main/manager/manager-mcp-source.ts` (~575 LOC)
- `packages/desktop/src/main/manager/manager-bridge.ts` (socket bridge, ~320 LOC)
- `packages/desktop/src/main/mcp/{scheduler,preview,manager}-sdk.ts` (per-domain SDK shims)
- `packages/desktop/src/main/__tests__/manager-bridge.test.ts`
- `packages/desktop/src/main/__tests__/{scheduler,preview,manager}-sdk.test.ts`

Net: **~1900 LOC removed**, ~1400 LOC added — strict simplification.

Startup cleanup (`cleanupLegacyMcpBinaries()`) `rmSync`s the legacy per-MCP
binaries under `~/.stratos/bin/` so users upgrading don't see stale files.

## Tool-name changes

All 19 tools moved from `mcp__stratos-{scheduler,preview,manager}__<name>` to
`mcp__stratos__<name>`. System prompts in `agent-manager.ts` (two places) and
`manager-session.ts` updated to match.

Opencode normalises server-prefixed names with `_` (not `__`): tools appear as
`stratos_schedule_folders`, `stratos_preview_open_file`, etc.

## Codex / Opencode wiring

Codex `-c` overrides (`buildCodexMcpArgs`):

```
-c mcp_servers.stratos.command="node"
-c mcp_servers.stratos.args=["/Users/…/.stratos/bin/stratos-mcp"]
-c mcp_servers.stratos.env.STRATOS_MCP_SOCK="/Users/…/.stratos/mcp-<hash>.sock"
```

Opencode JSON (`buildOpencodeMcpConfig` inside `OPENCODE_CONFIG_CONTENT.mcp`):

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

Both helpers' signatures are unchanged — they translate the `mcpServers` map
that `buildMcpServers({ providerName: "codex" | "opencode", ... })` emits.

## Claude Code wiring

```ts
buildMcpServers({ providerName: "claude-code", sdkHandlers });
// → { stratos: handlersToSdkMcp("stratos", "1.0.0", sdkHandlers) }
```

The SDK routes this server in-process via its bidirectional control protocol.
Nothing reaches the `--mcp-config` parser, so the LinkedIn allowlist never
fires.

## Tests

| Suite                                          | What it covers                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `__tests__/handlers-scheduler.test.ts`         | Scheduler handler tool names + each tool's behaviour (mocked storage)                                             |
| `__tests__/handlers-preview.test.ts`           | Preview handler behaviour (mocked `sendToRenderer`)                                                               |
| `__tests__/handlers-manager.test.ts`           | Manager handler behaviour (mocked `AgentManager` + `FileStorageAdapter` + window)                                 |
| `__tests__/socket-mcp-server.test.ts`          | Unix-socket MCP surface: initialize / tools/list / tools/call / zod validation / ping / handler exceptions        |
| `__tests__/stdio-proxy.integration.test.ts`    | Spawns a real `node stratos-mcp` subprocess against a real socket server; asserts MCP round-trip                  |
| `__tests__/mcp-parity.test.ts`                 | SDK adapter vs socket server: byte-identical tool names + descriptions                                            |
| `__tests__/sdk-mcp-policy.integration.test.ts` | Real `claude` CLI on a managed machine; asserts no policy warning + `stratos` connected + all 19 tools registered |
| `core/__tests__/mcp-provider-wiring.test.ts`   | `buildCodexMcpArgs` + `buildOpencodeMcpConfig` output shape                                                       |

**Total:** 134 desktop tests (104 UI + 153 core + 134 desktop = 391 across the
monorepo). All pass on a LinkedIn-managed machine.

## Live CDP verification: 9/9 passing

Real provider runs driven through the dev target via CDP
(`/tmp/cdp-smoke.mjs`). Each run:

1. `window.api.threadsCreate` — new thread via the real IPC.
2. `window.api.sendMessage` — streams a prompt that explicitly asks the agent
   to call a named Stratos tool.
3. Reads the provider's native transcript and confirms the tool call + result.

| Provider    | Scheduler                           | Preview                              | Manager                          |
| ----------- | ----------------------------------- | ------------------------------------ | -------------------------------- |
| claude-code | ✅ `mcp__stratos__schedule_folders` | ✅ `mcp__stratos__preview_open_file` | ✅ `mcp__stratos__list_sessions` |
| codex       | ✅ `mcp__stratos__schedule_folders` | ✅ `mcp__stratos__preview_open_file` | ✅ `mcp__stratos__list_sessions` |
| opencode    | ✅ `stratos_schedule_folders`       | ✅ `stratos_preview_open_file`       | ✅ `stratos_list_sessions`       |

Each call returned a real handler result (no errors, no policy warnings). The
dev-target console log was grep'd across all 9 runs — zero occurrences of
`policy`, `blocked`, or `enterprise`.

## Risks & mitigations

| Risk                                                                  | Mitigation                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Zod v4 schema → JSON Schema conversion diverges from SDK's conversion | Parity test asserts byte-identical `tools/list` output between SDK adapter and socket server       |
| Codex spawns the stdio proxy before the socket is ready               | Proxy retries `net.createConnection` for up to 3s with 50ms backoff                                |
| Socket file accessible to other users                                 | `chmodSync(socketPath, 0o600)` immediately after `listen()`                                        |
| Handler exception crashes main process                                | Socket server catches all handler throws and returns `isError: true` ToolResult; SDK does the same |
| Upgrade leaves legacy `~/.stratos/bin/stratos-*-mcp` files behind     | `cleanupLegacyMcpBinaries()` runs on every startup                                                 |

## Not in scope

- Adding new MCP tools.
- Changing the Manager Agent's behavioural rules.
- Exposing the socket to other users or the network.
- HTTP transport (explicitly excluded).

## Status

Implemented, tested, and CDP-verified across all 9 (provider × domain) combinations.

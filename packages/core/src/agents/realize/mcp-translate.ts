/**
 * Shared MCP-server translation used by the claude-code, codex, and opencode
 * realize adapters — all three accept the same `{type,url}` /
 * `{type:"stdio",command,args,env}` shape on `ProviderConfig.mcpServers`, so
 * `AgentMcpServer` (already in that shape) needs only its `undefined`
 * fields stripped. Not part of the package's public surface — internal to
 * `agents/realize/`.
 */
import type { AgentMcpServer } from "../../types/agent";

function toServerConfig(server: AgentMcpServer): Record<string, unknown> {
  if (server.type === "http" || server.type === "sse") {
    return { type: server.type, url: server.url };
  }
  return {
    type: "stdio",
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
}

export function translateAgentMcpServers(
  servers: Record<string, AgentMcpServer> | undefined,
): Record<string, unknown> | undefined {
  if (!servers || Object.keys(servers).length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(servers)) {
    out[name] = toServerConfig(server);
  }
  return out;
}

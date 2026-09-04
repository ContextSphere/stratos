import type { AgentDefinition } from "../../types/agent";
import type { ProviderConfig } from "../../providers/types";
import { translateAgentMcpServers } from "./mcp-translate";

/**
 * Realize an agent for the opencode provider.
 *
 * Opencode's `ProviderConfig` has no system-prompt field at all (see
 * `opencode.provider.ts` / `ProviderConfig` in `providers/types.ts`) — an
 * agent's `prompt` is silently dropped here. Only the
 * provider-agnostic thread defaults survive. `agentFidelity` in
 * `realize/index.ts` reports this so the UI can badge it.
 */
export function realizeOpencode(
  def: AgentDefinition,
  _resolvedPrompt: string,
): Partial<ProviderConfig> {
  const config: Partial<ProviderConfig> = {};

  const mcpServers = translateAgentMcpServers(def.mcpServers);
  if (mcpServers) config.mcpServers = mcpServers;

  if (def.model) config.model = def.model;
  if (def.cwd) config.cwd = def.cwd;

  return config;
}

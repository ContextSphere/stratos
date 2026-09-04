import type { AgentDefinition } from "../../types/agent";
import type { ProviderConfig } from "../../providers/types";
import { translateAgentMcpServers } from "./mcp-translate";

/**
 * Realize an agent for the codex provider. Codex has no preset/append
 * concept like claude-code — `ProviderConfig.systemPrompt` is mapped
 * straight to `developerInstructions` when it's a plain string (see
 * `codex.provider.ts`), so the resolved prompt is passed through as-is.
 */
export function realizeCodex(
  def: AgentDefinition,
  resolvedPrompt: string,
): Partial<ProviderConfig> {
  const config: Partial<ProviderConfig> = {};

  if (resolvedPrompt) {
    config.systemPrompt = resolvedPrompt;
  }

  const mcpServers = translateAgentMcpServers(def.mcpServers);
  if (mcpServers) config.mcpServers = mcpServers;

  if (def.model) config.model = def.model;
  if (def.cwd) config.cwd = def.cwd;

  return config;
}

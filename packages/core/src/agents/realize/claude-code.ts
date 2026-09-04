import type { AgentDefinition } from "../../types/agent";
import type { ProviderConfig } from "../../providers/types";
import { translateAgentMcpServers } from "./mcp-translate";

/**
 * Realize an agent for the claude-code provider: the resolved prompt is
 * appended to the built-in `claude_code` preset system prompt, so
 * Claude Code's own tool-use instructions are preserved.
 */
export function realizeClaudeCode(
  def: AgentDefinition,
  resolvedPrompt: string,
): Partial<ProviderConfig> {
  const config: Partial<ProviderConfig> = {};

  if (resolvedPrompt) {
    config.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: resolvedPrompt,
    };
  }

  const mcpServers = translateAgentMcpServers(def.mcpServers);
  if (mcpServers) config.mcpServers = mcpServers;

  if (def.model) config.model = def.model;
  if (def.cwd) config.cwd = def.cwd;

  return config;
}

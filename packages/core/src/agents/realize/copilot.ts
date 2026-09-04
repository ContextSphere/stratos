import type { AgentDefinition } from "../../types/agent";
import type { ProviderConfig } from "../../providers/types";
import { translateAgentMcpServers } from "./mcp-translate";

/**
 * Realize an agent for the copilot provider.
 *
 * Copilot ignores `ProviderConfig.systemPrompt` entirely (see
 * `copilot.provider.ts`, which never reads it) — the only way to hand it a
 * persona is through `ProviderConfig.agents`, which `translateCustomAgents`
 * maps to the SDK's native `customAgents`. So the agent becomes a
 * single-entry custom-agent map keyed by its own id, carrying `displayName`
 * (read via an `any` cast in `translateCustomAgents` — it isn't part of the
 * strict SDK `AgentDefinition` type, hence the assertion below) so Copilot's
 * UI can show the persona's name rather than its id.
 */
export function realizeCopilot(
  def: AgentDefinition,
  resolvedPrompt: string,
): Partial<ProviderConfig> {
  const config: Partial<ProviderConfig> = {};

  config.agents = {
    [def.id]: {
      displayName: def.name,
      description: def.description,
      prompt: resolvedPrompt,
      ...(def.model ? { model: def.model } : {}),
    },
  } as unknown as ProviderConfig["agents"];

  const mcpServers = translateAgentMcpServers(def.mcpServers);
  if (mcpServers) config.mcpServers = mcpServers;

  if (def.model) config.model = def.model;
  if (def.cwd) config.cwd = def.cwd;

  return config;
}

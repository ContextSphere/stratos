import type { AgentDefinition, CreateAgentInput } from "../types/agent";
import {
  deleteAgent,
  getAgent,
  loadAgents,
  saveAgent,
} from "../storage/agents.store";

export interface AgentServiceOptions {
  onChanged?: (agentId: string) => void;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Agent editor persistence with create-only semantics and change notifications.
 */
export class AgentService {
  constructor(private readonly options: AgentServiceOptions = {}) {}

  list(): AgentDefinition[] {
    return loadAgents();
  }

  get(id: string): AgentDefinition | null {
    return getAgent(id);
  }

  create(input: CreateAgentInput): AgentDefinition {
    const name = input.name.trim();
    const description = input.description.trim();
    const prompt = Array.isArray(input.prompt)
      ? input.prompt.map((part) => part.trim()).filter(Boolean)
      : input.prompt.trim();
    if (!name) throw new Error("Agent name is required");
    if (!description) throw new Error("Agent description is required");
    if (Array.isArray(prompt) ? prompt.length === 0 : !prompt) {
      throw new Error("Agent prompt is required");
    }

    const duplicate = loadAgents().find(
      (agent) =>
        agent.name.localeCompare(name, undefined, { sensitivity: "accent" }) ===
        0,
    );
    if (duplicate) {
      throw new Error(
        `An agent named "${name}" already exists (id: ${duplicate.id}); reuse it instead`,
      );
    }

    const id = slugify(name);
    if (!id) throw new Error("Agent name must contain a letter or digit");
    if (getAgent(id)) {
      throw new Error(
        `Agent id "${id}" already exists; choose a different name`,
      );
    }

    const saved = saveAgent({
      id,
      name,
      description,
      prompt,
      icon: input.icon?.trim() || "🤖",
      accent: input.accent ?? "violet",
      builtIn: false,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.telegram ? { telegram: input.telegram } : {}),
    });
    this.options.onChanged?.(saved.id);
    return saved;
  }

  save(definition: AgentDefinition): AgentDefinition {
    const saved = saveAgent(definition);
    this.options.onChanged?.(saved.id);
    return saved;
  }

  delete(id: string): boolean {
    const deleted = deleteAgent(id);
    if (deleted) this.options.onChanged?.(id);
    return deleted;
  }
}

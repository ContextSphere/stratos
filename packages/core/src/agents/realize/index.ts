import type { AgentDefinition } from "../../types/agent";
import type { ProviderConfig } from "../../providers/types";
import type { ProviderType } from "../../types/thread";
import { realizeClaudeCode } from "./claude-code";
import { realizeCopilot } from "./copilot";
import { realizeCodex } from "./codex";
import { realizeOpencode } from "./opencode";

/**
 * What a given provider silently drops when realizing an agent — e.g.
 * opencode has no system-prompt concept, so an agent's `prompt` (and any
 * never reaches the model. This is what the UI
 * badges next to a provider picker so the loss is visible before it bites.
 */
export interface AgentFidelity {
  provider: ProviderType;
  unsupported: string[];
}

/**
 * Turn an agent definition + its already-resolved prompt text into the
 * partial `ProviderConfig` a session for `provider` should be started with.
 * Each adapter is a pure function — no I/O, no throwing.
 */
export function realizeAgent(
  provider: ProviderType,
  def: AgentDefinition,
  resolvedPrompt: string,
): Partial<ProviderConfig> {
  switch (provider) {
    case "claude-code":
      return realizeClaudeCode(def, resolvedPrompt);
    case "copilot":
      return realizeCopilot(def, resolvedPrompt);
    case "codex":
      return realizeCodex(def, resolvedPrompt);
    case "opencode":
      return realizeOpencode(def, resolvedPrompt);
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Report what `provider` will silently drop when realizing `def`. */
export function agentFidelity(
  provider: ProviderType,
  def: AgentDefinition,
): AgentFidelity {
  const unsupported: string[] = [];

  if (provider === "opencode" && def.prompt) {
    unsupported.push("prompt");
  }

  return { provider, unsupported };
}

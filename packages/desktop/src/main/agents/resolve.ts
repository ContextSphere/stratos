/**
 * Resolves a thread's agent into a provider-config *overlay* — a partial
 * `ProviderConfig` that agent-manager.ts merges on top of the config it
 * already builds for a session.
 *
 * The single most important correctness requirement here: a thread with no
 * `agentId` (or one that points at the built-in default agent) MUST produce
 * an empty overlay, byte for byte, so every pre-existing thread keeps
 * behaving exactly as it did before agents existed.
 */
import {
  DEFAULT_AGENT_ID,
  getAgent,
  resolveAgentPrompt,
  realizeAgent,
} from "@stratosapp/core";
import type {
  AgentDefinition,
  ProviderConfig,
  ProviderType,
  Thread,
} from "@stratosapp/core";

interface ResolvedOverlay {
  overlay: Partial<ProviderConfig>;
  agent: AgentDefinition | null;
}

const EMPTY_OVERLAY: ResolvedOverlay = { overlay: {}, agent: null };

/** Resolved-prompt cache, keyed by agent id. Invalidated on save/delete. */
const promptCache = new Map<string, string>();

/**
 * Drop cached prompt(s) so the next `resolveAgentOverlay` call re-resolves
 * from disk. Call with no `id` to clear everything (e.g. on a bulk import).
 */
export function invalidateAgentCache(id?: string): void {
  if (id) {
    promptCache.delete(id);
  } else {
    promptCache.clear();
  }
}

/**
 * Resolve `thread.agentId` into a provider-config overlay.
 *
 * Returns `{ overlay: {}, agent: null }` when the thread has no agent, is
 * pinned to the default agent, or points at an agent that no longer exists
 * (deleted out from under a live thread) — in every one of those cases the
 * session must start exactly as it would have with no agent feature at all.
 */
export async function resolveAgentOverlay(
  thread: Thread,
): Promise<ResolvedOverlay> {
  const agentId = thread.agentId ?? DEFAULT_AGENT_ID;
  if (agentId === DEFAULT_AGENT_ID) {
    return EMPTY_OVERLAY;
  }

  const agent = getAgent(agentId);
  if (!agent) {
    return EMPTY_OVERLAY;
  }

  let prompt = promptCache.get(agentId);
  if (prompt === undefined) {
    prompt = await resolveAgentPrompt(agent);
    promptCache.set(agentId, prompt);
  }

  const providerName = (thread.provider ?? "claude-code") as ProviderType;
  const overlay = realizeAgent(providerName, agent, prompt);
  return { overlay, agent };
}

/**
 * Extract the agent's raw append/system-prompt text out of an overlay,
 * regardless of whether `realizeAgent` expressed it as a plain string or as
 * the `{type:"preset", preset:"claude_code", append}` shape.
 */
function extractAgentAppendText(
  overlay: Partial<ProviderConfig>,
): string | undefined {
  const sp = overlay.systemPrompt;
  if (!sp) return undefined;
  if (typeof sp === "string") return sp || undefined;
  if (typeof sp === "object" && "append" in sp) {
    return sp.append || undefined;
  }
  return undefined;
}

/**
 * Concatenate the agent's append text onto the host-environment append text
 * that agent-manager.ts always sends. Never substitutes — the host-environment
 * and Stratos-MCP instructions must survive even when an agent supplies its
 * own prompt.
 */
export function mergeSystemPromptAppend(
  hostAppend: string,
  overlay: Partial<ProviderConfig>,
): string {
  const agentText = extractAgentAppendText(overlay);
  if (!agentText) return hostAppend;
  return `${hostAppend}\n\n${agentText}`;
}

/**
 * Merge an agent's MCP servers underneath the servers Stratos already built
 * for the session (`built`, from `buildMcpServers(...)`). Any name collision
 * is won by `built` — in particular the always-on `stratos` server can never
 * be shadowed by an agent-supplied server of the same name.
 */
export function mergeAgentMcpServers(
  built: Record<string, unknown>,
  overlay: Partial<ProviderConfig>,
): Record<string, unknown> {
  if (!overlay.mcpServers || Object.keys(overlay.mcpServers).length === 0) {
    return built;
  }
  return { ...overlay.mcpServers, ...built };
}

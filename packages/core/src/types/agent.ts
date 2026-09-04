/**
 * Agent definitions — a named, reusable session template.
 *
 * An agent is a prompt plus a set of tools. Everything else
 * it carries (provider, model, mode, cwd) is existing Stratos vocabulary held
 * as a *default*: a thread created from an agent inherits these, and the
 * per-thread pickers still override them.
 *
 * Agents are realized into a `ProviderConfig` at session start — see
 * `agents/realize/` — so no provider learns about this type.
 */
import type { AgentMode } from "./thread";
import type { ProviderType } from "./thread";

/** Accent colors available to an agent glyph in the sidebar. */
export type AgentAccent =
  | "violet"
  | "emerald"
  | "blue"
  | "pink"
  | "orange"
  | "amber";

export const AGENT_ACCENTS: AgentAccent[] = [
  "violet",
  "emerald",
  "blue",
  "pink",
  "orange",
  "amber",
];

/** An MCP server an agent brings with it, beyond the always-on `stratos` server. */
export interface AgentMcpServer {
  type: "http" | "sse" | "stdio";
  /** http / sse transports */
  url?: string;
  /** stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Telegram binding. One bot per agent: each enabled agent runs its own
 * gateway instance with its own token, so there is no routing table and
 * revoking an agent's reach is deleting one token.
 */
export interface AgentTelegramBinding {
  enabled: boolean;
  botToken?: string;
  trustedChatId?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Emoji shown as the sidebar glyph. */
  icon: string;
  accent: AgentAccent;
  /**
   * Code-defined agents cannot be deleted or renamed from the UI.
   * Only `default` is built in; the shipped personas are seeded as editable
   * user agents on first run.
   */
  builtIn: boolean;

  // ── Thread-template defaults (existing Stratos vocabulary) ──
  provider?: ProviderType;
  model?: string;
  mode?: AgentMode;
  /**
   * Pinned working directory. When absent/null the new-thread flow asks for a
   * folder exactly as it does today.
   */
  cwd?: string | null;

  // ── The feature ──
  /**
   * Inline prompt text, or a list of file paths that are read and joined with
   * blank lines at session start. `~` is expanded. A path that cannot be read
   * is skipped with a warning rather than failing the session.
   */
  prompt?: string | string[];
  mcpServers?: Record<string, AgentMcpServer>;

  // ── Optional surface ──
  telegram?: AgentTelegramBinding;

  createdAt?: number;
  updatedAt?: number;
}

/**
 * The agent a thread belongs to when `Thread.agentId` is absent.
 * Its realization must reproduce today's hard-coded config exactly, so that
 * every pre-existing thread keeps behaving identically.
 */
export const DEFAULT_AGENT_ID = "default";

export const DEFAULT_AGENT: AgentDefinition = {
  id: DEFAULT_AGENT_ID,
  name: "Default",
  description: "Standard Stratos session with no additional instructions.",
  icon: "▲",
  accent: "blue",
  builtIn: true,
};

/** Validation result for a definition about to be saved. */
export interface AgentValidationError {
  field: string;
  message: string;
}

/** Server names an agent may not use — `stratos` is injected by the host. */
export const RESERVED_MCP_SERVER_NAMES = ["stratos"];

/**
 * Validate a definition. Returns [] when the definition is safe to persist.
 * Rules:
 *  - `id` must be non-empty, kebab-case (`^[a-z0-9][a-z0-9-]*$`)
 *  - `name` must be non-empty
 *  - `icon` must be non-empty
 *  - `accent` must be one of AGENT_ACCENTS
 *  - MCP server names must not collide with RESERVED_MCP_SERVER_NAMES
 *  - an `http`/`sse` server must have `url`; a `stdio` server must have `command`
 */
export function validateAgentDefinition(
  def: AgentDefinition,
): AgentValidationError[] {
  const errors: AgentValidationError[] = [];

  if (!def.id || !/^[a-z0-9][a-z0-9-]*$/.test(def.id)) {
    errors.push({
      field: "id",
      message: "id must be kebab-case and start with a letter or digit",
    });
  }
  if (!def.name?.trim()) {
    errors.push({ field: "name", message: "name is required" });
  }
  if (!def.icon?.trim()) {
    errors.push({ field: "icon", message: "icon is required" });
  }
  if (!AGENT_ACCENTS.includes(def.accent)) {
    errors.push({
      field: "accent",
      message: `accent must be one of ${AGENT_ACCENTS.join(", ")}`,
    });
  }

  for (const [name, server] of Object.entries(def.mcpServers ?? {})) {
    if (RESERVED_MCP_SERVER_NAMES.includes(name)) {
      errors.push({
        field: `mcpServers.${name}`,
        message: `"${name}" is reserved by Stratos`,
      });
    }
    if ((server.type === "http" || server.type === "sse") && !server.url) {
      errors.push({
        field: `mcpServers.${name}`,
        message: `${server.type} server needs a url`,
      });
    }
    if (server.type === "stdio" && !server.command) {
      errors.push({
        field: `mcpServers.${name}`,
        message: "stdio server needs a command",
      });
    }
  }

  return errors;
}

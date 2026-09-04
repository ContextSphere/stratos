/**
 * Browser-safe duplicates of the pure agent constants/helpers defined in
 * `packages/core/src/types/agent.ts`.
 *
 * `packages/ui` must not import *runtime* values from `@stratosapp/core`:
 * core's CommonJS barrel (`dist/index.js`) eagerly `require()`s Node-only
 * modules (fs-based storage adapters, providers, ...) alongside these pure
 * helpers, so bundlers can't tree-shake a browser build (the Electron
 * renderer) down to just the piece that's actually used — pulling in a
 * single runtime export from the barrel drags in the whole module graph,
 * Node built-ins included, and the build fails.
 *
 * Types are unaffected — `import type` is erased entirely at compile time —
 * so `AgentDefinition`, `AgentAccent`, etc. are still imported directly from
 * `@stratosapp/core` everywhere in this package.
 *
 * This mirrors the existing precedent at
 * `packages/desktop/src/renderer/utils/modes.ts`, which duplicates
 * `normalizeMode`/`DEFAULT_PROVIDER` for the same reason.
 *
 * Keep this file in lockstep with `packages/core/src/types/agent.ts`.
 */
import type {
  AgentAccent,
  AgentDefinition,
  AgentValidationError,
} from "@stratosapp/core";

export const AGENT_ACCENTS: AgentAccent[] = [
  "violet",
  "emerald",
  "blue",
  "pink",
  "orange",
  "amber",
];

/** The agent a thread belongs to when `Thread.agentId` is absent. */
export const DEFAULT_AGENT_ID = "default";

export const DEFAULT_AGENT: AgentDefinition = {
  id: DEFAULT_AGENT_ID,
  name: "Default",
  description: "Standard Stratos session with no additional instructions.",
  icon: "▲",
  accent: "blue",
  builtIn: true,
};

/** Server names an agent may not use — `stratos` is injected by the host. */
const RESERVED_MCP_SERVER_NAMES = ["stratos"];

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

/** Browser-safe mode utilities (avoids importing Node.js deps from @stratosapp/core) */

export type AgentMode =
  | "plan"
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "fullAccess";

export type ProviderType = "claude-code" | "codex" | "opencode" | "copilot";

/** Provider used for new sessions when the caller does not specify one. */
export const DEFAULT_PROVIDER: ProviderType = "copilot";

export function normalizeMode(
  mode: string | undefined,
  provider?: ProviderType,
): AgentMode {
  if (!mode || mode === "execute") return "default";
  if (provider === "codex") {
    if (mode === "acceptEdits") return "default";
    if (mode === "bypassPermissions") return "fullAccess";
  }
  if (provider === "copilot") {
    if (mode === "bypassPermissions") return "fullAccess";
  }
  if (
    [
      "plan",
      "default",
      "acceptEdits",
      "bypassPermissions",
      "fullAccess",
    ].includes(mode)
  ) {
    return mode as AgentMode;
  }
  return "default";
}

const PROVIDER_AGENT_MODES: Record<ProviderType, AgentMode[]> = {
  "claude-code": ["plan", "default", "acceptEdits", "bypassPermissions"],
  codex: ["plan", "default", "fullAccess"],
  opencode: ["default", "bypassPermissions"],
  copilot: ["plan", "default", "acceptEdits", "fullAccess"],
};

export function getAgentModes(provider: ProviderType): AgentMode[] {
  return PROVIDER_AGENT_MODES[provider] ?? PROVIDER_AGENT_MODES["claude-code"];
}

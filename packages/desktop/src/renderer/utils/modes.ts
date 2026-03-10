/** Browser-safe mode utilities (avoids importing Node.js deps from @stratosapp/core) */

export type AgentMode =
  | "plan"
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "fullAccess";

export type ProviderType = "claude-code" | "codex";

export function normalizeMode(
  mode: string | undefined,
  provider?: ProviderType,
): AgentMode {
  if (!mode || mode === "execute") return "default";
  if (provider === "codex") {
    if (mode === "acceptEdits") return "default";
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
};

export function getAgentModes(provider: ProviderType): AgentMode[] {
  return PROVIDER_AGENT_MODES[provider];
}

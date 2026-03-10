/** Browser-safe mode types and constants (no Node.js deps) */

export type AgentMode =
  | "plan"
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "fullAccess";

export type ProviderType = "claude-code" | "codex";

export interface ModeConfig {
  label: string;
  sdkPermissionMode: string;
  color: string;
  description: string;
  dangerous: boolean;
}

export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
  plan: {
    label: "Plan",
    sdkPermissionMode: "plan",
    color: "amber",
    description: "Read-only. Plans without modifying files.",
    dangerous: false,
  },
  default: {
    label: "Default",
    sdkPermissionMode: "default",
    color: "blue",
    description: "Prompts for permission on each tool use.",
    dangerous: false,
  },
  acceptEdits: {
    label: "Accept Edits",
    sdkPermissionMode: "acceptEdits",
    color: "green",
    description: "Auto-accepts file edits. Prompts for terminal commands.",
    dangerous: false,
  },
  bypassPermissions: {
    label: "Bypass",
    sdkPermissionMode: "bypassPermissions",
    color: "red",
    description: "Skips all permission prompts.",
    dangerous: true,
  },
  fullAccess: {
    label: "Full access",
    sdkPermissionMode: "fullAccess",
    color: "red",
    description:
      "Allows unrestricted file access and network access without permission prompts.",
    dangerous: true,
  },
};

const PROVIDER_AGENT_MODES: Record<ProviderType, AgentMode[]> = {
  "claude-code": ["plan", "default", "acceptEdits", "bypassPermissions"],
  codex: ["plan", "default", "fullAccess"],
};

const PROVIDER_MODE_CONFIG_OVERRIDES: Partial<
  Record<ProviderType, Partial<Record<AgentMode, Partial<ModeConfig>>>>
> = {
  codex: {
    default: {
      label: "Default permissions",
      description:
        "Lets Codex edit and run commands in the workspace. Prompts before network or actions outside that scope.",
    },
  },
};

export const AGENT_MODES: AgentMode[] = PROVIDER_AGENT_MODES["claude-code"];

export function getAgentModes(provider: ProviderType): AgentMode[] {
  return PROVIDER_AGENT_MODES[provider];
}

export function getModeConfig(
  provider: ProviderType,
  mode: AgentMode,
): ModeConfig {
  const base = MODE_CONFIGS[mode] ?? MODE_CONFIGS.default;
  const override = PROVIDER_MODE_CONFIG_OVERRIDES[provider]?.[mode];
  return override ? { ...base, ...override } : base;
}

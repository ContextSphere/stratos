import React from "react";
import type { AgentMode, ProviderType } from "../../utils/modes";
import { getAgentModes, getModeConfig } from "../../utils/modes";

// Static Tailwind class map — no dynamic class construction
const COLOR_MAP: Record<string, { active: string; dot: string }> = {
  amber: { active: "bg-amber-600/80 text-white", dot: "bg-amber-500" },
  blue: { active: "bg-blue-600/80 text-white", dot: "bg-blue-500" },
  green: { active: "bg-green-600/80 text-white", dot: "bg-green-500" },
  red: { active: "bg-red-600/80 text-white", dot: "bg-red-500" },
};

export interface ModeToggleProps {
  provider: ProviderType;
  mode: AgentMode | undefined;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export default function ModeToggle({
  provider,
  mode,
  onModeChange,
  disabled,
}: ModeToggleProps): React.ReactElement {
  const current: AgentMode = mode ?? "default";
  const modes = getAgentModes(provider);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[var(--text-control)]">Mode</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-control)]"
          title="Keyboard shortcut: Shift+Tab"
        >
          Shift+Tab
        </span>
      </div>
      <div className="flex items-center rounded-full bg-[var(--bg-surface)] border border-[var(--border)] p-0.5">
        {modes.map((m) => {
          const config = getModeConfig(provider, m);
          const colors = COLOR_MAP[config.color];
          const isActive = current === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              disabled={disabled}
              title={config.description}
              className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                isActive
                  ? colors.active
                  : "text-[var(--text-control)] hover:text-[var(--text-primary)]"
              } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              {config.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

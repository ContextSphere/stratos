import React from "react";
import type { AgentMode } from "../utils/modes";
import { AGENT_MODES, MODE_CONFIGS } from "../utils/modes";

// Static Tailwind class map — no dynamic class construction
const COLOR_MAP: Record<string, { active: string; dot: string }> = {
  amber: { active: "bg-amber-600/80 text-white", dot: "bg-amber-500" },
  blue: { active: "bg-blue-600/80 text-white", dot: "bg-blue-500" },
  green: { active: "bg-green-600/80 text-white", dot: "bg-green-500" },
  red: { active: "bg-red-600/80 text-white", dot: "bg-red-500" },
};

interface ModeToggleProps {
  mode: AgentMode | undefined;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export default function ModeToggle({
  mode,
  onModeChange,
  disabled,
}: ModeToggleProps): React.ReactElement {
  const current: AgentMode = mode ?? "default";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-600">Mode</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-gray-500"
          title="Keyboard shortcut: Shift+Tab"
        >
          Shift+Tab
        </span>
      </div>
      <div className="flex items-center rounded-full bg-[#1a1a1a] border border-[#2a2a2a] p-0.5">
        {AGENT_MODES.map((m) => {
          const config = MODE_CONFIGS[m];
          const colors = COLOR_MAP[config.color];
          const isActive = current === m;
          return (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              disabled={disabled}
              title={config.description}
              className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                isActive ? colors.active : "text-gray-500 hover:text-gray-400"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {config.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

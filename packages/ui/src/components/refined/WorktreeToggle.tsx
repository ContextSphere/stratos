import React from "react";
import { useDesignVariant } from "../../context/DesignContext";

export interface WorktreeToggleProps {
  worktreeMode: "local" | "worktree" | undefined;
  isGitRepo: boolean;
  disabled: boolean;
  onWorktreeModeChange: (mode: "local" | "worktree") => void;
}

const MODES = [
  {
    key: "local" as const,
    label: "Local",
    description: "Work directly in the repository",
  },
  {
    key: "worktree" as const,
    label: "Worktree",
    description: "Work in an isolated git worktree",
  },
];

export default function WorktreeToggle({
  worktreeMode,
  isGitRepo,
  disabled,
  onWorktreeModeChange,
}: WorktreeToggleProps): React.ReactElement | null {
  const classic = useDesignVariant() === "classic";
  if (!isGitRepo) return null;

  const current = worktreeMode ?? "local";

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-full bg-[var(--bg-surface)] border border-[var(--border)] p-0.5">
        {MODES.map((m) => {
          const isActive = current === m.key;
          return (
            <button
              key={m.key}
              onClick={() => onWorktreeModeChange(m.key)}
              disabled={disabled}
              title={m.description}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                isActive
                  ? classic
                    ? m.key === "local"
                      ? "bg-blue-600/80 text-white"
                      : "bg-purple-600/80 text-white"
                    : "bg-[var(--bg-selected)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

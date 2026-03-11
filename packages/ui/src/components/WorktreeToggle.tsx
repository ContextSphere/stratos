import React from "react";

interface WorktreeToggleProps {
  worktreeMode: "local" | "worktree" | undefined;
  isGitRepo: boolean;
  disabled: boolean;
  onWorktreeModeChange: (mode: "local" | "worktree") => void;
}

const MODES = [
  {
    key: "local" as const,
    label: "Local",
    color: "blue",
    description: "Work directly in the repository",
  },
  {
    key: "worktree" as const,
    label: "Worktree",
    color: "purple",
    description: "Work in an isolated git worktree",
  },
];

const COLOR_MAP: Record<string, { active: string }> = {
  blue: { active: "bg-blue-600/80 text-white" },
  purple: { active: "bg-purple-600/80 text-white" },
};

export default function WorktreeToggle({
  worktreeMode,
  isGitRepo,
  disabled,
  onWorktreeModeChange,
}: WorktreeToggleProps): React.ReactElement | null {
  if (!isGitRepo) return null;

  const current = worktreeMode ?? "local";

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-full bg-[var(--bg-surface)] border border-[var(--border)] p-0.5">
        {MODES.map((m) => {
          const colors = COLOR_MAP[m.color];
          const isActive = current === m.key;
          return (
            <button
              key={m.key}
              onClick={() => onWorktreeModeChange(m.key)}
              disabled={disabled}
              title={m.description}
              className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                isActive ? colors.active : "text-gray-500 hover:text-gray-400"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import React from "react";
import type { TodoData } from "../types";
import { ToolsBadge } from "./ToolsBadge";
import WorktreeToggle from "./WorktreeToggle";

export interface SessionStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextWindow: number | null;
}

interface ChatInfoBarProps {
  primaryCwd?: string;
  additionalCwds: string[];
  onAddDirectory: () => void;
  onRemoveDirectory: (path: string) => void;
  sessionStats: SessionStats;
  homeDir: string;
  sessionTools?: string[];
  todoData?: TodoData | null;
  onToggleTaskPanel?: () => void;
  worktreeMode?: "local" | "worktree";
  isGitRepo?: boolean;
  hasMessages?: boolean;
  onWorktreeModeChange?: (mode: "local" | "worktree") => void;
}

function shortenPath(path: string, homeDir: string): string {
  return homeDir && path.startsWith(homeDir)
    ? "~" + path.slice(homeDir.length)
    : path;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function ChatInfoBar({
  primaryCwd,
  additionalCwds,
  onAddDirectory,
  onRemoveDirectory,
  sessionStats,
  homeDir,
  sessionTools,
  todoData,
  onToggleTaskPanel,
  worktreeMode,
  isGitRepo,
  hasMessages,
  onWorktreeModeChange,
}: ChatInfoBarProps): React.ReactElement {
  const { totalCost, totalInputTokens, totalOutputTokens, contextWindow } =
    sessionStats;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const contextPercent =
    contextWindow && totalTokens > 0
      ? Math.min(100, Math.round((totalTokens / contextWindow) * 100))
      : null;
  const hasStats = totalCost > 0 || totalTokens > 0;
  const ringPercent = contextPercent ?? 0;
  const ringColor =
    contextPercent != null && contextPercent >= 80 ? "#d97706" : "#4b5563";

  return (
    <div className="flex-shrink-0 bg-[#0f0f0f] border-b border-[#1a1a1a] px-4 py-1.5">
      <div className="flex items-center justify-between text-xs text-gray-500 gap-3 min-h-[28px]">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-gray-600 whitespace-nowrap flex-shrink-0">
            Working directory
          </span>
          {primaryCwd && (
            <span
              className="no-drag flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] text-gray-400 whitespace-nowrap flex-shrink-0"
              title={`Working directory: ${primaryCwd}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3 flex-shrink-0"
              >
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span className="truncate max-w-[180px]">
                {shortenPath(primaryCwd, homeDir)}
              </span>
            </span>
          )}
          {isGitRepo && onWorktreeModeChange && (
            <WorktreeToggle
              worktreeMode={worktreeMode}
              isGitRepo={isGitRepo}
              disabled={hasMessages ?? false}
              onWorktreeModeChange={onWorktreeModeChange}
            />
          )}
          {additionalCwds.map((cwd) => (
            <span
              key={cwd}
              className="no-drag flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] text-gray-400 whitespace-nowrap flex-shrink-0"
              title={`Additional directory: ${cwd}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3 flex-shrink-0"
              >
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span className="truncate max-w-[180px]">
                {shortenPath(cwd, homeDir)}
              </span>
              <button
                onClick={() => onRemoveDirectory(cwd)}
                className="ml-0.5 text-gray-600 hover:text-gray-300 transition-colors"
                title="Remove directory"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
          <button
            onClick={onAddDirectory}
            className="no-drag flex items-center gap-1 px-2 py-0.5 rounded text-gray-600 hover:text-gray-400 hover:bg-[#1a1a1a] transition-colors whitespace-nowrap flex-shrink-0"
            title="Add working directory"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>Add</span>
          </button>

          {sessionTools && sessionTools.length > 0 && (
            <ToolsBadge
              toolCount={sessionTools.length}
              sessionTools={sessionTools}
            />
          )}

          {todoData && todoData.todos.length > 0 && (
            <button
              onClick={() => onToggleTaskPanel?.()}
              title="Toggle task panel"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1a1a1a] text-gray-400 hover:bg-[#2a2a2a] transition-colors whitespace-nowrap"
            >
              <span className="text-gray-500 text-xs">○</span>
              <span className="text-xs">
                {todoData.todos.filter((t) => t.status === "completed").length}/
                {todoData.todos.length} tasks
              </span>
            </button>
          )}
        </div>

        {hasStats && (
          <div className="relative no-drag group flex-shrink-0">
            <button
              type="button"
              aria-label="Session stats"
              className="w-6 h-6 rounded-full flex items-center justify-center bg-[#101010] border border-[#1a1a1a] hover:border-[#2b2b2b] transition-colors"
              title="Session stats"
            >
              <span
                className="block w-4 h-4 rounded-full"
                style={{
                  background: `conic-gradient(${ringColor} ${ringPercent}%, #2a2a2a ${ringPercent}% 100%)`,
                }}
              />
              <span className="absolute w-2.5 h-2.5 rounded-full bg-[#0f0f0f] border border-[#222]" />
            </button>
            <div className="pointer-events-none absolute right-0 top-[calc(100%+6px)] w-44 rounded-lg border border-[#2a2a2a] bg-[#121212] px-2.5 py-2 text-[11px] text-gray-300 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 z-20">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Context</span>
                <span
                  className={
                    contextPercent != null && contextPercent >= 80
                      ? "text-amber-400"
                      : "text-gray-300"
                  }
                >
                  {contextPercent != null ? `${contextPercent}%` : "—"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-gray-500">Cost</span>
                <span>${totalCost.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-gray-500">Tokens</span>
                <span>{formatTokens(totalTokens)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

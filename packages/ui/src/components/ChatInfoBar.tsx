import React from "react";
import type { TodoData } from "../types";
import type { McpServerInfo } from "../bridges/types";
import type { SessionChanges } from "../hooks/useSessionChanges";
import { basename } from "../utils/path";
import { ToolsBadge } from "./ToolsBadge";
import WorktreeToggle from "./WorktreeToggle";
import { TaskPanel } from "./TaskPanel";

export interface SessionStats {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextWindow: number | null;
}

interface ChatInfoBarProps {
  primaryCwd?: string;
  sessionStats: SessionStats;
  homeDir?: string;
  sessionTools?: string[];
  todoData?: TodoData | null;
  showTaskPanel?: boolean;
  onToggleTaskPanel?: () => void;
  worktreeMode?: "local" | "worktree";
  isGitRepo?: boolean;
  hasMessages?: boolean;
  onWorktreeModeChange?: (mode: "local" | "worktree") => void;
  onToggleFileExplorer?: () => void;
  onToggleTerminal?: () => void;
  mcpServers?: McpServerInfo[];
  onToggleMcpServer?: (serverName: string, enabled: boolean) => void;
  onOpenMcpConfig?: (configPath: string) => void;
  onReconnectMcpServer?: (serverName: string) => void;
  sessionChanges?: SessionChanges;
  onOpenSessionChanges?: () => void;
}

export function ChatInfoBar({
  primaryCwd,
  homeDir,
  sessionTools,
  todoData,
  showTaskPanel,
  onToggleTaskPanel,
  worktreeMode,
  isGitRepo,
  hasMessages,
  onWorktreeModeChange,
  onToggleFileExplorer,
  onToggleTerminal,
  mcpServers,
  onToggleMcpServer,
  onOpenMcpConfig,
  onReconnectMcpServer,
  sessionChanges,
  onOpenSessionChanges,
}: ChatInfoBarProps): React.ReactElement {
  const hasToolsBadge =
    (sessionTools?.length ?? 0) > 0 || (mcpServers?.length ?? 0) > 0;

  return (
    <div className="flex-shrink-0 bg-[var(--bg-main)] border-b border-[var(--border)] px-3 py-1">
      <div className="flex items-center justify-between text-xs gap-2 min-h-[28px]">
        {/* Left: directory pills */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {primaryCwd && (
            <span
              className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] text-[var(--text-control)] whitespace-nowrap flex-shrink-0"
              title={primaryCwd}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-3 h-3 flex-shrink-0 text-[var(--text-control)]"
              >
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              {basename(primaryCwd)}
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
        </div>

        {/* Right: tools, tasks, file explorer */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasToolsBadge && (
            <ToolsBadge
              toolCount={
                mcpServers?.reduce((sum, s) => sum + s.tools.length, 0) ?? 0
              }
              sessionTools={sessionTools ?? []}
              mcpServers={mcpServers}
              onToggleServer={onToggleMcpServer}
              onOpenConfig={onOpenMcpConfig}
              onReconnectServer={onReconnectMcpServer}
            />
          )}

          {todoData && todoData.todos.length > 0 && (
            <div className="relative">
              <button
                onClick={() => onToggleTaskPanel?.()}
                title="Toggle task panel"
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] text-[var(--text-control)] hover:bg-[var(--border)] transition-colors whitespace-nowrap"
              >
                <span className="text-xs">
                  {
                    todoData.todos.filter((t) => t.status === "completed")
                      .length
                  }
                  /{todoData.todos.length}
                </span>
              </button>
              {showTaskPanel && (
                <TaskPanel
                  todoData={todoData}
                  onClose={() => onToggleTaskPanel?.()}
                />
              )}
            </div>
          )}

          {primaryCwd && onToggleFileExplorer && (
            <button
              onClick={onToggleFileExplorer}
              className="no-drag p-1 rounded-md text-[var(--text-control)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
              title="Toggle file explorer"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
                />
              </svg>
            </button>
          )}

          {primaryCwd && onToggleTerminal && (
            <button
              onClick={onToggleTerminal}
              className="no-drag p-1 rounded-md text-[var(--text-control)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
              title="Toggle terminal"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <polyline
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points="4 17 10 11 4 5"
                />
                <line
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  x1="12"
                  y1="19"
                  x2="20"
                  y2="19"
                />
              </svg>
            </button>
          )}

          {sessionChanges &&
            sessionChanges.files.length > 0 &&
            onOpenSessionChanges && (
              <button
                onClick={onOpenSessionChanges}
                title={`${sessionChanges.files.length} file${sessionChanges.files.length !== 1 ? "s" : ""} changed — click to view diffs`}
                className="no-drag flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--border)] transition-colors font-mono text-[11px]"
              >
                {sessionChanges.hasRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                )}
                <span className="text-green-400">
                  +{sessionChanges.totalAdded}
                </span>
                <span className="text-red-400">
                  -{sessionChanges.totalRemoved}
                </span>
              </button>
            )}
        </div>
      </div>
    </div>
  );
}

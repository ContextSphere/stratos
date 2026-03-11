import { useState } from "react";
import type { TaskInfo, ToolCall } from "../types";
import { ToolCallCard } from "./ToolCallCard";

interface Props {
  taskInfo: TaskInfo;
  childToolCalls: ToolCall[];
  onToggleToolCalls?: (expanded: boolean) => void;
}

const SUBAGENT_ICONS: Record<string, string> = {
  Explore: "🔍",
  Plan: "📋",
  "kg-learner": "🧠",
  Bash: "⚡",
  "general-purpose": "🔧",
};

const statusColors: Record<TaskInfo["status"], string> = {
  running: "text-blue-400",
  completed: "text-green-400",
  error: "text-red-400",
};

const statusLabels: Record<TaskInfo["status"], string> = {
  running: "Running...",
  completed: "Done",
  error: "Error",
};

function truncateText(
  text: string,
  lines: number,
): { truncated: string; hasMore: boolean } {
  const textLines = text.split("\n");
  if (textLines.length <= lines) {
    return { truncated: text, hasMore: false };
  }
  return {
    truncated: textLines.slice(0, lines).join("\n"),
    hasMore: true,
  };
}

/**
 * Extract plain text from a task result, which may be either:
 * 1. A JSON array of content blocks: [{"type":"text","text":"..."}]
 * 2. Plain text
 */
function extractResultText(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n\n");
    }
  } catch {
    // Not JSON, return as-is
  }
  return result;
}

export function TaskCard({
  taskInfo,
  childToolCalls,
  onToggleToolCalls,
}: Props): React.ReactElement {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  const completedCount = childToolCalls.filter(
    (tc) => tc.status === "completed",
  ).length;
  const totalCount = childToolCalls.length;

  const elapsedTime = taskInfo.endTime
    ? ((taskInfo.endTime - taskInfo.startTime) / 1000).toFixed(1)
    : null;

  const icon = SUBAGENT_ICONS[taskInfo.subagentType] ?? "🔧";

  const { truncated: promptPreview, hasMore: hasMorePrompt } = truncateText(
    taskInfo.prompt,
    3,
  );

  // Extract and format the result text
  const resultText = taskInfo.result ? extractResultText(taskInfo.result) : "";
  const { truncated: resultPreview, hasMore: hasMoreResult } = resultText
    ? truncateText(resultText, 3)
    : { truncated: "", hasMore: false };

  const toolCallsExpanded = taskInfo.toolCallsExpanded ?? false;

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="font-semibold text-[var(--text-primary)]">
            {taskInfo.subagentType}
          </span>
        </div>
        <span
          className={`text-xs font-medium ${statusColors[taskInfo.status]}`}
        >
          {statusLabels[taskInfo.status]}
          {taskInfo.status === "running" && (
            <span className="ml-1 animate-pulse">⟳</span>
          )}
        </span>
      </div>

      {/* Description */}
      <div className="text-sm text-[var(--text-secondary)] mb-2">
        {taskInfo.description}
      </div>

      {/* Elapsed time (only when completed) */}
      {elapsedTime && (
        <div className="text-xs text-[var(--text-muted)] mb-2">
          Elapsed: {elapsedTime}s
        </div>
      )}

      {/* Task details (collapsible) */}
      <div className="mt-2">
        <button
          onClick={() => setDetailsExpanded(!detailsExpanded)}
          className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span className="text-[var(--text-muted)]">
            {detailsExpanded ? "▾" : "▸"}
          </span>
          Task details
        </button>
        {detailsExpanded && (
          <div className="mt-2 pl-4 space-y-2">
            <div>
              <div className="text-[var(--text-muted)] mb-1">Prompt:</div>
              <pre className="p-2 bg-[var(--bg-root)] rounded text-[var(--text-primary)] font-mono text-xs whitespace-pre-wrap">
                {promptExpanded ? taskInfo.prompt : promptPreview}
              </pre>
              {hasMorePrompt && (
                <button
                  onClick={() => setPromptExpanded(!promptExpanded)}
                  className="mt-1 text-blue-400 hover:underline"
                >
                  {promptExpanded ? "Show less ↑" : "Show more ↓"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Child tool calls (collapsible) */}
      {totalCount > 0 && (
        <div className="mt-2">
          <button
            onClick={() => {
              const newExpanded = !toolCallsExpanded;
              onToggleToolCalls?.(newExpanded);
            }}
            className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="text-[var(--text-muted)]">
              {toolCallsExpanded ? "▾" : "▸"}
            </span>
            {taskInfo.status === "running"
              ? `${completedCount}/${totalCount} tool calls`
              : `${totalCount} tool calls`}
            {taskInfo.status === "running" && (
              <span className="ml-1 animate-pulse">⟳</span>
            )}
          </button>
          {toolCallsExpanded && (
            <div className="mt-2 pl-4 space-y-2">
              {childToolCalls.map((tc) => (
                <ToolCallCard key={tc.toolCallId} toolCall={tc} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Result (collapsible, only when completed) */}
      {resultText && taskInfo.status === "completed" && (
        <div className="mt-2">
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="text-[var(--text-muted)]">
              {resultExpanded ? "▾" : "▸"}
            </span>
            Result
          </button>
          {resultExpanded && (
            <div className="mt-2 pl-4">
              <pre className="p-2 bg-[var(--bg-root)] rounded text-[var(--text-primary)] font-mono text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">
                {resultText}
              </pre>
            </div>
          )}
          {!resultExpanded && hasMoreResult && (
            <div className="mt-1 pl-4 text-[var(--text-muted)] text-xs">
              {resultPreview}... (click to expand)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

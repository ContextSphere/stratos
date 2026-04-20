import { lazy, Suspense } from "react";
import type { ToolCall } from "../types";
import { MemoryOperationCard } from "./MemoryOperationCard";
import { MonitorCard } from "./MonitorCard";

const FileChangeViewer = lazy(() =>
  import("./FileChangeViewer").then((m) => ({ default: m.FileChangeViewer })),
);

function extractFilePath(input: Record<string, unknown>): string {
  return (
    (input.file_path as string | undefined) ??
    (input.filePath as string | undefined) ??
    (input.path as string | undefined) ??
    (input.file as string | undefined) ??
    ""
  );
}

function isMemoryPath(filePath: string): boolean {
  return filePath.includes("/.claude/") && filePath.includes("/memory/");
}

interface Props {
  toolCall: ToolCall;
  isHistorical?: boolean;
  onViewFile?: (filePath: string) => void;
}

const statusColors: Record<ToolCall["status"], string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  denied: "text-red-400",
};

const statusLabels: Record<ToolCall["status"], string> = {
  pending: "Pending",
  running: "Running...",
  completed: "Done",
  denied: "Denied",
};

function formatInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "(no args)";
  return entries
    .map(([key, value]) => {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${str}`;
    })
    .join("\n");
}

function SkillCard({ toolCall }: Props): React.ReactElement {
  const skillName =
    typeof toolCall.input.name === "string"
      ? toolCall.input.name
      : typeof toolCall.input.skill === "string"
        ? toolCall.input.skill
        : ((Object.values(toolCall.input)[0] as string | undefined) ?? "skill");

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs flex items-center gap-2">
      <span className="text-purple-500 text-base">✦</span>
      <span className="text-[var(--text-secondary)] font-medium">
        Using skill:
      </span>
      <span className="font-mono text-[var(--text-primary)]">{skillName}</span>
      <span className={`ml-auto text-xs ${statusColors[toolCall.status]}`}>
        {statusLabels[toolCall.status]}
      </span>
    </div>
  );
}

export function ToolCallCard({
  toolCall,
  isHistorical = false,
  onViewFile,
}: Props): React.ReactElement {
  if (toolCall.toolName === "Monitor") {
    return <MonitorCard toolCall={toolCall} />;
  }

  if (toolCall.toolName === "Skill") {
    return <SkillCard toolCall={toolCall} />;
  }

  // Use MemoryOperationCard for memory file operations
  if (["Edit", "Write", "Read"].includes(toolCall.toolName)) {
    const filePath = extractFilePath(toolCall.input);
    if (isMemoryPath(filePath)) {
      return (
        <MemoryOperationCard toolCall={toolCall} onViewFile={onViewFile} />
      );
    }
  }

  // Use FileChangeViewer for file operation tools
  if (["Edit", "Write", "Read", "Delete"].includes(toolCall.toolName)) {
    return (
      <Suspense
        fallback={
          <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {toolCall.toolName}
              </span>
              <span className={`text-xs ${statusColors[toolCall.status]}`}>
                {statusLabels[toolCall.status]}
              </span>
            </div>
            <div className="mt-1.5 text-[var(--text-muted)] text-xs animate-pulse">
              Loading...
            </div>
          </div>
        }
      >
        <FileChangeViewer toolCall={toolCall} defaultExpanded={!isHistorical} />
      </Suspense>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-semibold text-[var(--text-primary)]">
          {toolCall.toolName}
        </span>
        <span className={`text-xs ${statusColors[toolCall.status]}`}>
          {statusLabels[toolCall.status]}
        </span>
      </div>
      <pre className="mt-1.5 p-2 bg-[var(--bg-root)] rounded text-[var(--text-primary)] font-mono text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
        {formatInput(toolCall.input)}
      </pre>
      {toolCall.output && (
        <div className="mt-1.5 text-[var(--text-muted)] font-mono text-xs whitespace-pre-wrap break-words line-clamp-2">
          {toolCall.output}
        </div>
      )}
    </div>
  );
}

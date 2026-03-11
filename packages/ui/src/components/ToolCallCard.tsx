import { lazy, Suspense } from "react";
import type { ToolCall } from "../types";

const FileChangeViewer = lazy(() =>
  import("./FileChangeViewer").then((m) => ({ default: m.FileChangeViewer })),
);

interface Props {
  toolCall: ToolCall;
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
    <div className="rounded-lg bg-[#0d0d14] border border-[#2a2a4a] p-3 text-xs flex items-center gap-2">
      <span className="text-purple-400 text-base">✦</span>
      <span className="text-purple-300 font-medium">Using skill:</span>
      <span className="font-mono text-purple-200">{skillName}</span>
      <span className={`ml-auto text-xs ${statusColors[toolCall.status]}`}>
        {statusLabels[toolCall.status]}
      </span>
    </div>
  );
}

export function ToolCallCard({ toolCall }: Props): React.ReactElement {
  if (toolCall.toolName === "Skill") {
    return <SkillCard toolCall={toolCall} />;
  }

  // Use FileChangeViewer for file operation tools
  if (["Edit", "Write", "Read", "Delete"].includes(toolCall.toolName)) {
    return (
      <Suspense
        fallback={
          <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono font-semibold text-gray-300">
                {toolCall.toolName}
              </span>
              <span className={`text-xs ${statusColors[toolCall.status]}`}>
                {statusLabels[toolCall.status]}
              </span>
            </div>
            <div className="mt-1.5 text-gray-500 text-xs animate-pulse">
              Loading...
            </div>
          </div>
        }
      >
        <FileChangeViewer toolCall={toolCall} />
      </Suspense>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-semibold text-gray-300">
          {toolCall.toolName}
        </span>
        <span className={`text-xs ${statusColors[toolCall.status]}`}>
          {statusLabels[toolCall.status]}
        </span>
      </div>
      <pre className="mt-1.5 p-2 bg-[var(--bg-root)] rounded text-gray-300 font-mono text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
        {formatInput(toolCall.input)}
      </pre>
      {toolCall.output && (
        <div className="mt-1.5 text-gray-500 font-mono text-xs whitespace-pre-wrap break-words line-clamp-2">
          {toolCall.output}
        </div>
      )}
    </div>
  );
}

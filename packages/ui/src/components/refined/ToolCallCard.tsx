import { lazy, Suspense, memo, useEffect, useState } from "react";
import type { ToolCall } from "../../types";
import { MemoryOperationCard } from "../MemoryOperationCard";
import { MonitorCard } from "../MonitorCard";
import { BuiltinToolCard } from "./BuiltinToolCard";
import { DefaultBuiltinCardBody } from "../DefaultBuiltinCardBody";
import { toolRegistry } from "../../tool-registry";

const FileChangeViewer = lazy(() =>
  import("../FileChangeViewer").then((m) => ({ default: m.FileChangeViewer })),
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

export interface Props {
  toolCall: ToolCall;
  isHistorical?: boolean;
  onViewFile?: (filePath: string) => void;
}

const statusColors: Record<ToolCall["status"], string> = {
  pending: "text-[var(--text-secondary)]",
  running: "text-[var(--text-secondary)]",
  completed: "text-[var(--text-secondary)]",
  denied: "text-[var(--text-danger)]",
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

function summarizeInput(input: Record<string, unknown>): string {
  const preferredKeys = [
    "command",
    "path",
    "file_path",
    "query",
    "url",
    "name",
  ];
  const key =
    preferredKeys.find((candidate) => input[candidate] != null) ??
    Object.keys(input)[0];
  if (!key) return "";
  const value = input[key];
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

function hasExplicitErrorOutput(output: string | undefined): boolean {
  return !!output && /^(error|failed|exception)(?:\s|:)/i.test(output.trim());
}

function GenericToolActivity({ toolCall }: Props): React.ReactElement {
  const isError =
    toolCall.status === "denied" || hasExplicitErrorOutput(toolCall.output);
  const statusLabel =
    toolCall.status === "denied"
      ? "Denied"
      : isError
        ? "Error"
        : statusLabels[toolCall.status];
  const [expanded, setExpanded] = useState(
    toolCall.status === "running" || toolCall.status === "pending" || isError,
  );
  const [userToggled, setUserToggled] = useState(false);
  const summary = summarizeInput(toolCall.input);
  const hasDetails =
    Object.keys(toolCall.input).length > 0 || !!toolCall.output;

  useEffect(() => {
    if (!userToggled) {
      setExpanded(
        toolCall.status === "running" ||
          toolCall.status === "pending" ||
          isError,
      );
    }
  }, [isError, toolCall.status, userToggled]);

  useEffect(() => {
    if (toolCall.status === "running") setUserToggled(false);
  }, [toolCall.status]);

  return (
    <div
      className={`text-[13px] ${isError ? "rounded-md bg-[var(--bg-danger)]" : ""}`}
    >
      <button
        type="button"
        onClick={() => {
          if (!hasDetails) return;
          setUserToggled(true);
          setExpanded((value) => !value);
        }}
        disabled={!hasDetails}
        className="flex min-h-7 w-full items-center gap-2 rounded-md px-0.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--text-muted)] disabled:cursor-default"
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            toolCall.status === "running"
              ? "animate-pulse bg-blue-400"
              : toolCall.status === "pending"
                ? "bg-amber-400"
                : isError
                  ? "bg-[var(--text-danger)]"
                  : "bg-emerald-400"
          }`}
        />
        <span className="flex-shrink-0 font-medium text-[var(--text-primary)]">
          {toolCall.toolName}
        </span>
        {summary && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-muted)]"
            title={summary}
          >
            {summary}
          </span>
        )}
        <span
          className={`ml-auto flex-shrink-0 text-xs ${isError ? "font-medium text-[var(--text-danger)]" : statusColors[toolCall.status]}`}
        >
          {statusLabel}
        </span>
        {hasDetails && (
          <svg
            className={`h-3 w-3 flex-shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m19 9-7 7-7-7"
            />
          </svg>
        )}
      </button>
      {hasDetails && expanded && (
        <div className="ml-3 space-y-2 border-l border-[var(--border)] py-1.5 pl-3 pr-1">
          {Object.keys(toolCall.input).length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                Arguments
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-overlay)] p-2 text-xs leading-5 text-[var(--text-secondary)]">
                {formatInput(toolCall.input)}
              </pre>
            </div>
          )}
          {toolCall.output && (
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                Output
              </div>
              <pre
                className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-overlay)] p-2 text-xs leading-5 ${isError ? "text-[var(--text-danger)]" : "text-[var(--text-secondary)]"}`}
              >
                {toolCall.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
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

function ToolCallCardImpl({
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

  // Registry lookup for internal Stratos tools
  const descriptor = toolRegistry.resolve(toolCall.toolName);
  if (descriptor) {
    const BodyComponent = descriptor.CardBody ?? DefaultBuiltinCardBody;
    const hasBody =
      !!descriptor.CardBody ||
      Object.keys(toolCall.input).length > 0 ||
      !!toolCall.output;
    return (
      <BuiltinToolCard
        toolCall={toolCall}
        descriptor={descriptor}
        hasBody={hasBody}
      >
        {hasBody && (
          <BodyComponent toolCall={toolCall} descriptor={descriptor} />
        )}
      </BuiltinToolCard>
    );
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

  return <GenericToolActivity toolCall={toolCall} />;
}

/** Memoized — a transcript can hold thousands of tool calls, and only the
 *  in-flight one changes during streaming. */
export const ToolCallCard = memo(ToolCallCardImpl);

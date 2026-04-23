import { useState } from "react";
import type { ToolCall } from "../types";
import type { InternalToolDescriptor } from "../tool-registry/types";

const STATUS_COLORS: Record<ToolCall["status"], string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  denied: "text-red-400",
};

const STATUS_LABELS: Record<ToolCall["status"], string> = {
  pending: "Pending",
  running: "Running…",
  completed: "Done",
  denied: "Denied",
};

interface Props {
  toolCall: ToolCall;
  descriptor: InternalToolDescriptor;
  /** Whether to show expand/collapse toggle. Pass false when body would be empty. */
  hasBody?: boolean;
  children?: React.ReactNode;
}

export function BuiltinToolCard({
  toolCall,
  descriptor,
  hasBody = true,
  children,
}: Props): React.ReactElement {
  const defaultExpanded =
    descriptor.defaultExpanded === "auto"
      ? toolCall.status === "running"
      : (descriptor.defaultExpanded ?? false);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { display } = descriptor;
  const IconComponent = display.icon;
  const title = descriptor.title
    ? descriptor.title(toolCall)
    : display.sourceLabel;

  return (
    <div
      className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] overflow-hidden text-xs"
      style={{ borderLeftColor: display.accentColor, borderLeftWidth: "3px" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span style={{ color: display.accentColor }} className="flex-shrink-0">
          <IconComponent size={12} />
        </span>
        <span
          className="text-[10px] font-medium flex-shrink-0"
          style={{ color: display.accentColor + "cc" }}
        >
          {display.sourceLabel}
        </span>
        <span className="text-[var(--text-secondary)] flex-1 truncate">
          {title}
        </span>

        {/* Status chip */}
        <span
          className={`font-medium flex-shrink-0 flex items-center gap-1 ${STATUS_COLORS[toolCall.status]}`}
        >
          {toolCall.status === "running" && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: "#60a5fa" }}
            />
          )}
          {STATUS_LABELS[toolCall.status]}
        </span>

        {/* Expand toggle */}
        {hasBody && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors flex-shrink-0"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <span
              className="text-[10px] inline-block transition-transform duration-150"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
          </button>
        )}
      </div>

      {/* Expandable body */}
      {hasBody && expanded && (
        <div className="border-t border-[var(--border-mid)] px-3 py-2">
          {children}
        </div>
      )}
    </div>
  );
}

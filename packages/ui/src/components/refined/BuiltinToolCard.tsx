import { useState } from "react";
import type { ToolCall } from "../../types";
import type { InternalToolDescriptor } from "../../tool-registry/types";
import { useDesignVariant } from "../../context/DesignContext";

const STATUS_COLORS: Record<ToolCall["status"], string> = {
  pending: "text-[var(--text-secondary)]",
  running: "text-[var(--text-secondary)]",
  completed: "text-[var(--text-secondary)]",
  denied: "text-[var(--text-danger)]",
};

const STATUS_LABELS: Record<ToolCall["status"], string> = {
  pending: "Pending",
  running: "Running…",
  completed: "Done",
  denied: "Denied",
};

export interface Props {
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
  const classic = useDesignVariant() === "classic";
  const defaultExpanded =
    toolCall.status === "denied"
      ? true
      : descriptor.defaultExpanded === "auto"
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
      className={`overflow-hidden rounded-lg border text-xs ${
        classic
          ? "border-[var(--border-mid)] bg-[var(--bg-overlay)]"
          : toolCall.status === "denied"
            ? "border-[var(--border-danger)] bg-[var(--bg-danger)]"
            : "border-[var(--border)] bg-[var(--bg-overlay)]"
      }`}
      style={
        classic
          ? { borderLeftColor: display.accentColor, borderLeftWidth: "3px" }
          : undefined
      }
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span style={{ color: display.accentColor }} className="flex-shrink-0">
          <IconComponent size={12} />
        </span>
        <span className="flex-shrink-0 text-[10px] font-medium text-[var(--text-secondary)]">
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
            className="ml-1 flex-shrink-0 rounded p-0.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
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
        <div className="border-t border-[var(--border)] px-2.5 py-2">
          {children}
        </div>
      )}
    </div>
  );
}

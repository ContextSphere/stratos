import { useState, useRef, useEffect } from "react";
import type { ToolCall } from "../types";

const statusColors: Record<ToolCall["status"], string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  denied: "text-red-400",
};

const statusLabels: Record<ToolCall["status"], string> = {
  pending: "Pending",
  running: "Watching…",
  completed: "Done",
  denied: "Denied",
};

function formatTimeout(ms: unknown): string {
  if (typeof ms !== "number") return "";
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1_000)}s`;
}

interface Props {
  toolCall: ToolCall;
}

export function MonitorCard({ toolCall }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const description =
    typeof toolCall.input.description === "string"
      ? toolCall.input.description
      : "";
  const command =
    typeof toolCall.input.command === "string" ? toolCall.input.command : "";
  const timeoutLabel = formatTimeout(toolCall.input.timeout_ms);
  const events = toolCall.monitorEvents ?? [];
  const isRunning = toolCall.status === "running";

  // Auto-scroll events list as new lines arrive
  useEffect(() => {
    if (isRunning) {
      eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, isRunning]);

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[var(--text-tertiary)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="6" />
            <polyline points="8,5 8,8 10,10" />
          </svg>
        </span>
        <span className="font-semibold text-[var(--text-primary)]">
          Monitor
        </span>
        {description && (
          <span className="text-[var(--text-secondary)] flex-1 truncate">
            {description}
          </span>
        )}
        <span
          className={`ml-auto font-medium ${statusColors[toolCall.status]}`}
        >
          {statusLabels[toolCall.status]}
        </span>
      </div>

      {/* Command + timeout row (collapsible) */}
      {command && (
        <div className="border-t border-[var(--border-mid)]">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-left"
          >
            <span
              className="text-[10px] transition-transform"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            <code className="font-mono text-[var(--text-secondary)] truncate flex-1">
              {command}
            </code>
            {timeoutLabel && (
              <span className="shrink-0 text-[var(--text-tertiary)]">
                timeout: {timeoutLabel}
              </span>
            )}
          </button>
          {expanded && (
            <div className="px-3 pb-2">
              <pre className="font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all bg-[var(--bg-base)] rounded p-2">
                {command}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Events stream */}
      {events.length > 0 && (
        <div className="border-t border-[var(--border-mid)] px-3 py-2">
          <div
            className="font-mono text-[var(--text-secondary)] max-h-32 overflow-y-auto space-y-0.5"
            data-testid="monitor-events"
          >
            {events.map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[var(--text-tertiary)] shrink-0 select-none">
                  ⬤
                </span>
                <span className="break-all">{line}</span>
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      )}

      {/* Running pulse indicator */}
      {isRunning && events.length === 0 && (
        <div className="border-t border-[var(--border-mid)] px-3 py-2 flex items-center gap-2 text-[var(--text-tertiary)]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span>Waiting for events…</span>
        </div>
      )}
    </div>
  );
}

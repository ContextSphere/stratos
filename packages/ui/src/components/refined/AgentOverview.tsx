import type { Thread } from "@stratosapp/core";
import type { AgentDefinition, AgentFidelity } from "@stratosapp/core";
import { getModeConfig } from "../../utils/modes";
import { AgentGlyph } from "../AgentGlyph";
import { getThreadStatus } from "../ThreadList";

/** Reports fields of an agent that a given provider realization ignores. */
export type { AgentFidelity as AgentFidelityInfo } from "@stratosapp/core";

export interface Props {
  agent: AgentDefinition;
  threads: Thread[];
  activeThreadId?: string | null;
  onThreadClick: (threadId: string) => void;
  onCreateThread: () => void;
  onEdit: () => void;
  fidelity?: AgentFidelity;
  runningThreadIds?: readonly string[];
  pendingPermissionThreadIds?: Set<string>;
  threadNotifications?: Map<string, string>;
}

const PROVIDER_LABELS = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
} as const;

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function describePrompt(prompt: AgentDefinition["prompt"]): string {
  if (!prompt) return "None";
  if (typeof prompt === "string") return prompt.trim() ? "Inline" : "None";
  if (Array.isArray(prompt)) {
    if (prompt.length === 0) return "None";
    return prompt.join(", ");
  }
  return "None";
}

export function AgentOverview({
  agent,
  threads,
  activeThreadId,
  onThreadClick,
  onCreateThread,
  onEdit,
  fidelity,
  runningThreadIds,
  pendingPermissionThreadIds,
  threadNotifications,
}: Props): React.ReactElement {
  const mcpServerNames = Object.keys(agent.mcpServers ?? {});

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--bg-main)]">
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 border-b border-[var(--border)] py-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
          <>
            <span className="truncate">Bots</span>
            <span aria-hidden="true" className="text-[var(--text-faint)]">
              /
            </span>
            <span className="truncate font-medium text-[var(--text-primary)]">
              {agent.name}
            </span>
          </>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            onClick={onEdit}
            className="no-drag rounded-lg px-3 py-1.5 text-sm text-[var(--text-control)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            Edit
          </button>
        </div>
      </div>

      <div className="flex-1 w-full px-6 mx-auto max-w-[620px] space-y-7 py-7">
        {/* Header */}
        <div className="flex items-start gap-4">
          <AgentGlyph
            name={agent.name}
            icon={agent.icon}
            accent={agent.accent}
            size="large"
          />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              {agent.name}
            </h1>
            {agent.description && (
              <p className="mt-1 max-w-xl text-[13px] leading-5 text-[var(--text-secondary)]">
                {agent.description}
              </p>
            )}
          </div>
        </div>

        {/* Fidelity warning */}
        {fidelity && fidelity.unsupported.length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <span>
              {fidelity.provider} ignores: {fidelity.unsupported.join(", ")}
            </span>
          </div>
        )}

        {/* Threads */}
        <div>
          <div className="flex items-center justify-between mb-1 border-b border-[var(--border)] pb-2">
            <h2 className="text-[13px] font-medium text-[var(--text-secondary)]">
              Recent threads{" "}
              <span className="text-[var(--text-muted)]">{threads.length}</span>
            </h2>
            {
              <button
                onClick={onCreateThread}
                className="no-drag rounded px-1.5 py-1 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              >
                <span aria-hidden="true">+</span> New thread
              </button>
            }
          </div>
          <div className="space-y-0.5">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => onThreadClick(thread.id)}
                className={`no-drag group flex w-full items-center gap-2 rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 h-[30px] px-2 text-[13px] ${
                  thread.id === activeThreadId
                    ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                    : "text-[var(--text-control)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {(() => {
                  const liveStatus = getThreadStatus(
                    thread.id,
                    thread.id === activeThreadId,
                    [...(runningThreadIds ?? [])],
                    pendingPermissionThreadIds,
                    threadNotifications,
                  );
                  const status = liveStatus
                    ? {
                        label: liveStatus.label,
                        dot: `${liveStatus.dotClass} ${liveStatus.pulse ? "animate-pulse" : ""}`,
                      }
                    : thread.lastCompletionStatus === "error"
                      ? { label: "Needs attention", dot: "bg-red-400" }
                      : thread.lastCompletionStatus === "interrupted"
                        ? { label: "Stopped", dot: "bg-amber-400" }
                        : thread.lastCompletionStatus === "completed"
                          ? { label: "Completed", dot: "bg-emerald-400" }
                          : { label: "Ready", dot: "bg-[var(--text-faint)]" };
                  return (
                    <>
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${status.dot}`}
                        title={status.label}
                      />
                      <span className="sr-only">{status.label}</span>
                    </>
                  );
                })()}
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                {
                  <span className="flex-shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                    {formatRelativeTime(thread.updatedAt)}
                  </span>
                }
                {
                  <svg
                    className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m9 18 6-6-6-6"
                    />
                  </svg>
                }
              </button>
            ))}
            {threads.length === 0 && (
              <p className="px-2 py-2 text-sm text-[var(--text-muted)]">
                No threads yet. Start one when you are ready.
              </p>
            )}
          </div>
        </div>

        {/* Configuration */}
        <div>
          <h2 className="mb-1 border-b border-[var(--border)] pb-2 text-[13px] font-medium text-[var(--text-secondary)]">
            Configuration
          </h2>
          <dl className="grid grid-cols-[130px_1fr] text-[13px]">
            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Instructions
            </dt>
            <dd className="truncate border-b border-[var(--border)] py-2 text-[var(--text-primary)]">
              {describePrompt(agent.prompt)}
            </dd>

            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Tools
            </dt>
            <dd className="truncate border-b border-[var(--border)] py-2 font-mono text-[11px] text-[var(--text-primary)]">
              {mcpServerNames.length > 0 ? mcpServerNames.join(", ") : "None"}
            </dd>

            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Working directory
            </dt>
            <dd
              className={`truncate border-b border-[var(--border)] py-2 ${
                agent.cwd
                  ? "font-mono text-[11px] text-[var(--text-primary)]"
                  : "text-[13px] text-[var(--text-secondary)]"
              }`}
            >
              {agent.cwd ?? "Uses the last folder this bot ran in"}
            </dd>

            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Provider
            </dt>
            <dd className="truncate border-b border-[var(--border)] py-2 text-[var(--text-primary)]">
              {agent.provider
                ? PROVIDER_LABELS[agent.provider]
                : "Thread default"}
            </dd>

            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Model
            </dt>
            <dd
              className={`truncate border-b border-[var(--border)] py-2 ${
                agent.model
                  ? "font-mono text-[11px] text-[var(--text-primary)]"
                  : "text-[13px] text-[var(--text-secondary)]"
              }`}
            >
              {agent.model ?? "Provider default"}
            </dd>

            <dt className="border-b border-[var(--border)] py-2 text-[var(--text-muted)]">
              Permissions
            </dt>
            <dd className="truncate border-b border-[var(--border)] py-2 text-[var(--text-primary)]">
              {agent.mode
                ? getModeConfig(agent.provider ?? "copilot", agent.mode).label
                : "Thread default"}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

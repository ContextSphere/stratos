import type { Thread } from "@stratosapp/core";
import type {
  AgentAccent,
  AgentDefinition,
  AgentFidelity,
} from "@stratosapp/core";

/** Tailwind classes for the accent-tinted glyph square, per accent. */
const ACCENT_CLASSES: Record<AgentAccent, string> = {
  violet: "bg-violet-500/15 text-violet-400",
  emerald: "bg-emerald-500/15 text-emerald-400",
  blue: "bg-blue-500/15 text-blue-400",
  pink: "bg-pink-500/15 text-pink-400",
  orange: "bg-orange-500/15 text-orange-400",
  amber: "bg-amber-500/15 text-amber-400",
};

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
}: Props): React.ReactElement {
  const accentClass = ACCENT_CLASSES[agent.accent] ?? ACCENT_CLASSES.blue;
  const mcpServerNames = Object.keys(agent.mcpServers ?? {});

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--bg-main)]">
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-xs">
          {agent.provider && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)]">
              {agent.provider}
            </span>
          )}
          {agent.model && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)]">
              {agent.model}
            </span>
          )}
          {agent.mode && (
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)]">
              {agent.mode}
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          className="no-drag px-3 py-1.5 rounded-lg text-sm text-[var(--text-control)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
        >
          Edit
        </button>
      </div>

      <div className="flex-1 px-6 py-6 max-w-2xl w-full mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className={`flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${accentClass}`}
          >
            <span aria-hidden="true">{agent.icon}</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">
              {agent.name}
            </h1>
            {agent.description && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
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
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Threads · {threads.length}
            </h2>
          </div>
          <div className="space-y-0.5">
            {threads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => onThreadClick(thread.id)}
                className={`no-drag flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                  thread.id === activeThreadId
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-control)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="flex-1 truncate">{thread.title}</span>
              </div>
            ))}
            <button
              onClick={onCreateThread}
              className="no-drag w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New thread with {agent.name}
            </button>
          </div>
        </div>

        {/* Configuration */}
        <div>
          <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
            Configuration
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
            <dt className="text-[var(--text-muted)]">Prompt</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {describePrompt(agent.prompt)}
            </dd>

            <dt className="text-[var(--text-muted)]">MCP servers</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {mcpServerNames.length > 0 ? mcpServerNames.join(", ") : "None"}
            </dd>

            <dt className="text-[var(--text-muted)]">Working directory</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {agent.cwd ??
                "Not pinned — uses the last folder this agent ran in"}
            </dd>

            <dt className="text-[var(--text-muted)]">Provider</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {agent.provider ?? "Default"}
            </dd>

            <dt className="text-[var(--text-muted)]">Model</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {agent.model ?? "Default"}
            </dd>

            <dt className="text-[var(--text-muted)]">Mode</dt>
            <dd className="text-[var(--text-primary)] truncate">
              {agent.mode ?? "Default"}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

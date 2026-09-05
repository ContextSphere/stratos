import { useMemo, useRef, useState, useEffect } from "react";
import type { Thread } from "@stratosapp/core";
import type { AgentAccent, AgentDefinition } from "@stratosapp/core";
import { DEFAULT_AGENT_ID } from "../../utils/agent-defaults";
import { ThreadRow, getThreadStatus } from "../ThreadList";

/** Tailwind classes for the accent-tinted glyph square, per accent. */
const ACCENT_CLASSES: Record<AgentAccent, string> = {
  violet: "bg-violet-500/15 text-violet-400",
  emerald: "bg-emerald-500/15 text-emerald-400",
  blue: "bg-blue-500/15 text-blue-400",
  pink: "bg-pink-500/15 text-pink-400",
  orange: "bg-orange-500/15 text-orange-400",
  amber: "bg-amber-500/15 text-amber-400",
};

export interface Props {
  agents: AgentDefinition[];
  threads: Thread[];
  activeThreadId: string | null;
  activeAgentId: string | null;
  collapsedAgentIds: Set<string>;
  onToggleAgent: (agentId: string, collapsed: boolean) => void;
  onAgentClick: (agentId: string) => void;
  onThreadClick: (threadId: string) => void;
  onCreateThreadForAgent: (agentId: string) => void;
  onCreateAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds?: Set<string>;
}

function AgentMenu({
  onDelete,
  onClose,
}: {
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[140px]"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-red-400 hover:bg-[var(--border)] transition-colors"
      >
        Delete bot
      </button>
    </div>
  );
}

export function AgentGroupList({
  agents,
  threads,
  activeThreadId,
  activeAgentId,
  collapsedAgentIds,
  onToggleAgent,
  onAgentClick,
  onThreadClick,
  onCreateThreadForAgent,
  onCreateAgent,
  onDeleteAgent,
  onDeleteThread,
  onRenameThread,
  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [menuOpenAgentId, setMenuOpenAgentId] = useState<string | null>(null);

  // Group non-manager threads by the agent that owns them. A thread with no
  // agentId belongs to the built-in Default agent.
  const threadsByAgentId = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const thread of threads) {
      if (thread.isManagerThread) continue;
      const agentId = thread.agentId ?? DEFAULT_AGENT_ID;
      const existing = map.get(agentId) ?? [];
      existing.push(thread);
      map.set(agentId, existing);
    }
    return map;
  }, [threads]);

  // The built-in Default agent is a *runtime* concept — it is what an agentless
  // thread resolves to so its session config stays exactly as it was before
  // agents existed. It is deliberately NOT listed here: every thread under it
  // is agentless, so the group would reproduce the Folders view verbatim and
  // bury the real agents under a junk drawer. Agentless threads live in
  // Folders; this view answers "what are my agents, and what are they doing".
  const yourAgents = useMemo(
    () => agents.filter((a) => !a.builtIn && a.id !== DEFAULT_AGENT_ID),
    [agents],
  );

  const renderAgentRow = (agent: AgentDefinition) => {
    const agentThreads = threadsByAgentId.get(agent.id) ?? [];
    const isCollapsed = collapsedAgentIds.has(agent.id);
    const isMenuOpen = menuOpenAgentId === agent.id;
    const isActiveAgent = activeAgentId === agent.id;
    const accentClass = ACCENT_CLASSES[agent.accent] ?? ACCENT_CLASSES.blue;

    return (
      <div key={agent.id}>
        {/* Agent row */}
        <div
          className={`group no-drag flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-sm relative ${
            isActiveAgent
              ? "bg-[var(--border)] text-[var(--text-primary)]"
              : "text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
          }`}
          title={agent.name}
          onClick={() => onAgentClick(agent.id)}
        >
          {/* Collapse chevron */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleAgent(agent.id, !isCollapsed);
            }}
            className="flex-shrink-0 p-0.5 -m-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            <svg
              className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>

          {/* Accent-tinted glyph */}
          <div
            className={`flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[11px] leading-none ${accentClass}`}
          >
            <span aria-hidden="true">{agent.icon}</span>
          </div>

          {/* Agent name */}
          <span className="flex-1 truncate font-medium">{agent.name}</span>

          {/* Thread count */}
          <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
            {agentThreads.length}
          </span>

          {/* Actions (visible on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {!agent.builtIn && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenAgentId(isMenuOpen ? null : agent.id);
                }}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Bot options"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            )}

            {/* New thread */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateThreadForAgent(agent.id);
              }}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title={`New thread with ${agent.name}`}
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
            </button>
          </div>

          {/* Dropdown menu */}
          {isMenuOpen && (
            <AgentMenu
              onDelete={() => onDeleteAgent(agent.id)}
              onClose={() => setMenuOpenAgentId(null)}
            />
          )}
        </div>

        {/* Threads under agent */}
        {!isCollapsed && (
          <div className="space-y-0.5 mt-0.5">
            {agentThreads.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-1 pl-7 pr-3">
                No threads
              </p>
            ) : (
              agentThreads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                const status = getThreadStatus(
                  thread.id,
                  isActive,
                  runningThreadIds,
                  pendingPermissionThreadIds,
                  threadNotifications,
                );
                return (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    isActive={isActive}
                    status={status}
                    hasDraft={false}
                    confirmDelete={confirmDelete}
                    editingThreadId={editingThreadId}
                    onThreadClick={onThreadClick}
                    onDeleteThread={onDeleteThread}
                    onRenameThread={onRenameThread}
                    setConfirmDelete={setConfirmDelete}
                    setEditingThreadId={setEditingThreadId}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-0.5 px-1">
        {/* Agents section — the Default agent is intentionally absent; see the
            `yourAgents` note above. */}
        <div className="flex items-center justify-between px-2 pt-1 pb-0.5">
          <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            Bots
          </span>
          <button
            onClick={onCreateAgent}
            className="no-drag p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            title="New bot"
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
          </button>
        </div>
        {yourAgents.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-4 px-3 text-center">
            No bots yet.{" "}
            <button
              onClick={onCreateAgent}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
            >
              Create a bot
            </button>{" "}
            to get started.
          </p>
        ) : (
          yourAgents.map(renderAgentRow)
        )}
      </div>
    </div>
  );
}

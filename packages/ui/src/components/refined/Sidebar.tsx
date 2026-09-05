import type { Thread, Folder } from "@stratosapp/core";
import type { AgentDefinition } from "@stratosapp/core";
import { ThreadList } from "../ThreadList";
import { AgentGroupList } from "./AgentGroupList";

export type SidebarGrouping = "folders" | "agents";

export interface Props {
  threads: Thread[];
  folders: Folder[];
  activeThreadId: string | null;
  onThreadClick: (threadId: string) => void;
  onCreateThreadInFolder: (folderId: string) => void;
  onAddFolder: () => void;
  onRemoveFolder: (folderId: string) => void;
  onToggleFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onToggleSidebar: () => void;
  onSettingsClick: () => void;
  onSchedulesClick?: () => void;
  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds?: Set<string>;
  draftThreadIds?: Set<string>;

  // Grouping switch (Folders | Agents)
  grouping?: SidebarGrouping;
  onGroupingChange?: (grouping: SidebarGrouping) => void;

  // Agents grouping — only needed when grouping === "agents"
  agents?: AgentDefinition[];
  activeAgentId?: string | null;
  collapsedAgentIds?: Set<string>;
  onToggleAgent?: (agentId: string, collapsed: boolean) => void;
  onAgentClick?: (agentId: string) => void;
  onCreateThreadForAgent?: (agentId: string) => void;
  onCreateAgent?: () => void;
  onDeleteAgent?: (agentId: string) => void;
}

export function Sidebar({
  threads,
  folders,
  activeThreadId,
  onThreadClick,
  onCreateThreadInFolder,
  onAddFolder,
  onRemoveFolder,
  onToggleFolderCollapsed,
  onDeleteThread,
  onRenameThread,
  onToggleSidebar,
  onSettingsClick,
  onSchedulesClick,
  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
  draftThreadIds,
  grouping = "folders",
  onGroupingChange,
  agents = [],
  activeAgentId = null,
  collapsedAgentIds,
  onToggleAgent,
  onAgentClick,
  onCreateThreadForAgent,
  onCreateAgent,
  onDeleteAgent,
}: Props): React.ReactElement {
  return (
    <div className="flex h-full w-[220px] min-w-[220px] flex-shrink-0 flex-col overflow-hidden bg-[var(--bg-root)] text-[13px]">
      <div className="flex flex-col h-full">
        {/* Traffic-light clearance */}
        <div className="drag-region h-6 flex-shrink-0" />
        {/* Header with logo */}
        <div className="flex flex-shrink-0 items-center justify-between px-4 pb-2 pt-1">
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            Stratos
          </span>
          <button
            onClick={onToggleSidebar}
            className="no-drag rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)]"
            title="Collapse sidebar"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>

        {/* Grouping switch */}
        {onGroupingChange && (
          <div
            role="tablist"
            aria-label="Sidebar grouping"
            className="no-drag mx-3 mb-2 flex flex-shrink-0 items-center gap-1"
          >
            <button
              role="tab"
              aria-selected={grouping === "folders"}
              onClick={() => onGroupingChange("folders")}
              className={`flex-1 rounded-md px-2 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)] ${
                grouping === "folders"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              Folders
            </button>
            <button
              role="tab"
              aria-selected={grouping === "agents"}
              onClick={() => onGroupingChange("agents")}
              className={`flex-1 rounded-md px-2 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)] ${
                grouping === "agents"
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
            >
              Bots
            </button>
          </div>
        )}

        {/* Thread list */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 py-1">
          {grouping === "agents" ? (
            <AgentGroupList
              agents={agents}
              threads={threads}
              activeThreadId={activeThreadId}
              activeAgentId={activeAgentId}
              collapsedAgentIds={collapsedAgentIds ?? new Set()}
              onToggleAgent={onToggleAgent ?? (() => {})}
              onAgentClick={onAgentClick ?? (() => {})}
              onThreadClick={onThreadClick}
              onCreateThreadForAgent={onCreateThreadForAgent ?? (() => {})}
              onCreateAgent={onCreateAgent ?? (() => {})}
              onDeleteAgent={onDeleteAgent ?? (() => {})}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
              runningThreadIds={runningThreadIds}
              threadNotifications={threadNotifications}
              pendingPermissionThreadIds={pendingPermissionThreadIds}
            />
          ) : (
            <ThreadList
              // Agent-owned threads live under their agent. Excluding them here
              // makes the two groupings a partition rather than an overlap, and
              // leaves Folders exactly as it was before agents existed.
              threads={threads.filter((t) => !t.agentId)}
              folders={folders}
              activeThreadId={activeThreadId}
              onThreadClick={onThreadClick}
              onCreateThreadInFolder={onCreateThreadInFolder}
              onAddFolder={onAddFolder}
              onRemoveFolder={onRemoveFolder}
              onToggleFolderCollapsed={onToggleFolderCollapsed}
              onDeleteThread={onDeleteThread}
              onRenameThread={onRenameThread}
              runningThreadIds={runningThreadIds}
              threadNotifications={threadNotifications}
              pendingPermissionThreadIds={pendingPermissionThreadIds}
              draftThreadIds={draftThreadIds}
            />
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex-shrink-0 space-y-0.5 px-3 pb-3 pt-2">
          {onSchedulesClick && (
            <button
              onClick={onSchedulesClick}
              className="no-drag flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)]"
              title="Scheduled Prompts"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
                />
              </svg>
              <span>Schedules</span>
            </button>
          )}
          <button
            onClick={onSettingsClick}
            className="no-drag flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-muted)]"
            title="Settings"
          >
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

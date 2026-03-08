import type { Thread, Folder } from "@agentpanel/core";
import { ThreadList } from "./ThreadList";

interface Props {
  threads: Thread[];
  folders: Folder[];
  activeThreadId: string | null;
  onThreadClick: (threadId: string) => void;
  onCreateThreadInFolder: (folderId: string) => void;
  onAddFolder: () => void;
  onRemoveFolder: (folderId: string) => void;
  onToggleFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleSidebar: () => void;

  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds?: Set<string>;
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
  onToggleSidebar,

  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
}: Props): React.ReactElement {
  return (
    <div className="flex-shrink-0 flex flex-col bg-[#0a0a0a] overflow-hidden w-[232px] min-w-[232px] h-full">
      <div className="flex flex-col h-full">
        {/* Traffic-light clearance */}
        <div className="drag-region h-7 flex-shrink-0" />
        {/* Header with logo */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 pb-1">
          <span className="font-semibold text-gray-200">
            Agent<span className="text-blue-500">Panel</span>
          </span>
          <button
            onClick={onToggleSidebar}
            className="no-drag p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] transition-colors"
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

        {/* Thread list */}
        <div className="flex-1 flex flex-col min-h-0 border-t border-white/10 overflow-y-auto px-1 py-2">
          <ThreadList
            threads={threads}
            folders={folders}
            activeThreadId={activeThreadId}
            onThreadClick={onThreadClick}
            onCreateThreadInFolder={onCreateThreadInFolder}
            onAddFolder={onAddFolder}
            onRemoveFolder={onRemoveFolder}
            onToggleFolderCollapsed={onToggleFolderCollapsed}
            onDeleteThread={onDeleteThread}
            runningThreadIds={runningThreadIds}
            threadNotifications={threadNotifications}
            pendingPermissionThreadIds={pendingPermissionThreadIds}
          />
        </div>

      </div>
    </div>
  );
}

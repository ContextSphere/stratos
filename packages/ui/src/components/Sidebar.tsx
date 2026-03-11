import type { Thread, Folder } from "@stratosapp/core";
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
  onSettingsClick: () => void;
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
  onSettingsClick,
  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
}: Props): React.ReactElement {
  return (
    <div className="flex-shrink-0 flex flex-col bg-[var(--bg-root)] overflow-hidden w-[232px] min-w-[232px] h-full">
      <div className="flex flex-col h-full">
        {/* Traffic-light clearance */}
        <div className="drag-region h-7 flex-shrink-0" />
        {/* Header with logo */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 pb-1">
          <span className="font-semibold text-gray-200">
            <span className="text-blue-500">Stratos</span>
          </span>
          <button
            onClick={onToggleSidebar}
            className="no-drag p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-[var(--bg-surface)] transition-colors"
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

        {/* Settings footer */}
        <div className="flex-shrink-0 border-t border-white/10 px-3 py-2">
          <button
            onClick={onSettingsClick}
            className="no-drag w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-500 hover:bg-[var(--bg-surface)] hover:text-gray-300 transition-colors text-sm"
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

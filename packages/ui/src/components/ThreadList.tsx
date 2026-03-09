import { useState, useMemo, useRef, useEffect } from "react";
import type { Thread, Folder } from "@stratosapp/core";
import { basename } from "../utils/path";

interface StatusPill {
  label: string;
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

function getThreadStatus(
  threadId: string,
  isActive: boolean,
  runningThreadIds: string[],
  pendingPermissionThreadIds?: Set<string>,
  threadNotifications?: Map<string, string>,
): StatusPill | null {
  if (pendingPermissionThreadIds?.has(threadId)) {
    return {
      label: "Awaiting",
      colorClass: "text-amber-400",
      dotClass: "bg-amber-400",
      pulse: false,
    };
  }
  if (runningThreadIds.includes(threadId)) {
    return {
      label: "Working",
      colorClass: "text-violet-400",
      dotClass: "bg-violet-400",
      pulse: true,
    };
  }
  if (!isActive && threadNotifications?.has(threadId)) {
    return {
      label: "Done",
      colorClass: "text-emerald-400",
      dotClass: "bg-emerald-400",
      pulse: false,
    };
  }
  return null;
}

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
  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds?: Set<string>;
}

function FolderMenu({
  onRemove,
  onClose,
}: {
  onRemove: () => void;
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
      className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-lg py-1 min-w-[140px]"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 hover:bg-[#2a2a2a] transition-colors"
      >
        Remove folder
      </button>
    </div>
  );
}

function ThreadRow({
  thread,
  isActive,
  status,
  confirmDelete,
  onThreadClick,
  onDeleteThread,
  setConfirmDelete,
}: {
  thread: Thread;
  isActive: boolean;
  status: StatusPill | null;
  confirmDelete: string | null;
  onThreadClick: (id: string) => void;
  onDeleteThread: (id: string) => void;
  setConfirmDelete: (id: string | null) => void;
}) {
  const isDeleting = confirmDelete === thread.id;

  return (
    <div
      className={`group no-drag flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm ${
        isActive
          ? "bg-[#2a2a2a] text-gray-200"
          : "text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200"
      }`}
      onClick={() => onThreadClick(thread.id)}
    >
      {status && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${status.dotClass} ${status.pulse ? "animate-pulse" : ""}`}
          />
          <span className={`text-[10px] font-medium ${status.colorClass}`}>
            {status.label}
          </span>
        </div>
      )}
      <span className="flex-1 truncate">{thread.title}</span>
      {isDeleting ? (
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onDeleteThread(thread.id);
              setConfirmDelete(null);
            }}
            className="text-xs text-red-400 hover:text-red-300 px-1"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(null)}
            className="text-xs text-gray-500 hover:text-gray-300 px-1"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(thread.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 transition-all"
          title="Delete thread"
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
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ThreadList({
  threads,
  folders,
  activeThreadId,
  onThreadClick,
  onCreateThreadInFolder,
  onAddFolder,
  onRemoveFolder,
  onToggleFolderCollapsed,
  onDeleteThread,
  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuOpenFolderId, setMenuOpenFolderId] = useState<string | null>(null);

  // Group threads by folder path
  const threadsByFolderPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const thread of threads) {
      if (!thread.cwd) continue;
      // Worktree threads should group under their source repo, not the worktree path
      const groupPath = thread.worktree?.sourceRepoPath ?? thread.cwd;
      const existing = map.get(groupPath) ?? [];
      existing.push(thread);
      map.set(groupPath, existing);
    }
    return map;
  }, [threads]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Threads
        </span>
        <button
          onClick={onAddFolder}
          className="no-drag p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] transition-colors"
          title="Add folder"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
        </button>
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto space-y-0.5 px-1">
        {folders.length === 0 ? (
          <p className="text-xs text-gray-600 py-4 px-3 text-center">
            No folders yet.{" "}
            <button
              onClick={onAddFolder}
              className="text-gray-400 hover:text-gray-200 underline"
            >
              Add a folder
            </button>{" "}
            to get started.
          </p>
        ) : (
          folders.map((folder) => {
            const folderThreads = threadsByFolderPath.get(folder.path) ?? [];
            const isCollapsed = folder.collapsed ?? false;
            const isMenuOpen = menuOpenFolderId === folder.id;

            return (
              <div key={folder.id}>
                {/* Folder row */}
                <div
                  className="group no-drag flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-sm text-gray-300 hover:bg-[#1a1a1a] relative"
                  title={folder.name}
                  onClick={() =>
                    onToggleFolderCollapsed(folder.id, !isCollapsed)
                  }
                >
                  {/* Collapse chevron */}
                  <svg
                    className={`w-3 h-3 text-gray-500 flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
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

                  {/* Folder icon */}
                  <svg
                    className="w-4 h-4 text-gray-500 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>

                  {/* Folder name */}
                  <span className="flex-1 truncate font-medium">
                    {basename(folder.name)}
                  </span>

                  {/* Actions (visible on hover) */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* More menu */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenFolderId(isMenuOpen ? null : folder.id);
                      }}
                      className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
                      title="Folder options"
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

                    {/* New thread */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateThreadInFolder(folder.id);
                      }}
                      className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
                      title={`New thread in ${folder.name}`}
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
                    <FolderMenu
                      onRemove={() => onRemoveFolder(folder.id)}
                      onClose={() => setMenuOpenFolderId(null)}
                    />
                  )}
                </div>

                {/* Threads under folder */}
                {!isCollapsed && (
                  <div className="space-y-0.5 mt-0.5">
                    {folderThreads.length === 0 ? (
                      <p className="text-xs text-gray-600 py-1 pl-7 pr-3">
                        No threads
                      </p>
                    ) : (
                      folderThreads.map((thread) => {
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
                            confirmDelete={confirmDelete}
                            onThreadClick={onThreadClick}
                            onDeleteThread={onDeleteThread}
                            setConfirmDelete={setConfirmDelete}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

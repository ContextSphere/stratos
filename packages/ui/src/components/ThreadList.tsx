import { useState, useMemo, useRef, useEffect } from "react";
import type { Thread, Folder } from "@stratosapp/core";
import { basename } from "../utils/path";

export interface StatusPill {
  label: string;
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export function getThreadStatus(
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
  onRenameThread: (threadId: string, title: string) => void;
  runningThreadIds: string[];
  threadNotifications: Map<string, string>;
  pendingPermissionThreadIds?: Set<string>;
  draftThreadIds?: Set<string>;
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
      className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[140px]"
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-red-400 hover:bg-[var(--border)] transition-colors"
      >
        Remove folder
      </button>
    </div>
  );
}

export function ThreadRow({
  thread,
  isActive,
  status,
  hasDraft,
  confirmDelete,
  editingThreadId,
  onThreadClick,
  onDeleteThread,
  onRenameThread,
  setConfirmDelete,
  setEditingThreadId,
}: {
  thread: Thread;
  isActive: boolean;
  status: StatusPill | null;
  hasDraft: boolean;
  confirmDelete: string | null;
  editingThreadId: string | null;
  onThreadClick: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onRenameThread: (id: string, title: string) => void;
  setConfirmDelete: (id: string | null) => void;
  setEditingThreadId: (id: string | null) => void;
}) {
  const isDeleting = confirmDelete === thread.id;
  const isEditing = editingThreadId === thread.id;
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      cancelledRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== thread.title) {
      onRenameThread(thread.id, trimmed);
    }
    setEditingThreadId(null);
  };

  const startEditing = () => {
    setConfirmDelete(null);
    setEditingThreadId(thread.id);
  };

  return (
    <div
      className={`group no-drag flex items-center gap-2 pl-7 pr-3 py-1.5 rounded-lg transition-colors text-sm ${
        isEditing ? "" : "cursor-pointer"
      } ${
        isActive
          ? "bg-[var(--border)] text-[var(--text-primary)]"
          : "text-[var(--text-control)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
      }`}
      onClick={() => {
        if (!isEditing) onThreadClick(thread.id);
      }}
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
      {hasDraft && !status && (
        <svg
          className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-label="Draft"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"
          />
        </svg>
      )}
      {thread.scheduledPromptId && !status && !hasDraft && (
        <svg
          className="w-3 h-3 flex-shrink-0 text-[var(--text-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-label="Scheduled"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
          />
        </svg>
      )}
      {isEditing ? (
        <input
          ref={inputRef}
          defaultValue={thread.title}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelledRef.current = true;
              setEditingThreadId(null);
            }
          }}
          onBlur={(e) => {
            if (cancelledRef.current) return;
            commit(e.target.value);
          }}
          aria-label="Rename thread"
          className="flex-1 min-w-0 bg-[var(--bg-root)] border border-blue-400 rounded px-1.5 py-0 text-sm text-[var(--text-primary)] outline-none"
        />
      ) : (
        <span className="flex-1 truncate">{thread.title}</span>
      )}
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
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1"
          >
            Cancel
          </button>
        </div>
      ) : isEditing ? null : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Rename thread"
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
                d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z"
              />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(thread.id);
            }}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
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
        </div>
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
  onRenameThread,
  runningThreadIds,
  threadNotifications,
  pendingPermissionThreadIds,
  draftThreadIds,
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [menuOpenFolderId, setMenuOpenFolderId] = useState<string | null>(null);

  // Separate manager thread from regular threads
  const managerThread = useMemo(
    () => threads.find((t) => t.isManagerThread),
    [threads],
  );
  const regularThreads = useMemo(
    () => threads.filter((t) => !t.isManagerThread),
    [threads],
  );

  // Group threads by folder path
  const threadsByFolderPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const thread of regularThreads) {
      if (!thread.cwd) continue;
      // Worktree threads should group under their source repo, not the worktree path
      const groupPath = thread.worktree?.sourceRepoPath ?? thread.cwd;
      const existing = map.get(groupPath) ?? [];
      existing.push(thread);
      map.set(groupPath, existing);
    }
    return map;
  }, [regularThreads]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
          Threads
        </span>
        <button
          onClick={onAddFolder}
          className="no-drag p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
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

      {/* Pinned Manager thread */}
      {managerThread && (
        <div className="px-1 pb-1 border-b border-[var(--border)] mb-1">
          <div
            className={`group no-drag flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-sm ${
              managerThread.id === activeThreadId
                ? "bg-[var(--border)] text-[var(--text-primary)]"
                : "text-[var(--text-control)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            }`}
            onClick={() => onThreadClick(managerThread.id)}
          >
            {/* Manager icon */}
            <svg
              className="w-4 h-4 flex-shrink-0 text-blue-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
              />
            </svg>
            {(() => {
              const status = getThreadStatus(
                managerThread.id,
                managerThread.id === activeThreadId,
                runningThreadIds,
                pendingPermissionThreadIds,
                threadNotifications,
              );
              return status ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${status.dotClass} ${status.pulse ? "animate-pulse" : ""}`}
                  />
                  <span
                    className={`text-[10px] font-medium ${status.colorClass}`}
                  >
                    {status.label}
                  </span>
                </div>
              ) : null;
            })()}
            <span className="flex-1 truncate font-medium">Manager</span>
          </div>
        </div>
      )}

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto space-y-0.5 px-1">
        {folders.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-4 px-3 text-center">
            No folders yet.{" "}
            <button
              onClick={onAddFolder}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
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
                  className="group no-drag flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] relative"
                  title={folder.name}
                  onClick={() =>
                    onToggleFolderCollapsed(folder.id, !isCollapsed)
                  }
                >
                  {/* Collapse chevron */}
                  <svg
                    className={`w-3 h-3 text-[var(--text-muted)] flex-shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
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
                    className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0"
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
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
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
                      <p className="text-xs text-[var(--text-muted)] py-1 pl-7 pr-3">
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
                            hasDraft={draftThreadIds?.has(thread.id) ?? false}
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
          })
        )}
      </div>
    </div>
  );
}

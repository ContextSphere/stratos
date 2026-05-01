import { useState } from "react";
import type { SessionChanges } from "../hooks/useSessionChanges";
import type { GitFileState, GitStatus } from "../types";
import { FileChangeViewer } from "./FileChangeViewer";
import { basename } from "../utils/path";

interface Props {
  changes: SessionChanges;
  gitStatus?: GitStatus;
}

const STATE_CONFIG: Record<
  GitFileState,
  { label: string; className: string; title: string }
> = {
  staged: {
    label: "S",
    className: "text-green-400 bg-green-400/15",
    title: "Staged",
  },
  unstaged: {
    label: "U",
    className: "text-yellow-400 bg-yellow-400/15",
    title: "Unstaged",
  },
  mixed: {
    label: "M",
    className: "text-orange-400 bg-orange-400/15",
    title: "Staged + unstaged changes",
  },
  untracked: {
    label: "?",
    className: "text-gray-400 bg-gray-400/15",
    title: "Untracked",
  },
  committed: {
    label: "✓",
    className: "text-[var(--text-muted)] bg-[var(--bg-surface)]",
    title: "Committed",
  },
};

function StatusBadge({ state }: { state: GitFileState }) {
  const cfg = STATE_CONFIG[state];
  return (
    <span
      className={`flex-shrink-0 text-[9px] font-mono font-bold px-1 rounded ${cfg.className}`}
      title={cfg.title}
    >
      {cfg.label}
    </span>
  );
}

function getFileState(
  absolutePath: string,
  gitStatus: GitStatus | undefined,
): GitFileState | null {
  if (!gitStatus || !gitStatus.root) return null;
  const rel = absolutePath.startsWith(gitStatus.root + "/")
    ? absolutePath.slice(gitStatus.root.length + 1)
    : null;
  if (!rel) return null;
  return (gitStatus.files[rel] as GitFileState) ?? "committed";
}

export function SessionChangesPane({
  changes,
  gitStatus,
}: Props): React.ReactElement {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    changes.files[0]?.filePath ?? null,
  );

  const selectedFile =
    changes.files.find((f) => f.filePath === selectedPath) ??
    changes.files[0] ??
    null;

  if (changes.files.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-[var(--text-muted)] text-xs gap-2">
        <svg
          className="w-8 h-8 opacity-30"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        <span>No file changes this session</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Branch header */}
      {gitStatus?.branch && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[var(--border)] flex-shrink-0 bg-[var(--bg-surface)]">
          <svg
            className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0h6a3 3 0 100-6 3 3 0 000 6H6z"
            />
          </svg>
          <span className="font-mono text-[11px] text-[var(--text-control)] truncate">
            {gitStatus.branch}
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* File list */}
        <div className="w-40 flex-shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {changes.files.map((file) => {
              const isSelected = file.filePath === selectedFile?.filePath;
              const name = basename(file.filePath);
              const dir = file.filePath.slice(
                0,
                file.filePath.length - name.length - 1,
              );
              const shortDir = dir.length > 20 ? "…" + dir.slice(-20) : dir;
              const fileState = getFileState(file.filePath, gitStatus);

              return (
                <button
                  key={file.filePath}
                  onClick={() => setSelectedPath(file.filePath)}
                  className={`w-full text-left px-3 py-2 border-b border-[var(--border)] transition-colors hover:bg-[var(--bg-surface)] ${
                    isSelected
                      ? "bg-[var(--bg-surface)] border-l-2 border-l-blue-500"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span
                      className="font-mono text-xs text-[var(--text-primary)] truncate flex-1"
                      title={file.filePath}
                    >
                      {name}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {fileState && <StatusBadge state={fileState} />}
                      {file.hasRunning ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      ) : file.toolCalls[file.toolCalls.length - 1]
                          ?.toolName === "Delete" ? (
                        <span className="text-[10px] text-red-400 font-medium">
                          del
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-[10px]">
                          {file.added > 0 && (
                            <span className="text-green-400">
                              +{file.added}
                            </span>
                          )}
                          {file.removed > 0 && (
                            <span className="text-red-400">
                              -{file.removed}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  {shortDir && (
                    <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5 font-mono">
                      {shortDir}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff viewer */}
        <div className="flex-1 min-w-[180px] overflow-hidden p-3 flex flex-col">
          {selectedFile ? (
            <FileChangeViewer
              key={selectedFile.latestToolCall.toolCallId}
              toolCall={selectedFile.latestToolCall}
              defaultExpanded={true}
              fillHeight={true}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

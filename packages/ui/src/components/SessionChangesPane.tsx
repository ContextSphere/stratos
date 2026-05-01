import { useState } from "react";
import type { SessionChanges } from "../hooks/useSessionChanges";
import { FileChangeViewer } from "./FileChangeViewer";
import { basename } from "../utils/path";

interface Props {
  changes: SessionChanges;
}

export function SessionChangesPane({ changes }: Props): React.ReactElement {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    changes.files[0]?.filePath ?? null,
  );

  // Keep selected path valid as files list updates
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
    <div className="flex h-full overflow-hidden">
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
                  {file.hasRunning ? (
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  ) : file.toolCalls[file.toolCalls.length - 1]?.toolName ===
                    "Delete" ? (
                    <span className="flex-shrink-0 text-[10px] text-red-400 font-medium">
                      del
                    </span>
                  ) : (
                    <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px]">
                      {file.added > 0 && (
                        <span className="text-green-400">+{file.added}</span>
                      )}
                      {file.removed > 0 && (
                        <span className="text-red-400">-{file.removed}</span>
                      )}
                    </span>
                  )}
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
      <div className="flex-1 min-w-[180px] overflow-y-auto p-3">
        {selectedFile ? (
          // key forces Monaco remount when switching to a different tool call
          // (different file or new edit to same file), avoiding stale content
          <FileChangeViewer
            key={selectedFile.latestToolCall.toolCallId}
            toolCall={selectedFile.latestToolCall}
            defaultExpanded={true}
          />
        ) : null}
      </div>
    </div>
  );
}

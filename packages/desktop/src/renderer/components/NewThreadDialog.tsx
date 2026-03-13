import { useCallback, useEffect, useRef, useState } from "react";
import type { Folder } from "@stratosapp/core";
import { Dialog, DialogBody } from "@stratosapp/ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  folders: Folder[];
  onSelectFolder: (folder: Folder) => void;
  onBrowse: () => void;
}

export function NewThreadDialog({
  isOpen,
  onClose,
  folders,
  onSelectFolder,
  onBrowse,
}: Props): React.ReactElement | null {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset highlight when opened
  useEffect(() => {
    if (isOpen) setHighlightedIndex(0);
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[highlightedIndex] as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          folders.length > 0 ? Math.min(prev + 1, folders.length - 1) : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (folders.length > 0 && highlightedIndex < folders.length) {
          onSelectFolder(folders[highlightedIndex]);
        } else {
          onBrowse();
        }
      }
    },
    [isOpen, folders, highlightedIndex, onSelectFolder, onBrowse],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="New Thread"
      subtitle="Choose a working directory"
      maxWidth="sm"
    >
      <DialogBody>
        {folders.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] mb-4">
            No folders yet. Browse to add one.
          </p>
        ) : (
          <div
            ref={listRef}
            className="mb-3 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]"
          >
            {folders.map((folder, i) => (
              <button
                key={folder.id}
                onClick={() => onSelectFolder(folder)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  i === highlightedIndex
                    ? "bg-[var(--bg-hover)]"
                    : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {folder.name}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                  {folder.path}
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={onBrowse}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
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
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
          Browse for folder…
        </button>
      </DialogBody>
    </Dialog>
  );
}

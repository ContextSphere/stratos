import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import { FileIcon } from "./FileIcon";

interface Props {
  files: string[];
  query: string;
  position: { bottom: number | string; left: number };
  onSelect: (path: string) => void;
  onClose: () => void;
  loading: boolean;
}

export function FileMentionMenu({
  files,
  query,
  position,
  onSelect,
  onClose,
  loading,
}: Props): ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      (query
        ? files.filter((f) =>
            (f.split("/").pop() ?? f)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
        : files
      ).slice(0, 6),
    [files, query],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (loading || filtered.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab": {
          e.preventDefault();
          e.stopPropagation();
          const item = filtered[selectedIndex];
          if (item !== undefined) onSelect(item);
          break;
        }
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onClose, loading],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  if (!loading && filtered.length === 0) return null;

  return (
    <div
      className="absolute z-50 w-80 max-w-full max-h-60 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-xl p-1 shadow-lg"
      style={{ bottom: position.bottom, left: position.left }}
      ref={listRef}
    >
      {loading ? (
        <div className="rounded-lg px-2.5 py-2 text-[13px] text-[var(--text-secondary)] flex items-center gap-2">
          <span className="animate-spin inline-block">⟳</span>
          Loading files…
        </div>
      ) : (
        filtered.map((filePath, i) => {
          const filename = filePath.split("/").pop() ?? filePath;
          const dir = filePath.includes("/")
            ? filePath.slice(0, filePath.lastIndexOf("/"))
            : "";
          return (
            <button
              key={filePath}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(filePath);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left rounded-lg px-2.5 py-2 text-[13px] flex items-center justify-between gap-3 ${
                i === selectedIndex
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileIcon filename={filename} size={14} />
                <span className="font-mono text-[var(--text-primary)] truncate">
                  {filename}
                </span>
              </span>
              {dir && (
                <span className="text-[var(--text-muted)] text-xs truncate font-mono flex-shrink-0 max-w-[40%]">
                  {dir}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

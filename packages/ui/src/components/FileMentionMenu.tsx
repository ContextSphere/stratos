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
  position: { bottom: number; left: number };
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
      className="absolute z-50 w-72 max-h-48 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
      ref={listRef}
    >
      {loading ? (
        <div className="px-3 py-2 text-sm text-gray-400 flex items-center gap-2">
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
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 ${
                i === selectedIndex
                  ? "bg-[var(--border)] text-gray-200"
                  : "text-gray-400 hover:bg-[var(--border)]"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileIcon filename={filename} size={14} />
                <span className="font-mono text-[var(--text-primary)] truncate">
                  {filename}
                </span>
              </span>
              {dir && (
                <span className="text-gray-500 text-xs truncate font-mono flex-shrink-0 max-w-[40%]">
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

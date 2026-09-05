import { useState, useEffect, useCallback, useRef } from "react";
import { useDesignVariant } from "../context/DesignContext";

export interface SlashCommandInfo {
  name: string;
  description?: string;
}

interface Props {
  commands: SlashCommandInfo[];
  filter: string;
  position: { bottom: number | string; left: number };
  onSelect: (command: string) => void;
  onClose: () => void;
}

export function SlashCommandMenu({
  commands,
  filter,
  position,
  onSelect,
  onClose,
}: Props): React.ReactElement | null {
  const refined = useDesignVariant() === "refined";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(filter.toLowerCase()),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
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
        case "Tab":
          e.preventDefault();
          e.stopPropagation();
          if (filtered[selectedIndex]) onSelect(filtered[selectedIndex].name);
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  if (filtered.length === 0) return null;

  return (
    <div
      className={`composer-command-menu absolute z-50 ${refined ? "w-full" : "w-80"} max-w-full max-h-60 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-xl p-1 shadow-lg`}
      style={{ bottom: position.bottom, left: position.left }}
      ref={listRef}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd.name);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
          className={`w-full text-left rounded-md px-2.5 py-1.5 text-[13px] leading-5 flex items-center gap-3 ${
            i === selectedIndex
              ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
          >
            <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" />
            <path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5" />
          </svg>
          <span className="min-w-0 font-normal text-[var(--text-primary)] truncate">
            {cmd.name}
          </span>
          {cmd.description && (
            <span className="min-w-0 text-[var(--text-muted)] text-xs truncate">
              {cmd.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

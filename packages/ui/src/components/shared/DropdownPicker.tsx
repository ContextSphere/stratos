import React, { useEffect, useRef, useState } from "react";

export interface DropdownItem {
  value: string;
  label: string;
  description?: string;
}

interface DropdownPickerProps {
  items: DropdownItem[];
  selectedValue: string;
  onSelect: (value: string) => void;
  /** Controlled open state — pass to enable external open/close (e.g. CMD+P) */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  minWidth?: string;
}

export default function DropdownPicker({
  items,
  selectedValue,
  onSelect,
  isOpen: controlledIsOpen,
  onOpenChange,
  minWidth = "min-w-36",
}: DropdownPickerProps): React.ReactElement {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = (next: boolean) => {
    setInternalIsOpen(next);
    onOpenChange?.(next);
  };

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync controlled open state
  useEffect(() => {
    if (controlledIsOpen !== undefined) {
      setInternalIsOpen(controlledIsOpen);
    }
  }, [controlledIsOpen]);

  // Sync highlight to current selection when opening
  useEffect(() => {
    if (isOpen) {
      const idx = items.findIndex((item) => item.value === selectedValue);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, items, selectedValue]);

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % items.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => (i - 1 + items.length) % items.length);
          break;
        case "Enter":
          e.preventDefault();
          onSelect(items[highlightedIndex].value);
          setIsOpen(false);
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [isOpen, items, highlightedIndex, onSelect]);

  // Auto-scroll highlighted item into view during keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, isOpen]);

  const currentItem = items.find((item) => item.value === selectedValue);

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2 py-0.5">
      <div className="relative" ref={ref}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-xs text-[var(--text-control)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          {currentItem?.label ?? selectedValue}
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {isOpen && (
          <div
            ref={listRef}
            className={`absolute bottom-full mb-1 left-0 z-50 ${minWidth} bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl overflow-y-auto max-h-64`}
          >
            {items.map((item, i) => (
              <button
                key={item.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item.value);
                  setIsOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 ${
                  i === highlightedIndex
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-control)] hover:bg-[var(--border)]"
                }`}
              >
                <span>{item.label}</span>
                {item.description && (
                  <span className="text-[var(--text-muted)] text-[11px]">
                    {item.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

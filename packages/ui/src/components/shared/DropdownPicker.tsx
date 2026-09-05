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
  /**
   * Show a type-to-filter box. Defaults to auto: enabled once the list is long
   * enough that blind-scrolling a ~5-row viewport becomes the only way to find
   * an entry (provider model lists routinely exceed this).
   */
  searchable?: boolean;
  searchPlaceholder?: string;
}

/** Lists longer than this get a filter box when `searchable` is unset. */
const SEARCHABLE_ITEM_THRESHOLD = 8;

export default function DropdownPicker({
  items,
  selectedValue,
  onSelect,
  isOpen: controlledIsOpen,
  onOpenChange,
  minWidth = "min-w-36",
  searchable,
  searchPlaceholder = "Filter…",
}: DropdownPickerProps): React.ReactElement {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = (next: boolean) => {
    setInternalIsOpen(next);
    onOpenChange?.(next);
  };

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? items.length > SEARCHABLE_ITEM_THRESHOLD;
  const trimmedQuery = query.trim().toLowerCase();
  // Match on the human label *and* the raw value so users can type either the
  // display name ("GPT-6 Astra") or the model id ("gpt-6-astra").
  const visibleItems = trimmedQuery
    ? items.filter(
        (item) =>
          item.label.toLowerCase().includes(trimmedQuery) ||
          item.value.toLowerCase().includes(trimmedQuery),
      )
    : items;

  // Sync controlled open state
  useEffect(() => {
    if (controlledIsOpen !== undefined) {
      setInternalIsOpen(controlledIsOpen);
    }
  }, [controlledIsOpen]);

  // Latest items without retriggering the open effect: `items` is rebuilt by
  // callers on every render, so depending on it directly would re-run the
  // effect continuously and snap the highlight back off the user's selection.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Sync highlight to current selection when opening; clear the filter on
  // close (clearing on open would race the query-reset effect below and
  // clobber the restored highlight).
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    const idx = itemsRef.current.findIndex(
      (item) => item.value === selectedValue,
    );
    setHighlightedIndex(idx >= 0 ? idx : 0);
    searchRef.current?.focus();
  }, [isOpen, selectedValue]);

  // Filtering reorders the list, so any prior highlight index is meaningless.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

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
          if (visibleItems.length === 0) return;
          setHighlightedIndex((i) => (i + 1) % visibleItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (visibleItems.length === 0) return;
          setHighlightedIndex(
            (i) => (i - 1 + visibleItems.length) % visibleItems.length,
          );
          break;
        case "Enter": {
          e.preventDefault();
          const picked = visibleItems[highlightedIndex];
          if (!picked) return;
          onSelect(picked.value);
          setIsOpen(false);
          break;
        }
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () =>
      document.removeEventListener("keydown", handler, { capture: true });
  }, [isOpen, visibleItems, highlightedIndex, onSelect]);

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
            className={`absolute bottom-full mb-1 left-0 z-50 ${minWidth} bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl overflow-hidden`}
          >
            {showSearch && (
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            )}
            <div ref={listRef} className="overflow-y-auto max-h-64">
              {visibleItems.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                  No matches
                </div>
              ) : (
                visibleItems.map((item, i) => (
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
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

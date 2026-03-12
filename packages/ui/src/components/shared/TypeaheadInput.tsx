import { useState, useRef, useEffect, useCallback } from "react";

export interface TypeaheadOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (option: TypeaheadOption) => void;
  onSearch: (query: string) => Promise<TypeaheadOption[]>;
  placeholder?: string;
  debounceMs?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  minQueryLength?: number;
}

export function TypeaheadInput({
  label,
  value,
  onChange,
  onSelect,
  onSearch,
  placeholder,
  debounceMs = 300,
  autoFocus = false,
  disabled = false,
  minQueryLength = 1,
}: Props): React.ReactElement {
  const [options, setOptions] = useState<TypeaheadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const runSearch = useCallback(
    async (query: string) => {
      if (query.length < minQueryLength) {
        setOptions([]);
        setIsOpen(false);
        return;
      }
      setLoading(true);
      try {
        const results = await onSearch(query);
        setOptions(results);
        setIsOpen(results.length > 0);
        setActiveIndex(-1);
      } catch {
        setOptions([]);
        setIsOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [onSearch, minQueryLength],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        runSearch(newValue);
      }, debounceMs);
    },
    [onChange, runSearch, debounceMs],
  );

  const handleSelect = useCallback(
    (option: TypeaheadOption) => {
      onSelect(option);
      setIsOpen(false);
      setOptions([]);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && options[activeIndex]) {
          e.preventDefault();
          handleSelect(options[activeIndex]);
        }
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    },
    [isOpen, options, activeIndex, handleSelect],
  );

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (options.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-[var(--bg-overlay)] border border-[var(--border-mid)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-blue-500 transition-colors pr-8"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg
              className="animate-spin w-4 h-4 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
        )}
      </div>

      {isOpen && options.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full text-left px-3 py-2.5 transition-colors ${
                index === activeIndex
                  ? "bg-blue-600/20 text-[var(--text-primary)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
              }`}
            >
              <div className="text-sm truncate">{option.label}</div>
              {option.sublabel && (
                <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                  {option.sublabel}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

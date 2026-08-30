import { memo, useCallback, useEffect, useState } from "react";

export interface TurnRailItem {
  /** Message id of the user turn (stable SDK transcript UUID). */
  id: string;
  /** User-authored turn text shown in the expanded gutter. */
  label: string;
}

interface TurnRailProps {
  turns: TurnRailItem[];
  activeTurnId: string | null;
  onSelect: (messageId: string) => void;
}

/**
 * A compact left gutter for navigating user turns. Its outline is an anchored
 * popover: browsing it must not reflow the transcript beneath the pointer.
 */
export const TurnRail = memo(function TurnRail({
  turns,
  activeTurnId,
  onSelect,
}: TurnRailProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectTurn = useCallback(
    (messageId: string) => {
      onSelect(messageId);
      setIsOpen(false);
    },
    [onSelect],
  );

  useEffect(() => {
    if (!isOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  if (turns.length < 2) return null;

  return (
    <div
      className="absolute inset-y-0 left-0 z-20 w-8"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocusCapture={() => setIsOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setIsOpen(false);
      }}
    >
      <button
        type="button"
        className="sr-only"
        aria-label="Browse conversation turns"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        Browse conversation turns
      </button>

      <div
        className="flex h-full w-8 flex-col items-start justify-center gap-1.5 pl-1"
        aria-label="Conversation turn markers"
      >
        {turns.map((turn) => {
          const active = turn.id === activeTurnId;
          return (
            <button
              key={turn.id}
              type="button"
              title={turn.label}
              aria-label={`Jump to ${turn.label}`}
              aria-current={active ? "step" : undefined}
              onClick={() => selectTurn(turn.id)}
              className="group flex h-3 w-6 items-center rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-primary)]"
            >
              <span
                className={`block h-0.5 rounded-full transition-opacity duration-150 ${
                  active
                    ? "w-5 bg-[var(--text-primary)]"
                    : "w-3 bg-[var(--text-muted)] opacity-60 group-hover:w-4 group-hover:opacity-100"
                }`}
              />
            </button>
          );
        })}
      </div>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Conversation turns"
          className="absolute left-3 top-3 w-[22rem] max-h-[32rem] overflow-y-auto rounded-xl border border-[var(--border-mid)] bg-[var(--bg-root)] p-2 shadow-[0_18px_36px_rgba(0,0,0,0.34)]"
        >
          {turns.map((turn) => {
            const active = turn.id === activeTurnId;
            return (
              <button
                key={turn.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => selectTurn(turn.id)}
                className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left text-sm leading-5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-primary)] ${
                  active
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-control)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span
                  className={`h-0.5 shrink-0 rounded-full ${
                    active
                      ? "w-5 bg-[var(--text-primary)]"
                      : "w-3 bg-[var(--text-muted)] opacity-70"
                  }`}
                />
                <span className="min-w-0 break-words">{turn.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

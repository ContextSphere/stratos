import React, { useEffect, useRef, useState } from "react";
import type { AgentMode, ProviderType } from "../../utils/modes";
import { getAgentModes, getModeConfig } from "../../utils/modes";

export interface ModeToggleProps {
  provider: ProviderType;
  mode: AgentMode | undefined;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export default function ModeToggle({
  provider,
  mode,
  onModeChange,
  disabled,
}: ModeToggleProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current: AgentMode = mode ?? "default";
  const modes = getAgentModes(provider);
  const currentConfig = getModeConfig(provider, current);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = optionRefs.current.filter(Boolean) as HTMLButtonElement[];
      if (buttons.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const currentIndex = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : (currentIndex + delta + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const currentIndex = Math.max(0, modes.indexOf(current));
    const frame = requestAnimationFrame(() =>
      optionRefs.current[currentIndex]?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [current, isOpen, modes]);

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        className={`no-drag flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
          currentConfig.dangerous
            ? "bg-[var(--bg-danger)] text-[var(--text-danger)] hover:opacity-90"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={`${currentConfig.description} Shortcut: Shift+Tab`}
        aria-label={`Permissions: ${currentConfig.label}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <svg
          className="h-3.5 w-3.5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3.75 4.5 7.5v4.85c0 4.31 3.08 7.84 7.5 8.9 4.42-1.06 7.5-4.59 7.5-8.9V7.5L12 3.75Z"
          />
        </svg>
        <span className="font-medium">{currentConfig.label}</span>
        <svg
          className="h-3 w-3 flex-shrink-0"
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

      {isOpen && !disabled && (
        <div
          role="menu"
          aria-label="Permissions"
          className="absolute bottom-full right-0 z-50 mb-2 w-80 max-w-[calc(100vw-32px)] rounded-xl border border-[var(--border-mid)] bg-[var(--bg-surface)] p-1.5 shadow-2xl"
        >
          <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-[var(--text-muted)]">
            Permissions
          </div>
          {modes.map((item, index) => {
            const config = getModeConfig(provider, item);
            const selected = item === current;
            return (
              <button
                key={item}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onModeChange(item);
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                  selected
                    ? "bg-[var(--bg-selected)]"
                    : "hover:bg-[var(--bg-hover)]"
                }`}
                title={config.description}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    config.dangerous
                      ? "bg-[var(--text-danger)]"
                      : selected
                        ? "bg-blue-400"
                        : "bg-[var(--text-faint)]"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${config.dangerous ? "text-[var(--text-danger)]" : "text-[var(--text-primary)]"}`}
                  >
                    {config.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-[var(--text-muted)]">
                    {config.description}
                  </span>
                </span>
                {selected && (
                  <svg
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m5 12 4 4L19 6"
                    />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="border-t border-[var(--border)] px-2 pb-1 pt-2 text-xs text-[var(--text-muted)]">
            Shift+Tab cycles permission modes
          </div>
        </div>
      )}
    </div>
  );
}

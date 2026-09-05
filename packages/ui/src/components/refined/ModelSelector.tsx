import { useDesignVariant } from "../../context/DesignContext";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../../types";
import type { ProviderType } from "../../utils/modes";

const EFFORT_LEVELS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const PROVIDER_LABELS: Record<ProviderType, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
};

export interface ModelSelectorProps {
  provider?: ProviderType;
  onProviderChange?: (provider: ProviderType) => void;
  enabledProviders?: ProviderType[];
  providerDisabled?: boolean;
  selectedModel?: string;
  onModelChange: (model: string) => void;
  thinkingEffort?: string;
  onThinkingEffortChange: (effort: string) => void;
  models?: ModelInfo[];
  onFetchModels?: () => Promise<ModelInfo[]>;
  /** Stable identifier that invalidates the provider-scoped model list. */
  fetchScope?: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function isOpusModel(model: ModelInfo | undefined): boolean {
  if (!model) return false;
  const text =
    `${model.value} ${model.displayName} ${model.description}`.toLowerCase();
  return text.includes("opus");
}

export default function ModelSelector({
  provider,
  onProviderChange,
  enabledProviders,
  providerDisabled = false,
  selectedModel,
  onModelChange,
  thinkingEffort,
  onThinkingEffortChange,
  models: modelsProp,
  onFetchModels,
  fetchScope,
  isOpen: controlledOpen,
  onOpenChange,
}: ModelSelectorProps): React.ReactElement {
  const classic = useDesignVariant() === "classic";
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(!modelsProp);
  const [internalOpen, setInternalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const models = modelsProp ?? fetchedModels;
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = useCallback(
    (open: boolean) => {
      setInternalOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (modelsProp || !onFetchModels) {
      setIsLoading(false);
      return;
    }
    setFetchedModels([]);
    setIsLoading(true);
    let cancelled = false;
    onFetchModels()
      .then((list) => {
        if (!cancelled) setFetchedModels(list);
      })
      .catch((err) => console.error("Failed to fetch models:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Callers commonly pass an inline fetcher. fetchScope is the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsProp, fetchScope]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = modelButtonRefs.current.filter(
        Boolean,
      ) as HTMLButtonElement[];
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
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setIsOpen]);

  const currentModel = selectedModel || models[0]?.value;
  const currentModelInfo = models.find((m) => m.value === currentModel);
  const showEffort =
    currentModelInfo?.supportsEffort ??
    currentModelInfo?.supportsReasoning ??
    isOpusModel(currentModelInfo);
  const providerLabel = provider ? PROVIDER_LABELS[provider] : "Provider";
  const modelLabel =
    currentModelInfo?.displayName ||
    currentModel ||
    (isLoading ? "Loading…" : "Default model");
  const visibleProviders =
    enabledProviders ?? (Object.keys(PROVIDER_LABELS) as ProviderType[]);

  useEffect(() => {
    if (!isOpen) return;
    const selectedIndex = Math.max(
      0,
      models.findIndex((item) => item.value === currentModel),
    );
    const frame = requestAnimationFrame(() => {
      modelButtonRefs.current[selectedIndex]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [currentModel, isOpen, models]);

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-[300px] flex-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`no-drag flex w-full min-w-0 items-center gap-1.5 px-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${classic ? "h-7 rounded-md border border-[var(--border-mid)] bg-[var(--bg-surface)]" : "h-8 rounded-lg"}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={`${providerLabel}, ${modelLabel}`}
      >
        <span className="flex-shrink-0 font-medium text-[var(--text-primary)]">
          {providerLabel}
        </span>
        <span aria-hidden="true" className="text-[var(--text-faint)]">
          ·
        </span>
        <span className="truncate">{modelLabel}</span>
        {showEffort && (
          <span className="flex-shrink-0 text-[var(--text-muted)]">
            · {thinkingEffort || "high"}
          </span>
        )}
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

      {isOpen && (
        <div
          role="dialog"
          aria-label="Provider and model"
          className="absolute bottom-full left-0 z-50 mb-2 w-[340px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-[var(--border-mid)] bg-[var(--bg-surface)] shadow-2xl"
        >
          {provider && onProviderChange && (
            <div className="border-b border-[var(--border)] p-2.5">
              <div className="mb-1.5 px-1 text-xs font-medium text-[var(--text-muted)]">
                Provider
              </div>
              <div className="flex flex-wrap gap-1">
                {visibleProviders.map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={providerDisabled}
                    onClick={() => onProviderChange(item)}
                    aria-pressed={item === provider}
                    className={`rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                      item === provider
                        ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {PROVIDER_LABELS[item]}
                  </button>
                ))}
              </div>
              {providerDisabled && (
                <p className="mt-2 px-1 text-xs leading-4 text-[var(--text-muted)]">
                  Provider is fixed after the conversation starts.
                </p>
              )}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto p-1.5">
            <div className="px-2 pb-1 pt-1 text-xs font-medium text-[var(--text-muted)]">
              Model
            </div>
            {isLoading ? (
              <div className="px-2 py-3 text-xs text-[var(--text-muted)]">
                Loading models…
              </div>
            ) : models.length === 0 ? (
              <div className="px-2 py-3 text-xs text-[var(--text-muted)]">
                No models available
              </div>
            ) : (
              models.map((model, index) => (
                <button
                  key={model.value}
                  ref={(element) => {
                    modelButtonRefs.current[index] = element;
                  }}
                  type="button"
                  onClick={() => {
                    onModelChange(model.value);
                    setIsOpen(false);
                    triggerRef.current?.focus();
                  }}
                  aria-current={
                    model.value === currentModel ? "true" : undefined
                  }
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    model.value === currentModel
                      ? "bg-[var(--bg-selected)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[var(--text-primary)]">
                      {model.displayName}
                    </span>
                    {model.description && (
                      <span className="mt-0.5 block text-xs leading-4 text-[var(--text-muted)]">
                        {model.description}
                      </span>
                    )}
                  </span>
                  {model.value === currentModel && (
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
              ))
            )}
          </div>

          {showEffort && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2.5">
              <span className="text-xs font-medium text-[var(--text-muted)]">
                Effort
              </span>
              <div className="flex rounded-lg bg-[var(--bg-root)] p-0.5">
                {EFFORT_LEVELS.map((effort) => (
                  <button
                    key={effort.value}
                    type="button"
                    onClick={() => {
                      onThinkingEffortChange(effort.value);
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                    aria-pressed={(thinkingEffort || "high") === effort.value}
                    className={`rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                      (thinkingEffort || "high") === effort.value
                        ? "bg-[var(--bg-selected)] text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {effort.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

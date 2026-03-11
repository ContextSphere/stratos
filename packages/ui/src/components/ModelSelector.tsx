import React, { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../types";

const EFFORT_LEVELS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

interface ModelSelectorProps {
  selectedModel?: string;
  onModelChange: (model: string) => void;
  thinkingEffort?: string;
  onThinkingEffortChange: (effort: string) => void;
  models?: ModelInfo[];
  onFetchModels?: () => Promise<ModelInfo[]>;
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
  selectedModel,
  onModelChange,
  thinkingEffort,
  onThinkingEffortChange,
  models: modelsProp,
  onFetchModels,
  isOpen: controlledIsOpen,
  onOpenChange,
}: ModelSelectorProps): React.ReactElement {
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(!modelsProp);
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  const isOpen = controlledIsOpen ?? internalIsOpen;
  const setIsOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(isOpen) : v;
    setInternalIsOpen(next);
    onOpenChange?.(next);
  };
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const models = modelsProp ?? fetchedModels;

  // Sync controlled open state
  useEffect(() => {
    if (controlledIsOpen !== undefined) {
      setInternalIsOpen(controlledIsOpen);
    }
  }, [controlledIsOpen]);

  useEffect(() => {
    if (modelsProp || !onFetchModels) {
      setIsLoading(false);
      return;
    }
    onFetchModels()
      .then(setFetchedModels)
      .catch((err) => console.error("Failed to fetch models:", err))
      .finally(() => setIsLoading(false));
  }, [modelsProp, onFetchModels]);

  useEffect(() => {
    if (isOpen) {
      const idx = models.findIndex(
        (m) => m.value === (selectedModel || models[0]?.value),
      );
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, models, selectedModel]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % models.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => (i - 1 + models.length) % models.length);
          break;
        case "Enter":
          e.preventDefault();
          onModelChange(models[highlightedIndex].value);
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
  }, [isOpen, models, highlightedIndex, onModelChange]);

  if (isLoading) {
    return <div className="text-xs text-gray-600">Loading models...</div>;
  }

  const currentModel = selectedModel || models[0]?.value;
  const currentModelInfo = models.find((m) => m.value === currentModel);
  const showEffort =
    currentModelInfo?.supportsReasoning ?? isOpusModel(currentModelInfo);

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors cursor-pointer"
          title={currentModelInfo?.description}
        >
          {currentModelInfo?.displayName ?? currentModel}
          <svg
            className="w-3 h-3 opacity-50"
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
          <div className="absolute bottom-full mb-1 left-0 z-50 min-w-48 bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl overflow-hidden">
            {models.map((model, i) => (
              <button
                key={model.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onModelChange(model.value);
                  setIsOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 ${
                  i === highlightedIndex
                    ? "bg-[var(--border)] text-gray-200"
                    : "text-gray-400 hover:bg-[var(--border)]"
                }`}
              >
                <span>{model.displayName}</span>
                {model.description && (
                  <span className="text-gray-600 text-[11px]">
                    {model.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {showEffort && (
        <>
          <span className="text-xs text-gray-600">·</span>
          <select
            value={thinkingEffort || "high"}
            onChange={(e) => onThinkingEffortChange(e.target.value)}
            className="w-auto bg-transparent border-none text-xs text-gray-500 hover:text-gray-400 focus:outline-none focus:text-gray-400 transition-colors cursor-pointer px-0"
            title="Thinking effort level"
          >
            {EFFORT_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label} effort
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

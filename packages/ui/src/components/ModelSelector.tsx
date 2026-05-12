import React, { useEffect, useState } from "react";
import type { ModelInfo } from "../types";
import DropdownPicker from "./shared/DropdownPicker";

const EFFORT_LEVELS = [
  { value: "low", label: "Low effort" },
  { value: "medium", label: "Medium effort" },
  { value: "high", label: "High effort" },
  { value: "max", label: "Max effort" },
];

interface ModelSelectorProps {
  selectedModel?: string;
  onModelChange: (model: string) => void;
  thinkingEffort?: string;
  onThinkingEffortChange: (effort: string) => void;
  models?: ModelInfo[];
  onFetchModels?: () => Promise<ModelInfo[]>;
  /**
   * Identifier (typically the provider name) that scopes the fetched model
   * list. When this value changes, the cached list is cleared and refetched
   * — otherwise the dropdown would show the previous scope's models until
   * the next fetch resolved. Without it, switching providers leaks stale
   * entries into the picker.
   */
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
  selectedModel,
  onModelChange,
  thinkingEffort,
  onThinkingEffortChange,
  models: modelsProp,
  onFetchModels,
  fetchScope,
  isOpen: controlledModelOpen,
  onOpenChange,
}: ModelSelectorProps): React.ReactElement {
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(!modelsProp);
  const [isEffortOpen, setIsEffortOpen] = useState(false);

  const models = modelsProp ?? fetchedModels;

  useEffect(() => {
    if (modelsProp || !onFetchModels) {
      setIsLoading(false);
      return;
    }
    // Drop any previously-fetched list before issuing a new request — otherwise
    // changing scope (e.g. provider switch) would render the old scope's models
    // until the new fetch resolved.
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
    // `onFetchModels` is intentionally NOT in the dep array — callers typically
    // pass an inline arrow, which would refire on every parent render. The
    // `fetchScope` prop is the stable invalidation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsProp, fetchScope]);

  // Mutual exclusion: opening model picker closes effort picker
  useEffect(() => {
    if (controlledModelOpen) setIsEffortOpen(false);
  }, [controlledModelOpen]);

  if (isLoading) {
    return (
      <div className="text-xs text-[var(--text-muted)]">Loading models...</div>
    );
  }

  const currentModel = selectedModel || models[0]?.value;
  const currentModelInfo = models.find((m) => m.value === currentModel);
  const showEffort =
    currentModelInfo?.supportsEffort ??
    currentModelInfo?.supportsReasoning ??
    isOpusModel(currentModelInfo);

  const modelItems = models.map((m) => ({
    value: m.value,
    label: m.displayName,
    description: m.description,
  }));

  return (
    <div className="flex items-center gap-1.5">
      <DropdownPicker
        items={modelItems}
        selectedValue={currentModel ?? ""}
        onSelect={onModelChange}
        isOpen={controlledModelOpen}
        onOpenChange={(open) => {
          onOpenChange?.(open);
          if (open) setIsEffortOpen(false);
        }}
        minWidth="min-w-48"
      />

      {showEffort && (
        <DropdownPicker
          items={EFFORT_LEVELS}
          selectedValue={thinkingEffort || "high"}
          onSelect={onThinkingEffortChange}
          isOpen={isEffortOpen}
          onOpenChange={(open) => {
            setIsEffortOpen(open);
            if (open) onOpenChange?.(false);
          }}
        />
      )}
    </div>
  );
}

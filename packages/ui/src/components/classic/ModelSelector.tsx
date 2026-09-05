import React, { useEffect, useState } from "react";
import type { ModelInfo } from "../../types";
import DropdownPicker from "../shared/DropdownPicker";
import {
  modelSupportsEffort,
  THINKING_EFFORTS,
  useAvailableModels,
} from "../model-selector-state";

const EFFORT_LEVELS = THINKING_EFFORTS.map((value) => ({
  value,
  label: `${value[0].toUpperCase()}${value.slice(1)} effort`,
}));

export interface ModelSelectorProps {
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
  const [isEffortOpen, setIsEffortOpen] = useState(false);
  const { models, isLoading } = useAvailableModels(
    modelsProp,
    onFetchModels,
    fetchScope,
  );

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
  const showEffort = modelSupportsEffort(currentModelInfo);

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
        searchPlaceholder="Search models…"
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

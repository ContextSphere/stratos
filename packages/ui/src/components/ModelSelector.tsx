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
    onFetchModels()
      .then(setFetchedModels)
      .catch((err) => console.error("Failed to fetch models:", err))
      .finally(() => setIsLoading(false));
  }, [modelsProp, onFetchModels]);

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

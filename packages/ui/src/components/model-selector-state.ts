import { useEffect, useState } from "react";
import type { ModelInfo } from "../types";

export const THINKING_EFFORTS = ["low", "medium", "high", "max"] as const;

export function modelSupportsEffort(model: ModelInfo | undefined): boolean {
  if (!model) return false;
  const searchable =
    `${model.value} ${model.displayName} ${model.description}`.toLowerCase();
  return (
    model.supportsEffort ??
    model.supportsReasoning ??
    searchable.includes("opus")
  );
}

export function useAvailableModels(
  suppliedModels: ModelInfo[] | undefined,
  fetchModels: (() => Promise<ModelInfo[]>) | undefined,
  fetchScope: string | undefined,
): { models: ModelInfo[]; isLoading: boolean } {
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(!suppliedModels);

  useEffect(() => {
    if (suppliedModels || !fetchModels) {
      setIsLoading(false);
      return;
    }

    setFetchedModels([]);
    setIsLoading(true);
    let cancelled = false;
    fetchModels()
      .then((models) => {
        if (!cancelled) setFetchedModels(models);
      })
      .catch((error) => console.error("Failed to fetch models:", error))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Callers commonly pass an inline fetcher. fetchScope is the stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliedModels, fetchScope]);

  return {
    models: suppliedModels ?? fetchedModels,
    isLoading,
  };
}

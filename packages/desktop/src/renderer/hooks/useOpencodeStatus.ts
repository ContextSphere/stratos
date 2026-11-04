import { useCallback, useEffect, useState } from "react";
import { getOpencodeProviderDefinition } from "../utils/opencode-providers";

interface OllamaConfigShape {
  baseURL: string;
  models: Record<string, unknown>;
}

interface UseOpencodeStatusReturn {
  configured: boolean;
  providerLabels: string[];
  refresh: () => Promise<void>;
}

function prettyProviderId(id: string): string {
  return getOpencodeProviderDefinition(id)?.label ?? id;
}

export function useOpencodeStatus(): UseOpencodeStatusReturn {
  const [configured, setConfigured] = useState(false);
  const [providerLabels, setProviderLabels] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [keys, ollama] = await Promise.all([
        window.api.opencodeGetProviderStatuses(),
        window.api.ollamaGetConfig() as Promise<OllamaConfigShape | undefined>,
      ]);
      const keyIds = Object.keys(keys ?? {});
      const ollamaModelCount = ollama
        ? Object.keys(ollama.models ?? {}).length
        : 0;
      const labels = keyIds
        .map(prettyProviderId)
        .sort((a, b) => a.localeCompare(b));
      if (ollamaModelCount > 0) {
        labels.push(
          `Ollama (${ollamaModelCount} model${ollamaModelCount === 1 ? "" : "s"})`,
        );
      }
      setProviderLabels(labels);
      setConfigured(labels.length > 0);
    } catch {
      setConfigured(false);
      setProviderLabels([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { configured, providerLabels, refresh };
}

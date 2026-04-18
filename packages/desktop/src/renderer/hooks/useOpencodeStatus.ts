import { useCallback, useEffect, useState } from "react";

interface OllamaConfigShape {
  baseURL: string;
  models: Record<string, unknown>;
}

interface UseOpencodeStatusReturn {
  configured: boolean;
  providerLabels: string[];
  refresh: () => Promise<void>;
}

const FRIENDLY_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google AI",
  groq: "Groq",
  mistral: "Mistral",
};

function prettyProviderId(id: string): string {
  return FRIENDLY_LABELS[id] ?? id;
}

export function useOpencodeStatus(): UseOpencodeStatusReturn {
  const [configured, setConfigured] = useState(false);
  const [providerLabels, setProviderLabels] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [keys, ollama] = await Promise.all([
        window.api.opencodeGetProviderKeys(),
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

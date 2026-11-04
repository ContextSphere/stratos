export interface OpencodeProviderDefinition {
  id: string;
  label: string;
  placeholder: string;
  kind: "api" | "ollama";
  defaultBaseURL?: string;
}

export const OPENCODE_PROVIDER_CATALOG = [
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    kind: "api",
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    kind: "api",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-v1-...",
    kind: "api",
    defaultBaseURL: "https://openrouter.ai/api/v1",
  },
  {
    id: "google",
    label: "Google AI",
    placeholder: "AIza...",
    kind: "api",
  },
  {
    id: "groq",
    label: "Groq",
    placeholder: "gsk_...",
    kind: "api",
  },
  {
    id: "mistral",
    label: "Mistral",
    placeholder: "...",
    kind: "api",
  },
  {
    id: "ollama",
    label: "Ollama",
    placeholder: "",
    kind: "ollama",
  },
] as const satisfies readonly OpencodeProviderDefinition[];

export function getOpencodeProviderDefinition(
  providerId: string,
): OpencodeProviderDefinition | undefined {
  return OPENCODE_PROVIDER_CATALOG.find(
    (provider) => provider.id === providerId,
  );
}

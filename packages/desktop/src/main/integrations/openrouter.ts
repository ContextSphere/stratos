import { getOpencodeProviderDefinition } from "@stratosapp/core";

export function getOpenRouterBaseURL(baseURL?: string): string {
  return (
    baseURL?.trim() ||
    getOpencodeProviderDefinition("openrouter")?.defaultBaseURL ||
    "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");
}

export async function validateOpenRouterCredential(
  apiKey: string,
  baseURL?: string,
): Promise<void> {
  const response = await fetch(`${getOpenRouterBaseURL(baseURL)}/auth/key`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/ContextSphere/stratos",
      "X-Title": "Stratos",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "OpenRouter rejected this API key. Check the key and try again.",
    );
  }
  if (response.status === 429) {
    throw new Error(
      "OpenRouter rate-limited credential validation. Wait briefly and try again.",
    );
  }
  throw new Error(
    `OpenRouter credential validation failed (${response.status}). Try again later.`,
  );
}

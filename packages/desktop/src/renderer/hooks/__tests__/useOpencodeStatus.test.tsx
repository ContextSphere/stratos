// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOpencodeStatus } from "../useOpencodeStatus";

function mockApi(
  statuses: Record<
    string,
    { configured: boolean; keyHint: string; baseURL?: string }
  >,
  ollama: { baseURL: string; models: Record<string, unknown> } | undefined,
) {
  (window as unknown as { api: unknown }).api = {
    opencodeGetProviderStatuses: vi.fn().mockResolvedValue(statuses),
    ollamaGetConfig: vi.fn().mockResolvedValue(ollama),
  };
}

describe("useOpencodeStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports unconfigured when no keys and no Ollama", async () => {
    mockApi({}, undefined);
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(false));
    expect(result.current.providerLabels).toEqual([]);
  });

  it("reports configured with friendly label for an API key", async () => {
    mockApi(
      {
        anthropic: {
          configured: true,
          keyHint: "sk-a…nt-x",
        },
      },
      undefined,
    );
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.providerLabels).toEqual(["Anthropic"]);
  });

  it("includes Ollama (N models) in labels", async () => {
    mockApi(
      {},
      {
        baseURL: "http://localhost:11434",
        models: { "gemma4:26B": {}, "gemma4:latest": {} },
      },
    );
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.providerLabels).toEqual(["Ollama (2 models)"]);
  });

  it("orders API providers alphabetically with Ollama last", async () => {
    mockApi(
      {
        openai: { configured: true, keyHint: "Credential stored securely" },
        anthropic: {
          configured: true,
          keyHint: "Credential stored securely",
        },
        groq: { configured: true, keyHint: "Credential stored securely" },
      },
      {
        baseURL: "http://localhost:11434",
        models: { "a-model": {} },
      },
    );
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.providerLabels).toEqual([
      "Anthropic",
      "Groq",
      "OpenAI",
      "Ollama (1 model)",
    ]);
  });

  it("treats Ollama with 0 models as unconfigured", async () => {
    mockApi({}, { baseURL: "http://localhost:11434", models: {} });
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.providerLabels).toEqual([]));
    expect(result.current.configured).toBe(false);
  });

  it("falls back to raw provider id for unknown providers", async () => {
    mockApi(
      {
        bedrock: {
          configured: true,
          keyHint: "Credential stored securely",
        },
      },
      undefined,
    );
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.providerLabels).toEqual(["bedrock"]);
  });

  it("refresh() re-reads current state", async () => {
    mockApi({}, undefined);
    const { result } = renderHook(() => useOpencodeStatus());
    await waitFor(() => expect(result.current.configured).toBe(false));

    // Flip backing state
    mockApi(
      {
        mistral: {
          configured: true,
          keyHint: "Credential stored securely",
        },
      },
      undefined,
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.configured).toBe(true);
    expect(result.current.providerLabels).toEqual(["Mistral"]);
  });
});

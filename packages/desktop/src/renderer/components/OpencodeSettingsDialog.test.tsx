// @vitest-environment happy-dom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { OpencodeSettingsDialog } from "./OpencodeSettingsDialog";

vi.mock("@stratosapp/ui", async () => {
  const ReactModule = await import("react");
  return {
    Dialog: ({
      isOpen,
      title,
      children,
    }: {
      isOpen: boolean;
      title: string;
      children: React.ReactNode;
    }) =>
      isOpen
        ? ReactModule.createElement(
            "div",
            { role: "dialog" },
            ReactModule.createElement("h2", null, title),
            children,
          )
        : null,
    DialogBody: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      ReactModule.createElement("button", props, children),
  };
});

function installApi(overrides: Record<string, unknown> = {}): {
  opencodeSetProviderKey: ReturnType<typeof vi.fn>;
  opencodeSetEnabledModels: ReturnType<typeof vi.fn>;
} {
  const opencodeSetProviderKey = vi.fn().mockResolvedValue(undefined);
  const opencodeSetEnabledModels = vi.fn().mockResolvedValue(undefined);
  (window as unknown as { api: unknown }).api = {
    opencodeGetProviderStatuses: vi.fn().mockResolvedValue({}),
    opencodeGetEnabledModels: vi.fn().mockResolvedValue({}),
    ollamaGetConfig: vi.fn().mockResolvedValue(undefined),
    opencodeSetProviderKey,
    opencodeSetEnabledModels,
    opencodeListProviderModels: vi.fn().mockResolvedValue([
      {
        value: "openrouter/anthropic/claude-sonnet-4.5",
        displayName: "Claude Sonnet 4.5",
        description: "200k context",
        supportsEffort: true,
        supportsReasoning: true,
      },
    ]),
    ...overrides,
  };
  return { opencodeSetProviderKey, opencodeSetEnabledModels };
}

describe("OpencodeSettingsDialog OpenRouter flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates the key, discovers models, and saves an OpenRouter selection", async () => {
    const { opencodeSetProviderKey, opencodeSetEnabledModels } = installApi();
    render(
      <OpencodeSettingsDialog
        isOpen
        onClose={vi.fn()}
        initialAddProviderId="openrouter"
      />,
    );

    const keyInput = await screen.findByTestId("opencode-api-key");
    fireEvent.change(keyInput, {
      target: { value: "test-openrouter-secret" },
    });
    fireEvent.click(screen.getByTestId("opencode-continue"));

    await waitFor(() =>
      expect(opencodeSetProviderKey).toHaveBeenCalledWith(
        "openrouter",
        "test-openrouter-secret",
        undefined,
      ),
    );
    expect(
      await screen.findByTestId(
        "opencode-model-openrouter-anthropic-claude-sonnet-4.5",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("opencode-save"));
    await waitFor(() =>
      expect(opencodeSetEnabledModels).toHaveBeenCalledWith("openrouter", [
        "openrouter/anthropic/claude-sonnet-4.5",
      ]),
    );
  });

  it("shows credential validation errors without advancing to models", async () => {
    const validationError = new Error(
      "OpenRouter rejected this API key. Check the key and try again.",
    );
    const opencodeSetProviderKey = vi.fn().mockRejectedValue(validationError);
    installApi({ opencodeSetProviderKey });
    render(
      <OpencodeSettingsDialog
        isOpen
        onClose={vi.fn()}
        initialAddProviderId="openrouter"
      />,
    );

    fireEvent.change(await screen.findByTestId("opencode-api-key"), {
      target: { value: "invalid-key" },
    });
    fireEvent.click(screen.getByTestId("opencode-continue"));

    expect(await screen.findByText(validationError.message)).toBeTruthy();
    expect(screen.queryByTestId("opencode-model-list")).toBeNull();
  });

  it("renders only the redacted credential hint for configured OpenRouter", async () => {
    installApi({
      opencodeGetProviderStatuses: vi.fn().mockResolvedValue({
        openrouter: {
          configured: true,
          keyHint: "sk-o…f419",
        },
      }),
      opencodeGetEnabledModels: vi.fn().mockResolvedValue({
        openrouter: ["openrouter/openai/gpt-4.1"],
      }),
    });
    render(<OpencodeSettingsDialog isOpen onClose={vi.fn()} />);

    expect(await screen.findByText("OpenRouter")).toBeTruthy();
    expect(screen.getByText(/sk-o…f419/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("test-openrouter-secret");
  });

  it("sorts models alphabetically and filters them by name or ID", async () => {
    installApi({
      opencodeGetProviderStatuses: vi.fn().mockResolvedValue({
        openrouter: {
          configured: true,
          keyHint: "sk-o…f419",
        },
      }),
      opencodeGetEnabledModels: vi.fn().mockResolvedValue({
        openrouter: ["openrouter/example/zulu"],
      }),
      opencodeListProviderModels: vi.fn().mockResolvedValue([
        {
          value: "openrouter/example/zulu",
          displayName: "Zulu 10",
          description: "128k context",
        },
        {
          value: "openrouter/example/alpha",
          displayName: "Alpha",
          description: "64k context",
        },
        {
          value: "openrouter/example/zulu-2",
          displayName: "Zulu 2",
          description: "256k context",
        },
      ]),
    });
    render(<OpencodeSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText("Manage"));
    const modelList = await screen.findByTestId("opencode-model-list");
    expect(
      within(modelList)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Zulu 2"),
      expect.stringContaining("Zulu 10"),
    ]);

    fireEvent.change(screen.getByTestId("opencode-model-search"), {
      target: { value: "zulu-2" },
    });
    expect(within(modelList).getByText("Zulu 2")).toBeTruthy();
    expect(within(modelList).queryByText("Alpha")).toBeNull();
    expect(within(modelList).queryByText("Zulu 10")).toBeNull();
  });
});

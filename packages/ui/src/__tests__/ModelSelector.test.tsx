import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModelSelector from "../components/ModelSelector";

const models = [
  {
    value: "gpt-5.6-luna",
    displayName: "GPT-5.6-Luna",
    description: "Fast everyday model",
    supportsEffort: true,
  },
  {
    value: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Previous generation",
    supportsEffort: true,
  },
];

describe("ModelSelector", () => {
  afterEach(cleanup);

  it("combines provider, model, and effort in one disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        provider="codex"
        onProviderChange={vi.fn()}
        selectedModel="gpt-5.6-luna"
        onModelChange={vi.fn()}
        thinkingEffort="high"
        onThinkingEffortChange={vi.fn()}
        models={models}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Codex.*GPT-5.6-Luna/i }),
    );
    expect(
      screen.getByRole("dialog", { name: "Provider and model" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Effort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("preserves a selected model label when the provider returns no models", () => {
    render(
      <ModelSelector
        provider="copilot"
        selectedModel="unavailable-model"
        onModelChange={vi.fn()}
        onThinkingEffortChange={vi.fn()}
        models={[]}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /GitHub Copilot.*unavailable-model/i,
      }),
    ).toBeInTheDocument();
  });

  it("locks provider choice while keeping model selection available", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    render(
      <ModelSelector
        provider="codex"
        onProviderChange={vi.fn()}
        providerDisabled
        selectedModel="gpt-5.6-luna"
        onModelChange={onModelChange}
        onThinkingEffortChange={vi.fn()}
        models={models}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Codex.*GPT-5.6-Luna/i }),
    );
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeDisabled();
    expect(
      screen.getByText("Provider is fixed after the conversation starts."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /GPT-5.5/ }));
    expect(onModelChange).toHaveBeenCalledWith("gpt-5.5");
  });

  it("moves through models with arrow keys and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(
      <ModelSelector
        provider="codex"
        selectedModel="gpt-5.6-luna"
        onModelChange={vi.fn()}
        onThinkingEffortChange={vi.fn()}
        models={models}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /Codex.*GPT-5.6-Luna/i,
    });
    await user.click(trigger);
    expect(
      screen.getByRole("button", { name: /GPT-5.6-Luna.*Fast everyday/ }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("button", { name: /GPT-5.5.*Previous generation/ }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});

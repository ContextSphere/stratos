import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RefinedModelSelector from "../components/refined/ModelSelector";
import DropdownPicker from "../components/shared/DropdownPicker";

/**
 * Provider model lists are long and ordered by the CLI, which appends newly
 * released models near the end — `gpt-6-astra` landed 18th of 19. A ~5-row
 * dropdown made it effectively invisible, so both pickers filter as you type.
 */
const manyModels = [
  "claude-opus-4.5",
  "claude-sonnet-4.5",
  "gemini-3-pro",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
].map((value) => ({
  value,
  displayName: value.toUpperCase(),
  description: "1,000,000 ctx",
  supportsEffort: true,
}));

const twoModels = manyModels.slice(0, 2);

const dropdownItems = manyModels.map((model) => ({
  value: model.value,
  label: model.displayName,
}));

describe("refined model picker filtering", () => {
  afterEach(cleanup);

  const renderRefined = (
    models: typeof manyModels,
    onModelChange = vi.fn(),
  ) => {
    render(
      <RefinedModelSelector
        provider="copilot"
        selectedModel={models[0]?.value}
        onModelChange={onModelChange}
        onThinkingEffortChange={vi.fn()}
        models={models}
      />,
    );
    return onModelChange;
  };

  it("filters a long model list down to a typed match", async () => {
    const user = userEvent.setup();
    renderRefined(manyModels);
    await user.click(screen.getByRole("button", { name: /GitHub Copilot/i }));

    expect(screen.getByLabelText("Search models")).toHaveFocus();
    expect(screen.getByRole("button", { name: /GPT-5.5/ })).toBeInTheDocument();

    await user.keyboard("astra");

    expect(
      screen.getByRole("button", { name: /GPT-6-ASTRA/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GPT-5.5/ })).toBeNull();
  });

  it("selects the only remaining match on Enter", async () => {
    const user = userEvent.setup();
    const onModelChange = renderRefined(manyModels);
    await user.click(screen.getByRole("button", { name: /GitHub Copilot/i }));
    await user.keyboard("astra{Enter}");
    expect(onModelChange).toHaveBeenCalledWith("gpt-6-astra");
  });

  it("reports when nothing matches instead of rendering an empty list", async () => {
    const user = userEvent.setup();
    renderRefined(manyModels);
    await user.click(screen.getByRole("button", { name: /GitHub Copilot/i }));
    await user.keyboard("nope");
    expect(screen.getByText(/No models match/)).toBeInTheDocument();
  });

  it("omits the filter box for short lists so focus still lands on the selection", async () => {
    const user = userEvent.setup();
    renderRefined(twoModels);
    await user.click(screen.getByRole("button", { name: /GitHub Copilot/i }));
    expect(screen.queryByLabelText("Search models")).toBeNull();
    // Scoped to the popover: the trigger label repeats the selected model name.
    const popover = screen.getByRole("dialog");
    expect(
      within(popover).getByRole("button", { name: /CLAUDE-OPUS-4.5/ }),
    ).toHaveFocus();
  });
});

describe("DropdownPicker filtering", () => {
  afterEach(cleanup);

  it("matches on the raw value as well as the label", async () => {
    const user = userEvent.setup();
    render(
      <DropdownPicker
        items={dropdownItems}
        selectedValue="gpt-5.5"
        onSelect={vi.fn()}
        searchPlaceholder="Search models…"
      />,
    );
    await user.click(screen.getByRole("button", { name: /GPT-5.5/ }));

    // Lowercase id, while the rendered label is uppercase.
    await user.keyboard("gpt-6-astra");
    expect(
      screen.getByRole("button", { name: /GPT-6-ASTRA/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GEMINI/ })).toBeNull();
  });

  it("shows an empty state and ignores Enter when nothing matches", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownPicker
        items={dropdownItems}
        selectedValue="gpt-5.5"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: /GPT-5.5/ }));
    await user.keyboard("zzz{Enter}");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves short lists unfiltered", async () => {
    const user = userEvent.setup();
    render(
      <DropdownPicker
        items={dropdownItems.slice(0, 4)}
        selectedValue="gpt-5.1"
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /GPT-5.1/ }));
    expect(screen.queryByLabelText("Filter…")).toBeNull();
  });
});

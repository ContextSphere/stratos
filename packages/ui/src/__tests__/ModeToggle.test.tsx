import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModeToggle from "../components/ModeToggle";

describe("ModeToggle", () => {
  const onModeChange = vi.fn();

  afterEach(() => {
    cleanup();
    onModeChange.mockClear();
  });

  it("shows the current provider-specific permission label", () => {
    render(
      <ModeToggle
        provider="codex"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Permissions: Default permissions" }),
    ).toBeInTheDocument();
  });

  it("reveals only the modes supported by the active provider", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="codex"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Permissions: Default permissions" }),
    );
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Full access")).toBeInTheDocument();
    expect(screen.queryByText("Accept Edits")).not.toBeInTheDocument();
    expect(screen.queryByText("Bypass")).not.toBeInTheDocument();
  });

  it("marks and selects the current mode", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="claude-code"
        mode="plan"
        onModeChange={onModeChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Permissions: Plan" }));
    expect(screen.getByRole("menuitemradio", { name: /Plan/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: /Accept Edits/ }),
    );
    expect(onModeChange).toHaveBeenCalledWith("acceptEdits");
  });

  it("keeps destructive modes visually explicit", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="codex"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Permissions: Default permissions" }),
    );
    expect(
      screen.getByRole("menuitemradio", { name: /Full access/ }),
    ).toHaveClass("text-left");
    expect(screen.getByText("Full access")).toHaveClass(
      "text-[var(--text-danger)]",
    );
  });

  it("supports arrow-key navigation and Escape", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Permissions: Default",
    });
    await user.click(trigger);
    expect(
      screen.getByRole("menuitemradio", { name: /Default/ }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("menuitemradio", { name: /Accept Edits/ }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("cannot open or change while disabled", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Permissions: Default",
    });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onModeChange).not.toHaveBeenCalled();
  });
});

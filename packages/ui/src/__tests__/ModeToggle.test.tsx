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

  it("renders Claude mode buttons", () => {
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("Accept Edits")).toBeInTheDocument();
    expect(screen.getByText("Bypass")).toBeInTheDocument();
  });

  it("renders Codex mode buttons", () => {
    render(
      <ModeToggle
        provider="codex"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Default permissions")).toBeInTheDocument();
    expect(screen.getByText("Full access")).toBeInTheDocument();
    expect(screen.queryByText("Accept Edits")).not.toBeInTheDocument();
    expect(screen.queryByText("Bypass")).not.toBeInTheDocument();
  });

  it('defaults to "default" mode when mode is undefined', () => {
    render(
      <ModeToggle
        provider="claude-code"
        mode={undefined}
        onModeChange={onModeChange}
      />,
    );
    const defaultBtn = screen.getByText("Default");
    // Active button gets a bg-blue class
    expect(defaultBtn.className).toContain("bg-blue");
  });

  it("highlights the active mode", () => {
    render(
      <ModeToggle
        provider="claude-code"
        mode="plan"
        onModeChange={onModeChange}
      />,
    );
    const planBtn = screen.getByText("Plan");
    expect(planBtn.className).toContain("bg-amber");
    // Other buttons should not have active styling
    const defaultBtn = screen.getByText("Default");
    expect(defaultBtn.className).not.toContain("bg-blue");
  });

  it("calls onModeChange when a mode button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    await user.click(screen.getByText("Plan"));
    expect(onModeChange).toHaveBeenCalledWith("plan");
  });

  it("disables all buttons when disabled prop is true", () => {
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
        disabled
      />,
    );
    const buttons = screen.getAllByRole("button");
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("does not call onModeChange when disabled", async () => {
    const user = userEvent.setup();
    render(
      <ModeToggle
        provider="claude-code"
        mode="default"
        onModeChange={onModeChange}
        disabled
      />,
    );
    await user.click(screen.getByText("Plan"));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("shows description as title attribute", () => {
    render(
      <ModeToggle
        provider="codex"
        mode="default"
        onModeChange={onModeChange}
      />,
    );
    expect(
      screen.getByTitle("Read-only. Plans without modifying files."),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle(
        "Allows unrestricted file access and network access without permission prompts.",
      ),
    ).toBeInTheDocument();
  });
});

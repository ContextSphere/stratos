import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TurnRail } from "./TurnRail";

describe("TurnRail", () => {
  afterEach(() => cleanup());

  const turns = [
    { id: "a", label: "Session start" },
    { id: "b", label: "Build the bank" },
    { id: "c", label: "Fix the tests" },
  ];

  it("renders nothing with fewer than two turns", () => {
    const { container } = render(
      <TurnRail
        turns={turns.slice(0, 1)}
        activeTurnId="a"
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one marker per turn", () => {
    render(<TurnRail turns={turns} activeTurnId="a" onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Jump to Session start")).toBeInTheDocument();
    expect(screen.getByLabelText("Jump to Build the bank")).toBeInTheDocument();
    expect(screen.getByLabelText("Jump to Fix the tests")).toBeInTheDocument();
  });

  it("opens a labeled turn popover when the rail is hovered", () => {
    render(<TurnRail turns={turns} activeTurnId="b" onSelect={vi.fn()} />);
    fireEvent.mouseEnter(
      screen.getByLabelText("Conversation turn markers").parentElement!,
    );

    expect(
      screen.getByRole("listbox", { name: "Conversation turns" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Session start" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Build the bank" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("keeps complete turn text available in the turn popover", () => {
    const longLabel =
      "Build the Nuro/Commure/Persona research bank with the full source list";
    render(
      <TurnRail
        turns={[turns[0], { id: "long", label: longLabel }]}
        activeTurnId="long"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.mouseEnter(
      screen.getByLabelText("Conversation turn markers").parentElement!,
    );

    expect(screen.getByRole("option", { name: longLabel })).toHaveTextContent(
      longLabel,
    );
  });

  it("calls onSelect with the turn id when a listed turn is clicked", () => {
    const onSelect = vi.fn();
    render(<TurnRail turns={turns} activeTurnId="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Browse conversation turns"));
    fireEvent.click(screen.getByRole("option", { name: "Fix the tests" }));
    expect(onSelect).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("emphasizes the active turn's dash", () => {
    render(<TurnRail turns={turns} activeTurnId="b" onSelect={vi.fn()} />);
    const activeDash = screen
      .getByLabelText("Jump to Build the bank")
      .querySelector("span");
    expect(activeDash?.className).toContain("bg-[var(--text-primary)]");
    const inactiveDash = screen
      .getByLabelText("Jump to Fix the tests")
      .querySelector("span");
    expect(inactiveDash?.className).toContain("bg-[var(--text-muted)]");
  });

  it("closes the list with Escape", () => {
    render(<TurnRail turns={turns} activeTurnId="a" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Browse conversation turns"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

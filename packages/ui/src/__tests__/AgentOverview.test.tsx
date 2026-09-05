import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentDefinition, Thread } from "@stratosapp/core";
import { AgentOverview } from "../components/AgentOverview";

const agent: AgentDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews changes before they ship.",
  icon: "🔎",
  accent: "violet",
  builtIn: false,
  provider: "codex",
  mode: "default",
};

const thread: Thread = {
  id: "thread-1",
  title: "Review the release notes",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("AgentOverview", () => {
  it("uses friendly provider and provider-specific permission labels", () => {
    render(
      <AgentOverview
        agent={agent}
        threads={[]}
        onThreadClick={vi.fn()}
        onCreateThread={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Default permissions").length).toBeGreaterThan(
      0,
    );
  });

  it("shows live thread status from the shared status helper and opens a thread", () => {
    const onThreadClick = vi.fn();
    render(
      <AgentOverview
        agent={agent}
        threads={[thread]}
        runningThreadIds={[thread.id]}
        onThreadClick={onThreadClick}
        onCreateThread={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Working")).toBeInTheDocument();
    fireEvent.click(screen.getByText(thread.title));
    expect(onThreadClick).toHaveBeenCalledWith(thread.id);
  });
});

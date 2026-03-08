import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatInfoBar } from "../components/ChatInfoBar";

describe("ChatInfoBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the info bar with add directory button", () => {
    render(
      <ChatInfoBar
        additionalCwds={[]}
        onAddDirectory={vi.fn()}
        onRemoveDirectory={vi.fn()}
        sessionStats={{
          totalCost: 2.34,
          totalInputTokens: 1000,
          totalOutputTokens: 250,
          contextWindow: 2500,
        }}
        homeDir="/Users/panik"
      />,
    );

    expect(screen.queryByLabelText("Session stats")).not.toBeInTheDocument();
    expect(screen.getByTitle("Add working directory")).toBeInTheDocument();
  });

  it("does not render stats icon when session stats are empty", () => {
    render(
      <ChatInfoBar
        additionalCwds={[]}
        onAddDirectory={vi.fn()}
        onRemoveDirectory={vi.fn()}
        sessionStats={{
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          contextWindow: null,
        }}
        homeDir="/Users/panik"
      />,
    );

    expect(screen.queryByLabelText("Session stats")).not.toBeInTheDocument();
  });
});

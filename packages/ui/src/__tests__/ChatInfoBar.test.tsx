import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatInfoBar } from "../components/ChatInfoBar";

describe("ChatInfoBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stats icon and tooltip content when session stats exist", () => {
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

    expect(screen.getByLabelText("Session stats")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("$2.34")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("1.3k")).toBeInTheDocument();
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

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ContextUsageIndicator } from "../components/ContextUsageIndicator";
import type { ContextUsage } from "../bridges/types";

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
  return {
    categories: [
      { name: "System prompt", tokens: 1500, color: "#888" },
      { name: "Messages", tokens: 3500, color: "#4f8" },
    ],
    totalTokens: 5000,
    maxTokens: 100_000,
    rawMaxTokens: 200_000,
    percentage: 5,
    model: "claude-opus-4-7",
    // SDK reports the threshold in absolute tokens, not as a 0–1 ratio.
    // 92_000 of 100_000 ⇒ 92%.
    autoCompactThreshold: 92_000,
    isAutoCompactEnabled: true,
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    apiUsage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 4800,
      cacheCreationInputTokens: 50,
    },
    ...overrides,
  };
}

describe("ContextUsageIndicator", () => {
  afterEach(cleanup);

  it("renders nothing when usage is null", () => {
    const { container } = render(<ContextUsageIndicator usage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the rounded percentage", () => {
    render(<ContextUsageIndicator usage={makeUsage({ percentage: 37.6 })} />);
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(screen.getByTestId("context-usage-indicator")).toBeInTheDocument();
  });

  it("opens the popover with category breakdown on click", () => {
    render(<ContextUsageIndicator usage={makeUsage()} />);
    fireEvent.click(screen.getByTestId("context-usage-indicator"));
    expect(screen.getByTestId("context-usage-popover")).toBeInTheDocument();
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText(/auto-compact @ 92%/)).toBeInTheDocument();
  });

  it("clamps the displayed percentage to 0..100", () => {
    cleanup();
    render(<ContextUsageIndicator usage={makeUsage({ percentage: 250 })} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    cleanup();
    render(<ContextUsageIndicator usage={makeUsage({ percentage: -10 })} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

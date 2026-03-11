import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatInfoBar } from "../components/ChatInfoBar";

describe("ChatInfoBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the info bar", () => {
    render(
      <ChatInfoBar
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
  });

  it("does not render stats icon when session stats are empty", () => {
    render(
      <ChatInfoBar
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

  it("renders the tools badge when MCP servers exist without session tools", () => {
    render(
      <ChatInfoBar
        sessionStats={{
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          contextWindow: null,
        }}
        mcpServers={[
          {
            name: "github",
            status: "connected",
            tools: ["search_repos"],
          },
        ]}
      />,
    );

    expect(screen.getByTitle("View available tools")).toBeInTheDocument();
    expect(screen.getByText("1 tools")).toBeInTheDocument();
  });
});

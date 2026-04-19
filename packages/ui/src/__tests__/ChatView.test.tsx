import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatView } from "../components/ChatView";

describe("ChatView empty state", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the default Stratos splash when messages are empty", () => {
    render(<ChatView messages={[]} isStreaming={false} />);
    expect(screen.getByText("Stratos")).toBeInTheDocument();
    expect(
      screen.getByText("Type a message to get started"),
    ).toBeInTheDocument();
  });

  it("renders a custom emptyState node when provided", () => {
    render(
      <ChatView
        messages={[]}
        isStreaming={false}
        emptyState={
          <div>
            <h1>Manager</h1>
            <p>Orchestrates your agent sessions.</p>
          </div>
        }
      />,
    );
    expect(screen.getByText("Manager")).toBeInTheDocument();
    expect(
      screen.getByText("Orchestrates your agent sessions."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stratos")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Type a message to get started"),
    ).not.toBeInTheDocument();
  });

  it("does not render any empty state when messages are non-empty", () => {
    render(
      <ChatView
        messages={[
          {
            id: "m1",
            role: "user",
            content: "hello",
            timestamp: Date.now(),
          },
        ]}
        isStreaming={false}
        emptyState={<div>Manager</div>}
      />,
    );
    expect(screen.queryByText("Manager")).not.toBeInTheDocument();
    expect(screen.queryByText("Stratos")).not.toBeInTheDocument();
  });
});

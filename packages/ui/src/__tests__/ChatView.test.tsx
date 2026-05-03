import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ChatView } from "../components/ChatView";
import type { ChatMessage } from "../types";

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

describe("ChatView typing indicator auto-scroll", () => {
  // Lock the JSDOM viewport so the scroll container has a finite client height
  // and the auto-scroll math has something to work with.
  beforeEach(() => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        // Pretend the content overflows the container by 1000px.
        return this.clientHeight + 1000;
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window.HTMLElement.prototype as unknown as Record<string, unknown>)
      .scrollHeight;
  });

  const messages: ChatMessage[] = [
    { id: "m1", role: "user", content: "hello", timestamp: 1 },
    { id: "m2", role: "assistant", content: "hi there", timestamp: 2 },
  ];

  it("scrolls to bottom when isStreaming flips to true even if messages stay the same", () => {
    const { rerender, container } = render(
      <ChatView messages={messages} isStreaming={false} />,
    );
    const scrollEl = container.querySelector(
      ".overflow-y-auto",
    ) as HTMLDivElement;
    expect(scrollEl).toBeTruthy();

    // Reset scrollTop so we can detect the auto-scroll fired.
    scrollEl.scrollTop = 0;

    act(() => {
      rerender(<ChatView messages={messages} isStreaming={true} />);
    });

    // The auto-scroll effect (on isStreaming change) should set scrollTop to
    // scrollHeight, which is mocked to clientHeight + 1000.
    expect(scrollEl.scrollTop).toBe(scrollEl.scrollHeight);
  });

  it("renders the typing indicator while streaming", () => {
    render(<ChatView messages={messages} isStreaming={true} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });
});

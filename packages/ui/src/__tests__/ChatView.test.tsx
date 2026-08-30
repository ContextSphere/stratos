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

  it("reserves a gutter only when the transcript has multiple user turns", () => {
    const { container, rerender } = render(
      <ChatView
        messages={[
          { id: "m1", role: "user", content: "First", timestamp: 1 },
          { id: "m2", role: "assistant", content: "Reply", timestamp: 2 },
          { id: "m3", role: "user", content: "Second", timestamp: 3 },
        ]}
        isStreaming={false}
      />,
    );

    expect(container.querySelector(".overflow-y-auto")).toHaveClass("pl-12");
    expect(
      screen.getByLabelText("Browse conversation turns"),
    ).toBeInTheDocument();

    rerender(
      <ChatView
        messages={[{ id: "m1", role: "user", content: "First", timestamp: 1 }]}
        isStreaming={false}
      />,
    );

    expect(container.querySelector(".overflow-y-auto")).toHaveClass("px-4");
    expect(
      screen.queryByLabelText("Browse conversation turns"),
    ).not.toBeInTheDocument();
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

describe("ChatView message windowing", () => {
  afterEach(() => {
    cleanup();
  });

  const makeMessages = (n: number): ChatMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      timestamp: i,
    }));

  it("renders every message when the transcript is small", () => {
    render(<ChatView messages={makeMessages(10)} isStreaming={false} />);
    expect(screen.getByText("message 0")).toBeInTheDocument();
    expect(screen.getByText("message 9")).toBeInTheDocument();
    expect(
      screen.queryByTitle("Render older messages"),
    ).not.toBeInTheDocument();
  });

  it("renders only the most recent window for a long transcript", () => {
    const { container } = render(
      <ChatView messages={makeMessages(500)} isStreaming={false} />,
    );
    // Oldest messages are not mounted; newest are.
    expect(screen.queryByText("message 0")).not.toBeInTheDocument();
    expect(screen.getByText("message 499")).toBeInTheDocument();
    // Far fewer DOM nodes than the 500 messages supplied.
    const rendered = container.querySelectorAll("[data-message-id]");
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("reveals older messages when the load-earlier control is clicked", () => {
    const { container } = render(
      <ChatView messages={makeMessages(500)} isStreaming={false} />,
    );
    const before = container.querySelectorAll("[data-message-id]").length;

    const btn = screen.getByTitle("Render older messages");
    act(() => {
      btn.click();
    });

    const after = container.querySelectorAll("[data-message-id]").length;
    expect(after).toBeGreaterThan(before);
  });

  it("marks the true last message as streaming, not the last of the window", () => {
    const msgs = makeMessages(500);
    render(<ChatView messages={msgs} isStreaming={true} />);
    // The newest message is rendered and the typing indicator is present,
    // meaning isStreaming was resolved against the real transcript tail.
    expect(screen.getByText("message 499")).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("resets the window when the transcript is replaced (thread switch)", () => {
    const { container, rerender } = render(
      <ChatView messages={makeMessages(500)} isStreaming={false} />,
    );
    act(() => {
      screen.getByTitle("Render older messages").click();
    });
    const expanded = container.querySelectorAll("[data-message-id]").length;

    // Switch to a different transcript (different first message id).
    const other: ChatMessage[] = Array.from({ length: 500 }, (_, i) => ({
      id: `x${i}`,
      role: "user",
      content: `other ${i}`,
      timestamp: i,
    }));
    act(() => {
      rerender(<ChatView messages={other} isStreaming={false} />);
    });

    const afterSwitch = container.querySelectorAll("[data-message-id]").length;
    expect(afterSwitch).toBeLessThan(expanded);
    expect(screen.getByText("other 499")).toBeInTheDocument();
  });
});

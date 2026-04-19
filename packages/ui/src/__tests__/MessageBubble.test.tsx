// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageBubble } from "../components/MessageBubble";
import type { ChatMessage } from "../types";

describe("MessageBubble — task notification", () => {
  afterEach(() => {
    cleanup();
  });

  function makeMessage(overrides?: Partial<ChatMessage>): ChatMessage {
    return {
      id: "m1",
      role: "user",
      content: "",
      timestamp: 0,
      taskNotification: {
        taskId: "t-1",
        toolUseId: "tu-1",
        status: "completed",
        summary: 'Background command "find foo" completed (exit code 0)',
        outputFile: "/tmp/out.log",
      },
      ...overrides,
    };
  }

  it("renders a compact pill instead of a user bubble for task notifications", () => {
    render(<MessageBubble message={makeMessage()} />);

    // The XML tags must NOT be rendered as text
    expect(screen.queryByText(/task-notification/)).not.toBeInTheDocument();
    // The status label and summary ARE rendered
    expect(screen.getByText("Background task done")).toBeInTheDocument();
    expect(
      screen.getByText(/Background command "find foo" completed/),
    ).toBeInTheDocument();
    expect(screen.getByText("/tmp/out.log")).toBeInTheDocument();
  });

  it("shows 'failed' label for failed status", () => {
    render(
      <MessageBubble
        message={makeMessage({
          taskNotification: {
            taskId: "t",
            status: "failed",
            summary: "it broke",
          },
        })}
      />,
    );

    expect(screen.getByText("Background task failed")).toBeInTheDocument();
    expect(screen.getByText("it broke")).toBeInTheDocument();
  });

  it("shows 'stopped' label for stopped status", () => {
    render(
      <MessageBubble
        message={makeMessage({
          taskNotification: {
            taskId: "t",
            status: "stopped",
            summary: "cancelled",
          },
        })}
      />,
    );

    expect(screen.getByText("Background task stopped")).toBeInTheDocument();
  });

  it("omits the output-file row when not provided", () => {
    render(
      <MessageBubble
        message={makeMessage({
          taskNotification: {
            taskId: "t",
            status: "completed",
            summary: "done",
          },
        })}
      />,
    );

    expect(screen.queryByText("/tmp/out.log")).not.toBeInTheDocument();
  });
});

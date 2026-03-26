import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryOperationCard } from "../components/MemoryOperationCard";
import type { ToolCall } from "../types";

function makeToolCall(overrides: Partial<ToolCall>): ToolCall {
  return {
    toolCallId: "tc-1",
    toolName: "Write",
    input: {},
    status: "completed",
    ...overrides,
  };
}

describe("MemoryOperationCard", () => {
  afterEach(() => cleanup());

  it('shows "Wrote to memory" for Write tool', () => {
    const tc = makeToolCall({
      toolName: "Write",
      input: {
        file_path:
          "/Users/ajay/.claude/projects/-Users-ajay-stratos/memory/user_role.md",
      },
    });
    render(<MemoryOperationCard toolCall={tc} />);
    expect(screen.getByText("Wrote to memory")).toBeInTheDocument();
  });

  it('shows "Read from memory" for Read tool', () => {
    const tc = makeToolCall({
      toolName: "Read",
      input: {
        file_path:
          "/Users/ajay/.claude/projects/-Users-ajay-stratos/memory/MEMORY.md",
      },
    });
    render(<MemoryOperationCard toolCall={tc} />);
    expect(screen.getByText("Read from memory")).toBeInTheDocument();
  });

  it('shows "Updated memory" for Edit tool', () => {
    const tc = makeToolCall({
      toolName: "Edit",
      input: {
        file_path:
          "/Users/ajay/.claude/projects/-Users-ajay-stratos/memory/feedback.md",
      },
    });
    render(<MemoryOperationCard toolCall={tc} />);
    expect(screen.getByText("Updated memory")).toBeInTheDocument();
  });

  it("shows the memory filename", () => {
    const tc = makeToolCall({
      toolName: "Write",
      input: {
        file_path:
          "/Users/ajay/.claude/projects/-Users-ajay-stratos/memory/user_role.md",
      },
    });
    render(<MemoryOperationCard toolCall={tc} />);
    expect(screen.getByText("user_role.md")).toBeInTheDocument();
  });

  it("shows status label", () => {
    const tc = makeToolCall({ status: "running" });
    render(<MemoryOperationCard toolCall={tc} />);
    expect(screen.getByText("Running...")).toBeInTheDocument();
  });
});

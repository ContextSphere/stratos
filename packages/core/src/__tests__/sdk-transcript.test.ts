import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
}));

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { sdkMessagesToStored } from "../storage/sdk-transcript";

const mockGetSessionMessages = vi.mocked(getSessionMessages);

function makeAssistantMsg(uuid: string, toolName: string, input: unknown) {
  return {
    type: "assistant" as const,
    uuid,
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: `tool_${uuid}`, name: toolName, input },
      ],
    },
  };
}

describe("sdkMessagesToStored — TodoWrite handling", () => {
  beforeEach(() => {
    mockGetSessionMessages.mockReset();
  });

  it("wraps todos array into { todos } when TodoWrite input is { todos: [...] }", async () => {
    const todos = [
      { id: "1", content: "Write tests", status: "pending", priority: "high" },
      { id: "2", content: "Fix bug", status: "completed", priority: "low" },
    ];
    mockGetSessionMessages.mockResolvedValue([
      makeAssistantMsg("msg1", "TodoWrite", { todos }),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].todoData).toEqual({ todos });
  });

  it("todoData.todos is always an array, never set to the raw array directly", async () => {
    const todos = [
      { id: "1", content: "Task", status: "in_progress", priority: "medium" },
    ];
    mockGetSessionMessages.mockResolvedValue([
      makeAssistantMsg("msg1", "TodoWrite", { todos }),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    const todoData = result[0].todoData as { todos: unknown[] };
    expect(Array.isArray(todoData)).toBe(false);
    expect(Array.isArray(todoData?.todos)).toBe(true);
  });

  it("falls back to raw input when todos property is missing", async () => {
    // Unusual input shape — no todos key
    const input = { items: ["a", "b"] };
    mockGetSessionMessages.mockResolvedValue([
      makeAssistantMsg("msg1", "TodoWrite", input),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result[0].todoData).toEqual(input);
  });
});

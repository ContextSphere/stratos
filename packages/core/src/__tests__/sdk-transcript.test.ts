import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
}));

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import {
  parseTaskNotification,
  sdkMessagesToStored,
} from "../storage/sdk-transcript";

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

describe("sdkMessagesToStored — user message content shapes", () => {
  beforeEach(() => {
    mockGetSessionMessages.mockReset();
  });

  it("preserves user messages where content is a plain string (Claude's default shape)", async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "hello world" },
      },
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("hello world");
  });

  it("preserves user messages where content is an array of text blocks", async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "user",
        uuid: "u1",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello world" }],
        },
      },
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello world");
  });
});

describe("parseTaskNotification", () => {
  it("parses a well-formed task notification XML blob", () => {
    const xml =
      "<task-notification>" +
      "<task-id>abc123</task-id>" +
      "<tool-use-id>toolu_01</tool-use-id>" +
      "<output-file>/tmp/out.txt</output-file>" +
      "<status>completed</status>" +
      '<summary>Background command "find foo" completed (exit code 0)</summary>' +
      "</task-notification>";
    expect(parseTaskNotification(xml)).toEqual({
      taskId: "abc123",
      toolUseId: "toolu_01",
      outputFile: "/tmp/out.txt",
      status: "completed",
      summary: 'Background command "find foo" completed (exit code 0)',
    });
  });

  it("returns null for non-task-notification text", () => {
    expect(parseTaskNotification("hello world")).toBeNull();
  });

  it("maps failed and stopped statuses", () => {
    const make = (status: string) =>
      `<task-notification><task-id>t</task-id><status>${status}</status><summary>s</summary></task-notification>`;
    expect(parseTaskNotification(make("failed"))?.status).toBe("failed");
    expect(parseTaskNotification(make("stopped"))?.status).toBe("stopped");
    expect(parseTaskNotification(make("completed"))?.status).toBe("completed");
  });
});

describe("sdkMessagesToStored — task-notification user messages", () => {
  beforeEach(() => {
    mockGetSessionMessages.mockReset();
  });

  it("extracts taskNotification and strips raw XML from content when origin is task-notification", async () => {
    const xml =
      "<task-notification>" +
      "<task-id>t-1</task-id>" +
      "<tool-use-id>tu-1</tool-use-id>" +
      "<output-file>/tmp/out.log</output-file>" +
      "<status>completed</status>" +
      "<summary>Background command completed (exit code 0)</summary>" +
      "</task-notification>";
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "user",
        uuid: "u1",
        origin: { kind: "task-notification" },
        message: { role: "user", content: xml },
      },
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("");
    expect(result[0].taskNotification).toEqual({
      taskId: "t-1",
      toolUseId: "tu-1",
      outputFile: "/tmp/out.log",
      status: "completed",
      summary: "Background command completed (exit code 0)",
    });
  });

  it("also recognizes task-notification when origin is missing but XML is present", async () => {
    const xml =
      "<task-notification>" +
      "<task-id>t-2</task-id>" +
      "<status>failed</status>" +
      "<summary>boom</summary>" +
      "</task-notification>";
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "user",
        uuid: "u1",
        message: { role: "user", content: xml },
      },
    ]);

    const result = await sdkMessagesToStored("session-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].taskNotification?.taskId).toBe("t-2");
    expect(result[0].taskNotification?.status).toBe("failed");
    expect(result[0].content).toBe("");
  });
});

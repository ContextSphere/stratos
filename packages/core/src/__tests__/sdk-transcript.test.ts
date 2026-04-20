import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
}));

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import {
  parseSessionCompleteNotification,
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

describe("parseSessionCompleteNotification", () => {
  it("parses the first-line directive prefix", () => {
    const text =
      '[stratos-notification] session="abc123" title="My Session" provider="codex" status="completed"\n\n' +
      'Session "My Session" finished successfully.';
    expect(parseSessionCompleteNotification(text)).toEqual({
      threadId: "abc123",
      title: "My Session",
      provider: "codex",
      status: "completed",
    });
  });

  it("returns null for text without the prefix", () => {
    expect(
      parseSessionCompleteNotification("just a normal message"),
    ).toBeNull();
    expect(parseSessionCompleteNotification("")).toBeNull();
  });

  it("maps error and interrupted statuses; defaults other values to completed", () => {
    const make = (status: string) =>
      `[stratos-notification] session="t" title="T" provider="claude-code" status="${status}"`;
    expect(parseSessionCompleteNotification(make("error"))?.status).toBe(
      "error",
    );
    expect(parseSessionCompleteNotification(make("interrupted"))?.status).toBe(
      "interrupted",
    );
    expect(parseSessionCompleteNotification(make("completed"))?.status).toBe(
      "completed",
    );
    // Unknown status falls back to "completed"
    expect(parseSessionCompleteNotification(make("whatever"))?.status).toBe(
      "completed",
    );
  });

  it("falls back to threadId for title when title is missing", () => {
    const text =
      '[stratos-notification] session="abc" provider="claude-code" status="completed"';
    expect(parseSessionCompleteNotification(text)?.title).toBe("abc");
  });

  it("returns null when session id is missing", () => {
    const text = '[stratos-notification] title="foo" status="completed"';
    expect(parseSessionCompleteNotification(text)).toBeNull();
  });
});

describe("parseTaskNotification — Monitor event variant", () => {
  it("parses a Monitor intermediate event with <event> tag (no <status>)", () => {
    const xml =
      "<task-notification>" +
      "<task-id>b1zqvxcn4</task-id>" +
      '<summary>Monitor event: "wait for transcript load"</summary>' +
      "<event>ok</event>" +
      "</task-notification>";
    const result = parseTaskNotification(xml);
    expect(result).not.toBeNull();
    expect(result?.taskId).toBe("b1zqvxcn4");
    expect(result?.status).toBe("event");
    expect(result?.event).toBe("ok");
    expect(result?.summary).toBe('Monitor event: "wait for transcript load"');
  });

  it("parses a Monitor event with multiline event content", () => {
    const xml =
      "<task-notification>" +
      "<task-id>abc</task-id>" +
      "<summary>Monitor event</summary>" +
      "<event>line1\nline2</event>" +
      "</task-notification>";
    const result = parseTaskNotification(xml);
    expect(result?.status).toBe("event");
    expect(result?.event).toBe("line1\nline2");
  });

  it("returns null when neither <status> nor <event> is present", () => {
    const xml =
      "<task-notification>" +
      "<task-id>x</task-id>" +
      "<summary>something</summary>" +
      "</task-notification>";
    expect(parseTaskNotification(xml)).toBeNull();
  });

  it("prefers <status> over <event> when both are present", () => {
    const xml =
      "<task-notification>" +
      "<task-id>x</task-id>" +
      "<summary>done</summary>" +
      "<status>completed</status>" +
      "<event>ok</event>" +
      "</task-notification>";
    const result = parseTaskNotification(xml);
    expect(result?.status).toBe("completed");
    expect(result?.event).toBeUndefined();
  });

  it("returns null when taskId is missing even with event", () => {
    const xml =
      "<task-notification>" +
      "<summary>Monitor event</summary>" +
      "<event>ok</event>" +
      "</task-notification>";
    expect(parseTaskNotification(xml)).toBeNull();
  });

  it("returns null when summary is missing even with event", () => {
    const xml =
      "<task-notification>" +
      "<task-id>x</task-id>" +
      "<event>ok</event>" +
      "</task-notification>";
    expect(parseTaskNotification(xml)).toBeNull();
  });

  it("emits empty string event when <event> tag is empty", () => {
    const xml =
      "<task-notification>" +
      "<task-id>x</task-id>" +
      "<summary>Monitor event</summary>" +
      "<event></event>" +
      "</task-notification>";
    const result = parseTaskNotification(xml);
    expect(result?.status).toBe("event");
    expect(result?.event).toBe("");
  });
});

describe("sdkMessagesToStored — Monitor tool call and event folding", () => {
  beforeEach(() => {
    mockGetSessionMessages.mockReset();
  });

  function makeMonitorToolResult(
    toolId: string,
    taskId: string,
    timeoutMs = 10000,
  ) {
    return {
      type: "user" as const,
      uuid: `result_${toolId}`,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolId,
            content: `Monitor started (task ${taskId}, timeout ${timeoutMs}ms). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`,
          },
        ],
      },
    };
  }

  function makeMonitorEvent(taskId: string, eventLine: string) {
    return {
      type: "user" as const,
      uuid: `event_${taskId}_${eventLine}`,
      origin: { kind: "task-notification" },
      message: {
        role: "user",
        content:
          "<task-notification>" +
          `<task-id>${taskId}</task-id>` +
          `<summary>Monitor event: "test"</summary>` +
          `<event>${eventLine}</event>` +
          "</task-notification>",
      },
    };
  }

  function makeMonitorFinalStatus(taskId: string, status: string) {
    return {
      type: "user" as const,
      uuid: `final_${taskId}`,
      origin: { kind: "task-notification" },
      message: {
        role: "user",
        content:
          "<task-notification>" +
          `<task-id>${taskId}</task-id>` +
          `<status>${status}</status>` +
          "<summary>Monitor finished</summary>" +
          "</task-notification>",
      },
    };
  }

  it("folds Monitor events into the originating tool call", async () => {
    mockGetSessionMessages.mockResolvedValue([
      // Assistant uses Monitor
      {
        type: "assistant" as const,
        uuid: "asst1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_monitor1",
              name: "Monitor",
              input: { command: "sleep 4; echo ok", description: "wait" },
            },
          ],
        },
      },
      // Tool result contains the task-id
      makeMonitorToolResult("toolu_monitor1", "b1zqvxcn4"),
      // Monitor events
      makeMonitorEvent("b1zqvxcn4", "ok"),
      makeMonitorEvent("b1zqvxcn4", "done"),
      // Final status
      makeMonitorFinalStatus("b1zqvxcn4", "completed"),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);

    // Should produce exactly 1 assistant message + 1 final notification
    // (events are folded into the tool call, not standalone messages)
    const assistantMsg = result.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();

    const monitorToolCall = assistantMsg?.toolCalls?.find(
      (tc) => tc.toolName === "Monitor",
    );
    expect(monitorToolCall).toBeDefined();
    expect(monitorToolCall?.monitorTaskId).toBe("b1zqvxcn4");
    expect(monitorToolCall?.monitorEvents).toEqual(["ok", "done"]);

    // Final status produces a standalone pill (since monitor is completed)
    const finalNotif = result.find((m) => m.taskNotification);
    expect(finalNotif?.taskNotification?.status).toBe("completed");

    // No raw XML user messages should exist
    const rawXmlMessages = result.filter((m) =>
      m.content.includes("<task-notification>"),
    );
    expect(rawXmlMessages).toHaveLength(0);
  });

  it("handles multiple Monitor tool calls in the same session", async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "assistant" as const,
        uuid: "asst1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_m1",
              name: "Monitor",
              input: { command: "echo a", description: "first" },
            },
          ],
        },
      },
      makeMonitorToolResult("toolu_m1", "task_aaa"),
      makeMonitorEvent("task_aaa", "line_a1"),
      makeMonitorFinalStatus("task_aaa", "completed"),
      {
        type: "assistant" as const,
        uuid: "asst2",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_m2",
              name: "Monitor",
              input: { command: "echo b", description: "second" },
            },
          ],
        },
      },
      makeMonitorToolResult("toolu_m2", "task_bbb"),
      makeMonitorEvent("task_bbb", "line_b1"),
      makeMonitorEvent("task_bbb", "line_b2"),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);

    const assistantMsgs = result.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(2);

    const tc1 = assistantMsgs[0].toolCalls?.find(
      (tc) => tc.toolName === "Monitor",
    );
    expect(tc1?.monitorTaskId).toBe("task_aaa");
    expect(tc1?.monitorEvents).toEqual(["line_a1"]);

    const tc2 = assistantMsgs[1].toolCalls?.find(
      (tc) => tc.toolName === "Monitor",
    );
    expect(tc2?.monitorTaskId).toBe("task_bbb");
    expect(tc2?.monitorEvents).toEqual(["line_b1", "line_b2"]);
  });

  it("renders orphaned Monitor events as standalone pills (no matching tool call)", async () => {
    const orphanEvent = makeMonitorEvent("unknown_task", "some output");
    mockGetSessionMessages.mockResolvedValue([orphanEvent]);

    const result = await sdkMessagesToStored("session-1", 0);

    // No assistant message, but the orphan event becomes a standalone pill
    const notif = result.find((m) => m.taskNotification);
    expect(notif).toBeDefined();
    expect(notif?.taskNotification?.status).toBe("event");
  });

  it("does not fold events if tool result has no task-id pattern", async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: "assistant" as const,
        uuid: "asst1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_noid",
              name: "Monitor",
              input: { command: "echo hi", description: "test" },
            },
          ],
        },
      },
      // Tool result with no task-id in output
      {
        type: "user" as const,
        uuid: "result_noid",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_noid",
              content: "started",
            },
          ],
        },
      },
      makeMonitorEvent("some_task", "hello"),
    ]);

    const result = await sdkMessagesToStored("session-1", 0);

    // Event becomes orphaned pill since no task-id mapping was established
    const notif = result.find((m) => m.taskNotification);
    expect(notif?.taskNotification?.status).toBe("event");
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

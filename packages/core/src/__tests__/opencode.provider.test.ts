import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OpencodeProvider,
  normalizeOpencodeToolName,
  normalizeFileToolInput,
  transformToolPart,
  type OpencodeToolPart,
} from "../providers/opencode.provider";
import type { AgentMessage } from "../providers/types";

// Minimal fixture builder for a tool part.
function toolPart(
  tool: string,
  callID: string,
  state: OpencodeToolPart["state"],
): OpencodeToolPart {
  return {
    id: `prt_${callID}`,
    type: "tool",
    tool,
    callID,
    state,
    sessionID: "ses_test",
    messageID: "msg_test",
  };
}

function collect<T>(gen: Generator<T>): T[] {
  const out: T[] = [];
  for (const msg of gen) out.push(msg);
  return out;
}

describe("normalizeOpencodeToolName", () => {
  it("maps file-tool names to Title-Case", () => {
    expect(normalizeOpencodeToolName("bash")).toBe("Bash");
    expect(normalizeOpencodeToolName("read")).toBe("Read");
    expect(normalizeOpencodeToolName("write")).toBe("Write");
    expect(normalizeOpencodeToolName("edit")).toBe("Edit");
    expect(normalizeOpencodeToolName("glob")).toBe("Glob");
    expect(normalizeOpencodeToolName("grep")).toBe("Grep");
    expect(normalizeOpencodeToolName("ls")).toBe("LS");
    expect(normalizeOpencodeToolName("webfetch")).toBe("WebFetch");
    expect(normalizeOpencodeToolName("websearch")).toBe("WebSearch");
  });

  it("passes through names that would collide with UI filters", () => {
    expect(normalizeOpencodeToolName("task")).toBe("task");
    expect(normalizeOpencodeToolName("todowrite")).toBe("todowrite");
    expect(normalizeOpencodeToolName("multiedit")).toBe("multiedit");
    expect(normalizeOpencodeToolName("plan")).toBe("plan");
    expect(normalizeOpencodeToolName("todo")).toBe("todo");
    expect(normalizeOpencodeToolName("lsp")).toBe("lsp");
  });

  it("passes through unknown tool names unchanged", () => {
    expect(normalizeOpencodeToolName("custom_mcp_tool")).toBe(
      "custom_mcp_tool",
    );
  });
});

describe("normalizeFileToolInput", () => {
  it("aliases filePath → file_path for Edit/Write/Read/Delete", () => {
    expect(normalizeFileToolInput("Edit", { filePath: "/a.ts" })).toMatchObject(
      { file_path: "/a.ts", filePath: "/a.ts" },
    );
    expect(
      normalizeFileToolInput("Write", { filePath: "/b.ts" }),
    ).toMatchObject({ file_path: "/b.ts" });
    expect(normalizeFileToolInput("Read", { path: "/c.ts" })).toMatchObject({
      file_path: "/c.ts",
    });
    expect(
      normalizeFileToolInput("Delete", { filePath: "/d.ts" }),
    ).toMatchObject({ file_path: "/d.ts" });
  });

  it("aliases oldString/newString → old_string/new_string for Edit", () => {
    const out = normalizeFileToolInput("Edit", {
      filePath: "/x.ts",
      oldString: "foo",
      newString: "bar",
    });
    expect(out).toMatchObject({
      file_path: "/x.ts",
      old_string: "foo",
      new_string: "bar",
      oldString: "foo",
      newString: "bar",
    });
  });

  it("aliases text → content for Write (defensive)", () => {
    expect(
      normalizeFileToolInput("Write", { filePath: "/a.ts", text: "hello" }),
    ).toMatchObject({ content: "hello", text: "hello" });
  });

  it("prefers existing canonical keys over aliases", () => {
    const out = normalizeFileToolInput("Edit", {
      file_path: "/canon.ts",
      filePath: "/alias.ts",
      old_string: "CANON",
      oldString: "ALIAS",
    });
    expect(out.file_path).toBe("/canon.ts");
    expect(out.old_string).toBe("CANON");
  });

  it("returns input unchanged for non-file tools", () => {
    const input = { command: "ls -la", description: "list" };
    expect(normalizeFileToolInput("Bash", input)).toBe(input);
    expect(normalizeFileToolInput("WebSearch", { query: "x" })).toEqual({
      query: "x",
    });
  });
});

describe("transformToolPart", () => {
  it("yields nothing for pending status", () => {
    const emitted = new Set<string>();
    const out = collect(
      transformToolPart(
        toolPart("bash", "call_1", { status: "pending", input: {} }),
        emitted,
      ),
    );
    expect(out).toEqual([]);
    expect(emitted.size).toBe(0);
  });

  it("yields tool_use on running, then tool_result on completion", () => {
    const emitted = new Set<string>();
    const running = collect(
      transformToolPart(
        toolPart("bash", "call_1", {
          status: "running",
          input: { command: "ls" },
        }),
        emitted,
      ),
    );
    expect(running).toEqual([
      {
        type: "tool_use",
        toolName: "Bash",
        toolCallId: "call_1",
        input: { command: "ls" },
      },
    ]);

    const completed = collect(
      transformToolPart(
        toolPart("bash", "call_1", {
          status: "completed",
          input: { command: "ls" },
          output: "a\nb\n",
        }),
        emitted,
      ),
    );
    expect(completed).toEqual([
      { type: "tool_result", toolCallId: "call_1", output: "a\nb\n" },
    ]);
  });

  it("dedups tool_use across multiple running frames", () => {
    const emitted = new Set<string>();
    // Simulate 3 running frames with gradually populated output metadata.
    const frames = [
      { status: "running" as const, input: { command: "ls" } },
      { status: "running" as const, input: { command: "ls" }, output: "a" },
      { status: "running" as const, input: { command: "ls" }, output: "a\nb" },
    ];
    const msgs: AgentMessage[] = [];
    for (const state of frames) {
      msgs.push(
        ...collect(
          transformToolPart(toolPart("bash", "call_1", state), emitted),
        ),
      );
    }
    expect(msgs.filter((m) => m.type === "tool_use")).toHaveLength(1);
  });

  it("emits tool_use + tool_result when pending transitions directly to completed", () => {
    const emitted = new Set<string>();
    collect(
      transformToolPart(
        toolPart("read", "call_2", { status: "pending", input: {} }),
        emitted,
      ),
    );
    const out = collect(
      transformToolPart(
        toolPart("read", "call_2", {
          status: "completed",
          input: { filePath: "/a.ts" },
          output: "file contents",
        }),
        emitted,
      ),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "tool_use",
      toolName: "Read",
      toolCallId: "call_2",
    });
    // file_path alias should be materialized for Read
    expect(
      (out[0] as Extract<AgentMessage, { type: "tool_use" }>).input,
    ).toMatchObject({
      file_path: "/a.ts",
      filePath: "/a.ts",
    });
    expect(out[1]).toEqual({
      type: "tool_result",
      toolCallId: "call_2",
      output: "file contents",
    });
  });

  it("emits Error-prefixed tool_result on error status", () => {
    const emitted = new Set<string>();
    const out = collect(
      transformToolPart(
        toolPart("bash", "call_3", {
          status: "error",
          input: { command: "false" },
          error: "exit 1",
        }),
        emitted,
      ),
    );
    expect(out).toEqual([
      {
        type: "tool_use",
        toolName: "Bash",
        toolCallId: "call_3",
        input: { command: "false" },
      },
      { type: "tool_result", toolCallId: "call_3", output: "Error: exit 1" },
    ]);
  });

  it("falls back to 'Unknown error' when error field is missing", () => {
    const emitted = new Set<string>();
    const out = collect(
      transformToolPart(
        toolPart("bash", "call_4", { status: "error", input: {} }),
        emitted,
      ),
    );
    expect(out[1]).toEqual({
      type: "tool_result",
      toolCallId: "call_4",
      output: "Error: Unknown error",
    });
  });

  it("preserves lowercase names for task/todowrite/multiedit", () => {
    const emitted = new Set<string>();
    for (const name of ["task", "todowrite", "multiedit"]) {
      emitted.clear();
      const out = collect(
        transformToolPart(
          toolPart(name, `call_${name}`, {
            status: "running",
            input: { x: 1 },
          }),
          emitted,
        ),
      );
      expect(out[0]).toMatchObject({
        type: "tool_use",
        toolName: name,
      });
    }
  });
});

// ─── End-to-end sendMessage SSE test ────────────────────────────────────────

function makeSseStream(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
}

describe("OpencodeProvider sendMessage SSE integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function drain(
    gen: AsyncGenerator<AgentMessage>,
  ): Promise<AgentMessage[]> {
    const out: AgentMessage[] = [];
    for await (const msg of gen) out.push(msg);
    return out;
  }

  function setupProvider(sseEvents: object[]): OpencodeProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new OpencodeProvider() as any;
    provider.config = { cwd: "/tmp" };
    provider.baseUrl = "http://127.0.0.1:8765";
    provider.port = 8765;
    provider.healthCheck = vi.fn().mockResolvedValue(true);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (input: any) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.endsWith("/session") && !url.includes("/session/")) {
          return new Response(JSON.stringify({ id: "ses_test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.endsWith("/event")) {
          return new Response(makeSseStream(sseEvents), { status: 200 });
        }
        if (url.includes("/session/ses_test/message")) {
          return new Response("{}", { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
    void fetchSpy;

    return provider;
  }

  it("full lifecycle: emits tool_use once and tool_result once for pending→running→running→completed", async () => {
    const sessionID = "ses_test";
    const events = [
      // Tool part created (pending)
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_tool",
            messageID: "msg_1",
            sessionID,
            type: "tool",
            tool: "bash",
            callID: "call_fn_1",
            state: { status: "pending", input: {}, raw: "" },
          },
        },
      },
      // Running with input populated
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_tool",
            messageID: "msg_1",
            sessionID,
            type: "tool",
            tool: "bash",
            callID: "call_fn_1",
            state: {
              status: "running",
              input: { command: "ls -la /tmp" },
              time: { start: 1 },
            },
          },
        },
      },
      // Running with partial output metadata
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_tool",
            messageID: "msg_1",
            sessionID,
            type: "tool",
            tool: "bash",
            callID: "call_fn_1",
            state: {
              status: "running",
              input: { command: "ls -la /tmp" },
              metadata: { output: "partial" },
              time: { start: 1 },
            },
          },
        },
      },
      // Completed
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_tool",
            messageID: "msg_1",
            sessionID,
            type: "tool",
            tool: "bash",
            callID: "call_fn_1",
            state: {
              status: "completed",
              input: { command: "ls -la /tmp" },
              output: "final output\n",
              time: { start: 1, end: 2 },
            },
          },
        },
      },
      {
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    ];

    const provider = setupProvider(events);
    const messages = await drain(
      provider.sendMessage({
        prompt: "list tmp",
        permissionHandler: async () => ({ approved: true }),
      }),
    );

    const toolUses = messages.filter((m) => m.type === "tool_use");
    const toolResults = messages.filter((m) => m.type === "tool_result");
    expect(toolUses).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      type: "tool_use",
      toolName: "Bash",
      toolCallId: "call_fn_1",
      input: { command: "ls -la /tmp" },
    });
    expect(toolResults[0]).toEqual({
      type: "tool_result",
      toolCallId: "call_fn_1",
      output: "final output\n",
    });
  });

  it("regression: text delta streaming still yields streaming text", async () => {
    const sessionID = "ses_test";
    const events = [
      // Text part created (no time.end)
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_text",
            messageID: "msg_1",
            sessionID,
            type: "text",
            text: "",
          },
        },
      },
      // Delta
      {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: "msg_1",
          partID: "prt_text",
          field: "text",
          delta: "Hello",
        },
      },
      {
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    ];

    const provider = setupProvider(events);
    const messages = await drain(
      provider.sendMessage({
        prompt: "hi",
        permissionHandler: async () => ({ approved: true }),
      }),
    );

    const text = messages.filter((m) => m.type === "text");
    expect(text).toHaveLength(1);
    expect(text[0]).toEqual({
      type: "text",
      content: "Hello",
      isStreaming: true,
    });
  });

  it("regression: reasoning delta maps to thinking", async () => {
    const sessionID = "ses_test";
    const events = [
      {
        type: "message.part.updated",
        properties: {
          sessionID,
          part: {
            id: "prt_r",
            messageID: "msg_1",
            sessionID,
            type: "reasoning",
            text: "",
          },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: "msg_1",
          partID: "prt_r",
          field: "text",
          delta: "thinking...",
        },
      },
      {
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    ];

    const provider = setupProvider(events);
    const messages = await drain(
      provider.sendMessage({
        prompt: "hi",
        permissionHandler: async () => ({ approved: true }),
      }),
    );

    const thinking = messages.filter((m) => m.type === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toEqual({
      type: "thinking",
      content: "thinking...",
      isStreaming: true,
    });
  });
});

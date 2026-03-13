import { describe, it, expect, vi, beforeEach } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

function makeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
}

const autoApprove = vi.fn().mockResolvedValue({ approved: true });

async function collectMessages(
  provider: import("../providers/claude-code.provider").ClaudeCodeProvider,
  prompt = "hello",
) {
  const messages: import("../providers/types").AgentMessage[] = [];
  for await (const msg of provider.sendMessage({
    prompt,
    permissionHandler: autoApprove,
  })) {
    messages.push(msg);
  }
  return messages;
}

describe("ClaudeCodeProvider integration (fake SDK)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ClaudeCodeProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../providers/claude-code.provider");
    ClaudeCodeProvider = mod.ClaudeCodeProvider;
  });

  it("emits session_init from system:init event", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "system",
          subtype: "init",
          session_id: "sess-123",
          tools: ["Read", "Edit"],
          slash_commands: [],
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({
      type: "session_init",
      sessionId: "sess-123",
      tools: ["Read", "Edit"],
      slashCommands: [],
    });
  });

  it("emits streaming text from content_block_delta", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: "stream_event", event: { type: "message_start" } },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello " },
          },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "world" },
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    const textMsgs = msgs.filter((m) => m.type === "text");
    expect(textMsgs).toHaveLength(2);
    expect(textMsgs[0]).toEqual({
      type: "text",
      content: "Hello ",
      isStreaming: true,
    });
    expect(textMsgs[1]).toEqual({
      type: "text",
      content: "world",
      isStreaming: true,
    });
  });

  it("emits thinking from thinking_delta", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        { type: "stream_event", event: { type: "message_start" } },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "I should..." },
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({
      type: "thinking",
      content: "I should...",
      isStreaming: true,
    });
  });

  it("emits tool_use from assistant message", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Read",
                id: "tool-1",
                input: { file_path: "/tmp/x.ts" },
              },
            ],
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({
      type: "tool_use",
      toolName: "Read",
      toolCallId: "tool-1",
      input: { file_path: "/tmp/x.ts" },
    });
  });

  it("emits tool_result from user message", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "file contents here",
              },
            ],
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({
      type: "tool_result",
      toolCallId: "tool-1",
      output: "file contents here",
    });
  });

  it("emits todo_update from TodoWrite tool", async () => {
    const todos = [
      { content: "Fix bug", status: "pending", activeForm: "Fixing bug" },
    ];
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "TodoWrite",
                id: "todo-1",
                input: { todos },
              },
            ],
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({ type: "todo_update", todos });
  });

  it("emits todo_update when TodoWrite todos is a JSON string (model bug)", async () => {
    const todos = [
      { content: "Fix bug", status: "pending", activeForm: "Fixing bug" },
    ];
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "TodoWrite",
                id: "todo-2",
                input: { todos: JSON.stringify(todos) },
              },
            ],
          },
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({ type: "todo_update", todos });
  });

  it("emits result on success", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "result",
          subtype: "success",
          result: "Done!",
          total_cost_usd: 0.002,
          usage: { input_tokens: 100, output_tokens: 50 },
          modelUsage: {},
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    const result = msgs.find((m) => m.type === "result");
    expect(result).toMatchObject({
      type: "result",
      content: "Done!",
      cost: 0.002,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
  });

  it("emits error on failure result", async () => {
    mockQuery.mockReturnValue(
      makeStream([
        {
          type: "result",
          subtype: "error",
          is_error: true,
          errors: ["Something went wrong"],
        },
      ]),
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});
    const msgs = await collectMessages(provider);

    expect(msgs).toContainEqual({
      type: "error",
      message: "Something went wrong",
      code: "error",
    });
  });

  it("calls permissionHandler for tool execution", async () => {
    const permissionHandler = vi.fn().mockResolvedValue({ approved: true });
    mockQuery.mockImplementation(
      ({
        options,
      }: {
        options: {
          canUseTool?: (
            name: string,
            input: Record<string, unknown>,
            sdkOptions: unknown,
          ) => Promise<unknown>;
        };
      }) => {
        if (options?.canUseTool) {
          options.canUseTool(
            "Bash",
            { command: "ls" },
            {
              signal: new AbortController().signal,
              toolUseID: "test-tool-use-id",
            },
          );
        }
        return makeStream([]);
      },
    );

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});

    const msgs: unknown[] = [];
    for await (const msg of provider.sendMessage({
      prompt: "hello",
      permissionHandler,
    })) {
      msgs.push(msg);
    }

    expect(permissionHandler).toHaveBeenCalledWith(
      "Bash",
      { command: "ls" },
      {
        suggestions: undefined,
        decisionReason: undefined,
      },
    );
  });

  it("uses default tools in plan mode (SDK handles restrictions)", async () => {
    mockQuery.mockReturnValue(makeStream([]));

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of provider.sendMessage({
      prompt: "plan something",
      mode: "plan",
      permissionHandler: autoApprove,
    })) {
      /* drain */
    }

    const callArgs = mockQuery.mock.calls[0][0];
    // Plan mode uses the full tool preset — the SDK's permissionMode:'plan'
    // handles execution restriction, and tools must remain available for
    // post-plan execution after ExitPlanMode switches the mode.
    expect(callArgs.options.tools).toEqual({
      type: "preset",
      preset: "claude_code",
    });
  });

  it("interrupt stops the current query", async () => {
    const mockInterrupt = vi.fn().mockResolvedValue(undefined);
    // Use a stream that parks after the first event so the query stays
    // active when interrupt() is called (mirrors real behaviour where
    // interrupt is called during an ongoing turn).
    let resolveParked: (() => void) | undefined;
    const parkingStream = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sess-int",
          tools: [],
          slash_commands: [],
        };
        // Park until the test resolves us (or gen.return aborts)
        await new Promise<void>((r) => {
          resolveParked = r;
        });
      },
      interrupt: mockInterrupt,
    };
    mockQuery.mockReturnValue(parkingStream);

    const provider = new ClaudeCodeProvider();
    await provider.initialize({});

    const gen = provider.sendMessage({
      prompt: "hello",
      permissionHandler: autoApprove,
    });
    // Kick off the generator body so currentQuery gets set, then interrupt
    await gen.next();
    await provider.interrupt();
    // Unpark so the generator can finish cleanly
    resolveParked?.();
    await gen.return(undefined);

    expect(mockInterrupt).toHaveBeenCalled();
  });
});

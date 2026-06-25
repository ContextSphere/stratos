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

  describe("streaming-input prompt lifecycle", () => {
    // Regression: the prompt generator handed to the SDK previously returned
    // immediately after its one yield, causing the SDK transport to send
    // stdin EOF to the Claude CLI subprocess mid-turn. The CLI would then set
    // inputClosed=true, and every subsequent can_use_tool request from the
    // CLI would synchronously fail with "Stream closed", surfacing in the UI
    // as: "Tool permission request failed: Error: Stream closed".
    //
    // Fix: keep the generator parked on a Promise until the for-await loop
    // on the output side terminates (success, error, or interrupt).

    // Capture only the FIRST query() call (the per-turn streaming-input one).
    // sendMessage also spins up a background control query at end-of-turn
    // which would otherwise overwrite our capture.
    function captureFirstPromptFromQuery() {
      type AsyncIterableLike<T> = {
        [Symbol.asyncIterator]: () => AsyncIterator<T>;
      };
      let captured: AsyncIterator<unknown> | undefined;
      mockQuery.mockImplementation(
        ({ prompt }: { prompt: AsyncIterableLike<unknown> }) => {
          if (captured === undefined) {
            captured = prompt[Symbol.asyncIterator]();
          }
          return makeStream([
            {
              type: "system",
              subtype: "init",
              session_id: "sess-stream",
              tools: [],
              slash_commands: [],
            },
          ]);
        },
      );
      return () => captured;
    }

    it("prompt generator stays parked after yielding the user message", async () => {
      const getGen = captureFirstPromptFromQuery();
      const provider = new ClaudeCodeProvider();
      await provider.initialize({});

      // Drain the turn — the for-await loop runs, then its finally releases
      // the parked generator. We inspect the generator state below.
      await collectMessages(provider, "hi");

      const gen = getGen();
      expect(gen).toBeDefined();

      // First yield: the initial user message.
      const first = await gen!.next();
      expect(first.done).toBe(false);
      const value = first.value as {
        type: string;
        message: { content: unknown };
      };
      expect(value.type).toBe("user");
      expect(value.message.content).toBe("hi");

      // After the for-await finally released the park, the generator must
      // complete on the next pull (rather than yielding another value).
      const second = await gen!.next();
      expect(second.done).toBe(true);
    });

    it("prompt generator does NOT complete before for-await loop finishes", async () => {
      // Build an SDK stream that parks on its second event so the for-await
      // loop in sendMessage stays live. The prompt generator must still be
      // parked at that point — that's the entire point of the fix.
      let resolveStream: (() => void) | undefined;
      type AsyncIterableLike<T> = {
        [Symbol.asyncIterator]: () => AsyncIterator<T>;
      };
      let capturedPrompt: AsyncIterator<unknown> | undefined;
      mockQuery.mockImplementation(
        ({ prompt }: { prompt: AsyncIterableLike<unknown> }) => {
          if (capturedPrompt === undefined) {
            capturedPrompt = prompt[Symbol.asyncIterator]();
          }
          return {
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: "system",
                subtype: "init",
                session_id: "sess-park",
                tools: [],
                slash_commands: [],
              };
              await new Promise<void>((r) => {
                resolveStream = r;
              });
            },
            interrupt: vi.fn().mockResolvedValue(undefined),
          };
        },
      );

      const provider = new ClaudeCodeProvider();
      await provider.initialize({});

      const turn = provider.sendMessage({
        prompt: "park me",
        permissionHandler: autoApprove,
      });

      // Drive the outer generator past its first yield so the inner for-await
      // is actively iterating the mocked SDK stream.
      await turn.next();

      // Consume the first yield from the prompt generator (the user message).
      expect(capturedPrompt).toBeDefined();
      const first = await capturedPrompt!.next();
      expect(first.done).toBe(false);

      // The second pull must hit `await parked` and remain pending because
      // the for-await loop in sendMessage hasn't finished yet — its mocked
      // SDK stream is suspended on resolveStream.
      const nextP = capturedPrompt!.next();
      const settled = await Promise.race([
        nextP.then(() => "settled" as const),
        new Promise<"pending">((r) => setTimeout(() => r("pending"), 50)),
      ]);
      expect(settled).toBe("pending");

      // Release the inner SDK stream so the for-await loop can complete,
      // which releases the parked generator.
      resolveStream?.();
      await turn.return?.(undefined);
      // Await the parked next() so vitest doesn't flag an unhandled promise.
      await nextP.catch(() => undefined);
    });

    it("interrupt releases the parked prompt generator", async () => {
      let resolveStream: (() => void) | undefined;
      type AsyncIterableLike<T> = {
        [Symbol.asyncIterator]: () => AsyncIterator<T>;
      };
      let capturedPrompt: AsyncIterator<unknown> | undefined;
      mockQuery.mockImplementation(
        ({ prompt }: { prompt: AsyncIterableLike<unknown> }) => {
          if (capturedPrompt === undefined) {
            capturedPrompt = prompt[Symbol.asyncIterator]();
          }
          return {
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: "system",
                subtype: "init",
                session_id: "sess-irq",
                tools: [],
                slash_commands: [],
              };
              await new Promise<void>((r) => {
                resolveStream = r;
              });
            },
            interrupt: vi.fn().mockResolvedValue(undefined),
          };
        },
      );

      const provider = new ClaudeCodeProvider();
      await provider.initialize({});

      const turn = provider.sendMessage({
        prompt: "go",
        permissionHandler: autoApprove,
      });
      await turn.next();
      // Consume the first yield (the user message).
      await capturedPrompt!.next();

      // Calling interrupt() must release the parked generator without
      // needing the for-await loop to drain.
      await provider.interrupt();
      const after = await capturedPrompt!.next();
      expect(after.done).toBe(true);

      // Clean up the test SDK stream so vitest doesn't hang.
      resolveStream?.();
      await turn.return?.(undefined);
    });

    it("breaks out of for-await after the result event so the SDK iterator's return() runs", async () => {
      // Regression: in streaming-input mode (async-iterable prompt) the SDK
      // sets isSingleUserTurn=false and does NOT auto-close stdin after the
      // result event. transport.readMessages keeps waiting on the parked
      // CLI's stdout, inputStream never drains, and readSdkMessages never
      // returns. The provider's for-await would hang forever, leaving the
      // host's activeStreams populated and the sidebar stuck on "Working".
      //
      // The fix: detect `result` inside the for-await and break, so
      // JavaScript invokes the iterator's return(), which triggers
      // B9.cleanup() → transport.close() → CLI exits.
      const returnSpy = vi
        .fn()
        .mockResolvedValue({ done: true, value: undefined });
      let yieldedResult = false;
      mockQuery.mockImplementation(() => {
        const iterator: AsyncIterator<unknown> = {
          async next() {
            if (!yieldedResult) {
              yieldedResult = true;
              return {
                done: false,
                value: {
                  type: "result",
                  subtype: "success",
                  total_cost_usd: 0,
                  usage: { input_tokens: 1, output_tokens: 1 },
                  modelUsage: {},
                  result: "ok",
                  stop_reason: null,
                  is_error: false,
                },
              };
            }
            // Mirrors real multi-turn SDK behavior: after result we sit on
            // transport.readMessages forever waiting for the parked CLI.
            // If the provider doesn't break, the test will time out.
            return await new Promise<{ done: boolean; value: unknown }>(() => {
              /* never resolves */
            });
          },
          return: returnSpy,
        };
        return {
          [Symbol.asyncIterator]: () => iterator,
          interrupt: vi.fn().mockResolvedValue(undefined),
        };
      });

      const provider = new ClaudeCodeProvider();
      await provider.initialize({});

      // collectMessages drains sendMessage to completion. With the fix this
      // returns promptly after the result event; without it, this would
      // hang and the test would time out.
      const msgs = await collectMessages(provider, "go");
      expect(msgs.some((m) => m.type === "result")).toBe(true);
      // JavaScript's for-await invokes iterator.return() on break/early exit.
      expect(returnSpy).toHaveBeenCalled();
    });
  });
});

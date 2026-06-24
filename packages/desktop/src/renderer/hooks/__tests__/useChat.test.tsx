// @vitest-environment happy-dom
/**
 * Tests for the useChat hook.
 *
 * The hook is deeply integrated with Electron IPC via `window.api`. All IPC
 * calls are mocked here. Deeper integration (actual streaming messages,
 * multi-thread interplay) requires E2E tests with a running Electron instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "../useChat";

// ---------------------------------------------------------------------------
// Mock window.api — every method the hook touches must be present so that the
// useEffect registrations don't throw on mount.
// ---------------------------------------------------------------------------

function makeMockApi() {
  return {
    // IPC listener registration (no-ops — we don't simulate IPC events here)
    onStreamMessage: vi.fn(),
    onToolPermission: vi.fn(),
    onAskUserQuestion: vi.fn(),
    onPlanReview: vi.fn(),
    onThreadStreamState: vi.fn(),
    onSlashCommands: vi.fn(),
    onModeChanged: vi.fn(),
    onMcpStatusChanged: vi.fn(),
    onThreadActivate: vi.fn(),
    onThreadMessagesReload: vi.fn(),
    removeAllListeners: vi.fn(),

    // Data-fetching calls used on mount / thread switch
    getSlashCommands: vi.fn().mockResolvedValue([]),
    getRunningThreads: vi.fn().mockResolvedValue([]),
    threadsLoadMessages: vi.fn().mockResolvedValue([]),
    threadsGet: vi.fn().mockResolvedValue(null),
    threadsSaveMessages: vi.fn().mockResolvedValue(undefined),
    threadsUpdate: vi.fn().mockResolvedValue(undefined),
    getContextUsage: vi.fn().mockResolvedValue(null),
    mcpServerStatus: vi.fn().mockResolvedValue([]),

    // Message sending / control
    sendMessage: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),

    // Permission / question / plan-review responses
    respondToolPermission: vi.fn(),
    respondAskUserQuestion: vi.fn(),
    respondPlanReview: vi.fn(),
  };
}

// We use `Object.defineProperty` so we can re-assign `window.api` in each test
// without TypeScript complaining about the global type.
let mockApi: ReturnType<typeof makeMockApi>;

beforeEach(() => {
  mockApi = makeMockApi();
  Object.defineProperty(window, "api", {
    value: mockApi,
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Helper — render the hook with a given threadId
// ---------------------------------------------------------------------------
function renderUseChat(activeThreadId: string | null = null) {
  return renderHook(
    ({ threadId }: { threadId: string | null }) => useChat(threadId),
    { initialProps: { threadId: activeThreadId } },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChat — initial state", () => {
  it("returns empty messages when no thread is active", () => {
    const { result } = renderUseChat(null);
    expect(result.current.messages).toEqual([]);
  });

  it("returns isStreaming=false when no thread is active", () => {
    const { result } = renderUseChat(null);
    expect(result.current.isStreaming).toBe(false);
  });

  it("returns zero-valued sessionStats on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.sessionStats).toEqual({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      contextWindow: null,
    });
  });

  it("returns interactiveMode of type 'none' on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.interactiveMode).toEqual({ type: "none" });
  });

  it("returns permissionRequest=null when no permissions are pending", () => {
    const { result } = renderUseChat(null);
    expect(result.current.permissionRequest).toBeNull();
  });

  it("returns empty slashCommands on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.slashCommands).toEqual([]);
  });

  it("returns sessionTools=null on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.sessionTools).toBeNull();
  });

  it("returns empty runningThreadIds on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.runningThreadIds).toEqual([]);
  });

  it("returns empty threadNotifications on mount", () => {
    const { result } = renderUseChat(null);
    expect(result.current.threadNotifications.size).toBe(0);
  });
});

describe("useChat — API calls on mount", () => {
  it("calls getSlashCommands on mount", () => {
    renderUseChat(null);
    expect(mockApi.getSlashCommands).toHaveBeenCalledTimes(1);
  });

  it("calls getRunningThreads on mount", () => {
    renderUseChat(null);
    expect(mockApi.getRunningThreads).toHaveBeenCalledTimes(1);
  });

  it("registers IPC listeners on mount", () => {
    renderUseChat(null);
    expect(mockApi.onStreamMessage).toHaveBeenCalledTimes(1);
    expect(mockApi.onToolPermission).toHaveBeenCalledTimes(1);
    expect(mockApi.onAskUserQuestion).toHaveBeenCalledTimes(1);
    expect(mockApi.onPlanReview).toHaveBeenCalledTimes(1);
    expect(mockApi.onThreadStreamState).toHaveBeenCalledTimes(1);
  });

  it("removes IPC listeners on unmount", () => {
    const { unmount } = renderUseChat(null);
    unmount();
    expect(mockApi.removeAllListeners).toHaveBeenCalled();
  });
});

describe("useChat — thread switching", () => {
  it("loads messages when an activeThreadId is provided", async () => {
    const stored = [
      {
        id: "m1",
        role: "user" as const,
        content: "hello",
        timestamp: 1000,
      },
    ];
    mockApi.threadsLoadMessages.mockResolvedValue(stored);

    const { result } = renderUseChat("thread-1");

    // Wait for async threadsLoadMessages to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockApi.threadsLoadMessages).toHaveBeenCalledWith("thread-1");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("hello");
  });

  it("clears messages when switching to null thread", async () => {
    const stored = [
      { id: "m1", role: "user" as const, content: "hi", timestamp: 1000 },
    ];
    mockApi.threadsLoadMessages.mockResolvedValue(stored);

    const { result, rerender } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.messages).toHaveLength(1);

    // Switch to null
    rerender({ threadId: null });
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionStats).toEqual({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      contextWindow: null,
    });
  });

  it("resets interactiveMode to 'none' when switching threads", async () => {
    const { result, rerender } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ threadId: "thread-2" });
    expect(result.current.interactiveMode).toEqual({ type: "none" });
  });

  it("saves current messages before switching away from a thread", async () => {
    const stored = [
      { id: "m1", role: "user" as const, content: "persist me", timestamp: 1 },
    ];
    mockApi.threadsLoadMessages.mockResolvedValue(stored);

    const { rerender } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    mockApi.threadsLoadMessages.mockResolvedValue([]);

    rerender({ threadId: "thread-2" });

    expect(mockApi.threadsSaveMessages).toHaveBeenCalledWith(
      "thread-1",
      stored,
    );
  });
});

describe("useChat — isStreaming", () => {
  it("isStreaming is false when activeThread is not in runningThreadIds", async () => {
    // getRunningThreads returns 'other-thread', not the active one
    mockApi.getRunningThreads.mockResolvedValue(["other-thread"]);

    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStreaming).toBe(false);
  });
});

describe("useChat — sendMessage", () => {
  it("does nothing when activeThreadId is null and no threadId arg", async () => {
    const { result } = renderUseChat(null);

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it("sends message when activeThreadId is provided", async () => {
    mockApi.threadsLoadMessages.mockResolvedValue([]);
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve(); // let threadsLoadMessages settle
    });

    await act(async () => {
      await result.current.sendMessage("hello world");
    });

    expect(mockApi.threadsUpdate).toHaveBeenCalledWith("thread-1", {
      title: "hello world",
    });
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      "hello world",
      "thread-1",
      undefined,
    );
  });

  it("adds user message to messages list optimistically", async () => {
    mockApi.threadsLoadMessages.mockResolvedValue([]);
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage("test message");
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[0].content).toBe("test message");
  });

  it("truncates long prompts to 50 chars + ellipsis for the thread title", async () => {
    mockApi.threadsLoadMessages.mockResolvedValue([]);
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    const long = "a".repeat(60);
    await act(async () => {
      await result.current.sendMessage(long);
    });

    expect(mockApi.threadsUpdate).toHaveBeenCalledWith("thread-1", {
      title: "a".repeat(50) + "...",
    });
  });

  it("can target a different threadId via the second argument", async () => {
    mockApi.threadsLoadMessages.mockResolvedValue([]);
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage("hi", "thread-2");
    });

    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      "hi",
      "thread-2",
      undefined,
    );
  });
});

describe("useChat — respondPermission", () => {
  it("calls respondToolPermission with the requestId and approved=true", () => {
    const { result } = renderUseChat("thread-1");

    act(() => {
      result.current.respondPermission("req-1", true);
    });

    expect(mockApi.respondToolPermission).toHaveBeenCalledWith(
      "req-1",
      true,
      undefined,
    );
  });

  it("calls respondToolPermission with approved=false", () => {
    const { result } = renderUseChat("thread-1");

    act(() => {
      result.current.respondPermission("req-1", false);
    });

    expect(mockApi.respondToolPermission).toHaveBeenCalledWith(
      "req-1",
      false,
      undefined,
    );
  });
});

describe("useChat — respondQuestion", () => {
  it("calls respondAskUserQuestion and clears interactiveMode", () => {
    const { result } = renderUseChat("thread-1");

    act(() => {
      result.current.respondQuestion("req-q", { answer: "yes" });
    });

    expect(mockApi.respondAskUserQuestion).toHaveBeenCalledWith("req-q", {
      answer: "yes",
    });
    expect(result.current.interactiveMode).toEqual({ type: "none" });
  });
});

describe("useChat — respondPlanReview", () => {
  it("calls respondPlanReview and clears interactiveMode", () => {
    const { result } = renderUseChat("thread-1");

    act(() => {
      result.current.respondPlanReview("req-p", { type: "approve" });
    });

    expect(mockApi.respondPlanReview).toHaveBeenCalledWith("req-p", {
      type: "approve",
    });
    expect(result.current.interactiveMode).toEqual({ type: "none" });
  });
});

describe("useChat — interrupt", () => {
  it("calls window.api.interrupt with the active thread id", async () => {
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await result.current.interrupt();
    });

    expect(mockApi.interrupt).toHaveBeenCalledWith("thread-1");
  });

  it("calls window.api.interrupt with an explicit threadId override", async () => {
    const { result } = renderUseChat("thread-1");

    await act(async () => {
      await result.current.interrupt("thread-2");
    });

    expect(mockApi.interrupt).toHaveBeenCalledWith("thread-2");
  });

  it("does nothing when no activeThreadId and no arg", async () => {
    const { result } = renderUseChat(null);

    await act(async () => {
      await result.current.interrupt();
    });

    expect(mockApi.interrupt).not.toHaveBeenCalled();
  });
});

describe("useChat — updateTaskExpanded", () => {
  it("does nothing when activeThreadId is null", () => {
    const { result } = renderUseChat(null);

    act(() => {
      result.current.updateTaskExpanded("msg-1", true);
    });

    // No crash, messages still empty
    expect(result.current.messages).toEqual([]);
  });
});

describe("useChat — task-notification loading", () => {
  it("loads a stored taskNotification into a ChatMessage", async () => {
    const stored = [
      {
        id: "m1",
        role: "user" as const,
        content: "",
        timestamp: 1000,
        taskNotification: {
          taskId: "t-1",
          toolUseId: "tu-1",
          status: "completed" as const,
          summary: "Background command completed (exit code 0)",
          outputFile: "/tmp/out.log",
        },
      },
    ];
    mockApi.threadsLoadMessages.mockResolvedValue(stored);

    const { result } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].taskNotification).toEqual(
      stored[0].taskNotification,
    );
    expect(result.current.messages[0].content).toBe("");
  });
});

describe("useChat — handleInteractiveResponse", () => {
  it("does nothing meaningful when interactiveMode is 'none'", () => {
    const { result } = renderUseChat("thread-1");

    act(() => {
      result.current.handleInteractiveResponse("some text");
    });

    // interactiveMode stays 'none', no IPC calls made
    expect(result.current.interactiveMode).toEqual({ type: "none" });
    expect(mockApi.respondPlanReview).not.toHaveBeenCalled();
    expect(mockApi.respondAskUserQuestion).not.toHaveBeenCalled();
  });
});

describe("useChat — streaming throttle", () => {
  // Regression: the active-thread UI was stuck at the first text fragment when
  // events arrived faster than the batching window. A pure debounce reset the
  // timer on every event and never fired during sustained streams. The
  // throttle must fire periodically even while events keep arriving.

  it("renders interim updates during a sustained burst of stream events", async () => {
    vi.useFakeTimers();

    let streamHandler:
      | ((data: unknown, threadId: string | null) => void)
      | null = null;
    mockApi.onStreamMessage.mockImplementation((cb) => {
      streamHandler = cb;
    });

    mockApi.threadsLoadMessages.mockResolvedValue([]);

    const { result } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(streamHandler).not.toBeNull();

    // Bootstrap streaming state via the user_message synthetic event.
    await act(async () => {
      streamHandler!(
        { type: "user_message", content: "hi", _streamId: "s1" },
        "thread-1",
      );
    });

    // Simulate 30 text chunks arriving every 10 ms (faster than the 50 ms
    // window). A debounce would never fire; a throttle must produce at
    // least one interim render before the burst ends.
    await act(async () => {
      for (let i = 0; i < 30; i++) {
        streamHandler!(
          { type: "text", content: `${i} `, _streamId: "s1" },
          "thread-1",
        );
        vi.advanceTimersByTime(10);
      }
      await Promise.resolve();
    });

    // After 300 ms of sustained events we must have seen interim content —
    // not the empty initial state, not the final post-burst state.
    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistant).toBeDefined();
    // At least the first few fragments are visible mid-burst.
    expect(assistant!.content.length).toBeGreaterThan(0);
    expect(assistant!.content).toContain("0 ");

    vi.useRealTimers();
  });
});

describe("useChat — result-event reload race", () => {
  // The SDK CLI writes its JSONL with async fs.appendFile, so when the
  // `result` event arrives over IPC the final assistant turn may not yet
  // have flushed. The hook polls until disk count stabilizes — this test
  // simulates the race and asserts we don't show the partial transcript.

  it("waits until disk count stabilizes before applying loaded messages", async () => {
    vi.useFakeTimers();

    // Capture the stream-message handler the hook installs on mount
    let streamHandler:
      | ((data: unknown, threadId: string | null) => void)
      | null = null;
    mockApi.onStreamMessage.mockImplementation((cb) => {
      streamHandler = cb;
    });

    // Simulate the race: first read returns a partial transcript (incomplete
    // — final assistant message hasn't flushed), the second read returns the
    // full transcript. The third and fourth reads stay stable.
    const partial = [
      { id: "u1", role: "user" as const, content: "hi", timestamp: 1 },
    ];
    const full = [
      ...partial,
      { id: "a1", role: "assistant" as const, content: "hello", timestamp: 2 },
    ];
    mockApi.threadsLoadMessages
      .mockResolvedValueOnce([]) // initial mount load
      .mockResolvedValueOnce(partial) // result-handler poll iter 1 (delay 0)
      .mockResolvedValueOnce(full) // poll iter 2 (delay 100)
      .mockResolvedValue(full); // subsequent stable reads

    const { result } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(streamHandler).not.toBeNull();

    // Simulate streaming events building up in-memory state then a `result`
    // event firing — the renderer immediately reloads from disk.
    await act(async () => {
      streamHandler!(
        { type: "user_message", content: "hi", _streamId: "s1" },
        "thread-1",
      );
      streamHandler!(
        { type: "text", content: "hello", _streamId: "s1" },
        "thread-1",
      );
      // Flush the 50 ms batched render
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    // Fire the result event — this kicks off the polling reload.
    await act(async () => {
      streamHandler!(
        {
          type: "result",
          cost: 0,
          usage: { inputTokens: 1, outputTokens: 1 },
          _streamId: "s1",
        },
        "thread-1",
      );
    });

    // First poll iteration (delay=0) reads `partial` synchronously.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      // Advance past the 100 ms backoff for iter 2 (which reads `full`)
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      await Promise.resolve();
      // Advance past iter 3's backoff to confirm stability (full === full)
      vi.advanceTimersByTime(260);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The final React state must reflect the FULL transcript, not the partial.
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].id).toBe("u1");
    expect(result.current.messages[1].id).toBe("a1");

    vi.useRealTimers();
  });

  it("does not clobber in-memory state if disk reads are persistently smaller", async () => {
    vi.useFakeTimers();

    let streamHandler:
      | ((data: unknown, threadId: string | null) => void)
      | null = null;
    mockApi.onStreamMessage.mockImplementation((cb) => {
      streamHandler = cb;
    });

    // Simulate a regen-style case where the SDK's filtered transcript has
    // FEWER messages than memory — but the count is stable across reads.
    const filtered = [
      { id: "u1", role: "user" as const, content: "hi", timestamp: 1 },
      { id: "a2", role: "assistant" as const, content: "real", timestamp: 3 },
    ];
    mockApi.threadsLoadMessages
      .mockResolvedValueOnce([]) // initial mount load
      .mockResolvedValue(filtered); // every subsequent read is the filtered set

    const { result } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(streamHandler).not.toBeNull();

    // Bootstrap the streaming state so the result handler actually runs.
    await act(async () => {
      streamHandler!(
        { type: "user_message", content: "hi", _streamId: "s1" },
        "thread-1",
      );
      streamHandler!(
        { type: "text", content: "intermediate", _streamId: "s1" },
        "thread-1",
      );
      // Flush the 50 ms batched render
      vi.advanceTimersByTime(60);
      await Promise.resolve();
    });

    await act(async () => {
      streamHandler!(
        {
          type: "result",
          cost: 0,
          usage: { inputTokens: 1, outputTokens: 1 },
          _streamId: "s1",
        },
        "thread-1",
      );
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Polling stabilized at length 2 — apply that (even though memory had
    // more messages, the filtered set is now considered authoritative).
    expect(result.current.messages).toHaveLength(2);

    vi.useRealTimers();
  });

  it("stops polling after the first read when disk catches up to streamed count", async () => {
    // Memory-OOM regression guard: when the SDK flushes before the result
    // event arrives (the common fast case), the poll must NOT re-read the
    // JSONL up to 6 times — each call allocates a full Buffer in main.
    vi.useFakeTimers();

    let streamHandler:
      | ((data: unknown, threadId: string | null) => void)
      | null = null;
    mockApi.onStreamMessage.mockImplementation((cb) => {
      streamHandler = cb;
    });

    const full = [
      { id: "u1", role: "user" as const, content: "hi", timestamp: 1 },
      { id: "a1", role: "assistant" as const, content: "hello", timestamp: 2 },
    ];
    mockApi.threadsLoadMessages
      .mockResolvedValueOnce([]) // initial mount load
      .mockResolvedValue(full); // every poll read returns the full set

    const { result } = renderUseChat("thread-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(streamHandler).not.toBeNull();

    await act(async () => {
      streamHandler!(
        { type: "user_message", content: "hi", _streamId: "s1" },
        "thread-1",
      );
      streamHandler!(
        { type: "text", content: "hello", _streamId: "s1" },
        "thread-1",
      );
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      // Absorb the 500ms defensive thread-switch re-check so it doesn't get
      // counted as a poll read below.
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsBeforeResult = mockApi.threadsLoadMessages.mock.calls.length;

    await act(async () => {
      streamHandler!(
        {
          type: "result",
          cost: 0,
          usage: { inputTokens: 1, outputTokens: 1 },
          _streamId: "s1",
        },
        "thread-1",
      );
      // First poll iteration runs at delay=0.
      await Promise.resolve();
      await Promise.resolve();
      // Advance well past every backoff step to confirm no further reads.
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Exactly ONE additional read should have happened — disk caught up
    // immediately, so the loop must short-circuit. Six reads = OOM regression.
    const pollReadCount =
      mockApi.threadsLoadMessages.mock.calls.length - callsBeforeResult;
    expect(pollReadCount).toBe(1);
    expect(result.current.messages).toHaveLength(2);

    vi.useRealTimers();
  });
});

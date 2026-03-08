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
    onThreadActivate: vi.fn(),
    removeAllListeners: vi.fn(),

    // Data-fetching calls used on mount / thread switch
    getSlashCommands: vi.fn().mockResolvedValue([]),
    getRunningThreads: vi.fn().mockResolvedValue([]),
    threadsLoadMessages: vi.fn().mockResolvedValue([]),
    threadsGet: vi.fn().mockResolvedValue(null),
    threadsSaveMessages: vi.fn().mockResolvedValue(undefined),
    threadsUpdate: vi.fn().mockResolvedValue(undefined),

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

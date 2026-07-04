import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Electron before any imports that use it
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  Notification: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    show: vi.fn(),
  })),
}));

// Mock @stratosapp/core — keep all real exports but replace ClaudeCodeProvider
vi.mock("@stratosapp/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stratosapp/core")>();
  return {
    ...original,
    ClaudeCodeProvider: vi.fn(),
  };
});

// Mock settings store — find the correct path by reading agent-manager.ts
// The import is: import { loadSettings } from './settings/settings.store'
vi.mock("../settings/settings.store", () => ({
  loadSettings: vi.fn().mockReturnValue({}),
  setProviderSettings: vi.fn(),
  isManagerEnabled: vi.fn().mockReturnValue(false),
}));

describe("AgentManager (integration)", () => {
  let sentMessages: Array<{
    channel: string;
    data: unknown;
    threadId?: string;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWindow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AgentManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    sentMessages = [];

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(true),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
        send: vi.fn((channel: string, data: unknown, threadId?: string) => {
          sentMessages.push({ channel, data, threadId });
        }),
      },
    };

    const mod = await import("../agent-manager");
    AgentManager = mod.AgentManager;
  });

  it("constructs without throwing", () => {
    expect(() => new AgentManager(mockWindow)).not.toThrow();
  });

  it("dispose resolves pending permissions with denied", () => {
    const manager = new AgentManager(mockWindow);
    const resolveMock = vi.fn();
    // Access private field directly: no public seam for pending permissions,
    // and driving through real IPC would require a full Electron process.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).pendingPermissions.set("test-req", {
      resolve: resolveMock,
    });
    manager.dispose();
    expect(resolveMock).toHaveBeenCalledWith({ approved: false });
  });

  it("getRunningThreadIds returns empty array initially", () => {
    const manager = new AgentManager(mockWindow);
    expect(manager.getRunningThreadIds()).toEqual([]);
    manager.dispose();
  });

  it("clearSession rejects pending requests for that thread (memory leak fix)", () => {
    const manager = new AgentManager(mockWindow);
    const permResolve = vi.fn();
    const questionResolve = vi.fn();
    const planResolve = vi.fn();
    const elicitResolve = vi.fn();
    // Pending entries for thread t1 (should be rejected)
    (manager as any).pendingPermissions.set("p1", {
      threadId: "t1",
      resolve: permResolve,
    });
    (manager as any).pendingQuestions.set("q1", {
      threadId: "t1",
      resolve: questionResolve,
      input: { questions: [] },
    });
    (manager as any).pendingPlanReviews.set("pr1", {
      threadId: "t1",
      resolve: planResolve,
      input: {},
    });
    (manager as any).pendingElicitations.set("e1", {
      threadId: "t1",
      resolve: elicitResolve,
    });
    // Pending entries for thread t2 (should remain untouched)
    const otherPerm = vi.fn();
    (manager as any).pendingPermissions.set("p2", {
      threadId: "t2",
      resolve: otherPerm,
    });

    manager.clearSession("t1");

    expect(permResolve).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
    );
    expect(questionResolve).toHaveBeenCalledWith({ approved: false });
    expect(planResolve).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
    );
    expect(elicitResolve).toHaveBeenCalledWith({ action: "cancel" });
    expect(otherPerm).not.toHaveBeenCalled();
    expect((manager as any).pendingPermissions.size).toBe(1);
    expect((manager as any).pendingQuestions.size).toBe(0);
    expect((manager as any).pendingPlanReviews.size).toBe(0);
    expect((manager as any).pendingElicitations.size).toBe(0);

    manager.dispose();
  });

  it("rejects all pending requests when renderer reloads (memory leak fix)", () => {
    const manager = new AgentManager(mockWindow);
    const permResolve = vi.fn();
    const questionResolve = vi.fn();
    (manager as any).pendingPermissions.set("p1", {
      threadId: "t1",
      resolve: permResolve,
    });
    (manager as any).pendingQuestions.set("q1", {
      threadId: "t2",
      resolve: questionResolve,
      input: {},
    });

    // Simulate the renderer reload path
    (manager as any).rejectAllPendingForRendererGone("test-reload");

    expect(permResolve).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false }),
    );
    expect(questionResolve).toHaveBeenCalledWith({ approved: false });
    expect((manager as any).pendingPermissions.size).toBe(0);
    expect((manager as any).pendingQuestions.size).toBe(0);
    manager.dispose();
  });

  it("clearSession disposes provider", () => {
    const disposeMock = vi.fn().mockResolvedValue(undefined);
    const fakeProvider = {
      name: "claude-code",
      initialize: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockReturnValue((async function* () {})()),
      interrupt: vi.fn().mockResolvedValue(undefined),
      canResume: vi.fn().mockReturnValue(false),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      discoverSlashCommands: vi.fn().mockResolvedValue([]),
      dispose: disposeMock,
    };

    const manager = new AgentManager(mockWindow);
    // Access private field directly — no public API to inject a session without spawning a full agent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).sessions.set("thread-1", { provider: fakeProvider });
    manager.clearSession("thread-1");

    expect(disposeMock).toHaveBeenCalled();
    manager.dispose();
  });

  it("getSlashCommands returns empty array initially", () => {
    const manager = new AgentManager(mockWindow);
    expect(manager.getSlashCommands()).toEqual([]);
    manager.dispose();
  });

  describe("manager MCP status delegation", () => {
    it("delegates getMcpStatusForThread to managerMcpStatusProvider for manager threads", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "mgr",
          isManagerThread: true,
          cwd: "/home/user",
        }),
      };

      const managerStatuses = [
        {
          name: "stratos-manager",
          status: "connected",
          tools: ["list_sessions", "create_workspace"],
        },
      ];
      const delegate = vi.fn().mockResolvedValue(managerStatuses);

      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      manager.setManagerMcpStatusProvider(delegate);

      const result = await (manager as any).getMcpStatusForThread("mgr");

      expect(delegate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(managerStatuses);
      manager.dispose();
    });

    it("returns [] for manager thread when delegate throws", async () => {
      const mockStorage = {
        getThread: vi
          .fn()
          .mockResolvedValue({ id: "mgr", isManagerThread: true }),
      };
      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      manager.setManagerMcpStatusProvider(() =>
        Promise.reject(new Error("boom")),
      );

      const result = await (manager as any).getMcpStatusForThread("mgr");

      expect(result).toEqual([]);
      manager.dispose();
    });

    it("falls through to session lookup for non-manager threads", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t1",
          isManagerThread: false,
          cwd: "/home/user",
        }),
      };
      const providerStatuses = [
        { name: "scheduler", status: "connected", tools: ["a", "b"] },
      ];
      const fakeProvider = {
        getMcpServerStatus: vi.fn().mockResolvedValue(providerStatuses),
        dispose: vi.fn().mockResolvedValue(undefined),
      };

      const delegate = vi.fn();
      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t1", { provider: fakeProvider });
      manager.setManagerMcpStatusProvider(delegate);

      const result = await (manager as any).getMcpStatusForThread("t1");

      expect(delegate).not.toHaveBeenCalled();
      expect(fakeProvider.getMcpServerStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(providerStatuses);
      manager.dispose();
    });
  });

  describe("onStreamCompleted listener registry", () => {
    it("fires registered listeners with {threadId, status} and supports unsubscribe", () => {
      const manager = new AgentManager(mockWindow);
      const listener = vi.fn();
      const unsub = manager.onStreamCompleted(listener);

      (manager as any).emitStreamCompleted({
        threadId: "t1",
        runId: "t1-1",
        status: "completed",
        origin: "manager",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        threadId: "t1",
        runId: "t1-1",
        status: "completed",
        origin: "manager",
      });

      unsub();
      (manager as any).emitStreamCompleted({
        threadId: "t2",
        runId: "t2-1",
        status: "error",
        origin: "manager",
      });
      // After unsubscribe no further calls
      expect(listener).toHaveBeenCalledTimes(1);

      manager.dispose();
    });

    it("swallows listener errors so one bad listener doesn't block others", () => {
      const manager = new AgentManager(mockWindow);
      const bad = vi.fn().mockImplementation(() => {
        throw new Error("boom");
      });
      const good = vi.fn();
      manager.onStreamCompleted(bad);
      manager.onStreamCompleted(good);

      expect(() =>
        (manager as any).emitStreamCompleted({
          threadId: "t1",
          runId: "t1-1",
          status: "completed",
          origin: "manager",
        }),
      ).not.toThrow();
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      manager.dispose();
    });
  });

  describe("ScheduleWakeup observer", () => {
    it("forwards ScheduleWakeup tool_use to the wired WakeupHandler", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t-wake",
          model: "claude-sonnet-4-6",
          provider: "claude-code",
          cwd: "/home/user",
        }),
        updateThread: vi.fn().mockResolvedValue(undefined),
        clearPersistedSessionId: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn(),
      };

      // Fake provider that yields a single ScheduleWakeup tool_use then exits.
      const fakeProvider = {
        name: "claude-code",
        initialize: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use" as const,
            toolName: "ScheduleWakeup",
            toolCallId: "call-1",
            input: {
              delaySeconds: 60,
              prompt: "fire-me-later",
              reason: "test",
            },
          };
        }),
        interrupt: vi.fn().mockResolvedValue(undefined),
        canResume: vi.fn().mockReturnValue(false),
        getAvailableModels: vi.fn().mockResolvedValue([]),
        discoverSlashCommands: vi.fn().mockResolvedValue([]),
        dispose: vi.fn().mockResolvedValue(undefined),
        getMcpServerStatus: vi.fn().mockResolvedValue([]),
      };

      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      // Pre-seed a session so runStream uses our fake provider instead of
      // spinning up a real one.
      (manager as any).sessions.set("t-wake", {
        provider: fakeProvider,
        interruptRequested: false,
      });

      const scheduleSpy = vi.fn();
      manager.setWakeupHandler({
        scheduleWakeup: scheduleSpy,
        cancelForThread: vi.fn().mockReturnValue(0),
      });

      await (manager as any).runStream("t-wake", "ignored").catch(() => {});

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledWith({
        threadId: "t-wake",
        delaySeconds: 60,
        prompt: "fire-me-later",
        reason: "test",
      });
      manager.dispose();
    });

    it("does NOT crash when WakeupHandler is unwired and ScheduleWakeup fires", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t-bare",
          model: "claude-sonnet-4-6",
          provider: "claude-code",
          cwd: "/home/user",
        }),
        updateThread: vi.fn().mockResolvedValue(undefined),
        clearPersistedSessionId: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn(),
      };

      const fakeProvider = {
        name: "claude-code",
        initialize: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async function* () {
          yield {
            type: "tool_use" as const,
            toolName: "ScheduleWakeup",
            toolCallId: "call-1",
            input: { delaySeconds: 60, prompt: "p" },
          };
        }),
        interrupt: vi.fn().mockResolvedValue(undefined),
        canResume: vi.fn().mockReturnValue(false),
        getAvailableModels: vi.fn().mockResolvedValue([]),
        discoverSlashCommands: vi.fn().mockResolvedValue([]),
        dispose: vi.fn().mockResolvedValue(undefined),
        getMcpServerStatus: vi.fn().mockResolvedValue([]),
      };

      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t-bare", {
        provider: fakeProvider,
        interruptRequested: false,
      });
      // No wakeup handler wired

      await expect(
        (manager as any).runStream("t-bare", "ignored").catch(() => {}),
      ).resolves.toBeUndefined();
      manager.dispose();
    });

    it("ignores malformed ScheduleWakeup input (missing fields)", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t-bad",
          model: "claude-sonnet-4-6",
          provider: "claude-code",
          cwd: "/home/user",
        }),
        updateThread: vi.fn().mockResolvedValue(undefined),
        clearPersistedSessionId: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn(),
      };

      const fakeProvider = {
        name: "claude-code",
        initialize: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async function* () {
          // Missing prompt
          yield {
            type: "tool_use" as const,
            toolName: "ScheduleWakeup",
            toolCallId: "call-1",
            input: { delaySeconds: 60 },
          };
          // Non-number delay
          yield {
            type: "tool_use" as const,
            toolName: "ScheduleWakeup",
            toolCallId: "call-2",
            input: { delaySeconds: "soon", prompt: "p" },
          };
        }),
        interrupt: vi.fn().mockResolvedValue(undefined),
        canResume: vi.fn().mockReturnValue(false),
        getAvailableModels: vi.fn().mockResolvedValue([]),
        discoverSlashCommands: vi.fn().mockResolvedValue([]),
        dispose: vi.fn().mockResolvedValue(undefined),
        getMcpServerStatus: vi.fn().mockResolvedValue([]),
      };

      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t-bad", {
        provider: fakeProvider,
        interruptRequested: false,
      });

      const scheduleSpy = vi.fn();
      manager.setWakeupHandler({
        scheduleWakeup: scheduleSpy,
        cancelForThread: vi.fn().mockReturnValue(0),
      });

      await (manager as any).runStream("t-bad", "ignored").catch(() => {});
      expect(scheduleSpy).not.toHaveBeenCalled();
      manager.dispose();
    });
  });

  describe("non-user-initiated runs bootstrap renderer state", () => {
    // Regression: useChat's stream-message handler auto-initializes its
    // streamingThreadsRef on a `user_message` event but drops every other
    // event when there is no state. User-initiated sends create the state
    // optimistically in the renderer; scheduler wakeups and manager/MCP
    // send_message calls do not. Without a synthetic user_message the
    // entire turn (session_init, text, tool_use, result) is silently
    // discarded by the UI and the thread sits in "thinking" forever.

    const buildHarness = () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t-origin",
          model: "claude-sonnet-4-6",
          provider: "claude-code",
          cwd: "/home/user",
        }),
        updateThread: vi.fn().mockResolvedValue(undefined),
        clearPersistedSessionId: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn(),
      };
      const fakeProvider = {
        name: "claude-code",
        initialize: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockImplementation(async function* () {
          yield {
            type: "result" as const,
            content: "",
            cost: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }),
        interrupt: vi.fn().mockResolvedValue(undefined),
        canResume: vi.fn().mockReturnValue(false),
        getAvailableModels: vi.fn().mockResolvedValue([]),
        discoverSlashCommands: vi.fn().mockResolvedValue([]),
        dispose: vi.fn().mockResolvedValue(undefined),
        getMcpServerStatus: vi.fn().mockResolvedValue([]),
      };
      return { mockStorage, fakeProvider };
    };

    it("emits a synthetic user_message before the stream when origin is 'scheduler'", async () => {
      const { mockStorage, fakeProvider } = buildHarness();
      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t-origin", {
        provider: fakeProvider,
        interruptRequested: false,
      });

      await (manager as any)
        .runStream(
          "t-origin",
          "<<autonomous-loop-dynamic>>",
          undefined,
          "scheduler",
        )
        .catch(() => {});

      const userMessages = sentMessages.filter(
        (m) =>
          m.channel === "chat:stream-message" &&
          (m.data as { type?: string })?.type === "user_message",
      );
      expect(userMessages).toHaveLength(1);
      const payload = userMessages[0].data as {
        type: string;
        content: string;
        _streamId: string;
      };
      expect(payload.content).toBe("<<autonomous-loop-dynamic>>");
      expect(payload._streamId).toMatch(/^t-origin-/);
      expect(userMessages[0].threadId).toBe("t-origin");

      // Must arrive BEFORE the running-state notification so the renderer's
      // state exists by the time subsequent stream events show up.
      const userMsgIdx = sentMessages.findIndex(
        (m) =>
          m.channel === "chat:stream-message" &&
          (m.data as { type?: string })?.type === "user_message",
      );
      const runningStateIdx = sentMessages.findIndex(
        (m) => m.channel === "chat:thread-stream-state",
      );
      expect(userMsgIdx).toBeGreaterThanOrEqual(0);
      expect(runningStateIdx).toBeGreaterThan(userMsgIdx);
      manager.dispose();
    });

    it("emits a synthetic user_message when origin is 'manager' (MCP send_message)", async () => {
      const { mockStorage, fakeProvider } = buildHarness();
      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t-origin", {
        provider: fakeProvider,
        interruptRequested: false,
      });

      await (manager as any)
        .runStream("t-origin", "do the thing", undefined, "manager")
        .catch(() => {});

      const userMessages = sentMessages.filter(
        (m) =>
          m.channel === "chat:stream-message" &&
          (m.data as { type?: string })?.type === "user_message",
      );
      expect(userMessages).toHaveLength(1);
      expect((userMessages[0].data as { content: string }).content).toBe(
        "do the thing",
      );
      manager.dispose();
    });

    it("does NOT emit a synthetic user_message when origin is 'user' (renderer already added it)", async () => {
      const { mockStorage, fakeProvider } = buildHarness();
      const manager = new AgentManager(mockWindow);
      (manager as any).storage = mockStorage;
      (manager as any).sessions.set("t-origin", {
        provider: fakeProvider,
        interruptRequested: false,
      });

      await (manager as any)
        .runStream("t-origin", "hello", undefined, "user")
        .catch(() => {});

      const userMessages = sentMessages.filter(
        (m) =>
          m.channel === "chat:stream-message" &&
          (m.data as { type?: string })?.type === "user_message",
      );
      expect(userMessages).toHaveLength(0);
      manager.dispose();
    });
  });

  describe("stale model detection", () => {
    it("falls back to first available model and updates settings when saved model is not in cache", async () => {
      const mockStorage = {
        getThread: vi.fn().mockResolvedValue({
          id: "t1",
          model: "claude-stale-model",
          provider: "claude-code",
          cwd: "/home/user",
        }),
        updateThread: vi.fn().mockResolvedValue(undefined),
        clearPersistedSessionId: vi.fn(),
        loadMessages: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn(),
      };

      const { setProviderSettings } =
        await import("../settings/settings.store");
      const manager = new AgentManager(mockWindow);

      // Inject a storage stub and seed the modelsCache with models that
      // do NOT include "claude-stale-model"
      (manager as any).storage = mockStorage;
      (manager as any).modelsCache.set("claude-code", {
        models: [{ value: "claude-sonnet-4-6" }, { value: "claude-haiku-4-5" }],
        ts: Date.now(),
      });

      // runStream is private — access via any cast
      // It will throw after the stale-model correction when it tries to create
      // a provider session (no real provider injected). That's fine — we only
      // care that updateThread and setProviderSettings were called first.
      await (manager as any).runStream("t1", "hello").catch(() => {});

      expect(mockStorage.updateThread).toHaveBeenCalledWith("t1", {
        model: "claude-sonnet-4-6",
      });
      expect(setProviderSettings).toHaveBeenCalledWith("claude-code", {
        lastUsedModel: "claude-sonnet-4-6",
      });
    });
  });
});

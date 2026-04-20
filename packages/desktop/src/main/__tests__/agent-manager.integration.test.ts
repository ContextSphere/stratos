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
        status: "completed",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        threadId: "t1",
        status: "completed",
      });

      unsub();
      (manager as any).emitStreamCompleted({
        threadId: "t2",
        status: "error",
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
          status: "completed",
        }),
      ).not.toThrow();
      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

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

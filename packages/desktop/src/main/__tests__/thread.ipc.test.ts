import { beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (...args: unknown[]) => unknown;
const handleMocks = new Map<string, IpcHandler>();
const mockStorage = {
  listThreads: vi.fn().mockReturnValue([]),
  getActiveThreadId: vi.fn(),
  setActiveThreadId: vi.fn(),
  createThread: vi.fn(),
  getThread: vi.fn(),
  updateThread: vi.fn(),
  deleteThread: vi.fn(),
  loadMessages: vi.fn(),
  saveMessages: vi.fn(),
  clearPersistedSessionId: vi.fn(),
  listFolders: vi.fn().mockReturnValue([]),
  addFolder: vi.fn(),
  removeFolder: vi.fn(),
  updateFolder: vi.fn(),
};

const mockBroadcasts: string[] = [];
const mockWindow = {
  isDestroyed: () => false,
  webContents: {
    send: vi.fn((channel: string) => {
      mockBroadcasts.push(channel);
    }),
  },
};

vi.mock("electron", () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handleMocks.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [mockWindow],
  },
}));

const isSdkSessionMissingMock = vi.fn().mockResolvedValue(false);
vi.mock("@stratosapp/core", () => ({
  FileStorageAdapter: vi.fn(function MockFileStorageAdapter() {
    return mockStorage;
  }),
  readTraceEntries: vi.fn(),
  clearTraceFile: vi.fn(),
  isSdkSessionMissing: isSdkSessionMissingMock,
  DEFAULT_PROVIDER: "copilot",
}));

describe("thread IPC session reset behavior", () => {
  let registerThreadIpc: typeof import("../threads/thread.ipc").registerThreadIpc;
  let setThreadSessionClearer: typeof import("../threads/thread.ipc").setThreadSessionClearer;
  let IPC_CHANNELS: typeof import("../../common/ipc-channels").IPC_CHANNELS;
  let clearSession: (threadId: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    handleMocks.clear();
    mockStorage.listThreads.mockReturnValue([]);

    const threadIpc = await import("../threads/thread.ipc");
    const ipcChannels = await import("../../common/ipc-channels");
    registerThreadIpc = threadIpc.registerThreadIpc;
    setThreadSessionClearer = threadIpc.setThreadSessionClearer;
    IPC_CHANNELS = ipcChannels.IPC_CHANNELS;

    clearSession = vi.fn<(threadId: string) => void>();
    setThreadSessionClearer(clearSession);
    registerThreadIpc();
  });

  it("preserves the backend session for mode-only updates", async () => {
    const handler = handleMocks.get(IPC_CHANNELS.THREADS_UPDATE);
    expect(handler).toBeTypeOf("function");

    await handler?.({}, "thread-1", { mode: "bypassPermissions" });

    expect(clearSession).not.toHaveBeenCalled();
    expect(mockStorage.clearPersistedSessionId).not.toHaveBeenCalled();
    expect(mockStorage.updateThread).toHaveBeenCalledWith("thread-1", {
      mode: "bypassPermissions",
    });
  });

  it("clears the backend session for provider changes", async () => {
    const handler = handleMocks.get(IPC_CHANNELS.THREADS_UPDATE);
    expect(handler).toBeTypeOf("function");

    await handler?.({}, "thread-1", { provider: "codex" });

    expect(clearSession).toHaveBeenCalledWith("thread-1");
    expect(mockStorage.clearPersistedSessionId).toHaveBeenCalledWith(
      "thread-1",
    );
    expect(mockStorage.updateThread).toHaveBeenCalledWith("thread-1", {
      provider: "codex",
    });
  });

  it("clears the backend session for cwd changes", async () => {
    const handler = handleMocks.get(IPC_CHANNELS.THREADS_UPDATE);
    expect(handler).toBeTypeOf("function");

    await handler?.({}, "thread-1", { cwd: "/tmp/other" });

    expect(clearSession).toHaveBeenCalledWith("thread-1");
    expect(mockStorage.clearPersistedSessionId).toHaveBeenCalledWith(
      "thread-1",
    );
    expect(mockStorage.updateThread).toHaveBeenCalledWith("thread-1", {
      cwd: "/tmp/other",
    });
  });

  describe("THREADS_LOAD_MESSAGES auto-cleanup", () => {
    beforeEach(() => {
      isSdkSessionMissingMock.mockReset().mockResolvedValue(false);
      mockBroadcasts.length = 0;
    });

    it("deletes a claude-code thread when the SDK JSONL is missing", async () => {
      mockStorage.getThread.mockReturnValue({
        id: "thread-1",
        provider: "claude-code",
        sessionId: "sess-abc",
        cwd: "/tmp/proj",
      });
      isSdkSessionMissingMock.mockResolvedValueOnce(true);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LOAD_MESSAGES);
      const result = await handler?.({}, "thread-1");

      expect(isSdkSessionMissingMock).toHaveBeenCalledWith(
        "sess-abc",
        "/tmp/proj",
      );
      expect(clearSession).toHaveBeenCalledWith("thread-1");
      expect(mockStorage.deleteThread).toHaveBeenCalledWith("thread-1");
      expect(mockBroadcasts).toContain(IPC_CHANNELS.THREADS_CHANGED);
      expect(mockStorage.loadMessages).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("loads normally when the SDK JSONL exists", async () => {
      mockStorage.getThread.mockReturnValue({
        id: "thread-1",
        provider: "claude-code",
        sessionId: "sess-abc",
        cwd: "/tmp/proj",
      });
      mockStorage.loadMessages.mockResolvedValueOnce([
        { id: "m1", role: "user", content: "hi", timestamp: 1 },
      ]);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LOAD_MESSAGES);
      const result = await handler?.({}, "thread-1");

      expect(mockStorage.deleteThread).not.toHaveBeenCalled();
      expect(mockStorage.loadMessages).toHaveBeenCalledWith("thread-1");
      expect(result).toHaveLength(1);
    });

    it("skips the check for non-claude-code threads", async () => {
      mockStorage.getThread.mockReturnValue({
        id: "thread-1",
        provider: "codex",
        sessionId: "sess-abc",
        cwd: "/tmp/proj",
      });
      mockStorage.loadMessages.mockResolvedValueOnce([]);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LOAD_MESSAGES);
      await handler?.({}, "thread-1");

      expect(isSdkSessionMissingMock).not.toHaveBeenCalled();
      expect(mockStorage.loadMessages).toHaveBeenCalledWith("thread-1");
    });

    it("skips the check for threads with no sessionId", async () => {
      mockStorage.getThread.mockReturnValue({
        id: "thread-1",
        provider: "claude-code",
        sessionId: undefined,
        cwd: "/tmp/proj",
      });
      mockStorage.loadMessages.mockResolvedValueOnce([]);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LOAD_MESSAGES);
      await handler?.({}, "thread-1");

      expect(isSdkSessionMissingMock).not.toHaveBeenCalled();
    });
  });

  describe("THREADS_LIST reaping", () => {
    beforeEach(() => {
      isSdkSessionMissingMock.mockReset().mockResolvedValue(false);
      mockBroadcasts.length = 0;
    });

    it("filters out and deletes stale claude-code threads", async () => {
      const alive = {
        id: "alive",
        provider: "claude-code" as const,
        sessionId: "s-alive",
        cwd: "/tmp/alive",
      };
      const stale = {
        id: "stale",
        provider: "claude-code" as const,
        sessionId: "s-stale",
        cwd: "/tmp/stale",
      };
      mockStorage.listThreads.mockReturnValue([alive, stale]);
      // Second call returns "stale" as missing
      isSdkSessionMissingMock.mockImplementation(
        async (sid: string) => sid === "s-stale",
      );

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LIST);
      const result = (await handler?.({})) as (typeof alive)[];

      expect(result.map((t) => t.id)).toEqual(["alive"]);
      expect(clearSession).toHaveBeenCalledWith("stale");
      expect(clearSession).not.toHaveBeenCalledWith("alive");
      expect(mockStorage.deleteThread).toHaveBeenCalledWith("stale");
      expect(mockStorage.deleteThread).not.toHaveBeenCalledWith("alive");
    });

    it("returns the full list untouched when no thread is stale", async () => {
      mockStorage.listThreads.mockReturnValue([
        {
          id: "t1",
          provider: "claude-code",
          sessionId: "s1",
          cwd: "/tmp/1",
        },
        {
          id: "t2",
          provider: "codex",
          sessionId: "s2",
          cwd: "/tmp/2",
        },
      ]);
      isSdkSessionMissingMock.mockResolvedValue(false);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LIST);
      const result = (await handler?.({})) as { id: string }[];

      expect(result.map((t) => t.id)).toEqual(["t1", "t2"]);
      expect(mockStorage.deleteThread).not.toHaveBeenCalled();
    });

    it("does not touch non-claude-code threads or threads without sessionId", async () => {
      mockStorage.listThreads.mockReturnValue([
        {
          id: "codex-thread",
          provider: "codex",
          sessionId: "s-codex",
          cwd: "/tmp/codex",
        },
        {
          id: "no-session",
          provider: "claude-code",
          sessionId: undefined,
          cwd: "/tmp/nosess",
        },
      ]);

      const handler = handleMocks.get(IPC_CHANNELS.THREADS_LIST);
      const result = (await handler?.({})) as { id: string }[];

      expect(result.map((t) => t.id)).toEqual(["codex-thread", "no-session"]);
      expect(isSdkSessionMissingMock).not.toHaveBeenCalled();
      expect(mockStorage.deleteThread).not.toHaveBeenCalled();
    });
  });

  describe("THREADS_CREATE provider settings pre-population", () => {
    // Each test resets modules so the vi.doMock for settings.store takes effect
    // on the fresh thread.ipc import. The outer beforeEach only does clearAllMocks,
    // not resetModules, so we must do it here explicitly.

    it("pre-populates model from provider settings when lastUsedModel is set", async () => {
      vi.resetModules();
      handleMocks.clear();
      vi.doMock("../settings/settings.store", () => ({
        getProviderSettings: vi.fn().mockReturnValue({
          lastUsedModel: "claude-sonnet-4-6",
        }),
        setProviderSettings: vi.fn(),
        updateSettings: vi.fn(),
        loadSettings: vi.fn().mockReturnValue({ theme: "dark" }),
      }));

      const threadIpc = await import("../threads/thread.ipc");
      threadIpc.registerThreadIpc(mockStorage as any);

      const createHandler = handleMocks.get("chat:threads:create");
      mockStorage.createThread.mockResolvedValue({
        id: "t1",
        model: "claude-sonnet-4-6",
      });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.(
        {},
        "New chat",
        undefined,
        "/home/user",
        "claude-code",
      );

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        "claude-sonnet-4-6", // lastUsedModel injected
        "/home/user",
        "claude-code",
      );
      // No effort set — updateThread called only for dev-mode bypass
      expect(mockStorage.updateThread).toHaveBeenCalledWith("t1", {
        mode: "bypassPermissions",
      });
    });

    it("pre-populates thinkingEffort via updateThread when lastUsedEffort is set", async () => {
      vi.resetModules();
      handleMocks.clear();
      vi.doMock("../settings/settings.store", () => ({
        getProviderSettings: vi.fn().mockReturnValue({
          lastUsedModel: "claude-sonnet-4-6",
          lastUsedEffort: "medium",
        }),
        setProviderSettings: vi.fn(),
        updateSettings: vi.fn(),
        loadSettings: vi.fn().mockReturnValue({ theme: "dark" }),
      }));

      const threadIpc = await import("../threads/thread.ipc");
      threadIpc.registerThreadIpc(mockStorage as any);

      const createHandler = handleMocks.get("chat:threads:create");
      mockStorage.createThread.mockResolvedValue({ id: "t1" });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.(
        {},
        "New chat",
        undefined,
        "/home/user",
        "claude-code",
      );

      expect(mockStorage.updateThread).toHaveBeenCalledWith("t1", {
        thinkingEffort: "medium",
        mode: "bypassPermissions",
      });
    });

    it("creates thread without pre-population when no provider settings exist (first launch)", async () => {
      vi.resetModules();
      handleMocks.clear();
      vi.doMock("../settings/settings.store", () => ({
        getProviderSettings: vi.fn().mockReturnValue({}),
        setProviderSettings: vi.fn(),
        updateSettings: vi.fn(),
        loadSettings: vi.fn().mockReturnValue({ theme: "dark" }),
      }));

      const threadIpc = await import("../threads/thread.ipc");
      threadIpc.registerThreadIpc(mockStorage as any);

      const createHandler = handleMocks.get("chat:threads:create");
      mockStorage.createThread.mockResolvedValue({ id: "t1" });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.(
        {},
        "New chat",
        undefined,
        "/home/user",
        "claude-code",
      );

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        undefined, // no pre-population
        "/home/user",
        "claude-code",
      );
      // Dev mode sets bypassPermissions even with no provider prefs
      expect(mockStorage.updateThread).toHaveBeenCalledWith("t1", {
        mode: "bypassPermissions",
      });
    });

    it("defaults new threads to the standard provider when none is passed", async () => {
      vi.resetModules();
      handleMocks.clear();
      const getProviderSettings = vi.fn().mockReturnValue({});
      vi.doMock("../settings/settings.store", () => ({
        getProviderSettings,
        setProviderSettings: vi.fn(),
        updateSettings: vi.fn(),
        loadSettings: vi.fn().mockReturnValue({ theme: "dark" }),
      }));

      const threadIpc = await import("../threads/thread.ipc");
      threadIpc.registerThreadIpc(mockStorage as any);

      const createHandler = handleMocks.get("chat:threads:create");
      mockStorage.createThread.mockResolvedValue({ id: "t1" });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.({}, "New chat", undefined, "/home/user");

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        undefined,
        "/home/user",
        "copilot",
      );
      // Model/effort prefs are looked up against the resolved default provider
      expect(getProviderSettings).toHaveBeenCalledWith("copilot");
    });

    it("honours an explicit provider over the default", async () => {
      vi.resetModules();
      handleMocks.clear();
      vi.doMock("../settings/settings.store", () => ({
        getProviderSettings: vi.fn().mockReturnValue({}),
        setProviderSettings: vi.fn(),
        updateSettings: vi.fn(),
        loadSettings: vi.fn().mockReturnValue({ theme: "dark" }),
      }));

      const threadIpc = await import("../threads/thread.ipc");
      threadIpc.registerThreadIpc(mockStorage as any);

      const createHandler = handleMocks.get("chat:threads:create");
      mockStorage.createThread.mockResolvedValue({ id: "t1" });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.({}, "New chat", undefined, "/home/user", "codex");

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        undefined,
        "/home/user",
        "codex",
      );
    });
  });
});

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

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handleMocks.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
}));

vi.mock("@stratosapp/core", () => ({
  FileStorageAdapter: vi.fn(function MockFileStorageAdapter() {
    return mockStorage;
  }),
  readTraceEntries: vi.fn(),
  clearTraceFile: vi.fn(),
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
      mockStorage.createThread.mockResolvedValue({ id: "t1", model: "claude-sonnet-4-6" });
      mockStorage.updateThread.mockResolvedValue(undefined);

      await createHandler?.({}, "New chat", undefined, "/home/user", "claude-code");

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        "claude-sonnet-4-6", // lastUsedModel injected
        "/home/user",
        "claude-code",
      );
      // No effort set — updateThread must NOT be called
      expect(mockStorage.updateThread).not.toHaveBeenCalled();
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

      await createHandler?.({}, "New chat", undefined, "/home/user", "claude-code");

      expect(mockStorage.updateThread).toHaveBeenCalledWith("t1", {
        thinkingEffort: "medium",
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

      await createHandler?.({}, "New chat", undefined, "/home/user", "claude-code");

      expect(mockStorage.createThread).toHaveBeenCalledWith(
        "New chat",
        undefined, // no pre-population
        "/home/user",
        "claude-code",
      );
      expect(mockStorage.updateThread).not.toHaveBeenCalled();
    });
  });
});

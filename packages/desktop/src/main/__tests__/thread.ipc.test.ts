import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMocks = new Map<string, Function>();
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
    handle: vi.fn((channel: string, handler: Function) => {
      handleMocks.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
}));

vi.mock("@stratosapp/core", () => ({
  FileStorageAdapter: vi.fn(() => mockStorage),
  readTraceEntries: vi.fn(),
  clearTraceFile: vi.fn(),
}));

describe("thread IPC session reset behavior", () => {
  let registerThreadIpc: typeof import("../threads/thread.ipc").registerThreadIpc;
  let setThreadSessionClearer: typeof import("../threads/thread.ipc").setThreadSessionClearer;
  let IPC_CHANNELS: typeof import("../../common/ipc-channels").IPC_CHANNELS;
  let clearSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handleMocks.clear();
    mockStorage.listThreads.mockReturnValue([]);

    const threadIpc = await import("../threads/thread.ipc");
    const ipcChannels = await import("../../common/ipc-channels");
    registerThreadIpc = threadIpc.registerThreadIpc;
    setThreadSessionClearer = threadIpc.setThreadSessionClearer;
    IPC_CHANNELS = ipcChannels.IPC_CHANNELS;

    clearSession = vi.fn();
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
});

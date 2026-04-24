import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
}));

import { ManagerBridge } from "../manager/manager-bridge";
import { IPC_CHANNELS } from "../../common/ipc-channels";

describe("ManagerBridge — sidebar broadcast events", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWindow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStorage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAgentManager: any;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    mockWindow = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: sendSpy,
      },
    };
    mockStorage = {
      listFolders: vi.fn().mockReturnValue([]),
      addFolder: vi
        .fn()
        .mockReturnValue({ id: "f1", name: "ws", path: "/tmp/ws" }),
      createThread: vi.fn().mockReturnValue({ id: "t1" }),
      updateThread: vi.fn(),
      getThread: vi.fn().mockReturnValue({ id: "t1", isManagerThread: false }),
      deleteThread: vi.fn(),
      removeFolder: vi.fn(),
      getActiveThreadId: vi.fn().mockReturnValue("mgr-thread"),
      setActiveThreadId: vi.fn(),
    };
    mockAgentManager = {
      startStream: vi.fn().mockResolvedValue(undefined),
      isStreaming: vi.fn().mockReturnValue(false),
      clearSession: vi.fn(),
      interruptSession: vi.fn().mockResolvedValue(undefined),
    };
  });

  function makeBridge(): ManagerBridge {
    return new ManagerBridge(
      mockAgentManager,
      mockStorage,
      "/tmp/ignored.sock",
      mockWindow,
    );
  }

  async function dispatch(
    bridge: ManagerBridge,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (bridge as any).dispatch(method, params);
  }

  it("createSession fires THREADS_CHANGED", async () => {
    const bridge = makeBridge();
    mockStorage.listFolders.mockReturnValue([{ id: "f0", path: "/tmp/ws" }]);
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/ws",
      prompt: "hi",
    });
    const calls = sendSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(IPC_CHANNELS.THREADS_CHANGED);
    // Folder was already registered → no FOLDERS_CHANGED
    expect(calls).not.toContain(IPC_CHANNELS.FOLDERS_CHANGED);
  });

  it("createSession fires FOLDERS_CHANGED + THREADS_CHANGED when folder is new", async () => {
    const bridge = makeBridge();
    // listFolders returns empty → folder must be added
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/new-ws",
      prompt: "hi",
    });
    const calls = sendSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(IPC_CHANNELS.FOLDERS_CHANGED);
    expect(calls).toContain(IPC_CHANNELS.THREADS_CHANGED);
  });

  it("createSession preserves the previous activeThreadId", async () => {
    const bridge = makeBridge();
    mockStorage.getActiveThreadId.mockReturnValue("mgr-thread");
    mockStorage.createThread.mockReturnValue({ id: "new-thread" });
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/ws",
      prompt: "hi",
    });
    // FileStorageAdapter.createThread sets activeThreadId to the new thread;
    // the bridge must restore the previous active to avoid yanking the user
    // out of the Manager chat.
    expect(mockStorage.setActiveThreadId).toHaveBeenCalledWith("mgr-thread");
  });

  it("createSession tags the new thread with spawnedBy='manager'", async () => {
    const bridge = makeBridge();
    mockStorage.createThread.mockReturnValue({ id: "new-thread" });
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/ws",
      prompt: "hi",
    });
    // The first updateThread call must include spawnedBy — this is the flag
    // AgentManager's completion event uses to decide whether to notify the
    // Manager Agent when the child finishes.
    const updateCall = mockStorage.updateThread.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as Record<string, unknown> | undefined)?.spawnedBy === "manager",
    );
    expect(updateCall).toBeDefined();
  });

  it("deleteSession fires THREADS_CHANGED", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "delete_session", { threadId: "t1" });
    expect(sendSpy).toHaveBeenCalledWith(IPC_CHANNELS.THREADS_CHANGED);
  });

  it("createWorkspace fires FOLDERS_CHANGED", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "create_workspace", {
      path: "/tmp/ws2",
      name: "ws2",
    });
    expect(sendSpy).toHaveBeenCalledWith(IPC_CHANNELS.FOLDERS_CHANGED);
  });

  it("removeWorkspace fires both FOLDERS_CHANGED and THREADS_CHANGED (cascade)", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "remove_workspace", { folderId: "f1" });
    const calls = sendSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(IPC_CHANNELS.FOLDERS_CHANGED);
    expect(calls).toContain(IPC_CHANNELS.THREADS_CHANGED);
  });

  it("does not broadcast on a destroyed window", async () => {
    mockWindow.isDestroyed = (): boolean => true;
    const bridge = makeBridge();
    await dispatch(bridge, "delete_session", { threadId: "t1" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("sendMessage does not change the list (no broadcast)", async () => {
    const bridge = makeBridge();
    mockAgentManager.isStreaming.mockReturnValue(false);
    await dispatch(bridge, "send_message", {
      threadId: "t1",
      prompt: "hi",
    });
    const calls = sendSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(IPC_CHANNELS.THREADS_CHANGED);
    expect(calls).not.toContain(IPC_CHANNELS.FOLDERS_CHANGED);
  });

  it("stopSession does not change the list (no broadcast)", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "stop_session", { threadId: "t1" });
    const calls = sendSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain(IPC_CHANNELS.THREADS_CHANGED);
    expect(calls).not.toContain(IPC_CHANNELS.FOLDERS_CHANGED);
  });
});

describe("ManagerBridge — image forwarding", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockWindow: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStorage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAgentManager: any;

  const TEST_IMAGES = [
    { dataUrl: "data:image/png;base64,abc123", mimeType: "image/png" },
    { dataUrl: "data:image/jpeg;base64,xyz789", mimeType: "image/jpeg" },
  ];

  beforeEach(() => {
    mockWindow = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    mockStorage = {
      listFolders: vi.fn().mockReturnValue([{ id: "f0", path: "/tmp/ws" }]),
      addFolder: vi
        .fn()
        .mockReturnValue({ id: "f1", name: "ws", path: "/tmp/ws" }),
      createThread: vi.fn().mockReturnValue({ id: "t1" }),
      updateThread: vi.fn(),
      getThread: vi.fn().mockReturnValue({ id: "t1", isManagerThread: false }),
      deleteThread: vi.fn(),
      removeFolder: vi.fn(),
      getActiveThreadId: vi.fn().mockReturnValue("mgr-thread"),
      setActiveThreadId: vi.fn(),
    };
    mockAgentManager = {
      startStream: vi.fn().mockResolvedValue(undefined),
      isStreaming: vi.fn().mockReturnValue(false),
      clearSession: vi.fn(),
      interruptSession: vi.fn().mockResolvedValue(undefined),
    };
  });

  function makeBridge(): ManagerBridge {
    return new ManagerBridge(
      mockAgentManager,
      mockStorage,
      "/tmp/ignored.sock",
      mockWindow,
    );
  }

  async function dispatch(
    bridge: ManagerBridge,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (bridge as any).dispatch(method, params);
  }

  it("createSession forwards images to startStream", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/ws",
      prompt: "analyze this screenshot",
      images: TEST_IMAGES,
    });
    expect(mockAgentManager.startStream).toHaveBeenCalledWith(
      "t1",
      "analyze this screenshot",
      TEST_IMAGES,
    );
  });

  it("createSession passes undefined images when none provided", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "create_session", {
      workspace: "/tmp/ws",
      prompt: "hello",
    });
    expect(mockAgentManager.startStream).toHaveBeenCalledWith(
      "t1",
      "hello",
      undefined,
    );
  });

  it("sendMessage forwards images to startStream", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "send_message", {
      threadId: "t1",
      prompt: "look at these images",
      images: TEST_IMAGES,
    });
    expect(mockAgentManager.startStream).toHaveBeenCalledWith(
      "t1",
      "look at these images",
      TEST_IMAGES,
    );
  });

  it("sendMessage passes undefined images when none provided", async () => {
    const bridge = makeBridge();
    await dispatch(bridge, "send_message", { threadId: "t1", prompt: "hello" });
    expect(mockAgentManager.startStream).toHaveBeenCalledWith(
      "t1",
      "hello",
      undefined,
    );
  });

  it("sendMessage returns 'queued' without calling startStream when session is running", async () => {
    const bridge = makeBridge();
    mockAgentManager.isStreaming.mockReturnValue(true);
    const result = await dispatch(bridge, "send_message", {
      threadId: "t1",
      prompt: "hi",
      images: TEST_IMAGES,
    });
    expect(result).toEqual({ status: "queued" });
    expect(mockAgentManager.startStream).not.toHaveBeenCalled();
  });
});

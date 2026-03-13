// packages/desktop/src/main/files/__tests__/files-watcher.test.ts
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { join, dirname } from "path";

// --- Electron mock ---
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handleMocks = new Map<string, IpcHandler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handleMocks.set(channel, handler);
    }),
    removeHandler: vi.fn(),
  },
}));

// --- fs mock ---
const mockWatcherClose = vi.fn();
const mockWatcherOn = vi.fn().mockReturnThis();
let capturedWatchHandler:
  | ((eventType: string, filename: string | null) => void)
  | null = null;

vi.mock("fs", () => ({
  watch: vi.fn((_, _opts, handler) => {
    capturedWatchHandler = handler;
    return { close: mockWatcherClose, on: mockWatcherOn };
  }),
}));

describe("files watcher IPC", () => {
  let mockWebContents: { send: Mock; isDestroyed: Mock };

  beforeEach(async () => {
    handleMocks.clear();
    capturedWatchHandler = null;
    mockWatcherClose.mockReset();
    mockWatcherOn.mockReset().mockReturnThis();

    mockWebContents = {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    };

    // Re-import to re-register handlers after vi.mock reset
    vi.resetModules();
    const { registerFilesIpc } = await import("../files.ipc");
    registerFilesIpc();
  });

  it("FILES_WATCH_START registers a watcher for the given cwd", async () => {
    const { watch } = await import("fs");
    const handler = handleMocks.get("files:watch-start");
    expect(handler).toBeDefined();

    await handler!({ sender: mockWebContents }, "/some/cwd");
    expect(watch).toHaveBeenCalledWith(
      "/some/cwd",
      { recursive: true },
      expect.any(Function),
    );
  });

  it("FILES_WATCH_START attaches an error handler to prevent crashes", async () => {
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");
    expect(mockWatcherOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("error handler closes the watcher", async () => {
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");
    const [, errorHandler] = mockWatcherOn.mock.calls.find(
      ([evt]) => evt === "error",
    )!;
    errorHandler(new Error("ENOENT"));
    expect(mockWatcherClose).toHaveBeenCalled();
  });

  it("watcher event sends FILES_DIR_CHANGED with the parent directory", async () => {
    vi.useFakeTimers();
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");

    capturedWatchHandler!("change", "src/foo.ts");
    vi.advanceTimersByTime(150);

    expect(mockWebContents.send).toHaveBeenCalledWith(
      "files:dir-changed",
      join("/some/cwd", dirname("src/foo.ts")),
    );
    vi.useRealTimers();
  });

  it("watcher event for root-level file sends cwd as the changed dir", async () => {
    vi.useFakeTimers();
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");

    capturedWatchHandler!("change", "package.json");
    vi.advanceTimersByTime(150);

    expect(mockWebContents.send).toHaveBeenCalledWith(
      "files:dir-changed",
      "/some/cwd",
    );
    vi.useRealTimers();
  });

  it("null filename falls back to cwd", async () => {
    vi.useFakeTimers();
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");

    capturedWatchHandler!("rename", null);
    vi.advanceTimersByTime(150);

    expect(mockWebContents.send).toHaveBeenCalledWith(
      "files:dir-changed",
      "/some/cwd",
    );
    vi.useRealTimers();
  });

  it("does not send if webContents is destroyed", async () => {
    vi.useFakeTimers();
    mockWebContents.isDestroyed.mockReturnValue(true);
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");

    capturedWatchHandler!("change", "src/foo.ts");
    vi.advanceTimersByTime(150);

    expect(mockWebContents.send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("debounces rapid events for the same directory", async () => {
    vi.useFakeTimers();
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/some/cwd");

    capturedWatchHandler!("change", "src/a.ts");
    capturedWatchHandler!("change", "src/b.ts");
    capturedWatchHandler!("change", "src/c.ts");
    vi.advanceTimersByTime(150);

    expect(mockWebContents.send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("FILES_WATCH_STOP closes the watcher", async () => {
    const startHandler = handleMocks.get("files:watch-start");
    await startHandler!({ sender: mockWebContents }, "/some/cwd");

    const stopHandler = handleMocks.get("files:watch-stop");
    expect(stopHandler).toBeDefined();
    await stopHandler!({});

    expect(mockWatcherClose).toHaveBeenCalled();
  });

  it("FILES_WATCH_STOP is a no-op if no watcher is active", async () => {
    const stopHandler = handleMocks.get("files:watch-stop");
    // Should not throw
    await expect(stopHandler!({})).resolves.toBeUndefined();
  });

  it("starting a second watcher closes the first", async () => {
    const handler = handleMocks.get("files:watch-start");
    await handler!({ sender: mockWebContents }, "/cwd-a");
    await handler!({ sender: mockWebContents }, "/cwd-b");
    expect(mockWatcherClose).toHaveBeenCalledTimes(1);
  });
});

import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// ---- Mocks ----------------------------------------------------------------

const handleMocks = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handleMocks.set(channel, handler);
      },
    ),
    removeHandler: vi.fn(),
  },
}));

const mockWatcherClose = vi.fn();
const mockWatcherOn = vi.fn().mockReturnThis();
let capturedWatchHandler:
  | ((eventType: string, filename: string | null) => void)
  | null = null;

vi.mock("fs", () => ({
  watch: vi.fn(
    (
      _path: string,
      _opts: object,
      handler: (e: string, f: string | null) => void,
    ) => {
      capturedWatchHandler = handler;
      return { close: mockWatcherClose, on: mockWatcherOn };
    },
  ),
}));

// ---- Helpers --------------------------------------------------------------

function makeWebContents(destroyed = false): {
  send: Mock;
  isDestroyed: Mock;
} {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(destroyed),
  };
}

async function invoke(
  channel: string,
  wc: ReturnType<typeof makeWebContents>,
  ...args: unknown[]
) {
  const handler = handleMocks.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: wc }, ...args);
}

// ---- Tests ----------------------------------------------------------------

describe("files watcher IPC", () => {
  beforeEach(async () => {
    handleMocks.clear();
    capturedWatchHandler = null;
    mockWatcherClose.mockReset();
    mockWatcherOn.mockReset().mockReturnThis();
    vi.useFakeTimers();
    vi.resetModules();
    const { registerFilesIpc } = await import("../files/files.ipc");
    registerFilesIpc();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("FILES_WATCH_START calls fs.watch with cwd and recursive:true", async () => {
    const { watch } = await import("fs");
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    expect(watch).toHaveBeenCalledWith(
      "/my/project",
      { recursive: true },
      expect.any(Function),
    );
  });

  it("attaches an error handler to prevent process crash", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    expect(mockWatcherOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("error handler closes the watcher", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    const [, errorHandler] = mockWatcherOn.mock.calls.find(
      ([e]) => e === "error",
    )!;
    errorHandler(new Error("ENOENT"));
    expect(mockWatcherClose).toHaveBeenCalled();
  });

  it("sends FILES_DIR_CHANGED after debounce for nested file change", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    capturedWatchHandler!("change", "src/index.ts");
    expect(wc.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(wc.send).toHaveBeenCalledWith(
      "files:dir-changed",
      "/my/project/src",
    );
  });

  it("sends cwd when filename is a root-level file", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    capturedWatchHandler!("change", "package.json");
    vi.advanceTimersByTime(100);
    expect(wc.send).toHaveBeenCalledWith("files:dir-changed", "/my/project");
  });

  it("sends cwd when filename is null", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    capturedWatchHandler!("rename", null);
    vi.advanceTimersByTime(100);
    expect(wc.send).toHaveBeenCalledWith("files:dir-changed", "/my/project");
  });

  it("skips send if webContents is destroyed", async () => {
    const wc = makeWebContents(true);
    await invoke("files:watch-start", wc, "/my/project");
    capturedWatchHandler!("change", "src/foo.ts");
    vi.advanceTimersByTime(100);
    expect(wc.send).not.toHaveBeenCalled();
  });

  it("debounces rapid changes to the same dir into one send", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    capturedWatchHandler!("change", "src/a.ts");
    capturedWatchHandler!("change", "src/b.ts");
    capturedWatchHandler!("change", "src/c.ts");
    vi.advanceTimersByTime(100);
    expect(wc.send).toHaveBeenCalledTimes(1);
  });

  it("starting a new watcher closes the previous one", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/cwd-a");
    await invoke("files:watch-start", wc, "/cwd-b");
    expect(mockWatcherClose).toHaveBeenCalledTimes(1);
  });

  it("FILES_WATCH_STOP closes the active watcher", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    await invoke("files:watch-stop", wc);
    expect(mockWatcherClose).toHaveBeenCalled();
  });

  it("FILES_WATCH_STOP closes the watcher", async () => {
    const wc = makeWebContents();
    await invoke("files:watch-start", wc, "/my/project");
    await invoke("files:watch-stop", wc);
    expect(mockWatcherClose).toHaveBeenCalledTimes(1);
  });

  it("FILES_WATCH_STOP is a no-op when no watcher is active", async () => {
    const wc = makeWebContents();
    await expect(invoke("files:watch-stop", wc)).resolves.toBeUndefined();
  });
});

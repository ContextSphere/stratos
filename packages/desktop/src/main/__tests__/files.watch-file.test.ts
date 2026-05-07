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

const watchFileMock = vi.fn();
const unwatchFileMock = vi.fn();
const watchMock = vi.fn().mockReturnValue({
  close: vi.fn(),
  on: vi.fn().mockReturnThis(),
});

let capturedListener:
  | ((curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void)
  | null = null;

vi.mock("fs", () => ({
  watch: (...args: unknown[]) => watchMock(...args),
  watchFile: (
    _path: string,
    _opts: { interval: number },
    listener: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void,
  ) => {
    capturedListener = listener;
    watchFileMock(_path, _opts, listener);
  },
  unwatchFile: (path: string, listener: unknown) =>
    unwatchFileMock(path, listener),
}));

const readFileMock = vi.fn();
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: (...args: unknown[]) => readFileMock(...args),
  stat: vi.fn(),
  writeFile: vi.fn(),
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

async function flushPromises() {
  await new Promise((r) => setImmediate(r));
}

// ---- Tests ----------------------------------------------------------------

describe("per-file watcher IPC", () => {
  beforeEach(async () => {
    handleMocks.clear();
    capturedListener = null;
    watchFileMock.mockReset();
    unwatchFileMock.mockReset();
    readFileMock.mockReset();
    vi.resetModules();
    const { registerFilesIpc } = await import("../files/files.ipc");
    registerFilesIpc();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("FILES_FILE_WATCH_START calls fs.watchFile with mtime polling", async () => {
    const wc = makeWebContents();
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    expect(watchFileMock).toHaveBeenCalledWith(
      "/cwd/foo.ts",
      { interval: 1000 },
      expect.any(Function),
    );
  });

  it("rejects path outside rootPath", async () => {
    const wc = makeWebContents();
    await expect(
      invoke("files:file-watch-start", wc, {
        filePath: "/elsewhere/foo.ts",
        rootPath: "/cwd",
      }),
    ).rejects.toThrow(/outside allowed/);
  });

  it("ships content + path on mtime change", async () => {
    const wc = makeWebContents();
    readFileMock.mockResolvedValue(Buffer.from("new content"));
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/foo.ts",
      content: "new content",
      isBinary: false,
    });
  });

  it("ignores spurious events where mtime did not change", async () => {
    const wc = makeWebContents();
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 100 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("emits isDeleted when file is removed (mtimeMs goes to 0)", async () => {
    const wc = makeWebContents();
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 0 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/foo.ts",
      isDeleted: true,
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("flags binary files", async () => {
    const wc = makeWebContents();
    const buf = Buffer.alloc(64);
    buf[10] = 0; // null byte → binary marker
    readFileMock.mockResolvedValue(buf);
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/binary.dat",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/binary.dat",
      content: "",
      isBinary: true,
    });
  });

  it("flags too-large text files", async () => {
    const wc = makeWebContents();
    readFileMock.mockResolvedValue(Buffer.alloc(2 * 1024 * 1024)); // 2MB
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/big.txt",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/big.txt",
      content: "",
      isBinary: false,
      tooLarge: true,
    });
  });

  it("emits image data URL for image files", async () => {
    const wc = makeWebContents();
    readFileMock.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/icon.png",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/icon.png",
      content: expect.stringMatching(/^data:image\/png;base64,/),
      isBinary: true,
      isImage: true,
    });
  });

  it("emits isDeleted on read failure (file removed between events)", async () => {
    const wc = makeWebContents();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).toHaveBeenCalledWith("files:file-changed", {
      filePath: "/cwd/foo.ts",
      isDeleted: true,
    });
  });

  it("skips send when webContents is destroyed", async () => {
    const wc = makeWebContents(true);
    readFileMock.mockResolvedValue(Buffer.from("hi"));
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    capturedListener!({ mtimeMs: 200 }, { mtimeMs: 100 });
    await flushPromises();
    expect(wc.send).not.toHaveBeenCalled();
  });

  it("is idempotent: starting the same watcher twice is a no-op", async () => {
    const wc = makeWebContents();
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    expect(watchFileMock).toHaveBeenCalledTimes(1);
  });

  it("FILES_FILE_WATCH_STOP calls fs.unwatchFile", async () => {
    const wc = makeWebContents();
    await invoke("files:file-watch-start", wc, {
      filePath: "/cwd/foo.ts",
      rootPath: "/cwd",
    });
    await invoke("files:file-watch-stop", wc, { filePath: "/cwd/foo.ts" });
    expect(unwatchFileMock).toHaveBeenCalledWith(
      "/cwd/foo.ts",
      expect.any(Function),
    );
  });

  it("STOP without prior START is a no-op", async () => {
    const wc = makeWebContents();
    await expect(
      invoke("files:file-watch-stop", wc, { filePath: "/cwd/foo.ts" }),
    ).resolves.toBeUndefined();
    expect(unwatchFileMock).not.toHaveBeenCalled();
  });
});

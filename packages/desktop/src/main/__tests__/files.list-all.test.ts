import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock fs/promises readdir only — keep other fns from the real module
const readdirMock = vi.fn();
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readdir: readdirMock };
});

// Mock fs (watcher) so registerFilesIpc doesn't blow up on import
vi.mock("fs", () => ({
  watch: vi.fn(() => ({ close: vi.fn(), on: vi.fn().mockReturnThis() })),
}));

// ---- Helpers --------------------------------------------------------------

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handleMocks.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler(
    { sender: { isDestroyed: () => false, send: vi.fn() } },
    ...args,
  );
}

// ---- Tests ----------------------------------------------------------------

describe("files:list-all", () => {
  beforeEach(async () => {
    handleMocks.clear();
    vi.resetAllMocks();
    const { registerFilesIpc } = await import("../files/files.ipc");
    registerFilesIpc();
  });

  it("returns flat list of relative paths for a flat directory", async () => {
    readdirMock.mockResolvedValueOnce([
      { name: "App.tsx", isDirectory: () => false },
      { name: "main.ts", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["App.tsx", "main.ts"]);
  });

  it("recurses into subdirectories", async () => {
    // First call: root
    readdirMock.mockResolvedValueOnce([
      { name: "src", isDirectory: () => true },
      { name: "README.md", isDirectory: () => false },
    ]);
    // Second call: src/
    readdirMock.mockResolvedValueOnce([
      { name: "App.tsx", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["README.md", "src/App.tsx"]);
  });

  it("skips node_modules, .git, dist, build, .next, .turbo", async () => {
    readdirMock.mockResolvedValueOnce([
      { name: "node_modules", isDirectory: () => true },
      { name: ".git", isDirectory: () => true },
      { name: "dist", isDirectory: () => true },
      { name: "build", isDirectory: () => true },
      { name: ".next", isDirectory: () => true },
      { name: ".turbo", isDirectory: () => true },
      { name: "index.ts", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["index.ts"]);
    // readdir called only once (skipped dirs never walked)
    expect(readdirMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when readdir throws", async () => {
    readdirMock.mockRejectedValueOnce(new Error("ENOENT"));
    const result = await invoke("files:list-all", "/nonexistent");
    expect(result).toEqual([]);
  });

  it("skips expanded ignore set (target, .gradle, .idea, .pnpm, Pods, etc.)", async () => {
    readdirMock.mockResolvedValueOnce([
      { name: "target", isDirectory: () => true },
      { name: ".gradle", isDirectory: () => true },
      { name: ".idea", isDirectory: () => true },
      { name: ".pnpm", isDirectory: () => true },
      { name: "Pods", isDirectory: () => true },
      { name: "DerivedData", isDirectory: () => true },
      { name: ".cache", isDirectory: () => true },
      { name: "out", isDirectory: () => true },
      { name: "venv", isDirectory: () => true },
      { name: "__pycache__", isDirectory: () => true },
      { name: "vendor", isDirectory: () => true },
      { name: "Main.kt", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["Main.kt"]);
    expect(readdirMock).toHaveBeenCalledTimes(1);
  });

  it("caps result at 5000 entries to prevent OOM on huge workspaces", async () => {
    // Single directory containing 10K files. The walk should stop at 5000.
    const entries = Array.from({ length: 10_000 }, (_, i) => ({
      name: `file-${i}.ts`,
      isDirectory: () => false,
    }));
    readdirMock.mockResolvedValueOnce(entries);

    const result = (await invoke("files:list-all", "/project")) as string[];
    expect(result.length).toBe(5000);
    // First and last paths come from the start of the listing
    expect(result[0]).toBe("file-0.ts");
    expect(result[4999]).toBe("file-4999.ts");
  });
});

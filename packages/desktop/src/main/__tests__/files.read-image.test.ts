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

const readFileMock = vi.fn();
const statMock = vi.fn();
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readFile: readFileMock, stat: statMock };
});

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

describe("files:read-file image handling", () => {
  beforeEach(async () => {
    handleMocks.clear();
    vi.resetAllMocks();
    const { registerFilesIpc } = await import("../files/files.ipc");
    registerFilesIpc();
  });

  it("returns base64 data URL for .png files", async () => {
    statMock.mockResolvedValueOnce({ size: 4 });
    readFileMock.mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = (await invoke(
      "files:read-file",
      "/project/img.png",
      "/project",
    )) as { content: string; isBinary: boolean; isImage?: boolean };

    expect(result.isImage).toBe(true);
    expect(result.isBinary).toBe(true);
    expect(result.content).toBe(
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`,
    );
  });

  it("uses correct mime for jpg/jpeg/gif/webp/svg", async () => {
    const cases: Array<[string, string]> = [
      ["pic.jpg", "image/jpeg"],
      ["pic.jpeg", "image/jpeg"],
      ["pic.gif", "image/gif"],
      ["pic.webp", "image/webp"],
      ["pic.svg", "image/svg+xml"],
    ];
    for (const [name, mime] of cases) {
      statMock.mockResolvedValueOnce({ size: 1 });
      readFileMock.mockResolvedValueOnce(Buffer.from([0x00]));
      const result = (await invoke(
        "files:read-file",
        `/project/${name}`,
        "/project",
      )) as { content: string };
      expect(result.content.startsWith(`data:${mime};base64,`)).toBe(true);
    }
  });

  it("treats image extension lookup as case-insensitive", async () => {
    statMock.mockResolvedValueOnce({ size: 1 });
    readFileMock.mockResolvedValueOnce(Buffer.from([0xff]));

    const result = (await invoke(
      "files:read-file",
      "/project/IMG.PNG",
      "/project",
    )) as { isImage?: boolean; content: string };

    expect(result.isImage).toBe(true);
    expect(result.content.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("returns isImage: true with empty content for images > 10MB", async () => {
    statMock.mockResolvedValueOnce({ size: 11 * 1024 * 1024 });

    const result = (await invoke(
      "files:read-file",
      "/project/huge.png",
      "/project",
    )) as { content: string; isBinary: boolean; isImage?: boolean };

    expect(result.isImage).toBe(true);
    expect(result.isBinary).toBe(true);
    expect(result.content).toBe("");
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("does not flag non-image binary files as images", async () => {
    statMock.mockResolvedValueOnce({ size: 4 });
    readFileMock.mockResolvedValueOnce(Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = (await invoke(
      "files:read-file",
      "/project/binary.bin",
      "/project",
    )) as { content: string; isBinary: boolean; isImage?: boolean };

    expect(result.isImage).toBeUndefined();
    expect(result.isBinary).toBe(true);
    expect(result.content).toBe("");
  });

  it("still returns plain text for non-image files", async () => {
    statMock.mockResolvedValueOnce({ size: 5 });
    readFileMock.mockResolvedValueOnce(Buffer.from("hello", "utf-8"));

    const result = (await invoke(
      "files:read-file",
      "/project/readme.txt",
      "/project",
    )) as { content: string; isBinary: boolean; isImage?: boolean };

    expect(result.isImage).toBeUndefined();
    expect(result.isBinary).toBe(false);
    expect(result.content).toBe("hello");
  });

  it("rejects paths outside the root", async () => {
    await expect(
      invoke("files:read-file", "/etc/passwd", "/project"),
    ).rejects.toThrow("Path outside allowed directory");
    expect(statMock).not.toHaveBeenCalled();
  });
});

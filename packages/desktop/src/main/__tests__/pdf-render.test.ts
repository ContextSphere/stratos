import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn();
const execFileMock = vi.fn();
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: { ...actual.promises, access: accessMock },
  };
});
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, access: accessMock };
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFile: execFileMock };
});

async function importFresh() {
  vi.resetModules();
  return import("../pdf-render");
}

describe("pdf-render — soffice discovery", () => {
  beforeEach(() => {
    accessMock.mockReset();
    execFileMock.mockReset();
  });

  it("reports installed when a known soffice path exists", async () => {
    accessMock.mockResolvedValueOnce(undefined);
    const { getLibreOfficeStatus } = await importFresh();
    const status = await getLibreOfficeStatus();
    expect(status.installed).toBe(true);
    expect(status.path).toMatch(/soffice$/);
  });

  it("reports not installed and canAutoInstall on macOS when no path resolves", async () => {
    accessMock.mockRejectedValue(new Error("ENOENT"));
    // execFile callback shape: (cmd, args, cb) => cb(err, {stdout, stderr})
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        cb: (
          err: Error | null,
          stdio?: { stdout: string; stderr: string },
        ) => void,
      ) => {
        cb(new Error("not found"));
      },
    );
    Object.defineProperty(process, "platform", { value: "darwin" });
    const { getLibreOfficeStatus } = await importFresh();
    const status = await getLibreOfficeStatus();
    expect(status.installed).toBe(false);
    expect(status.path).toBeNull();
    expect(status.canAutoInstall).toBe(true);
  });

  it("exports the MISSING_LIBREOFFICE error prefix used by the UI", async () => {
    const { MISSING_LIBREOFFICE_ERROR, MISSING_POPPLER_ERROR } =
      await importFresh();
    expect(MISSING_LIBREOFFICE_ERROR).toBe("MISSING_LIBREOFFICE");
    expect(MISSING_POPPLER_ERROR).toBe("MISSING_POPPLER");
  });
});

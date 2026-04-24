/**
 * Transport-agnostic tests for the preview handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createPreviewHandlers } from "../mcp/handlers/preview";
import { IPC_CHANNELS } from "../../common/ipc-channels";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

function byName(defs: ReturnType<typeof createPreviewHandlers>, name: string) {
  const d = defs.find((h) => h.name === name);
  if (!d) throw new Error(`missing tool: ${name}`);
  return d;
}

describe("preview handlers", () => {
  let tmp: string;
  let send: ReturnType<typeof vi.fn> & ((channel: string, data: unknown) => void);

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "stratos-handlers-prev-"));
    send = vi.fn() as typeof send;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("produces exactly 2 tools", () => {
    const defs = createPreviewHandlers({ sendToRenderer: send });
    expect(defs.map((d) => d.name).sort()).toEqual([
      "preview_close",
      "preview_open_file",
    ]);
  });

  it("preview_open_file sends markdown payload for .md file", async () => {
    const file = join(tmp, "doc.md");
    writeFileSync(file, "# hi", "utf-8");
    const defs = createPreviewHandlers({ sendToRenderer: send });

    const res = await byName(defs, "preview_open_file").handler({
      file_path: file,
    });

    expect(res.isError).toBeFalsy();
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
      expect.objectContaining({ content: "# hi", title: "doc.md" }),
    );
    // markdown payload should not include filePath
    expect(
      (send.mock.calls[0][1] as Record<string, unknown>).filePath,
    ).toBeUndefined();
  });

  it("preview_open_file sends code-editor payload (with filePath) for non-markdown", async () => {
    const file = join(tmp, "a.ts");
    writeFileSync(file, "export {}", "utf-8");
    const defs = createPreviewHandlers({ sendToRenderer: send });

    await byName(defs, "preview_open_file").handler({
      file_path: file,
      title: "My TS",
    });

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN, {
      content: "export {}",
      title: "My TS",
      filePath: file,
    });
  });

  it("preview_open_file returns error on missing file", async () => {
    const defs = createPreviewHandlers({ sendToRenderer: send });
    const res = await byName(defs, "preview_open_file").handler({
      file_path: join(tmp, "nope.md"),
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Cannot read/);
    expect(send).not.toHaveBeenCalled();
  });

  it("preview_close dispatches PREVIEW_CLOSE", async () => {
    const defs = createPreviewHandlers({ sendToRenderer: send });
    const res = await byName(defs, "preview_close").handler({});
    expect(res.isError).toBeFalsy();
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.PREVIEW_CLOSE, {});
  });
});

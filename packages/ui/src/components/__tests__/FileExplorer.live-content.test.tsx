import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import type { FileChangeEvent, DirEntry } from "../../bridges/types";

// Avoid pulling Monaco into jsdom — it crashes with "window.matchMedia is not
// a function" and similar. Render a minimal stand-in that simply prints the
// value so we can assert content updates without spinning up the editor.
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="monaco">{value}</div>
  ),
  Editor: ({ value }: { value: string }) => (
    <div data-testid="monaco">{value}</div>
  ),
}));

vi.mock("../../hooks/useMonacoFontReady", () => ({
  useMonacoFontReady: () => undefined,
}));

vi.mock("../../utils/monaco-theme", () => ({}));

vi.mock("../../utils/monaco-language", () => ({
  getLanguageFromPath: () => "typescript",
  MONO_FONT_FAMILY: "monospace",
}));

vi.mock("./preview/MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

import { FileExplorer } from "../FileExplorer";

function makeBridge(initial: { content: string }) {
  let fileListener: ((e: FileChangeEvent) => void) | null = null;
  const listDirectory = vi.fn(
    async (_: string, __: string): Promise<DirEntry[]> => [
      { name: "foo.ts", type: "file", size: 100 },
    ],
  );
  const readFile = vi.fn(async () => ({
    content: initial.content,
    isBinary: false,
  }));
  const watchFile = vi.fn(async () => undefined);
  const unwatchFile = vi.fn(async () => undefined);
  const onFileChanged = vi.fn((cb: (e: FileChangeEvent) => void) => {
    fileListener = cb;
    return () => {
      fileListener = null;
    };
  });
  return {
    listDirectory,
    readFile,
    watchFile,
    unwatchFile,
    onFileChanged,
    emit: (event: FileChangeEvent) => {
      if (fileListener) fileListener(event);
    },
  };
}

describe("FileExplorer — live content refresh", () => {
  afterEach(() => {
    cleanup();
  });

  it("auto-updates the open file when onFileChanged fires", async () => {
    const bridge = makeBridge({ content: "old content" });

    render(
      <FileExplorer
        cwd="/cwd"
        targetFilePath="/cwd/foo.ts"
        listDirectory={bridge.listDirectory}
        readFile={bridge.readFile}
        watchFile={bridge.watchFile}
        unwatchFile={bridge.unwatchFile}
        onFileChanged={bridge.onFileChanged}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());
    expect(screen.getByTestId("monaco").textContent).toBe("old content");
    expect(bridge.watchFile).toHaveBeenCalledWith("/cwd/foo.ts", "/cwd");

    act(() => {
      bridge.emit({
        filePath: "/cwd/foo.ts",
        content: "fresh from disk",
        isBinary: false,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("monaco").textContent).toBe("fresh from disk"),
    );
  });

  it("ignores onFileChanged events for a different path", async () => {
    const bridge = makeBridge({ content: "stay" });

    render(
      <FileExplorer
        cwd="/cwd"
        targetFilePath="/cwd/foo.ts"
        listDirectory={bridge.listDirectory}
        readFile={bridge.readFile}
        watchFile={bridge.watchFile}
        unwatchFile={bridge.unwatchFile}
        onFileChanged={bridge.onFileChanged}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());

    act(() => {
      bridge.emit({
        filePath: "/cwd/different.ts",
        content: "should not appear",
        isBinary: false,
      });
    });

    expect(screen.getByTestId("monaco").textContent).toBe("stay");
  });

  it("shows 'no longer available' when the file is deleted on disk", async () => {
    const bridge = makeBridge({ content: "before delete" });

    render(
      <FileExplorer
        cwd="/cwd"
        targetFilePath="/cwd/foo.ts"
        listDirectory={bridge.listDirectory}
        readFile={bridge.readFile}
        watchFile={bridge.watchFile}
        unwatchFile={bridge.unwatchFile}
        onFileChanged={bridge.onFileChanged}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());

    act(() => {
      bridge.emit({ filePath: "/cwd/foo.ts", isDeleted: true });
    });

    await waitFor(() =>
      expect(screen.getByTestId("monaco").textContent).toBe(
        "File no longer available",
      ),
    );
  });

  it("calls watchFile on mount and unwatchFile on unmount", async () => {
    const bridge = makeBridge({ content: "x" });

    const { unmount } = render(
      <FileExplorer
        cwd="/cwd"
        targetFilePath="/cwd/foo.ts"
        listDirectory={bridge.listDirectory}
        readFile={bridge.readFile}
        watchFile={bridge.watchFile}
        unwatchFile={bridge.unwatchFile}
        onFileChanged={bridge.onFileChanged}
      />,
    );

    await waitFor(() => expect(bridge.watchFile).toHaveBeenCalled());

    unmount();
    expect(bridge.unwatchFile).toHaveBeenCalledWith("/cwd/foo.ts");
  });

  it("does not start a per-file watcher when no file is open", async () => {
    const bridge = makeBridge({ content: "" });

    render(
      <FileExplorer
        cwd="/cwd"
        listDirectory={bridge.listDirectory}
        readFile={bridge.readFile}
        watchFile={bridge.watchFile}
        unwatchFile={bridge.unwatchFile}
        onFileChanged={bridge.onFileChanged}
      />,
    );

    // Wait for tree load to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.watchFile).not.toHaveBeenCalled();
  });
});

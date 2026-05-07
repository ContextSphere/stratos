import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import type { FileChangeEvent, FilesBridge } from "../../../bridges/types";

vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => (
    <div data-testid="monaco">{value}</div>
  ),
  Editor: ({ value }: { value: string }) => (
    <div data-testid="monaco">{value}</div>
  ),
}));

vi.mock("../../../hooks/useMonacoFontReady", () => ({
  useMonacoFontReady: () => undefined,
}));

vi.mock("../../../utils/monaco-theme", () => ({}));

vi.mock("../../../utils/monaco-language", () => ({
  getLanguageFromPath: () => "typescript",
  MONO_FONT_FAMILY: "monospace",
}));

vi.mock("../MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="md">{content}</div>
  ),
}));

import { ArtifactEditorPreview } from "../ArtifactEditorPreview";

function makeBridge() {
  let listener: ((e: FileChangeEvent) => void) | null = null;
  const bridge: Partial<FilesBridge> = {
    watchFile: vi.fn(async () => undefined),
    unwatchFile: vi.fn(async () => undefined),
    onFileChanged: vi.fn((cb: (e: FileChangeEvent) => void) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
  };
  return {
    bridge: bridge as FilesBridge,
    emit: (e: FileChangeEvent) => {
      if (listener) listener(e);
    },
  };
}

describe("ArtifactEditorPreview — live content refresh", () => {
  afterEach(() => cleanup());

  it("starts a per-file watcher on mount", async () => {
    const { bridge } = makeBridge();
    render(
      <ArtifactEditorPreview
        content="initial"
        filePath="/abs/foo.ts"
        filesBridge={bridge}
      />,
    );
    await waitFor(() => expect(bridge.watchFile).toHaveBeenCalled());
    expect(bridge.watchFile).toHaveBeenCalledWith("/abs/foo.ts", "/abs/foo.ts");
  });

  it("updates content when an onFileChanged event arrives", async () => {
    const { bridge, emit } = makeBridge();
    render(
      <ArtifactEditorPreview
        content="old"
        filePath="/abs/foo.ts"
        filesBridge={bridge}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());
    expect(screen.getByTestId("monaco").textContent).toBe("old");

    act(() => {
      emit({ filePath: "/abs/foo.ts", content: "new", isBinary: false });
    });

    await waitFor(() =>
      expect(screen.getByTestId("monaco").textContent).toBe("new"),
    );
  });

  it("ignores events for a different file path", async () => {
    const { bridge, emit } = makeBridge();
    render(
      <ArtifactEditorPreview
        content="stay"
        filePath="/abs/foo.ts"
        filesBridge={bridge}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());

    act(() => {
      emit({
        filePath: "/abs/different.ts",
        content: "wrong",
        isBinary: false,
      });
    });

    expect(screen.getByTestId("monaco").textContent).toBe("stay");
  });

  it("ignores deleted-file events to avoid blanking the editor", async () => {
    const { bridge, emit } = makeBridge();
    render(
      <ArtifactEditorPreview
        content="keep me"
        filePath="/abs/foo.ts"
        filesBridge={bridge}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("monaco")).toBeTruthy());

    act(() => {
      emit({ filePath: "/abs/foo.ts", isDeleted: true });
    });

    expect(screen.getByTestId("monaco").textContent).toBe("keep me");
  });

  it("calls unwatchFile on unmount", async () => {
    const { bridge } = makeBridge();
    const { unmount } = render(
      <ArtifactEditorPreview
        content="x"
        filePath="/abs/foo.ts"
        filesBridge={bridge}
      />,
    );
    await waitFor(() => expect(bridge.watchFile).toHaveBeenCalled());
    unmount();
    expect(bridge.unwatchFile).toHaveBeenCalledWith("/abs/foo.ts");
  });

  it("renders without filesBridge (graceful degradation)", () => {
    expect(() =>
      render(
        <ArtifactEditorPreview content="standalone" filePath="/abs/foo.ts" />,
      ),
    ).not.toThrow();
  });
});

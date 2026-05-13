import { useState, useEffect, useCallback, useRef } from "react";
import type { PreviewState } from "@stratosapp/ui";

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch {
    return url.slice(0, 50);
  }
}

const INITIAL_STATE: PreviewState = { isOpen: false, type: "url", title: "" };

export function usePreview(activeThreadId?: string | null) {
  const [preview, setPreview] = useState<PreviewState>(INITIAL_STATE);
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const previewTypeRef = useRef(preview.type);
  previewTypeRef.current = preview.type;

  const openUrl = useCallback((url: string) => {
    setPreview({ isOpen: true, type: "url", url, title: titleFromUrl(url) });
  }, []);

  const openMarkdown = useCallback((content: string, title: string) => {
    setPreview({
      isOpen: true,
      type: "markdown",
      markdownContent: content,
      title,
    });
  }, []);

  const openArtifactEditor = useCallback(
    (content: string, filePath: string) => {
      setPreview({
        isOpen: true,
        type: "artifact-editor",
        title: filePath,
        artifactContent: content,
        artifactFilePath: filePath,
      });
    },
    [],
  );

  const openImage = useCallback(
    (filePath: string, title: string, dataUrl: string) => {
      setPreview({
        isOpen: true,
        type: "image",
        title,
        imageFilePath: filePath,
        imageDataUrl: dataUrl,
      });
    },
    [],
  );

  const openPdf = useCallback(
    (pdfFilePath: string, sourceFilePath: string, title: string) => {
      setPreview({
        isOpen: true,
        type: "pdf",
        title,
        pdfFilePath,
        pdfSourceFilePath: sourceFilePath,
      });
    },
    [],
  );

  const openFileExplorer = useCallback(
    (cwd: string, targetFilePath?: string, targetLine?: number) => {
      setPreview({
        isOpen: true,
        type: "file-explorer",
        title: targetFilePath ?? "",
        cwd,
        ...(targetFilePath ? { targetFilePath } : {}),
        ...(targetLine ? { targetLine } : {}),
      });
    },
    [],
  );

  const openTerminal = useCallback((cwd: string) => {
    setPreview({
      isOpen: true,
      type: "terminal",
      title: "Terminal",
      cwd,
    });
  }, []);

  const openFileChanges = useCallback(() => {
    setPreview((current) =>
      current.isOpen && current.type === "file-changes"
        ? INITIAL_STATE
        : { isOpen: true, type: "file-changes", title: "Changes" },
    );
  }, []);

  const close = useCallback(() => {
    setPreview(INITIAL_STATE);
  }, []);

  useEffect(() => {
    window.api.onPreviewOpenUrl(openUrl);
    window.api.onPreviewOpenMarkdown(
      ({ content, title, filePath, isImage, threadId }) => {
        if (
          threadId &&
          activeThreadIdRef.current &&
          threadId !== activeThreadIdRef.current
        )
          return;
        // Don't clobber the Changes panel — the user pinned it intentionally
        if (previewTypeRef.current === "file-changes") return;
        if (isImage && filePath) {
          openImage(filePath, title, content);
        } else if (filePath) {
          openArtifactEditor(content, filePath);
        } else {
          openMarkdown(content, title);
        }
      },
    );
    window.api.onPreviewOpenPdf?.(
      ({ pdfPath, sourcePath, title, threadId }) => {
        if (
          threadId &&
          activeThreadIdRef.current &&
          threadId !== activeThreadIdRef.current
        )
          return;
        if (previewTypeRef.current === "file-changes") return;
        openPdf(pdfPath, sourcePath, title);
      },
    );
    window.api.onPreviewClose(close);
  }, [openUrl, openMarkdown, openArtifactEditor, openImage, openPdf, close]);

  return {
    preview,
    openUrl,
    openMarkdown,
    openArtifactEditor,
    openImage,
    openPdf,
    openFileExplorer,
    openTerminal,
    openFileChanges,
    close,
  };
}

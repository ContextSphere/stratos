import { useState, useEffect, useCallback } from "react";
import type { PreviewState } from "@agentpanel/ui";

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname.slice(0, 40);
  } catch {
    return url.slice(0, 50);
  }
}

const INITIAL_STATE: PreviewState = { isOpen: false, type: "url", title: "" };

export function usePreview() {
  const [preview, setPreview] = useState<PreviewState>(INITIAL_STATE);

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

  const openFileExplorer = useCallback((cwd: string) => {
    setPreview({ isOpen: true, type: "file-explorer", title: "Files", cwd });
  }, []);

  const close = useCallback(() => {
    setPreview(INITIAL_STATE);
  }, []);

  useEffect(() => {
    window.api.onPreviewOpenUrl(openUrl);
    window.api.onPreviewOpenMarkdown(({ content, title }) => {
      openMarkdown(content, title);
    });
  }, [openUrl, openMarkdown]);

  return {
    preview,
    openUrl,
    openMarkdown,
    openArtifactEditor,
    openFileExplorer,
    close,
  };
}

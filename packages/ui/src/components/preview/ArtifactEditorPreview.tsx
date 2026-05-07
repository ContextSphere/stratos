import { useState, useRef, useCallback, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useMonacoFontReady } from "../../hooks/useMonacoFontReady";
import { MarkdownPreview } from "./MarkdownPreview";
import "../../utils/monaco-theme";
import { useTheme, monacoThemeName } from "../../context/ThemeContext";
import {
  getLanguageFromPath,
  MONO_FONT_FAMILY,
} from "../../utils/monaco-language";
import type { FilesBridge } from "../../bridges/types";

interface Props {
  content: string;
  filePath: string;
  onSave?: (content: string) => Promise<void>;
  filesBridge?: FilesBridge;
}

export function ArtifactEditorPreview({
  content,
  filePath,
  onSave,
  filesBridge,
}: Props) {
  useMonacoFontReady();
  const theme = useTheme();
  const isMarkdown = filePath.endsWith(".md");
  const [mode, setMode] = useState<"preview" | "raw">(
    isMarkdown ? "preview" : "raw",
  );
  const [currentContent, setCurrentContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "idle"
  >("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = getLanguageFromPath(filePath);

  useEffect(() => {
    setCurrentContent(content);
    setSaveStatus("idle");
    setMode(filePath.endsWith(".md") ? "preview" : "raw");
  }, [content, filePath]);

  const saveToFile = useCallback(
    async (newContent: string) => {
      if (!onSave) return;
      setSaveStatus("saving");
      try {
        await onSave(newContent);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [onSave],
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      setCurrentContent(value);
      setSaveStatus("unsaved");

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveToFile(value), 1000);
    },
    [saveToFile],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Auto-refresh content when the underlying file changes on disk.
  // Same fs.watchFile-backed bridge used by FileExplorer — bulletproof on
  // macOS where fs.watch's recursive option is unreliable.
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  useEffect(() => {
    if (!filesBridge?.watchFile || !filesBridge.unwatchFile) return;
    if (!filesBridge.onFileChanged) return;

    const cleanup = filesBridge.onFileChanged((event) => {
      if (event.filePath !== filePath) return;
      if (event.isDeleted) return;
      // Don't clobber the user's unsaved edits.
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "saving"
      ) {
        return;
      }
      if (event.content !== undefined) {
        setCurrentContent(event.content);
      }
    });
    // rootPath = filePath satisfies isPathWithin trivially. preview_open_file
    // already reads arbitrary absolute paths without a cwd constraint, so the
    // watcher should mirror that.
    void filesBridge.watchFile(filePath, filePath);

    return () => {
      cleanup();
      void filesBridge.unwatchFile?.(filePath);
    };
  }, [filePath, filesBridge]);

  const handleEditorMount: OnMount = (editor) => {
    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      lineNumbers: "on",
      fontSize: 13,
      fontFamily: MONO_FONT_FAMILY,
      fontLigatures: true,
      padding: { top: 12 },
      renderLineHighlight: "line",
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      smoothScrolling: true,
      bracketPairColorization: { enabled: true },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] flex-shrink-0">
        {isMarkdown && (
          <div className="flex rounded-md overflow-hidden border border-[var(--border-mid)]">
            <button
              onClick={() => setMode("preview")}
              className={`px-2.5 py-1 text-xs transition-colors ${
                mode === "preview"
                  ? "bg-[var(--border)] text-gray-200"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setMode("raw")}
              className={`px-2.5 py-1 text-xs transition-colors ${
                mode === "raw"
                  ? "bg-[var(--border)] text-gray-200"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              Raw
            </button>
          </div>
        )}
        <div className="flex-1" />
        {saveStatus === "saving" && (
          <span className="text-xs text-gray-500">Saving...</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-green-500">Saved</span>
        )}
        {saveStatus === "unsaved" && (
          <span className="text-xs text-yellow-500">Unsaved</span>
        )}
      </div>

      {mode === "preview" && isMarkdown ? (
        <MarkdownPreview content={currentContent} />
      ) : (
        <Editor
          height="100%"
          language={language}
          value={currentContent}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          theme={monacoThemeName(theme)}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            lineNumbers: "on",
            fontSize: 13,
            fontFamily: MONO_FONT_FAMILY,
            fontLigatures: true,
            padding: { top: 12 },
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            smoothScrolling: true,
            bracketPairColorization: { enabled: true },
          }}
        />
      )}
    </div>
  );
}

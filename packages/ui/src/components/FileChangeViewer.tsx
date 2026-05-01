import { useState, useEffect, useRef, useCallback } from "react";
import { Editor, DiffEditor } from "@monaco-editor/react";
import { useMonacoFontReady } from "../hooks/useMonacoFontReady";
import type { ToolCall } from "../types";
import {
  getLanguageFromPath,
  MONO_FONT_FAMILY,
  isBinaryFile,
  isImageFile,
  extractImageDataUrl,
  calculateEditorHeight,
  countLines,
  getFileName,
} from "../utils/monaco-language";
import "../utils/monaco-theme";
import { useTheme, monacoThemeName } from "../context/ThemeContext";

interface Props {
  toolCall: ToolCall;
  defaultExpanded?: boolean;
  fillHeight?: boolean;
}

const statusColors: Record<ToolCall["status"], string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  denied: "text-red-400",
};

const statusLabels: Record<ToolCall["status"], string> = {
  pending: "Pending",
  running: "Running...",
  completed: "Done",
  denied: "Denied",
};

// Minimal interfaces for the Monaco scroll APIs we need
type ModelWithValue = { getValue(): string; setValue(v: string): void };
type ScrollableEditor = {
  getScrollTop(): number;
  getScrollHeight(): number;
  getLayoutInfo(): { height: number };
  getModel(): ModelWithValue | null;
};
type DiffEditorInstance = {
  getModifiedEditor(): ScrollableEditor;
  getModel(): { original: ModelWithValue; modified: ModelWithValue } | null;
};

const MAX_LINES_INLINE = 500;
const MAX_VISIBLE_LINES = 30;

function extractFilePath(input: Record<string, unknown>): string {
  return (
    (input.file_path as string | undefined) ??
    (input.filePath as string | undefined) ??
    (input.path as string | undefined) ??
    (input.file as string | undefined) ??
    "Unknown file"
  );
}

function calculateChangeStats(
  oldContent: string,
  newContent: string,
): { added: number; removed: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Simple line-based diff (not perfect but good enough for stats)
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let added = 0;
  let removed = 0;

  for (const line of newLines) {
    if (!oldSet.has(line)) added++;
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) removed++;
  }

  return { added, removed };
}

export function FileChangeViewer({
  toolCall,
  defaultExpanded = true,
  fillHeight = false,
}: Props): React.ReactElement {
  useMonacoFontReady();
  const theme = useTheme();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasEverExpandedRef = useRef(defaultExpanded);
  const [shouldRenderMonaco, setShouldRenderMonaco] = useState(false);
  const editorRef = useRef<ScrollableEditor | null>(null);
  const diffEditorRef = useRef<DiffEditorInstance | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);

  // Bubble wheel events to parent when Monaco is at its scroll boundary.
  // Monaco consumes all wheel events internally; capture-phase interception
  // lets us intercept before Monaco and redirect boundary scrolls upward.
  const getActiveEditor = useCallback(() => {
    if (diffEditorRef.current) return diffEditorRef.current.getModifiedEditor();
    return editorRef.current;
  }, []);

  useEffect(() => {
    const container = monacoContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const editor = getActiveEditor();
      if (!editor) return;

      const scrollTop = editor.getScrollTop();
      const scrollHeight = editor.getScrollHeight();
      const layoutHeight = editor.getLayoutInfo().height;

      const atTop = scrollTop <= 0 && e.deltaY < 0;
      const atBottom =
        scrollTop + layoutHeight >= scrollHeight - 1 && e.deltaY > 0;

      if (atTop || atBottom) {
        e.stopPropagation();
        e.preventDefault();
        // Find nearest scrollable ancestor and scroll it
        let parent = container.parentElement;
        while (parent) {
          const { overflowY } = getComputedStyle(parent);
          if (overflowY === "auto" || overflowY === "scroll") {
            parent.scrollBy({ top: e.deltaY, behavior: "auto" });
            break;
          }
          parent = parent.parentElement;
        }
      }
    };

    container.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      container.removeEventListener("wheel", handleWheel, { capture: true });
  }, [getActiveEditor, shouldRenderMonaco]);

  const filePath = extractFilePath(toolCall.input);
  const fileName = getFileName(filePath);
  const isBinary = isBinaryFile(filePath);
  const isImage = isImageFile(filePath);
  const imageDataUrl = isImage
    ? extractImageDataUrl(toolCall.output ?? "")
    : null;
  const language = getLanguageFromPath(filePath);

  // Debounce Monaco rendering to prevent janky animation on first expand.
  // Once rendered, keep the editor mounted and hide via CSS to avoid
  // a Monaco race condition where TextModel is disposed while DiffEditorWidget
  // is still active ("TextModel got disposed before DiffEditorWidget model got reset").
  useEffect(() => {
    if (isExpanded && !shouldRenderMonaco) {
      const timer = setTimeout(() => setShouldRenderMonaco(true), 150);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, shouldRenderMonaco]);

  // Extract content based on tool type
  let oldContent = "";
  let newContent = "";
  let displayContent = "";
  let isTooLarge = false;

  // Unified diff string (e.g. from Codex provider)
  const unifiedDiff = (toolCall.input.diff as string | undefined) ?? "";

  if (unifiedDiff) {
    // Codex-style: show unified diff with diff syntax highlighting
    displayContent = unifiedDiff;
    isTooLarge = countLines(displayContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Edit") {
    oldContent = (toolCall.input.old_string as string | undefined) ?? "";
    newContent = (toolCall.input.new_string as string | undefined) ?? "";
    isTooLarge = countLines(newContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Write") {
    displayContent = (toolCall.input.content as string | undefined) ?? "";
    isTooLarge = countLines(displayContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Read") {
    displayContent = toolCall.output ?? "";
    isTooLarge = countLines(displayContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Delete") {
    displayContent = "";
  }

  // When content changes (e.g. a second edit to the same file in the panel),
  // imperatively push new values into the already-mounted Monaco models so
  // the diff updates without remounting (which triggers the TextModel race).
  useEffect(() => {
    if (!diffEditorRef.current) return;
    const models = diffEditorRef.current.getModel();
    if (!models) return;
    if (models.original.getValue() !== oldContent)
      models.original.setValue(oldContent);
    if (models.modified.getValue() !== newContent)
      models.modified.setValue(newContent);
  }, [oldContent, newContent]);

  useEffect(() => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const target = unifiedDiff || displayContent;
    if (model.getValue() !== target) model.setValue(target);
  }, [unifiedDiff, displayContent]);

  const changeStats =
    toolCall.toolName === "Edit" && !unifiedDiff
      ? calculateChangeStats(oldContent, newContent)
      : null;
  const height = fillHeight
    ? "100%"
    : calculateEditorHeight(
        toolCall.toolName === "Edit" && !unifiedDiff
          ? newContent
          : displayContent,
        MAX_VISIBLE_LINES,
      );

  const toggleExpand = () => {
    const next = !isExpanded;
    if (next) hasEverExpandedRef.current = true;
    setIsExpanded(next);
  };

  // Binary file indicator
  if (isBinary) {
    return (
      <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {toolCall.toolName}
            </span>
            <span className="text-[var(--text-muted)]">•</span>
            <span className="font-mono text-[var(--text-secondary)]">
              {fileName}
            </span>
          </div>
          <span className={`text-xs ${statusColors[toolCall.status]}`}>
            {statusLabels[toolCall.status]}
          </span>
        </div>
        {imageDataUrl ? (
          <div className="mt-2">
            <img
              src={imageDataUrl}
              alt={fileName}
              className="max-h-48 max-w-full rounded object-contain"
              style={{
                backgroundImage:
                  "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
                backgroundSize: "10px 10px",
                backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
              }}
            />
          </div>
        ) : (
          <div className="mt-2 text-[var(--text-muted)] text-xs">
            📦 Binary file ({fileName.split(".").pop()?.toUpperCase()})
          </div>
        )}
      </div>
    );
  }

  // Empty file indicator
  const isEmpty =
    toolCall.toolName === "Delete"
      ? false
      : toolCall.toolName === "Edit" && !unifiedDiff
        ? !oldContent && !newContent
        : !displayContent;

  if (isEmpty) {
    return (
      <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {toolCall.toolName}
            </span>
            <span className="text-[var(--text-muted)]">•</span>
            <span className="font-mono text-[var(--text-secondary)]">
              {fileName}
            </span>
          </div>
          <span className={`text-xs ${statusColors[toolCall.status]}`}>
            {statusLabels[toolCall.status]}
          </span>
        </div>
        <div className="mt-2 text-[var(--text-muted)] text-xs">
          📄 Empty file
        </div>
      </div>
    );
  }

  // Read tool: show header only, no content
  if (toolCall.toolName === "Read") {
    return (
      <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono font-semibold text-[var(--text-primary)] flex-shrink-0">
              {toolCall.toolName}
            </span>
            <span className="text-[var(--text-muted)] flex-shrink-0">•</span>
            <span
              className="font-mono text-[var(--text-secondary)] truncate"
              title={filePath}
            >
              {fileName}
            </span>
          </div>
          <span
            className={`text-xs ml-2 flex-shrink-0 ${statusColors[toolCall.status]}`}
          >
            {statusLabels[toolCall.status]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] overflow-hidden text-xs ${fillHeight ? "flex flex-col h-full" : ""}`}
    >
      {/* Header - always visible */}
      <button
        onClick={toggleExpand}
        className="w-full p-3 flex items-center justify-between hover:bg-[var(--bg-surface)] transition-colors text-left"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${toolCall.toolName} for ${fileName}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[var(--text-muted)] flex-shrink-0">
            {isExpanded ? "▾" : "▸"}
          </span>
          <span className="font-mono font-semibold text-[var(--text-primary)] flex-shrink-0">
            {toolCall.toolName}
          </span>
          <span className="text-[var(--text-muted)] flex-shrink-0">•</span>
          <span
            className="font-mono text-[var(--text-secondary)] truncate"
            title={filePath}
          >
            {fileName}
          </span>
          {changeStats && (
            <span className="text-[var(--text-muted)] flex-shrink-0 ml-1">
              <span className="text-green-400">+{changeStats.added}</span>{" "}
              <span className="text-red-400">-{changeStats.removed}</span>
            </span>
          )}
        </div>
        <span
          className={`text-xs ml-2 flex-shrink-0 ${statusColors[toolCall.status]}`}
        >
          {statusLabels[toolCall.status]}
        </span>
      </button>

      {/* Non-Monaco content (too large warning or loading placeholder) - safe to mount/unmount */}
      {isExpanded && (isTooLarge || !shouldRenderMonaco) && (
        <div className="border-t border-[var(--border)]">
          {isTooLarge ? (
            // Too large - show message
            <div className="p-4 text-center">
              <div className="text-[var(--text-secondary)] mb-2">
                📊 File too large for inline preview (
                {countLines(
                  toolCall.toolName === "Edit" ? newContent : displayContent,
                )}{" "}
                lines)
              </div>
              <div className="text-[var(--text-muted)] text-xs">
                Files larger than {MAX_LINES_INLINE} lines are not displayed
                inline.
              </div>
            </div>
          ) : (
            // Loading placeholder
            <div className="p-4 flex items-center justify-center text-[var(--text-muted)]">
              <div className="animate-pulse">Loading editor...</div>
            </div>
          )}
        </div>
      )}

      {/* Monaco editors - kept mounted once rendered (hidden via CSS when collapsed).
          Unmounting Monaco while it's active causes a race condition:
          "TextModel got disposed before DiffEditorWidget model got reset".
          We skip rendering entirely until the user has expanded at least once
          (hasEverExpandedRef) to avoid Monaco initialization cost on history load. */}
      {shouldRenderMonaco && !isTooLarge && hasEverExpandedRef.current && (
        <div
          className={`border-t border-[var(--border)] ${fillHeight ? "flex-1 min-h-0" : ""}`}
          style={{
            display: isExpanded ? (fillHeight ? "flex" : "block") : "none",
          }}
        >
          <div
            className={`relative ${fillHeight ? "flex-1 h-full" : ""}`}
            ref={monacoContainerRef}
          >
            {unifiedDiff ? (
              // Unified diff view (Codex-style)
              <Editor
                height={height}
                language="diff"
                value={displayContent}
                theme={monacoThemeName(theme)}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: MONO_FONT_FAMILY,
                  lineNumbers: "off",
                  renderLineHighlight: "none",
                  wordWrap: "on",
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto",
                    useShadows: false,
                  },
                  contextmenu: false,
                  links: false,
                  folding: false,
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  lineNumbersMinChars: 0,
                  renderWhitespace: "none",
                }}
              />
            ) : toolCall.toolName === "Edit" ? (
              // Diff view for Edit tool
              <DiffEditor
                height={height}
                language={language}
                original={oldContent}
                modified={newContent}
                theme={monacoThemeName(theme)}
                onMount={(editor) => {
                  diffEditorRef.current = editor;
                }}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: MONO_FONT_FAMILY,
                  lineNumbers: "on",
                  renderLineHighlight: "none",
                  wordWrap: "on",
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto",
                    useShadows: false,
                  },
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  contextmenu: false,
                  links: false,
                  folding: true,
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  lineNumbersMinChars: 3,
                  renderWhitespace: "none",
                  diffWordWrap: "on",
                }}
              />
            ) : (
              // Regular editor for Write/Read tools
              <Editor
                height={height}
                language={language}
                value={displayContent}
                theme={monacoThemeName(theme)}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: MONO_FONT_FAMILY,
                  lineNumbers: "on",
                  renderLineHighlight: "none",
                  wordWrap: "on",
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto",
                    useShadows: false,
                  },
                  contextmenu: false,
                  links: false,
                  folding: true,
                  glyphMargin: false,
                  lineDecorationsWidth: 0,
                  lineNumbersMinChars: 3,
                  renderWhitespace: "none",
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

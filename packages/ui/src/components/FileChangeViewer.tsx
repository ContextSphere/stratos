import { useState, useEffect } from "react";
import { Editor, DiffEditor } from "@monaco-editor/react";
import { useMonacoFontReady } from "../hooks/useMonacoFontReady";
import type { ToolCall } from "../types";
import {
  getLanguageFromPath,
  MONO_FONT_FAMILY,
  isBinaryFile,
  calculateEditorHeight,
  countLines,
  getFileName,
} from "../utils/monaco-language";
import "../utils/monaco-theme";

interface Props {
  toolCall: ToolCall;
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

export function FileChangeViewer({ toolCall }: Props): React.ReactElement {
  useMonacoFontReady();
  const [isExpanded, setIsExpanded] = useState(false);
  const [shouldRenderMonaco, setShouldRenderMonaco] = useState(false);

  const filePath = extractFilePath(toolCall.input);
  const fileName = getFileName(filePath);
  const isBinary = isBinaryFile(filePath);
  const language = getLanguageFromPath(filePath);

  // Debounce Monaco rendering to prevent janky animation
  useEffect(() => {
    if (isExpanded) {
      const timer = setTimeout(() => setShouldRenderMonaco(true), 150);
      return () => clearTimeout(timer);
    } else {
      setShouldRenderMonaco(false);
    }
  }, [isExpanded]);

  // Extract content based on tool type
  let oldContent = "";
  let newContent = "";
  let displayContent = "";
  let isTooLarge = false;

  if (toolCall.toolName === "Edit") {
    oldContent = (toolCall.input.old_string as string | undefined) ?? "";
    newContent = (toolCall.input.new_string as string | undefined) ?? "";
    isTooLarge = countLines(newContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Write") {
    displayContent = (toolCall.input.content as string | undefined) ?? "";
    isTooLarge = countLines(displayContent) > MAX_LINES_INLINE;
  } else if (toolCall.toolName === "Read") {
    displayContent = toolCall.output ?? "";
    isTooLarge = countLines(displayContent) > MAX_LINES_INLINE;
  }

  const changeStats =
    toolCall.toolName === "Edit"
      ? calculateChangeStats(oldContent, newContent)
      : null;
  const height = calculateEditorHeight(
    toolCall.toolName === "Edit" ? newContent : displayContent,
    MAX_VISIBLE_LINES,
  );

  const toggleExpand = () => setIsExpanded(!isExpanded);

  // Binary file indicator
  if (isBinary) {
    return (
      <div className="rounded-lg bg-[#111] border border-[#333] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-gray-300">
              {toolCall.toolName}
            </span>
            <span className="text-gray-500">•</span>
            <span className="font-mono text-gray-400">{fileName}</span>
          </div>
          <span className={`text-xs ${statusColors[toolCall.status]}`}>
            {statusLabels[toolCall.status]}
          </span>
        </div>
        <div className="mt-2 text-gray-500 text-xs">
          📦 Binary file ({fileName.split(".").pop()?.toUpperCase()})
        </div>
      </div>
    );
  }

  // Empty file indicator
  const isEmpty =
    toolCall.toolName === "Edit" ? !oldContent && !newContent : !displayContent;

  if (isEmpty) {
    return (
      <div className="rounded-lg bg-[#111] border border-[#333] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-gray-300">
              {toolCall.toolName}
            </span>
            <span className="text-gray-500">•</span>
            <span className="font-mono text-gray-400">{fileName}</span>
          </div>
          <span className={`text-xs ${statusColors[toolCall.status]}`}>
            {statusLabels[toolCall.status]}
          </span>
        </div>
        <div className="mt-2 text-gray-500 text-xs">📄 Empty file</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[#111] border border-[#333] overflow-hidden text-xs">
      {/* Header - always visible */}
      <button
        onClick={toggleExpand}
        className="w-full p-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors text-left"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${toolCall.toolName} for ${fileName}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-gray-400 flex-shrink-0">
            {isExpanded ? "▾" : "▸"}
          </span>
          <span className="font-mono font-semibold text-gray-300 flex-shrink-0">
            {toolCall.toolName}
          </span>
          <span className="text-gray-500 flex-shrink-0">•</span>
          <span className="font-mono text-gray-400 truncate" title={filePath}>
            {fileName}
          </span>
          {changeStats && (
            <span className="text-gray-500 flex-shrink-0 ml-1">
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

      {/* Content - expandable */}
      {isExpanded && (
        <div className="border-t border-[#2a2a2a]">
          {isTooLarge ? (
            // Too large - show message
            <div className="p-4 text-center">
              <div className="text-gray-400 mb-2">
                📊 File too large for inline preview (
                {countLines(
                  toolCall.toolName === "Edit" ? newContent : displayContent,
                )}{" "}
                lines)
              </div>
              <div className="text-gray-500 text-xs">
                Files larger than {MAX_LINES_INLINE} lines are not displayed
                inline.
              </div>
            </div>
          ) : shouldRenderMonaco ? (
            // Render Monaco editor or diff
            <div className="relative">
              {toolCall.toolName === "Edit" ? (
                // Diff view for Edit tool
                <DiffEditor
                  height={height}
                  language={language}
                  original={oldContent}
                  modified={newContent}
                  theme="cursor-dark"
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
                  theme="cursor-dark"
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
          ) : (
            // Loading placeholder
            <div className="p-4 flex items-center justify-center text-gray-500">
              <div className="animate-pulse">Loading editor...</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import type { PreviewState } from "../types/preview";
import type { FilesBridge } from "../bridges/types";
import { MarkdownPreview } from "./preview/MarkdownPreview";
import { ArtifactEditorPreview } from "./preview/ArtifactEditorPreview";
import { FileExplorer } from "./FileExplorer";
import { TerminalPane } from "./TerminalPane";
import { WebviewPreview } from "./preview/WebviewPreview";
import { SessionChangesPane } from "./SessionChangesPane";
import type { SessionChanges } from "../hooks/useSessionChanges";
import type { GitStatus } from "../types";

interface Props {
  preview: PreviewState;
  onClose: () => void;
  filesBridge?: FilesBridge;
  sessionChanges?: SessionChanges;
  gitStatus?: GitStatus;
}

const TYPE_LABELS: Record<string, string> = {
  url: "Web",
  markdown: "Markdown",
  "artifact-editor": "Editor",
  "file-explorer": "Files",
  terminal: "Terminal",
  image: "Image",
  "file-changes": "Changes",
};

export function PreviewPane({
  preview,
  onClose,
  filesBridge,
  sessionChanges,
  gitStatus,
}: Props): React.ReactElement {
  const handleOpenExternal = (): void => {
    if (preview.url) {
      window.open(preview.url, "_blank");
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-main)] border-l border-[var(--border)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--border)] text-gray-400 uppercase tracking-wide">
          {TYPE_LABELS[preview.type] || "Preview"}
        </span>
        {preview.type === "file-changes" ? (
          gitStatus?.branch ? (
            <span className="flex items-center gap-1 text-xs text-gray-500 truncate flex-1 font-mono">
              <svg
                className="w-3 h-3 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0h6a3 3 0 100-6 3 3 0 000 6H6z"
                />
              </svg>
              {gitStatus.branch}
            </span>
          ) : (
            <span className="flex-1" />
          )
        ) : (
          <span
            className="text-xs text-gray-500 truncate flex-1"
            title={preview.title}
          >
            {preview.title}
          </span>
        )}
        {preview.url && (
          <button
            onClick={handleOpenExternal}
            className="p-1 rounded hover:bg-[var(--border)] text-gray-500 hover:text-gray-300 transition-colors"
            title="Open in browser"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--border)] text-gray-500 hover:text-gray-300 transition-colors"
          title="Close preview"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      {preview.type === "file-explorer" && preview.cwd && filesBridge ? (
        <FileExplorer
          cwd={preview.cwd}
          targetFilePath={preview.targetFilePath}
          targetLine={preview.targetLine}
          listDirectory={filesBridge.listDirectory}
          readFile={filesBridge.readFile}
          writeFile={filesBridge.writeFile}
          watchDirectory={filesBridge.watchDirectory}
          unwatchDirectory={filesBridge.unwatchDirectory}
          onDirectoryChanged={filesBridge.onDirectoryChanged}
          watchFile={filesBridge.watchFile}
          unwatchFile={filesBridge.unwatchFile}
          onFileChanged={filesBridge.onFileChanged}
        />
      ) : preview.type === "artifact-editor" &&
        preview.artifactContent !== undefined &&
        preview.artifactFilePath ? (
        <ArtifactEditorPreview
          content={preview.artifactContent}
          filePath={preview.artifactFilePath}
          filesBridge={filesBridge}
        />
      ) : preview.type === "markdown" && preview.markdownContent ? (
        <MarkdownPreview content={preview.markdownContent} />
      ) : preview.type === "terminal" ? (
        <TerminalPane cwd={preview.cwd ?? ""} />
      ) : preview.type === "image" && preview.imageDataUrl ? (
        <div
          className="flex-1 flex items-center justify-center overflow-auto p-4"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #2a2a2a 25%, transparent 25%), linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2a 75%), linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          }}
        >
          <img
            src={preview.imageDataUrl}
            alt={preview.title}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      ) : preview.type === "file-changes" && sessionChanges ? (
        <SessionChangesPane changes={sessionChanges} gitStatus={gitStatus} />
      ) : preview.url ? (
        <WebviewPreview url={preview.url} />
      ) : null}
    </div>
  );
}

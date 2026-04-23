import { toolRegistry } from "../registry";
import type { ToolCardBodyProps } from "../types";
import type { ToolCall } from "../../types";

export function PreviewIcon({
  size = 12,
  className,
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function getShortName(toolCall: ToolCall): string {
  return toolCall.toolName.split("__")[2] ?? "";
}

const FILE_ICONS: Record<string, string> = {
  md: "📄",
  markdown: "📄",
  ts: "📘",
  tsx: "📘",
  js: "📒",
  jsx: "📒",
  json: "📋",
  py: "🐍",
  rs: "🦀",
  go: "🔷",
  css: "🎨",
  html: "🌐",
  png: "🖼",
  jpg: "🖼",
  jpeg: "🖼",
  gif: "🖼",
  svg: "🖼",
  pdf: "📕",
};

function fileIcon(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? "📄";
}

function getTitle(toolCall: ToolCall): string {
  const short = getShortName(toolCall);
  if (short === "preview_open_file") {
    const title =
      typeof toolCall.input.title === "string" ? toolCall.input.title : "";
    const filePath =
      typeof toolCall.input.file_path === "string"
        ? toolCall.input.file_path
        : "";
    const display = title || filePath.split("/").pop() || "file";
    return `Opened preview: ${display}`;
  }
  if (short === "preview_close") return "Closed preview pane";
  return short.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PreviewCardBody({
  toolCall,
}: ToolCardBodyProps): React.ReactElement | null {
  const short = getShortName(toolCall);

  if (short === "preview_open_file") {
    const filePath =
      typeof toolCall.input.file_path === "string"
        ? toolCall.input.file_path
        : "";
    const title =
      typeof toolCall.input.title === "string"
        ? toolCall.input.title
        : (filePath.split("/").pop() ?? "");
    const icon = fileIcon(filePath);
    const displayName = title || filePath;

    return (
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="flex-shrink-0">{icon}</span>
          <span
            className="text-[var(--text-secondary)] truncate"
            title={filePath}
          >
            {displayName}
          </span>
        </div>
        {filePath && title && filePath !== title && (
          <div className="text-[var(--text-muted)] font-mono truncate text-[10px]">
            {filePath}
          </div>
        )}
      </div>
    );
  }

  // preview_close — no body
  return null;
}

toolRegistry.register({
  id: "stratos-preview",
  match: { type: "mcp-server", server: "stratos-preview" },
  display: {
    sourceLabel: "Stratos Preview",
    icon: PreviewIcon,
    accentColor: "#6366F1",
  },
  title: getTitle,
  CardBody: PreviewCardBody,
});

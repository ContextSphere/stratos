import type { ToolCall } from "../types";

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

const operationLabels: Record<string, string> = {
  Read: "Read from memory",
  Write: "Wrote to memory",
  Edit: "Updated memory",
};

function extractFilePath(input: Record<string, unknown>): string {
  return (
    (input.file_path as string | undefined) ??
    (input.filePath as string | undefined) ??
    (input.path as string | undefined) ??
    (input.file as string | undefined) ??
    ""
  );
}

function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function MemoryOperationCard({ toolCall }: Props): React.ReactElement {
  const filePath = extractFilePath(toolCall.input);
  const label = operationLabels[toolCall.toolName] ?? "Memory operation";
  const fileName = basename(filePath);

  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs flex items-center gap-2">
      <svg
        className="text-purple-400 shrink-0"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
      </svg>
      <span className="text-[var(--text-secondary)] font-medium">{label}</span>
      {fileName && (
        <span className="font-mono text-[var(--text-muted)] truncate">
          {fileName}
        </span>
      )}
      <span
        className={`ml-auto shrink-0 text-xs ${statusColors[toolCall.status]}`}
      >
        {statusLabels[toolCall.status]}
      </span>
    </div>
  );
}

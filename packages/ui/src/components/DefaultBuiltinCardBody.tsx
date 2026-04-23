import type { ToolCardBodyProps } from "../tool-registry/types";

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isErrorOutput(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.startsWith("error") ||
    lower.includes('"error"') ||
    lower.includes("failed") ||
    lower.includes("exception")
  );
}

export function DefaultBuiltinCardBody({
  toolCall,
}: ToolCardBodyProps): React.ReactElement | null {
  const entries = Object.entries(toolCall.input);
  const hasInput = entries.length > 0;
  const hasOutput = !!toolCall.output;

  if (!hasInput && !hasOutput) return null;

  return (
    <div className="space-y-2">
      {hasInput && (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-1.5 text-[11px]">
              <span className="text-[var(--text-muted)] flex-shrink-0">
                {humanizeKey(key)}:
              </span>
              <span className="text-[var(--text-secondary)] font-mono break-all">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}
      {hasOutput && (
        <div
          className={`text-[11px] font-mono whitespace-pre-wrap break-words ${
            isErrorOutput(toolCall.output!)
              ? "text-red-400"
              : "text-[var(--text-muted)]"
          }`}
        >
          {toolCall.output}
        </div>
      )}
    </div>
  );
}

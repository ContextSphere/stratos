import { toolRegistry } from "../registry";
import type { ToolCardBodyProps } from "../types";
import type { ToolCall } from "../../types";

export function ManagerIcon({
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
      <rect x="1" y="1" width="14" height="4" rx="1" />
      <rect x="1" y="7" width="14" height="4" rx="1" />
      <rect x="1" y="13" width="14" height="2" rx="1" />
    </svg>
  );
}

function getShortName(toolCall: ToolCall): string {
  return toolCall.toolName.split("__")[2] ?? "";
}

function getTitle(toolCall: ToolCall): string {
  const short = getShortName(toolCall);
  const inp = toolCall.input;
  const name = typeof inp.name === "string" ? inp.name : "";
  const folder = typeof inp.folder === "string" ? inp.folder : "";
  const query = typeof inp.query === "string" ? inp.query : "";

  switch (short) {
    case "create_session":
      return folder ? `Started session in ${folder}` : "Started session";
    case "send_message":
      return "Sent message to session";
    case "stop_session":
      return "Stopped session";
    case "delete_session":
      return "Deleted session";
    case "list_sessions":
      return "Listed sessions";
    case "get_session":
      return "Fetched session info";
    case "search_sessions":
      return query ? `Searched sessions: ${query}` : "Searched sessions";
    case "get_dashboard":
      return "Fetched dashboard";
    case "list_workspaces":
      return "Listed workspaces";
    case "create_workspace":
      return name ? `Created workspace: ${name}` : "Created workspace";
    case "remove_workspace":
      return name ? `Removed workspace: ${name}` : "Removed workspace";
    default:
      return short.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

type SessionItem = {
  id?: string;
  status?: string;
  folder?: string;
  title?: string;
};

function parseSessionsFromOutput(output: string | undefined): SessionItem[] {
  if (!output) return [];
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed as SessionItem[];
    if (
      parsed &&
      typeof parsed === "object" &&
      "sessions" in parsed &&
      Array.isArray((parsed as { sessions: unknown }).sessions)
    ) {
      return (parsed as { sessions: SessionItem[] }).sessions;
    }
  } catch {
    // non-JSON
  }
  return [];
}

function SessionCountSummary({
  output,
}: {
  output: string | undefined;
}): React.ReactElement {
  const sessions = parseSessionsFromOutput(output);
  if (sessions.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-muted)]">
        {output ?? "No sessions"}
      </div>
    );
  }
  const active = sessions.filter(
    (s) => s.status === "running" || s.status === "active",
  ).length;
  const stopped = sessions.length - active;
  return (
    <div className="text-[11px] text-[var(--text-secondary)]">
      <span className="text-emerald-400">{active} active</span>
      {stopped > 0 && (
        <span className="text-[var(--text-muted)]">, {stopped} stopped</span>
      )}
    </div>
  );
}

function ManagerCardBody({
  toolCall,
}: ToolCardBodyProps): React.ReactElement | null {
  const short = getShortName(toolCall);
  const inp = toolCall.input;
  const isRunning = toolCall.status === "running";

  if (short === "create_session" || short === "send_message") {
    const folder =
      typeof inp.folder === "string"
        ? inp.folder
        : typeof inp.workspace === "string"
          ? inp.workspace
          : "";
    const prompt =
      typeof inp.prompt === "string"
        ? inp.prompt
        : typeof inp.message === "string"
          ? inp.message
          : "";

    return (
      <div className="space-y-1 text-[11px]">
        {folder && (
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-muted)] flex-shrink-0">
              Folder:
            </span>
            <span className="text-[var(--text-secondary)] truncate">
              {folder}
            </span>
          </div>
        )}
        {prompt && (
          <div className="flex items-start gap-1.5">
            <span className="text-[var(--text-muted)] flex-shrink-0">
              Prompt:
            </span>
            <span className="text-[var(--text-secondary)] break-words">
              {truncate(prompt, 80)}
            </span>
          </div>
        )}
        {isRunning && short === "send_message" && (
          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span>Driving downstream session…</span>
          </div>
        )}
      </div>
    );
  }

  if (short === "list_sessions" || short === "get_dashboard") {
    return <SessionCountSummary output={toolCall.output} />;
  }

  if (short === "list_workspaces") {
    type WorkspaceItem = { name?: string; path?: string };
    let workspaces: WorkspaceItem[] = [];
    try {
      if (typeof toolCall.output === "string") {
        const parsed: unknown = JSON.parse(toolCall.output);
        if (Array.isArray(parsed)) workspaces = parsed as WorkspaceItem[];
      }
    } catch {
      // non-JSON
    }
    if (workspaces.length === 0) {
      return (
        <div className="text-[11px] text-[var(--text-muted)]">
          {toolCall.output ?? "No workspaces"}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {workspaces.slice(0, 5).map((w, i) => (
          <div
            key={i}
            className="text-[11px] text-[var(--text-secondary)] truncate"
          >
            {w.name ?? w.path ?? "—"}
          </div>
        ))}
        {workspaces.length > 5 && (
          <div className="text-[10px] text-[var(--text-muted)]">
            +{workspaces.length - 5} more
          </div>
        )}
      </div>
    );
  }

  if (short === "search_sessions") {
    const sessions = parseSessionsFromOutput(toolCall.output);
    if (sessions.length === 0) {
      return (
        <div className="text-[11px] text-[var(--text-muted)]">
          {toolCall.output ?? "No results"}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {sessions.slice(0, 4).map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                s.status === "running"
                  ? "bg-emerald-400"
                  : "bg-[var(--text-faint)]"
              }`}
            />
            <span className="text-[var(--text-secondary)] truncate">
              {s.title ?? s.folder ?? s.id ?? "—"}
            </span>
          </div>
        ))}
        {sessions.length > 4 && (
          <div className="text-[10px] text-[var(--text-muted)]">
            +{sessions.length - 4} more
          </div>
        )}
      </div>
    );
  }

  // For simple mutations (stop, delete, create/remove workspace, get_session) fall back
  if (toolCall.output) {
    return (
      <div className="text-[11px] text-[var(--text-muted)] break-words">
        {truncate(toolCall.output, 120)}
      </div>
    );
  }

  return null;
}

toolRegistry.register({
  id: "stratos-manager",
  match: { type: "mcp-server", server: "stratos-manager" },
  display: {
    sourceLabel: "Stratos Manager",
    icon: ManagerIcon,
    accentColor: "#10B981",
  },
  title: getTitle,
  CardBody: ManagerCardBody,
});

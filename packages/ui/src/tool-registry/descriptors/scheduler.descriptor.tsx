import { toolRegistry } from "../registry";
import type { ToolCardBodyProps } from "../types";
import type { ToolCall } from "../../types";
import {
  stratosToolName,
  stratosToolPrefixMatcher,
} from "./stratos-match";

export function SchedulerIcon({
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
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10,10" />
    </svg>
  );
}

function getShortName(toolCall: ToolCall): string {
  return stratosToolName(toolCall.toolName) ?? "";
}

function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;
  if (
    min === "0" &&
    hour === "0" &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  )
    return "Every day at midnight";
  if (
    dom === "*" &&
    month === "*" &&
    dow === "*" &&
    min !== "*" &&
    hour !== "*"
  )
    return `Daily at ${hour}:${min.padStart(2, "0")}`;
  return expr;
}

function getTitle(toolCall: ToolCall): string {
  const short = getShortName(toolCall);
  const name =
    typeof toolCall.input.name === "string" ? toolCall.input.name : "";
  switch (short) {
    case "schedule_create":
      return name ? `Created schedule: ${name}` : "Created schedule";
    case "schedule_list":
      return "Listed schedules";
    case "schedule_delete":
      return name ? `Deleted schedule: ${name}` : "Deleted schedule";
    case "schedule_enable":
      return name ? `Enabled schedule: ${name}` : "Enabled schedule";
    case "schedule_disable":
      return name ? `Disabled schedule: ${name}` : "Disabled schedule";
    case "schedule_folders":
      return "Fetched available folders";
    default:
      return short.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function SchedulerCardBody({
  toolCall,
}: ToolCardBodyProps): React.ReactElement | null {
  const short = getShortName(toolCall);
  const inp = toolCall.input;

  if (short === "schedule_list") {
    type ScheduleItem = { name?: string; enabled?: boolean; cron?: string };
    let schedules: ScheduleItem[] = [];
    try {
      if (typeof toolCall.output === "string") {
        const parsed: unknown = JSON.parse(toolCall.output);
        if (Array.isArray(parsed)) schedules = parsed as ScheduleItem[];
        else if (
          parsed &&
          typeof parsed === "object" &&
          "schedules" in parsed &&
          Array.isArray((parsed as { schedules: unknown }).schedules)
        ) {
          schedules = (parsed as { schedules: ScheduleItem[] }).schedules;
        }
      }
    } catch {
      // non-JSON output
    }
    if (schedules.length === 0) {
      return (
        <div className="text-[var(--text-muted)] italic text-[11px]">
          {toolCall.output ?? "No schedules found"}
        </div>
      );
    }
    const visible = schedules.slice(0, 5);
    return (
      <div className="space-y-1">
        {visible.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                s.enabled === false ? "bg-[var(--text-faint)]" : "bg-amber-400"
              }`}
            />
            <span className="text-[var(--text-primary)] truncate flex-1">
              {s.name ?? "—"}
            </span>
            {s.cron && (
              <span className="text-[var(--text-muted)] flex-shrink-0 font-mono">
                {humanizeCron(s.cron)}
              </span>
            )}
          </div>
        ))}
        {schedules.length > 5 && (
          <div className="text-[var(--text-muted)] text-[10px]">
            +{schedules.length - 5} more
          </div>
        )}
      </div>
    );
  }

  if (short === "schedule_delete") {
    const name =
      typeof inp.name === "string"
        ? inp.name
        : typeof inp.id === "string"
          ? inp.id
          : "";
    return (
      <div className="text-[11px] text-[var(--text-muted)]">
        {name ? (
          <span className="line-through">{name}</span>
        ) : (
          "Schedule removed"
        )}
      </div>
    );
  }

  if (
    short === "schedule_create" ||
    short === "schedule_enable" ||
    short === "schedule_disable"
  ) {
    const cron = typeof inp.cron === "string" ? inp.cron : "";
    const folder = typeof inp.folder === "string" ? inp.folder : "";
    const enabled = short !== "schedule_disable";
    return (
      <div className="space-y-1 text-[11px]">
        {cron && (
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--text-muted)] flex-shrink-0">
              Cron:
            </span>
            <code className="font-mono text-[var(--text-secondary)]">
              {humanizeCron(cron)}
            </code>
          </div>
        )}
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
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--text-muted)] flex-shrink-0">
            Status:
          </span>
          <span
            className={enabled ? "text-amber-400" : "text-[var(--text-faint)]"}
          >
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </div>
    );
  }

  if (short === "schedule_folders") {
    type FolderItem = { name?: string; path?: string };
    let folders: string[] = [];
    try {
      if (typeof toolCall.output === "string") {
        const parsed: unknown = JSON.parse(toolCall.output);
        if (Array.isArray(parsed)) {
          folders = (parsed as (string | FolderItem)[]).map((f) =>
            typeof f === "string" ? f : (f.name ?? f.path ?? ""),
          );
        }
      }
    } catch {
      // non-JSON
    }
    return (
      <div className="space-y-1">
        {folders.slice(0, 6).map((f, i) => (
          <div
            key={i}
            className="text-[11px] text-[var(--text-secondary)] font-mono truncate"
          >
            {f}
          </div>
        ))}
        {folders.length === 0 && toolCall.output && (
          <div className="text-[11px] text-[var(--text-muted)]">
            {toolCall.output}
          </div>
        )}
      </div>
    );
  }

  return null;
}

toolRegistry.register({
  id: "stratos-scheduler",
  match: { type: "predicate", fn: stratosToolPrefixMatcher("schedule_") },
  display: {
    sourceLabel: "Stratos Scheduler",
    icon: SchedulerIcon,
    accentColor: "#F59E0B",
  },
  title: getTitle,
  CardBody: SchedulerCardBody,
});

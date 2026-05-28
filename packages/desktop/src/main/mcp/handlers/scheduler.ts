/**
 * Scheduler handler definitions — 6 tools for managing Stratos scheduled prompts.
 */
import { z } from "zod";
import {
  loadScheduledPrompts,
  addScheduledPrompt,
  deleteScheduledPrompt,
  updateScheduledPrompt,
  listScheduleRuns,
  FileStorageAdapter,
} from "@stratosapp/core";
import type { ScheduledPrompt } from "@stratosapp/core";
import { type HandlerDef, defineHandler, textResult } from "./types";
import { depositReport } from "../../scheduler/schedule-report-store";

function buildSchedule(args: {
  once?: string;
  interval?: string;
  cron?: string;
  time?: string;
  day?: number;
}): ScheduledPrompt["schedule"] {
  if (args.once) return { type: "once", runAt: args.once };
  const interval = (args.interval ??
    "every-day") as ScheduledPrompt["schedule"] extends { interval: infer I }
    ? I
    : never;
  const config: {
    type: "recurring";
    interval: typeof interval;
    customCron?: string;
    timeOfDay?: string;
    dayOfWeek?: number;
  } = { type: "recurring", interval };
  if (interval === "custom" && args.cron) config.customCron = args.cron;
  if (args.time) config.timeOfDay = args.time;
  if (args.day !== undefined) config.dayOfWeek = args.day;
  return config as ScheduledPrompt["schedule"];
}

export interface SchedulerDeps {
  storage: FileStorageAdapter;
}

export function createSchedulerHandlers(deps: SchedulerDeps): HandlerDef[] {
  const { storage } = deps;
  return [
    defineHandler({
      name: "schedule_create",
      description:
        "Create a new scheduled prompt that runs automatically in Stratos. Call schedule_folders first to get a valid folder name or path. To have the Manager dispatch the run instead of executing it directly, set routeToManager=true — but only if the work genuinely benefits from Manager orchestration (conflict checks, batching). When routeToManager is true, the prompt MUST be fully self-describing — include all relevant context, goals, and constraints inline. Do not reference 'earlier discussion', 'the analysis above', or any prior session state, since the Manager's history at fire time will not contain it.",
      inputSchema: {
        name: z.string().describe("Human-readable schedule name"),
        prompt: z.string().describe("Prompt text to run on each execution"),
        folder: z
          .string()
          .optional()
          .describe(
            "Folder name (use schedule_folders to list). Defaults to first folder.",
          ),
        cwd: z
          .string()
          .optional()
          .describe("Folder by exact path (alternative to folder)"),
        provider: z
          .enum(["claude-code", "codex", "opencode", "copilot"])
          .optional()
          .describe("Agent provider (default: claude-code)"),
        model: z
          .string()
          .optional()
          .describe("Model override (e.g. claude-opus-4-5)"),
        interval: z
          .enum([
            "every-hour",
            "every-6-hours",
            "every-12-hours",
            "every-day",
            "every-week",
            "custom",
          ])
          .optional()
          .describe("Recurrence interval (default: every-day)"),
        once: z
          .string()
          .optional()
          .describe(
            "ISO datetime for a one-shot run (e.g. 2025-01-15T14:00). Mutually exclusive with interval.",
          ),
        cron: z
          .string()
          .optional()
          .describe(
            "Custom cron expression (5-field). Only used when interval=custom.",
          ),
        time: z
          .string()
          .optional()
          .describe(
            "Time of day for daily/weekly schedules in HH:mm (default: 09:00)",
          ),
        day: z
          .number()
          .optional()
          .describe(
            "Day of week for weekly schedules (0=Sun … 6=Sat, default: 1=Mon)",
          ),
        routeToManager: z
          .boolean()
          .optional()
          .describe(
            "If true, the schedule fires by posting to the Manager (which then dispatches a session) instead of running the prompt directly. Use only when Manager intelligence is needed (conflict checks, batching, contextual rewriting). Default: false. When true, the prompt must be fully self-describing.",
          ),
      },
      handler: async (args) => {
        const folders = storage.listFolders();
        let folderId: string | undefined;
        if (args.cwd) {
          const f = folders.find((x) => x.path === args.cwd);
          if (!f)
            return textResult(`No folder found with path: ${args.cwd}`, true);
          folderId = f.id;
        } else if (args.folder) {
          const f = folders.find(
            (x) => x.name === args.folder || x.name.endsWith(args.folder!),
          );
          if (!f)
            return textResult(`No folder found named: ${args.folder}`, true);
          folderId = f.id;
        } else {
          if (folders.length === 0)
            return textResult("No folders found. Provide cwd or folder.", true);
          folderId = folders[0].id;
        }

        const schedule = buildSchedule(args);
        const entry = addScheduledPrompt({
          name: args.name,
          prompt: args.prompt,
          provider: args.provider ?? "claude-code",
          folderId,
          schedule,
          enabled: true,
          ...(args.model ? { model: args.model } : {}),
          ...(args.routeToManager ? { routeToManager: true } : {}),
        } as Omit<ScheduledPrompt, "id" | "createdAt">);
        return textResult(JSON.stringify(entry, null, 2));
      },
    }),
    defineHandler({
      name: "schedule_list",
      description:
        "List all scheduled prompts in Stratos with their status and last run info.",
      inputSchema: {},
      handler: async () => {
        const prompts = loadScheduledPrompts();
        const folders = storage.listFolders();
        const list = prompts.map((p) => {
          const folder = folders.find((f) => f.id === p.folderId);
          const sched =
            p.schedule.type === "once"
              ? `once at ${p.schedule.runAt ?? "?"}`
              : `${p.schedule.interval ?? "every-day"}${
                  p.schedule.timeOfDay ? ` at ${p.schedule.timeOfDay}` : ""
                }`;
          return {
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            schedule: sched,
            folder: folder?.name ?? "?",
            provider: p.provider,
            routeToManager: p.routeToManager ?? false,
            lastRunAt: p.lastRunAt ?? null,
            lastRunStatus: p.lastRunStatus ?? null,
          };
        });
        return textResult(
          list.length ? JSON.stringify(list, null, 2) : "No scheduled prompts.",
        );
      },
    }),
    defineHandler({
      name: "schedule_runs",
      description:
        "Query the log of past scheduled-prompt run completions (newest first). Includes status, agent-authored summary (if filed), duration, and error message. Use this to check what scheduled tasks have completed recently and what they reported.",
      inputSchema: {
        scheduleId: z
          .string()
          .optional()
          .describe("Filter to runs of a specific schedule"),
        limit: z
          .number()
          .optional()
          .describe("Max records to return (default: 20, max: 100)"),
      },
      handler: async (args) => {
        const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
        const runs = listScheduleRuns({
          ...(args.scheduleId ? { scheduleId: args.scheduleId } : {}),
          limit,
        });
        return textResult(
          runs.length
            ? JSON.stringify(runs, null, 2)
            : "No scheduled-prompt runs recorded yet.",
        );
      },
    }),
    defineHandler({
      name: "schedule_delete",
      description: "Permanently delete a scheduled prompt by ID.",
      inputSchema: {
        id: z.string().describe("Schedule ID (from schedule_list)"),
      },
      handler: async (args) => {
        const ok = deleteScheduledPrompt(args.id);
        return ok
          ? textResult(`Deleted schedule: ${args.id}`)
          : textResult(`Not found: ${args.id}`, true);
      },
    }),
    defineHandler({
      name: "schedule_enable",
      description: "Re-enable a previously disabled scheduled prompt.",
      inputSchema: {
        id: z.string().describe("Schedule ID (from schedule_list)"),
      },
      handler: async (args) => {
        const updated = updateScheduledPrompt(args.id, { enabled: true });
        return updated
          ? textResult(`Enabled schedule: ${args.id}`)
          : textResult(`Not found: ${args.id}`, true);
      },
    }),
    defineHandler({
      name: "schedule_disable",
      description:
        "Temporarily disable a scheduled prompt without deleting it.",
      inputSchema: {
        id: z.string().describe("Schedule ID (from schedule_list)"),
      },
      handler: async (args) => {
        const updated = updateScheduledPrompt(args.id, { enabled: false });
        return updated
          ? textResult(`Disabled schedule: ${args.id}`)
          : textResult(`Not found: ${args.id}`, true);
      },
    }),
    defineHandler({
      name: "schedule_report",
      description:
        "Deposit a concise summary of a scheduled task run. Call this at the end of a scheduled run with the scheduleId from the [SCHEDULED TASK] context block. The summary is forwarded to the Manager when the run completes. This tool only stores data — it has no other side effects.",
      inputSchema: {
        scheduleId: z
          .string()
          .describe(
            "The scheduleId from the [SCHEDULED TASK] context block in your prompt.",
          ),
        summary: z
          .string()
          .describe(
            "1-3 sentence summary of what you accomplished, found, or changed.",
          ),
      },
      handler: async (args) => {
        depositReport(args.scheduleId, args.summary);
        return textResult(JSON.stringify({ status: "recorded" }, null, 2));
      },
    }),
    defineHandler({
      name: "schedule_folders",
      description:
        "List available Stratos folders (id, name, path). Use this to resolve folder names/paths before calling schedule_create.",
      inputSchema: {},
      handler: async () => {
        const folders = storage
          .listFolders()
          .map((f) => ({ id: f.id, name: f.name, path: f.path }));
        return textResult(
          folders.length
            ? JSON.stringify(folders, null, 2)
            : "No folders found.",
        );
      },
    }),
  ];
}

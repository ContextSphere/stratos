import type { ProviderType } from "./thread";

export type ScheduleType = "once" | "recurring";

export type RecurringInterval =
  | "every-hour"
  | "every-6-hours"
  | "every-12-hours"
  | "every-day"
  | "every-week"
  | "custom";

export interface ScheduleConfig {
  type: ScheduleType;
  /** For "once": ISO datetime string (e.g. "2026-04-13T09:00") */
  runAt?: string;
  /** For "recurring": friendly preset or custom cron */
  interval?: RecurringInterval;
  /** Only when interval === "custom" */
  customCron?: string;
  /** "HH:mm" format for presets that need a time (every-day, every-week) */
  timeOfDay?: string;
  /** 0-6 (Sun-Sat), for "every-week" */
  dayOfWeek?: number;
}

export interface ScheduledPrompt {
  id: string;
  name: string;
  prompt: string;
  provider: ProviderType;
  model?: string;
  /** Folder ID — resolved to folder.path as the thread's cwd at execution time */
  folderId: string;
  schedule: ScheduleConfig;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastRunThreadId?: string;
  lastRunStatus?: "running" | "completed" | "error";
}

/** Convert a friendly ScheduleConfig to a cron expression for node-cron. */
export function scheduleToCron(config: ScheduleConfig): string {
  if (config.type === "once") {
    throw new Error("Cannot convert one-time schedule to cron");
  }
  switch (config.interval) {
    case "every-hour":
      return "0 * * * *";
    case "every-6-hours":
      return "0 */6 * * *";
    case "every-12-hours":
      return "0 */12 * * *";
    case "every-day": {
      const [h, m] = (config.timeOfDay ?? "09:00").split(":").map(Number);
      return `${m} ${h} * * *`;
    }
    case "every-week": {
      const [h, m] = (config.timeOfDay ?? "09:00").split(":").map(Number);
      const dow = config.dayOfWeek ?? 1; // default Monday
      return `${m} ${h} * * ${dow}`;
    }
    case "custom":
      if (!config.customCron)
        throw new Error("Custom cron expression required");
      return config.customCron;
    default:
      throw new Error(`Unknown interval: ${config.interval}`);
  }
}

/** Human-readable description of a schedule config. */
export function scheduleToHuman(config: ScheduleConfig): string {
  if (config.type === "once") {
    if (!config.runAt) return "Once (no date set)";
    const d = new Date(config.runAt);
    return `Once on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  const DAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const time = config.timeOfDay ?? "09:00";
  switch (config.interval) {
    case "every-hour":
      return "Every hour";
    case "every-6-hours":
      return "Every 6 hours";
    case "every-12-hours":
      return "Every 12 hours";
    case "every-day":
      return `Every day at ${time}`;
    case "every-week":
      return `Every ${DAYS[config.dayOfWeek ?? 1]} at ${time}`;
    case "custom":
      return `Custom: ${config.customCron ?? ""}`;
    default:
      return "Unknown schedule";
  }
}

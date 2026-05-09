import type { ScheduleNotifyMode } from "@stratosapp/core";

/**
 * Decide whether a completed schedule should trigger a Manager LLM turn —
 * which is also what makes the user receive a WhatsApp message. Per-schedule
 * `notify` overrides the global default; absent both, fall back to
 * "errors-only" so cost-aware behavior is preserved by default.
 *
 * Pure function — extracted from scheduler.ts so it's testable without
 * pulling in electron / node-cron transitive imports.
 */
export function shouldNotifyManager(
  notifyMode: ScheduleNotifyMode | undefined,
  globalDefault: ScheduleNotifyMode,
  status: "completed" | "error",
): boolean {
  const mode = notifyMode ?? globalDefault;
  if (mode === "never") return false;
  if (mode === "errors-only") return status === "error";
  return true;
}

/**
 * Builds the [SCHEDULED TASK] context postscript appended to a scheduled
 * prompt's text before execution. Single source of truth for both:
 *   - executeDirect (scheduler builds the thread itself)
 *   - create_session (Manager builds the thread when routeToManager: true)
 *
 * The postscript gives the agent the scheduleId it needs for schedule_report.
 */
import type { ScheduledPrompt } from "@stratosapp/core";

export function buildSchedulePostscript(args: {
  prompt: ScheduledPrompt;
  workspace: string;
}): string {
  return [
    "",
    "---",
    `[SCHEDULED TASK — ${args.prompt.name}]`,
    `Schedule ID: ${args.prompt.id}`,
    `Workspace: ${args.workspace}`,
    `Provider: ${args.prompt.provider}`,
    "",
    `When you finish, call mcp__stratos__schedule_report with scheduleId="${args.prompt.id}" and a concise 1-3 sentence summary of what you accomplished, found, or changed. The Manager will receive this summary as a status update.`,
  ].join("\n");
}

export function decoratePromptWithSchedule(args: {
  promptText: string;
  prompt: ScheduledPrompt;
  workspace: string;
}): string {
  return args.promptText + "\n" + buildSchedulePostscript(args);
}

import type { AgentMode } from "@agentpanel/core";

/**
 * Tool names that are always auto-approved in acceptEdits mode.
 * Exported for testing.
 */
export const ACCEPT_EDITS_AUTO_APPROVE = new Set([
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "NotebookEdit",
]);

/**
 * Special tool names that require custom handling (not a simple approve/deny).
 */
export type SpecialToolBehavior = "plan_review" | "ask_user" | "always_approve";

/**
 * Determines how to handle a tool call in the current permission mode.
 *
 * Returns:
 * - 'always_approve' — auto-approve without prompting the user
 * - 'plan_review' — show the plan review dialog
 * - 'ask_user' — show the AskUserQuestion dialog
 * - false — prompt the user with a generic permission dialog
 */
export function resolveToolBehavior(
  mode: AgentMode,
  toolName: string,
): SpecialToolBehavior | false {
  // EnterPlanMode is always silently approved
  if (toolName === "EnterPlanMode") return "always_approve";

  // ExitPlanMode triggers plan review regardless of mode
  if (toolName === "ExitPlanMode") return "plan_review";

  // AskUserQuestion always shows the question dialog
  if (toolName === "AskUserQuestion") return "ask_user";

  // In bypass mode, everything else is approved
  if (mode === "bypassPermissions") return "always_approve";

  // In acceptEdits mode, approve common file/shell tools and MCP tools
  if (mode === "acceptEdits") {
    if (
      ACCEPT_EDITS_AUTO_APPROVE.has(toolName) ||
      toolName.startsWith("mcp__")
    ) {
      return "always_approve";
    }
  }

  // Everything else: show generic permission prompt
  return false;
}

/**
 * Returns true if this tool is in the read-only category.
 * Used for informational purposes (e.g., UI display).
 */
export function isReadOnlyTool(toolName: string): boolean {
  return ["Read", "Glob", "Grep", "WebSearch", "WebFetch"].includes(toolName);
}

/**
 * Returns true if this tool modifies files.
 */
export function isFileEditTool(toolName: string): boolean {
  return ["Write", "Edit", "NotebookEdit"].includes(toolName);
}

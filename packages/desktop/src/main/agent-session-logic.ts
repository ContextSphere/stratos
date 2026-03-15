import type { AgentMode, ProviderType } from "@stratosapp/core";

/**
 * Interactive tool names that require special handling (not rendered as tool cards).
 */
const INTERACTIVE_TOOL_NAMES = new Set([
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
]);

/**
 * Returns the effective tool name, unwrapping Skill-wrapped interactive tools.
 * When the model lacks ToolSearch it may call `Skill({ skill: "ExitPlanMode" })`
 * instead of calling ExitPlanMode directly. This function detects that pattern.
 */
export function effectiveToolName(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Skill") {
    const wrapped = (input?.skill ?? input?.name) as string | undefined;
    if (wrapped && INTERACTIVE_TOOL_NAMES.has(wrapped)) return wrapped;
  }
  return toolName;
}

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
  provider: ProviderType = "claude-code",
): SpecialToolBehavior | false {
  // EnterPlanMode is always silently approved
  if (toolName === "EnterPlanMode") return "always_approve";

  // ExitPlanMode triggers plan review only when currently in plan mode.
  // In other modes, approve silently so it does not surface plan UI.
  if (toolName === "ExitPlanMode") {
    return mode === "plan" ? "plan_review" : "always_approve";
  }

  // AskUserQuestion always shows the question dialog
  if (toolName === "AskUserQuestion") return "ask_user";

  // Codex/OpenCode full access mirrors their "Full access" mode.
  if (
    (provider === "codex" || provider === "opencode") &&
    mode === "fullAccess"
  ) {
    return "always_approve";
  }

  // In bypass mode, everything else is approved
  if (mode === "bypassPermissions") return "always_approve";

  // In acceptEdits mode, approve common file/shell tools and MCP tools
  if (
    provider !== "codex" &&
    provider !== "opencode" &&
    mode === "acceptEdits"
  ) {
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

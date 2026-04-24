/**
 * Helpers for matching tools served by the unified `stratos` MCP server.
 *
 * Tool-name forms:
 *   claude-code / codex: mcp__stratos__<name>   (e.g. mcp__stratos__schedule_create)
 *   opencode:            stratos_<name>         (e.g. stratos_schedule_create)
 *
 * Because all three domains (scheduler / preview / manager) share the single
 * server name "stratos", descriptors can't dispatch by server alone — they
 * must match on the short tool name.
 */

/** Returns the short tool name (without the stratos prefix), or null. */
export function stratosToolName(toolName: string): string | null {
  const mcp = toolName.match(/^mcp__stratos__(.+)$/);
  if (mcp) return mcp[1];
  const opencode = toolName.match(/^stratos_(.+)$/);
  if (opencode) return opencode[1];
  return null;
}

/** Predicate: tool is served by stratos AND its short name starts with prefix. */
export function stratosToolPrefixMatcher(
  prefix: string,
): (toolName: string) => boolean {
  return (toolName) => {
    const name = stratosToolName(toolName);
    return name !== null && name.startsWith(prefix);
  };
}

/** Predicate: tool is served by stratos AND its short name is in the list. */
export function stratosToolNameMatcher(
  names: readonly string[],
): (toolName: string) => boolean {
  const set = new Set(names);
  return (toolName) => {
    const name = stratosToolName(toolName);
    return name !== null && set.has(name);
  };
}

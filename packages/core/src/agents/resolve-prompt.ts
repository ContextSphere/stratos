import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AgentDefinition } from "../types/agent";

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve an agent's `prompt` field into the final text to hand a provider.
 *
 * - A string prompt is returned as-is.
 * - An array is treated as file paths (`~` expanded), read and joined with
 *   blank lines; an unreadable path is skipped with a `console.warn` rather
 *   than failing prompt resolution.
 *
 * Never throws. Returns `""` when there is nothing at all to resolve.
 */
export async function resolveAgentPrompt(
  def: AgentDefinition,
): Promise<string> {
  let base = "";

  if (typeof def.prompt === "string") {
    base = def.prompt;
  } else if (Array.isArray(def.prompt)) {
    const parts: string[] = [];
    for (const rawPath of def.prompt) {
      const path = expandHome(rawPath);
      try {
        const content = await readFile(path, "utf-8");
        if (content.trim().length > 0) {
          parts.push(content);
        }
      } catch (err) {
        console.warn(
          `[resolve-prompt] skipping unreadable prompt file "${rawPath}":`,
          err,
        );
      }
    }
    base = parts.join("\n\n");
  }

  return base;
}

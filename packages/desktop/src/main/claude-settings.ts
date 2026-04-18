import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

// The Claude Agent SDK attaches the `redact-thinking-2026-02-12` beta header
// (stripping plaintext chain-of-thought) unless `showThinkingSummaries` is
// true in loaded settings. Stratos renders thinking blocks and needs plaintext
// to flow through, so we ensure the flag is on in the user's global settings.
// Additive only: if the user has explicitly set it (true or false), we leave
// it alone.
export function ensureClaudeCodeThinkingSummaries(): void {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      if (raw.trim()) settings = JSON.parse(raw);
    }
    if (
      Object.prototype.hasOwnProperty.call(settings, "showThinkingSummaries")
    ) {
      return;
    }
    settings.showThinkingSummaries = true;
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(settings, null, 2) + "\n",
      "utf-8",
    );
  } catch (err) {
    console.error("[stratos] Failed to ensure showThinkingSummaries:", err);
  }
}

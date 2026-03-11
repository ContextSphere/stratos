import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";

let resolvedClaudePath: string | null = null;

async function isUsableClaudePath(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(candidate, ["--version"], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

export async function resolveClaudePath(): Promise<string> {
  if (resolvedClaudePath) return resolvedClaudePath;

  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    "claude",
  ];

  for (const candidate of candidates) {
    if (await isUsableClaudePath(candidate)) {
      resolvedClaudePath = candidate;
      return candidate;
    }
  }

  throw new Error("claude CLI not found");
}

export async function resolveClaudePathOrUndefined(
  configuredPath?: string,
): Promise<string | undefined> {
  if (configuredPath && (await isUsableClaudePath(configuredPath))) {
    resolvedClaudePath = configuredPath;
    return configuredPath;
  }
  try {
    return await resolveClaudePath();
  } catch {
    return undefined;
  }
}

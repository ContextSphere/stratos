import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface ProjectMcpFile {
  mcpServers?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse Claude-compatible project MCP configuration into the provider-neutral
 * shape used by ProviderConfig. Metadata stays on each entry for the tools UI;
 * provider translators ignore fields they do not understand.
 */
export function parseProjectMcpConfig(
  content: string,
  configPath: string,
): Record<string, unknown> {
  const parsed = JSON.parse(content) as ProjectMcpFile;
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return {};

  const servers: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(parsed.mcpServers)) {
    if (!isRecord(raw)) continue;
    servers[name] = {
      ...raw,
      scope: "project",
      configPath,
    };
  }
  return servers;
}

async function resolveProjectRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd,
        encoding: "utf-8",
        timeout: 3_000,
      },
    );
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

/**
 * OpenCode does not discover Claude's `.mcp.json`, so Stratos bridges the
 * project-level file into OpenCode's injected configuration. User-level
 * OpenCode MCPs remain OpenCode's responsibility via its native config files.
 */
export async function loadProjectMcpServers(
  cwd: string,
): Promise<Record<string, unknown>> {
  const root = await resolveProjectRoot(cwd);
  const configPath = join(root, ".mcp.json");
  try {
    return parseProjectMcpConfig(
      await readFile(configPath, "utf-8"),
      configPath,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`[MCP] Failed to read ${configPath}:`, error);
    }
    return {};
  }
}

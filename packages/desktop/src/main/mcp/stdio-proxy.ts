/**
 * Install and path helpers for the stratos-mcp stdio proxy.
 */
import { writeFileSync, existsSync, mkdirSync, chmodSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { STDIO_PROXY_SOURCE } from "./stdio-proxy-source";

export function getStratosMcpPath(): string {
  return join(homedir(), ".stratos", "bin", "stratos-mcp");
}

export function installStratosMcpProxy(): void {
  const binDir = join(homedir(), ".stratos", "bin");
  if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });
  const path = getStratosMcpPath();
  writeFileSync(path, STDIO_PROXY_SOURCE, "utf-8");
  chmodSync(path, 0o755);
}

/**
 * Remove the legacy per-MCP binaries installed by older Stratos versions.
 * Users upgrading shouldn't see stale `stratos-schedule-mcp`,
 * `stratos-preview-mcp`, `stratos-manager-mcp` files next to the new
 * unified proxy.
 */
export function cleanupLegacyMcpBinaries(): void {
  const binDir = join(homedir(), ".stratos", "bin");
  for (const stale of [
    "stratos-schedule-mcp",
    "stratos-schedule", // very old alias
    "stratos-preview-mcp",
    "stratos-manager-mcp",
  ]) {
    const p = join(binDir, stale);
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
      } catch {}
    }
  }
}

export function getStratosMcpSocketPath(instanceHash: string): string {
  return join(homedir(), ".stratos", `mcp-${instanceHash}.sock`);
}

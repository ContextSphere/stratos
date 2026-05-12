import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProviderType = "claude-code" | "codex" | "opencode";

const ALL_PROVIDERS: ProviderType[] = ["claude-code", "codex", "opencode"];

interface StratosConfig {
  providers?: ProviderType[];
}

let _cached: { providers: ProviderType[] } | null = null;

function loadConfig(): { providers: ProviderType[] } {
  if (_cached !== null) return _cached;

  try {
    const raw = readFileSync(
      join(homedir(), ".stratos", "config.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as StratosConfig;
    if (Array.isArray(parsed.providers)) {
      const filtered = parsed.providers.filter((p): p is ProviderType =>
        ALL_PROVIDERS.includes(p as ProviderType),
      );
      _cached = { providers: filtered };
      return _cached;
    }
  } catch {
    // Missing or invalid config → fall through to default
  }

  _cached = { providers: ALL_PROVIDERS };
  return _cached;
}

export function getEnabledProviders(): ProviderType[] {
  return loadConfig().providers;
}

export function isProviderEnabled(provider: ProviderType): boolean {
  return loadConfig().providers.includes(provider);
}

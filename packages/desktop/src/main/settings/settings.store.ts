import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

export type AppTheme = "dark" | "light";

export interface ProviderPrefs {
  lastUsedModel?: string;
  lastUsedEffort?: "low" | "medium" | "high" | "max";
}

export interface AppSettings {
  theme?: AppTheme;
  providers?: Record<string, ProviderPrefs>;
  [key: string]: unknown;
}

const STORE_FILE = "app-settings.json";
const GLOBAL_CONFIG_DIR = join(homedir(), ".stratos");

function getStorePath(): string {
  return join(GLOBAL_CONFIG_DIR, STORE_FILE);
}

function getDefaults(): AppSettings {
  return { theme: "dark" };
}

export function loadSettings(): AppSettings {
  const path = getStorePath();
  if (!existsSync(path)) {
    return getDefaults();
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...getDefaults(),
      ...data,
    };
  } catch {
    return getDefaults();
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(getStorePath(), JSON.stringify(settings, null, 2), "utf-8");
}

export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const updated: AppSettings = { ...current, ...updates };
  // Deep-merge providers so writing one provider's prefs doesn't erase another's
  if (updates.providers !== undefined) {
    updated.providers = {
      ...current.providers,
      ...Object.fromEntries(
        Object.entries(updates.providers).map(([provider, prefs]) => [
          provider,
          { ...(current.providers?.[provider] ?? {}), ...prefs },
        ]),
      ),
    };
  }
  saveSettings(updated);
  return updated;
}

export function getProviderSettings(provider: string): ProviderPrefs {
  const settings = loadSettings();
  return settings.providers?.[provider] ?? {};
}

export function setProviderSettings(
  provider: string,
  patch: Partial<ProviderPrefs>,
): void {
  updateSettings({ providers: { [provider]: patch } });
}

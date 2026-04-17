import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

export type AppTheme = "dark" | "light";

export interface ProviderPrefs {
  lastUsedModel?: string;
  lastUsedEffort?: "low" | "medium" | "high" | "max";
}

/** API keys for opencode sub-providers (stored in app-settings.json, plain text) */
export interface OpencodeProviderKey {
  apiKey: string;
  baseURL?: string;
}

/** Per-model metadata discovered from Ollama's /api/show endpoint */
export interface OllamaModelInfo {
  name: string;
  size: number;
  parameterSize: string;
  family: string;
  quantization: string;
  capabilities: {
    vision: boolean;
    tools: boolean;
    thinking: boolean;
  };
  contextLength: number;
}

/** Ollama configuration persisted in app-settings.json */
export interface OllamaConfig {
  baseURL: string;
  models: Record<string, OllamaModelInfo>;
}

export interface AppSettings {
  theme?: AppTheme;
  providers?: Record<string, ProviderPrefs>;
  /** Opencode sub-provider API keys keyed by opencode provider ID (e.g. "anthropic", "openai") */
  opencodeProviderKeys?: Record<string, OpencodeProviderKey>;
  /** Allowlist of opencode sub-provider IDs whose models are shown in the picker.
   *  If undefined, DEFAULT_OPENCODE_MODEL_ALLOWLIST is used. */
  opencodeModelAllowlist?: string[];
  /** Ollama local model server configuration */
  ollamaConfig?: OllamaConfig;
  [key: string]: unknown;
}

/** Default allowlist: only show Anthropic and OpenAI models in the picker. */
export const DEFAULT_OPENCODE_MODEL_ALLOWLIST = ["anthropic", "openai"];

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

export function getOpencodeProviderKeys(): Record<string, OpencodeProviderKey> {
  const settings = loadSettings();
  return settings.opencodeProviderKeys ?? {};
}

export function setOpencodeProviderKey(
  providerId: string,
  key: OpencodeProviderKey,
): void {
  const current = loadSettings();
  const updated: AppSettings = {
    ...current,
    opencodeProviderKeys: {
      ...(current.opencodeProviderKeys ?? {}),
      [providerId]: key,
    },
  };
  saveSettings(updated);
}

export function deleteOpencodeProviderKey(providerId: string): void {
  const current = loadSettings();
  const keys = { ...(current.opencodeProviderKeys ?? {}) };
  delete keys[providerId];
  const updated: AppSettings = { ...current, opencodeProviderKeys: keys };
  saveSettings(updated);
}

export function getOpencodeModelAllowlist(): string[] {
  const settings = loadSettings();
  return settings.opencodeModelAllowlist ?? DEFAULT_OPENCODE_MODEL_ALLOWLIST;
}

export function setOpencodeModelAllowlist(allowlist: string[]): void {
  const current = loadSettings();
  saveSettings({ ...current, opencodeModelAllowlist: allowlist });
}

export function getOllamaConfig(): OllamaConfig | undefined {
  const settings = loadSettings();
  return settings.ollamaConfig;
}

export function setOllamaConfig(config: OllamaConfig): void {
  const current = loadSettings();
  saveSettings({ ...current, ollamaConfig: config });
}

export function clearOllamaConfig(): void {
  const current = loadSettings();
  const { ollamaConfig: _, ...rest } = current;
  saveSettings(rest as AppSettings);
}

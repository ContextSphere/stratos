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
  /** Visual design, independent of light/dark color mode. */
  designVariant?: "classic" | "refined";
  providers?: Record<string, ProviderPrefs>;
  /** Opencode sub-provider API keys keyed by opencode provider ID (e.g. "anthropic", "openai") */
  opencodeProviderKeys?: Record<string, OpencodeProviderKey>;
  /** @deprecated Use `opencodeEnabledModels`. Retained for migration. */
  opencodeModelAllowlist?: string[];
  /**
   * Per-provider enabled model values, e.g.
   * `{ anthropic: ["anthropic/claude-sonnet-4-5"], ollama: ["ollama/llama3.1:8b"] }`.
   * A provider is "enabled" iff it has an entry in this map with >= 1 value.
   * An empty array is treated as a legacy migration marker (means "all models").
   */
  opencodeEnabledModels?: Record<string, string[]>;
  /**
   * Last selection stash so toggling a provider off then on restores picks
   * without forcing the user to re-select. Cleared on Remove.
   */
  opencodeEnabledModelsArchive?: Record<string, string[]>;
  /** Ollama local model server configuration */
  ollamaConfig?: OllamaConfig;
  /**
   * Enables the Manager Agent (pinned Manager thread + `mcp__stratos__*`
   * orchestration tools). Off by default: most users don't use it and an empty
   * Manager thread makes an otherwise-empty sidebar confusing. Requires an app
   * restart to take effect since Manager wiring happens once at startup.
   */
  managerEnabled?: boolean;
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
  return { theme: "dark", designVariant: "classic" };
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

/**
 * Enabled models per opencode sub-provider.
 *
 * Returns an empty array for providers that existed in the legacy
 * `opencodeModelAllowlist` but have no explicit selection yet — this is the
 * "all models visible" fallback used for backward compat. Once the user opens
 * the Manage panel, the explicit selection overwrites this.
 */
export function getOpencodeEnabledModels(): Record<string, string[]> {
  const settings = loadSettings();
  if (settings.opencodeEnabledModels) return settings.opencodeEnabledModels;
  const legacy = settings.opencodeModelAllowlist;
  if (!legacy) {
    return Object.fromEntries(
      DEFAULT_OPENCODE_MODEL_ALLOWLIST.map((id) => [id, [] as string[]]),
    );
  }
  return Object.fromEntries(legacy.map((id) => [id, [] as string[]]));
}

export function setOpencodeEnabledModels(
  providerId: string,
  modelValues: string[],
): void {
  const current = loadSettings();
  // Use the persisted map as-is (do not inflate with defaults on write —
  // users shouldn't have implicit providers added behind their back).
  const existing = current.opencodeEnabledModels ?? {};
  const next: Record<string, string[]> = { ...existing };
  if (modelValues.length === 0) {
    delete next[providerId];
  } else {
    next[providerId] = modelValues;
  }
  // Keep the legacy allowlist mirror in sync for one release so any
  // consumer we haven't migrated still sees a coherent provider set.
  const allowlist = Object.keys(next);
  saveSettings({
    ...current,
    opencodeEnabledModels: next,
    opencodeModelAllowlist: allowlist,
  });
}

export function disableOpencodeProvider(providerId: string): void {
  const current = loadSettings();
  const enabled = current.opencodeEnabledModels ?? {};
  if (!enabled[providerId]) return;
  const archive = { ...(current.opencodeEnabledModelsArchive ?? {}) };
  archive[providerId] = enabled[providerId];
  const nextEnabled = { ...enabled };
  delete nextEnabled[providerId];
  saveSettings({
    ...current,
    opencodeEnabledModels: nextEnabled,
    opencodeEnabledModelsArchive: archive,
    opencodeModelAllowlist: Object.keys(nextEnabled),
  });
}

/**
 * Returns the archived selection for this provider, if any, or null.
 * Does not mutate storage — the caller is expected to pass the returned
 * values back through `setOpencodeEnabledModels`.
 */
export function getArchivedOpencodeEnabledModels(
  providerId: string,
): string[] | null {
  const settings = loadSettings();
  return settings.opencodeEnabledModelsArchive?.[providerId] ?? null;
}

export function clearOpencodeProvider(providerId: string): void {
  const current = loadSettings();
  const enabled = { ...(current.opencodeEnabledModels ?? {}) };
  const archive = { ...(current.opencodeEnabledModelsArchive ?? {}) };
  delete enabled[providerId];
  delete archive[providerId];
  saveSettings({
    ...current,
    opencodeEnabledModels: enabled,
    opencodeEnabledModelsArchive: archive,
    opencodeModelAllowlist: Object.keys(enabled),
  });
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

/** True iff the user has explicitly opted into the Manager Agent. */
export function isManagerEnabled(): boolean {
  return loadSettings().managerEnabled === true;
}

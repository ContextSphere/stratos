import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { decryptSecret, encryptSecret } from "./secure-storage";

export type AppTheme = "dark" | "light";

export interface ProviderPrefs {
  lastUsedModel?: string;
  lastUsedEffort?: "low" | "medium" | "high" | "max";
}

/** Decrypted API key used only inside the Electron main process. */
export interface OpencodeProviderKey {
  apiKey: string;
  baseURL?: string;
}

/** Encrypted-at-rest representation persisted in app-settings.json. */
interface StoredOpencodeProviderKey {
  /** @deprecated Plaintext field retained only for one-time migration. */
  apiKey?: string;
  encryptedApiKey?: string;
  keyHint?: string;
  baseURL?: string;
}

export interface OpencodeProviderStatus {
  configured: boolean;
  keyHint: string;
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
  /** Encrypted Opencode sub-provider credentials keyed by provider ID. */
  opencodeProviderKeys?: Record<string, StoredOpencodeProviderKey>;
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
// Allow an isolated development/test profile without changing provider login
// discovery (which still uses the real home directory).
function getConfigDir(): string {
  return process.env.STRATOS_SETTINGS_DIR || join(homedir(), ".stratos");
}

function getStorePath(): string {
  return join(getConfigDir(), STORE_FILE);
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
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
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
  const stored = settings.opencodeProviderKeys ?? {};
  const resolved: Record<string, OpencodeProviderKey> = {};
  let migrated = false;
  const migratedKeys: Record<string, StoredOpencodeProviderKey> = {};

  for (const [providerId, entry] of Object.entries(stored)) {
    const apiKey = entry.encryptedApiKey
      ? decryptSecret(entry.encryptedApiKey)
      : entry.apiKey;
    if (!apiKey) continue;

    resolved[providerId] = {
      apiKey,
      ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
    };

    if (entry.encryptedApiKey) {
      migratedKeys[providerId] = entry;
      continue;
    }

    migrated = true;
    migratedKeys[providerId] = {
      encryptedApiKey: encryptSecret(apiKey),
      keyHint: maskCredential(apiKey),
      ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
    };
  }

  if (migrated) {
    saveSettings({ ...settings, opencodeProviderKeys: migratedKeys });
  }

  return resolved;
}

export function getOpencodeProviderStatuses(): Record<
  string,
  OpencodeProviderStatus
> {
  // Resolve once so legacy plaintext credentials are migrated before anything
  // is returned to the renderer.
  getOpencodeProviderKeys();
  const stored = loadSettings().opencodeProviderKeys ?? {};
  return Object.fromEntries(
    Object.entries(stored)
      .filter(([, entry]) => Boolean(entry.encryptedApiKey))
      .map(([providerId, entry]) => [
        providerId,
        {
          configured: true,
          keyHint: entry.keyHint ?? "Credential stored securely",
          ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
        },
      ]),
  );
}

export function setOpencodeProviderKey(
  providerId: string,
  key: OpencodeProviderKey,
): void {
  const apiKey = key.apiKey.trim();
  if (!apiKey) {
    throw new Error("An API key is required.");
  }
  const current = loadSettings();
  const updated: AppSettings = {
    ...current,
    opencodeProviderKeys: {
      ...(current.opencodeProviderKeys ?? {}),
      [providerId]: {
        encryptedApiKey: encryptSecret(apiKey),
        keyHint: maskCredential(apiKey),
        ...(key.baseURL ? { baseURL: key.baseURL } : {}),
      },
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

function maskCredential(value: string): string {
  if (value.length <= 8) return "Credential stored securely";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function getPublicSettings(): AppSettings {
  const { opencodeProviderKeys: _credentials, ...settings } = loadSettings();
  return settings;
}

export function updatePublicSettings(
  updates: Partial<AppSettings>,
): AppSettings {
  const { opencodeProviderKeys: _credentials, ...safeUpdates } = updates;
  updateSettings(safeUpdates);
  return getPublicSettings();
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

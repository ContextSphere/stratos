import { useState, useCallback, useEffect, useMemo } from "react";
import { Dialog, DialogBody, Button } from "@stratosapp/ui";

interface ProviderKey {
  apiKey: string;
  baseURL?: string;
}

interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportsReasoning?: boolean;
}

interface OllamaModelInfo {
  name: string;
  size: number;
  parameterSize: string;
  family: string;
  quantization: string;
  capabilities: { vision: boolean; tools: boolean; thinking: boolean };
  contextLength: number;
}

interface OllamaConfig {
  baseURL: string;
  models: Record<string, OllamaModelInfo>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: when set, opens the Add panel with this provider preselected. */
  initialAddProviderId?: string;
}

interface ProviderDef {
  id: string;
  label: string;
  placeholder: string;
  kind: "api" | "ollama";
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    kind: "api",
  },
  { id: "openai", label: "OpenAI", placeholder: "sk-...", kind: "api" },
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    kind: "api",
  },
  { id: "google", label: "Google AI", placeholder: "AIza...", kind: "api" },
  { id: "groq", label: "Groq", placeholder: "gsk_...", kind: "api" },
  { id: "mistral", label: "Mistral", placeholder: "...", kind: "api" },
  { id: "ollama", label: "Ollama", placeholder: "", kind: "ollama" },
];

function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

type PanelMode =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; providerId: string };

export function OpencodeSettingsDialog({
  isOpen,
  onClose,
  initialAddProviderId,
}: Props): React.ReactElement | null {
  const [keys, setKeys] = useState<Record<string, ProviderKey>>({});
  const [enabledModels, setEnabledModels] = useState<Record<string, string[]>>(
    {},
  );
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);
  const [panel, setPanel] = useState<PanelMode>({ kind: "closed" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [k, em, oc] = await Promise.all([
        window.api.opencodeGetProviderKeys(),
        window.api.opencodeGetEnabledModels?.() ?? Promise.resolve({}),
        window.api.ollamaGetConfig() as Promise<OllamaConfig | undefined>,
      ]);
      setKeys(k ?? {});
      setEnabledModels(em ?? {});
      setOllamaConfig(oc ?? null);
    } catch (err) {
      console.error("[opencode-settings] refresh failed:", err);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    setError(null);
    if (initialAddProviderId) {
      setPanel({ kind: "add" });
    } else {
      setPanel({ kind: "closed" });
    }
  }, [isOpen, refresh, initialAddProviderId]);

  const configuredIds = useMemo(() => {
    const ids = new Set<string>(Object.keys(keys));
    if (ollamaConfig) ids.add("ollama");
    return ids;
  }, [keys, ollamaConfig]);

  const rows = useMemo(() => {
    const list: {
      id: string;
      label: string;
      keyHint: string;
      modelCount: number;
      enabled: boolean;
      kind: "api" | "ollama";
    }[] = [];
    for (const id of configuredIds) {
      const def = PROVIDERS.find((p) => p.id === id);
      const isOllama = id === "ollama";
      const hint = isOllama
        ? (ollamaConfig?.baseURL ?? "")
        : maskKey(keys[id]?.apiKey ?? "");
      const picks = enabledModels[id] ?? [];
      // Legacy-empty array = fall back to known count (we don't know, show 0
      // until the user opens Manage; that's a reasonable nudge).
      const count = picks.length;
      list.push({
        id,
        label: def?.label ?? id,
        keyHint: hint,
        modelCount: count,
        enabled: picks.length > 0 || id in enabledModels,
        kind: isOllama ? "ollama" : "api",
      });
    }
    // Pinned order: alphabetical by label, Ollama last
    return list.sort((a, b) => {
      if (a.id === "ollama") return 1;
      if (b.id === "ollama") return -1;
      return a.label.localeCompare(b.label);
    });
  }, [configuredIds, keys, ollamaConfig, enabledModels]);

  const handleToggle = useCallback(
    async (id: string, nextEnabled: boolean) => {
      try {
        if (nextEnabled) {
          const restored = await window.api.opencodeRestoreProvider(id);
          if (restored && restored.length > 0) {
            await refresh();
            return;
          }
          // No archive — jump to Manage so the user picks models
          setPanel({ kind: "edit", providerId: id });
        } else {
          await window.api.opencodeDisableProvider(id);
          await refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Toggle failed");
      }
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        if (id === "ollama") {
          await window.api.ollamaClearConfig();
        } else {
          await window.api.opencodeDeleteProviderKey(id);
        }
        await window.api.opencodeClearProvider(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove failed");
      }
    },
    [refresh],
  );

  if (!isOpen) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Opencode Settings">
      <DialogBody>
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Configure providers for the opencode runtime. Keys are stored
            locally and injected at server startup.
          </p>

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
                Providers
              </p>
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <ProviderRow
                    key={row.id}
                    id={row.id}
                    label={row.label}
                    keyHint={row.keyHint}
                    modelCount={row.modelCount}
                    enabled={row.enabled}
                    onToggle={(next) => handleToggle(row.id, next)}
                    onManage={() =>
                      setPanel({ kind: "edit", providerId: row.id })
                    }
                    onRemove={() => handleRemove(row.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {rows.length === 0 && panel.kind === "closed" && (
            <p className="text-xs text-[var(--text-muted)] text-center py-2">
              No providers configured.
            </p>
          )}

          {panel.kind === "closed" ? (
            <div className="flex justify-center">
              <Button
                onClick={() => setPanel({ kind: "add" })}
                size="sm"
                data-testid="opencode-add-provider"
              >
                + Add Provider
              </Button>
            </div>
          ) : (
            <AddProviderPanel
              mode={panel}
              configuredIds={configuredIds}
              existingKey={
                panel.kind === "edit" ? keys[panel.providerId] : undefined
              }
              existingOllama={
                panel.kind === "edit" && panel.providerId === "ollama"
                  ? ollamaConfig
                  : null
              }
              existingSelection={
                panel.kind === "edit"
                  ? (enabledModels[panel.providerId] ?? [])
                  : []
              }
              initialProviderId={
                panel.kind === "add" ? initialAddProviderId : undefined
              }
              onCancel={() => setPanel({ kind: "closed" })}
              onSaved={async () => {
                await refresh();
                setPanel({ kind: "closed" });
              }}
            />
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-2 py-1.5 rounded-md">
              {error}
            </p>
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}

// ─── ProviderRow ─────────────────────────────────────────────────────────────

interface ProviderRowProps {
  id: string;
  label: string;
  keyHint: string;
  modelCount: number;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onManage: () => void;
  onRemove: () => void;
}

function ProviderRow({
  id,
  label,
  keyHint,
  modelCount,
  enabled,
  onToggle,
  onManage,
  onRemove,
}: ProviderRowProps): React.ReactElement {
  return (
    <div
      className="flex items-center gap-2 p-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border)]"
      data-testid={`opencode-row-${id}`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          enabled && modelCount > 0 ? "bg-green-500" : "bg-gray-500"
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--text-primary)] truncate">
          {label}
        </p>
        <p className="text-[10px] text-[var(--text-muted)] truncate">
          {keyHint}
          {keyHint ? " · " : ""}
          {modelCount} model{modelCount === 1 ? "" : "s"}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
        onClick={() => onToggle(!enabled)}
        className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 relative ${
          enabled ? "bg-green-600" : "bg-[var(--border)]"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <button
        onClick={onManage}
        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0 px-1"
      >
        Manage
      </button>
      <button
        onClick={onRemove}
        className="text-[10px] text-[var(--text-muted)] hover:text-red-400 transition-colors flex-shrink-0 px-1"
      >
        Remove
      </button>
    </div>
  );
}

// ─── AddProviderPanel ────────────────────────────────────────────────────────

interface AddProviderPanelProps {
  mode: { kind: "add" } | { kind: "edit"; providerId: string };
  configuredIds: Set<string>;
  existingKey?: ProviderKey;
  existingOllama: OllamaConfig | null;
  existingSelection: string[];
  initialProviderId?: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

function AddProviderPanel({
  mode,
  configuredIds,
  existingKey,
  existingOllama,
  existingSelection,
  initialProviderId,
  onCancel,
  onSaved,
}: AddProviderPanelProps): React.ReactElement {
  const editing = mode.kind === "edit";
  const fixedProviderId = editing ? mode.providerId : undefined;

  const [providerId, setProviderId] = useState<string>(
    fixedProviderId ?? initialProviderId ?? "anthropic",
  );
  const def = PROVIDERS.find((p) => p.id === providerId);

  const [step, setStep] = useState<"credentials" | "models">(
    editing ? "models" : "credentials",
  );

  // Shared state
  const [apiKey, setApiKey] = useState(existingKey?.apiKey ?? "");
  const [baseURL, setBaseURL] = useState(existingKey?.baseURL ?? "");
  const [ollamaURL, setOllamaURL] = useState(
    existingOllama?.baseURL ?? "http://localhost:11434",
  );

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(existingSelection),
  );
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When a model list arrives for the first time in edit mode, keep the
  // existing selection (already in `selected`). In add mode, select-all by
  // default.
  const fetchModels = useCallback(async () => {
    setFetching(true);
    setErr(null);
    try {
      if (def?.kind === "ollama") {
        const list = (await window.api.ollamaDiscoverModels(
          ollamaURL,
        )) as OllamaModelInfo[];
        setOllamaModels(list);
        if (!editing) setSelected(new Set(list.map((m) => m.name)));
      } else {
        const list = await window.api.opencodeListProviderModels(providerId);
        setModels(list);
        if (!editing) setSelected(new Set(list.map((m) => m.value)));
      }
    } catch (e) {
      setErr(
        e instanceof Error
          ? e.message
          : "Failed to fetch models. Check your credentials or server.",
      );
    } finally {
      setFetching(false);
    }
  }, [def?.kind, ollamaURL, providerId, editing]);

  // Auto-fetch when we enter the models step
  useEffect(() => {
    if (step !== "models") return;
    if (def?.kind === "ollama") {
      fetchModels();
    } else {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, providerId]);

  const canContinue = useMemo(() => {
    if (!def) return false;
    if (def.kind === "api") return apiKey.trim().length > 0;
    if (def.kind === "ollama") return ollamaURL.trim().length > 0;
    return false;
  }, [def, apiKey, ollamaURL]);

  const handleContinue = useCallback(async () => {
    if (!def || !canContinue) return;
    setErr(null);
    setSaving(true);
    try {
      if (def.kind === "api") {
        await window.api.opencodeSetProviderKey(
          providerId,
          apiKey.trim(),
          baseURL.trim() || undefined,
        );
      }
      // For Ollama: defer save until models are picked.
      setStep("models");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }, [def, canContinue, providerId, apiKey, baseURL]);

  const handleSave = useCallback(async () => {
    if (!def) return;
    setSaving(true);
    setErr(null);
    try {
      if (def.kind === "ollama") {
        const modelsMap: Record<string, OllamaModelInfo> = {};
        for (const m of ollamaModels) {
          if (selected.has(m.name)) modelsMap[m.name] = m;
        }
        // preserve previously-configured models that weren't re-discovered
        if (existingOllama) {
          for (const [name, info] of Object.entries(existingOllama.models)) {
            if (selected.has(name) && !modelsMap[name]) {
              modelsMap[name] = info;
            }
          }
        }
        await window.api.ollamaSetConfig({
          baseURL: ollamaURL,
          models: modelsMap,
        });
        const values = Object.keys(modelsMap).map((id) => `ollama/${id}`);
        await window.api.opencodeSetEnabledModels("ollama", values);
      } else {
        const values = Array.from(selected);
        await window.api.opencodeSetEnabledModels(providerId, values);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    def,
    providerId,
    selected,
    ollamaURL,
    ollamaModels,
    existingOllama,
    onSaved,
  ]);

  const providerOptions = PROVIDERS.filter(
    (p) => !configuredIds.has(p.id) || p.id === providerId,
  );

  return (
    <div
      className="space-y-2 p-3 rounded-md bg-[var(--bg-surface)] border border-[var(--border)]"
      data-testid="opencode-add-panel"
    >
      <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
        {editing ? `Manage — ${providerLabel(providerId)}` : "Add Provider"}
      </p>

      {!editing && (
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
            Provider
          </label>
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setStep("credentials");
              setApiKey("");
              setBaseURL("");
              setModels([]);
              setOllamaModels([]);
              setSelected(new Set());
              setErr(null);
            }}
            className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-control)]"
            data-testid="opencode-provider-dropdown"
          >
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {configuredIds.has(p.id) ? " (configured)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {step === "credentials" && def?.kind === "api" && (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={def.placeholder || "API key"}
            className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
            autoFocus
            data-testid="opencode-api-key"
          />
          <input
            type="text"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="Base URL (optional)"
            className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
          />
        </div>
      )}

      {step === "credentials" && def?.kind === "ollama" && (
        <div className="space-y-2">
          <input
            type="text"
            value={ollamaURL}
            onChange={(e) => setOllamaURL(e.target.value)}
            placeholder="http://localhost:11434"
            className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
            autoFocus
            data-testid="opencode-ollama-url"
          />
        </div>
      )}

      {step === "models" && (
        <ModelMultiSelect
          kind={def?.kind ?? "api"}
          fetching={fetching}
          apiModels={models}
          ollamaModels={ollamaModels}
          selected={selected}
          onToggle={(value) => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(value)) next.delete(value);
              else next.add(value);
              return next;
            });
          }}
          onSelectAll={() => {
            if (def?.kind === "ollama") {
              setSelected(new Set(ollamaModels.map((m) => m.name)));
            } else {
              setSelected(new Set(models.map((m) => m.value)));
            }
          }}
          onSelectNone={() => setSelected(new Set())}
          onRetry={fetchModels}
          onChangeKey={
            def?.kind === "api" && editing
              ? () => setStep("credentials")
              : undefined
          }
        />
      )}

      {err && (
        <p className="text-xs text-red-400 bg-red-400/10 px-2 py-1.5 rounded-md">
          {err}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1"
        >
          Cancel
        </button>
        <div className="flex-1" />
        {step === "credentials" ? (
          <Button
            onClick={handleContinue}
            disabled={!canContinue || saving}
            size="sm"
            data-testid="opencode-continue"
          >
            {saving ? "Saving..." : "Continue →"}
          </Button>
        ) : (
          <>
            {def?.kind === "api" && !editing && (
              <button
                onClick={() => setStep("credentials")}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
              >
                ← Back
              </button>
            )}
            <Button
              onClick={handleSave}
              disabled={selected.size === 0 || saving || fetching}
              size="sm"
              data-testid="opencode-save"
            >
              {saving ? "Saving..." : `Save Provider (${selected.size})`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── ModelMultiSelect ────────────────────────────────────────────────────────

interface ModelMultiSelectProps {
  kind: "api" | "ollama";
  fetching: boolean;
  apiModels: ModelInfo[];
  ollamaModels: OllamaModelInfo[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onRetry: () => void;
  onChangeKey?: () => void;
}

function ModelMultiSelect({
  kind,
  fetching,
  apiModels,
  ollamaModels,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onRetry,
  onChangeKey,
}: ModelMultiSelectProps): React.ReactElement {
  const count = kind === "ollama" ? ollamaModels.length : apiModels.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
          Models
          {count > 0 && ` · ${selected.size}/${count} selected`}
        </p>
        <div className="flex items-center gap-2">
          {onChangeKey && (
            <button
              onClick={onChangeKey}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Change key
            </button>
          )}
          <button
            onClick={onRetry}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            disabled={fetching}
          >
            {fetching ? "…" : "Refresh"}
          </button>
          <button
            onClick={onSelectAll}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            All
          </button>
          <button
            onClick={onSelectNone}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            None
          </button>
        </div>
      </div>

      {fetching && count === 0 && (
        <p className="text-xs text-[var(--text-muted)] py-2 text-center">
          Fetching models…
        </p>
      )}

      {!fetching && count === 0 && (
        <p className="text-xs text-[var(--text-muted)] py-2 text-center">
          No models found.{" "}
          <button
            onClick={onRetry}
            className="text-[var(--text-control)] hover:underline"
          >
            Retry
          </button>
        </p>
      )}

      {count > 0 && (
        <div
          className="space-y-1 max-h-64 overflow-y-auto pr-1"
          data-testid="opencode-model-list"
        >
          {kind === "ollama"
            ? ollamaModels.map((m) => {
                const on = selected.has(m.name);
                const badges: string[] = [];
                if (m.capabilities.tools) badges.push("tools");
                if (m.capabilities.vision) badges.push("vision");
                if (m.capabilities.thinking) badges.push("thinking");
                return (
                  <button
                    key={m.name}
                    onClick={() => onToggle(m.name)}
                    className={`w-full text-left p-1.5 rounded border text-xs transition-colors ${
                      on
                        ? "bg-[var(--bg-base)] border-[var(--text-control)]"
                        : "bg-transparent border-[var(--border)] opacity-60 hover:opacity-100"
                    }`}
                    data-testid={`opencode-model-${m.name}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {}}
                        className="flex-shrink-0"
                      />
                      <span className="font-medium text-[var(--text-primary)] truncate flex-1">
                        {m.name}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
                        {m.parameterSize} · {formatBytes(m.size)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 ml-6">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {Math.round(m.contextLength / 1024)}k ctx
                      </span>
                      {badges.map((b) => (
                        <span
                          key={b}
                          className="text-[10px] px-1 rounded bg-[var(--border)] text-[var(--text-muted)]"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })
            : apiModels.map((m) => {
                const on = selected.has(m.value);
                return (
                  <button
                    key={m.value}
                    onClick={() => onToggle(m.value)}
                    className={`w-full text-left p-1.5 rounded border text-xs transition-colors ${
                      on
                        ? "bg-[var(--bg-base)] border-[var(--text-control)]"
                        : "bg-transparent border-[var(--border)] opacity-60 hover:opacity-100"
                    }`}
                    data-testid={`opencode-model-${m.value.replace(/\//g, "-")}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {}}
                        className="flex-shrink-0"
                      />
                      <span className="font-medium text-[var(--text-primary)] truncate flex-1">
                        {m.displayName}
                      </span>
                      {m.supportsReasoning && (
                        <span className="text-[10px] px-1 rounded bg-[var(--border)] text-[var(--text-muted)] flex-shrink-0">
                          reasoning
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 ml-6 text-[10px] text-[var(--text-muted)]">
                      <span className="truncate">{m.description}</span>
                    </div>
                  </button>
                );
              })}
        </div>
      )}
    </div>
  );
}

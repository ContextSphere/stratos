import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogBody, Button } from "@stratosapp/ui";

interface OllamaModelInfo {
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

interface OllamaConfig {
  baseURL: string;
  models: Record<string, OllamaModelInfo>;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function capBadges(caps: OllamaModelInfo["capabilities"]): string[] {
  const tags: string[] = [];
  if (caps.tools) tags.push("tools");
  if (caps.vision) tags.push("vision");
  if (caps.thinking) tags.push("thinking");
  return tags;
}

export function OllamaSettingsDialog({
  isOpen,
  onClose,
}: Props): React.ReactElement | null {
  const [baseURL, setBaseURL] = useState("http://localhost:11434");
  const [config, setConfig] = useState<OllamaConfig | null>(null);
  const [discovered, setDiscovered] = useState<OllamaModelInfo[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load existing config on open
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSaved(false);
    setDiscovered([]);
    window.api
      .ollamaGetConfig()
      .then((cfg: unknown) => {
        const c = cfg as OllamaConfig | undefined;
        if (c) {
          setConfig(c);
          setBaseURL(c.baseURL);
          setSelectedModels(new Set(Object.keys(c.models)));
        } else {
          setConfig(null);
          setSelectedModels(new Set());
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setError(null);
    setSaved(false);
    try {
      const models = (await window.api.ollamaDiscoverModels(
        baseURL,
      )) as OllamaModelInfo[];
      setDiscovered(models);
      // Auto-select all discovered models
      setSelectedModels(new Set(models.map((m) => m.name)));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect to Ollama. Is it running?",
      );
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  }, [baseURL]);

  const toggleModel = useCallback((name: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build models map from discovered + selected
      const allModels = discovered.length > 0 ? discovered : [];
      // Also include existing config models for models not re-discovered
      const existingModels = config?.models ?? {};
      const models: Record<string, OllamaModelInfo> = {};

      for (const m of allModels) {
        if (selectedModels.has(m.name)) {
          models[m.name] = m;
        }
      }
      // Keep existing models that are still selected but weren't re-discovered
      for (const [name, info] of Object.entries(existingModels)) {
        if (selectedModels.has(name) && !models[name]) {
          models[name] = info;
        }
      }

      const newConfig: OllamaConfig = { baseURL, models };
      await window.api.ollamaSetConfig(newConfig);
      setConfig(newConfig);

      // Auto-add "ollama" to model allowlist
      try {
        const allowlist =
          (await window.api.opencodeGetModelAllowlist?.()) ?? [];
        if (!allowlist.includes("ollama")) {
          await window.api.opencodeSetModelAllowlist?.([
            ...allowlist,
            "ollama",
          ]);
        }
      } catch {
        // Non-critical
      }

      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setLoading(false);
    }
  }, [baseURL, discovered, selectedModels, config]);

  const handleRemove = useCallback(async () => {
    setLoading(true);
    try {
      await window.api.ollamaClearConfig();
      setConfig(null);
      setDiscovered([]);
      setSelectedModels(new Set());
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear config");
    } finally {
      setLoading(false);
    }
  }, []);

  // Models to display: discovered takes priority, otherwise existing config
  const displayModels =
    discovered.length > 0 ? discovered : Object.values(config?.models ?? {});

  if (!isOpen) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Ollama Settings">
      <DialogBody>
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Connect to a local Ollama server to use open-source models with the
            Opencode provider.
          </p>

          {/* Base URL */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
              Ollama Server URL
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseURL}
                onChange={(e) => {
                  setBaseURL(e.target.value);
                  setSaved(false);
                }}
                placeholder="http://localhost:11434"
                className="flex-1 px-2 py-1.5 text-xs rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
              />
              <Button
                onClick={handleDiscover}
                disabled={discovering || !baseURL.trim()}
                size="sm"
              >
                {discovering ? "Scanning..." : "Discover Models"}
              </Button>
            </div>
          </div>

          {/* Model list */}
          {displayModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
                Available Models
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {displayModels.map((m) => {
                  const isSelected = selectedModels.has(m.name);
                  const badges = capBadges(m.capabilities);
                  return (
                    <button
                      key={m.name}
                      onClick={() => toggleModel(m.name)}
                      className={`w-full text-left p-2 rounded-md border transition-colors ${
                        isSelected
                          ? "bg-[var(--bg-surface)] border-[var(--text-control)]"
                          : "bg-transparent border-[var(--border)] opacity-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSelected ? "bg-green-500" : "bg-gray-500"
                            }`}
                          />
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                            {m.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">
                          {m.parameterSize} &middot; {formatBytes(m.size)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 ml-4">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {Math.round(m.contextLength / 1024)}k ctx
                        </span>
                        {badges.map((b) => (
                          <span
                            key={b}
                            className="text-[10px] px-1 py-0.5 rounded bg-[var(--border)] text-[var(--text-muted)]"
                          >
                            {b}
                          </span>
                        ))}
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {m.quantization}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          {displayModels.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={loading || selectedModels.size === 0}
                size="sm"
              >
                {loading
                  ? "Saving..."
                  : saved
                    ? "Saved!"
                    : `Enable ${selectedModels.size} Model${selectedModels.size !== 1 ? "s" : ""}`}
              </Button>
              {config && (
                <button
                  onClick={handleRemove}
                  disabled={loading}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                >
                  Remove Ollama
                </button>
              )}
            </div>
          )}

          {/* Status indicator */}
          {config && displayModels.length === 0 && (
            <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <p className="text-xs text-[var(--text-primary)]">
                  Ollama configured ({Object.keys(config.models).length} model
                  {Object.keys(config.models).length !== 1 ? "s" : ""})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscover}
                  disabled={discovering}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Refresh
                </button>
                <button
                  onClick={handleRemove}
                  disabled={loading}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-2 py-1.5 rounded-md">
              {error}
            </p>
          )}

          {/* Empty state */}
          {!config && displayModels.length === 0 && !error && (
            <p className="text-xs text-[var(--text-muted)] text-center py-2">
              Click &quot;Discover Models&quot; to scan your local Ollama
              server.
            </p>
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}

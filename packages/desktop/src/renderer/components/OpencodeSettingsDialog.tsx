import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogBody, Button } from "@stratosapp/ui";

interface ProviderKey {
  apiKey: string;
  baseURL?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const COMMON_PROVIDERS = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
  { id: "google", label: "Google AI", placeholder: "AIza..." },
  { id: "groq", label: "Groq", placeholder: "gsk_..." },
  { id: "mistral", label: "Mistral", placeholder: "..." },
];

export function OpencodeSettingsDialog({
  isOpen,
  onClose,
}: Props): React.ReactElement | null {
  const [keys, setKeys] = useState<Record<string, ProviderKey>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState<string>("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newBaseURL, setNewBaseURL] = useState("");
  const [showCustomProvider, setShowCustomProvider] = useState(false);
  const [customProviderId, setCustomProviderId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await window.api.opencodeGetProviderKeys();
      setKeys(result ?? {});
    } catch (err) {
      console.error("[opencode] failed to load provider keys:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      refresh();
      setError(null);
      setAddingProvider("");
      setNewApiKey("");
      setNewBaseURL("");
      setShowCustomProvider(false);
      setCustomProviderId("");
    }
  }, [isOpen, refresh]);

  const handleAdd = useCallback(async () => {
    const providerId = showCustomProvider
      ? customProviderId.trim()
      : addingProvider;
    if (!providerId || !newApiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await window.api.opencodeSetProviderKey(
        providerId,
        newApiKey.trim(),
        newBaseURL.trim() || undefined,
      );
      await refresh();
      setAddingProvider("");
      setNewApiKey("");
      setNewBaseURL("");
      setShowCustomProvider(false);
      setCustomProviderId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setLoading(false);
    }
  }, [
    addingProvider,
    customProviderId,
    newApiKey,
    newBaseURL,
    showCustomProvider,
    refresh,
  ]);

  const handleDelete = useCallback(
    async (providerId: string) => {
      setLoading(true);
      setError(null);
      try {
        await window.api.opencodeDeleteProviderKey(providerId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete key");
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  const activeProviderId = showCustomProvider
    ? customProviderId
    : addingProvider;
  const canSave = !!activeProviderId.trim() && !!newApiKey.trim();

  if (!isOpen) return null;

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Opencode Settings">
      <DialogBody>
        <div className="space-y-4">
          <p className="text-xs text-[var(--text-muted)]">
            Configure API keys for opencode sub-providers. These are stored
            locally and injected into the opencode server at startup.
          </p>

          {/* Existing keys */}
          {Object.keys(keys).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
                Configured Providers
              </p>
              {Object.entries(keys).map(([id, key]) => (
                <div
                  key={id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {COMMON_PROVIDERS.find((p) => p.id === id)?.label ?? id}
                      </p>
                      {key.baseURL && (
                        <p className="text-[10px] text-[var(--text-muted)] truncate">
                          {key.baseURL}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(id)}
                    disabled={loading}
                    className="text-[var(--text-muted)] hover:text-red-400 transition-colors text-xs flex-shrink-0"
                    title="Remove key"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new key */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-control)] uppercase tracking-wide">
              Add Provider Key
            </p>

            {/* Provider selector */}
            <div className="flex flex-wrap gap-1.5">
              {COMMON_PROVIDERS.filter((p) => !keys[p.id]).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setAddingProvider(p.id);
                    setShowCustomProvider(false);
                  }}
                  className={`px-2 py-0.5 rounded text-xs transition-colors border ${
                    addingProvider === p.id && !showCustomProvider
                      ? "bg-[var(--border)] text-[var(--text-primary)] border-[var(--text-control)]"
                      : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowCustomProvider(true);
                  setAddingProvider("");
                }}
                className={`px-2 py-0.5 rounded text-xs transition-colors border ${
                  showCustomProvider
                    ? "bg-[var(--border)] text-[var(--text-primary)] border-[var(--text-control)]"
                    : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                }`}
              >
                Custom...
              </button>
            </div>

            {/* Custom provider ID */}
            {showCustomProvider && (
              <input
                type="text"
                value={customProviderId}
                onChange={(e) => setCustomProviderId(e.target.value)}
                placeholder="Provider ID (e.g. bedrock, vertex)"
                className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
              />
            )}

            {/* API key input */}
            {(addingProvider || showCustomProvider) && (
              <div className="space-y-2">
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSave) handleAdd();
                  }}
                  placeholder={
                    COMMON_PROVIDERS.find((p) => p.id === addingProvider)
                      ?.placeholder ?? "API key"
                  }
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
                  autoFocus
                />
                <input
                  type="text"
                  value={newBaseURL}
                  onChange={(e) => setNewBaseURL(e.target.value)}
                  placeholder="Base URL (optional, for custom endpoints)"
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-control)]"
                />
                <Button
                  onClick={handleAdd}
                  disabled={loading || !canSave}
                  size="sm"
                >
                  {loading ? "Saving..." : "Save Key"}
                </Button>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-2 py-1.5 rounded-md">
              {error}
            </p>
          )}

          {Object.keys(keys).length === 0 &&
            !addingProvider &&
            !showCustomProvider && (
              <p className="text-xs text-[var(--text-muted)] text-center py-2">
                No keys configured. Select a provider above to get started.
              </p>
            )}
        </div>
      </DialogBody>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import type {
  AgentAccent,
  AgentDefinition,
  AgentMcpServer,
  AgentMode,
  ModelInfo,
  ProviderType,
} from "@stratosapp/core";
import {
  AGENT_ACCENTS,
  validateAgentDefinition,
} from "../../utils/agent-defaults";

const ACCENT_SWATCH_CLASSES: Record<AgentAccent, string> = {
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
};

const PROVIDERS: ProviderType[] = [
  "claude-code",
  "codex",
  "opencode",
  "copilot",
];
const MODES: AgentMode[] = [
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
  "fullAccess",
];

interface McpServerRow {
  key: string;
  name: string;
  type: "http" | "sse" | "stdio";
  url: string;
  command: string;
}

export interface Props {
  agent?: AgentDefinition | null;
  onSave: (agent: AgentDefinition) => void;
  onCancel: () => void;
  onDelete?: (agentId: string) => void;
  /**
   * Fetches the model list for a provider — the same source the threads view
   * uses, so the picker here and the one in the input bar never disagree.
   */
  onFetchModels?: (provider: ProviderType) => Promise<ModelInfo[]>;
}

let rowSeq = 0;
function nextKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

/**
 * Shared control chrome, with no layout opinions. Use this inside flex rows,
 * where a hardcoded `w-full` would fight `flex-1` (Tailwind resolves the two
 * by stylesheet order, not source order, so `w-full` silently beat `w-24` and
 * let one control eat the whole row).
 */
function fieldBase(className: string): string {
  return `rounded-md border border-[var(--border)] bg-[var(--bg-root)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-blue-400 ${className}`;
}

/** Full-width stacked form field. */
function fieldLabel(className: string): string {
  return `mt-1 block w-full ${fieldBase(className)}`;
}

export function AgentEditor({
  agent,
  onSave,
  onCancel,
  onDelete,
  onFetchModels,
}: Props): React.ReactElement {
  const isBuiltIn = agent?.builtIn ?? false;

  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [icon, setIcon] = useState(agent?.icon ?? "🤖");
  const [accent, setAccent] = useState<AgentAccent>(agent?.accent ?? "blue");
  const [provider, setProvider] = useState<ProviderType | "">(
    agent?.provider ?? "",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Model list follows the selected provider, exactly as the threads view does.
  // Refetching on provider change stops a previous provider's models leaking
  // into the picker.
  useEffect(() => {
    let cancelled = false;
    // `provider` is "" until the user picks one; there is no model list to
    // fetch for "no provider", so clear rather than guessing a default.
    if (!onFetchModels || !provider) {
      setModels([]);
      return;
    }
    onFetchModels(provider as ProviderType)
      .then((list) => {
        if (!cancelled) setModels(list ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, onFetchModels]);

  const modelOptions = useMemo(
    () => [
      ...models.map((m) => ({
        value: m.value,
        label: m.displayName || m.value,
      })),
      // Keep a model the agent already names visible even when the provider
      // no longer lists it, so opening the editor can never silently drop it.
      ...(model && !models.some((m) => m.value === model)
        ? [{ value: model, label: `${model} (not in provider list)` }]
        : []),
    ],
    [models, model],
  );
  const [mode, setMode] = useState<AgentMode | "">(agent?.mode ?? "");
  const [cwd, setCwd] = useState(agent?.cwd ?? "");

  const [promptMode, setPromptMode] = useState<"inline" | "files">(
    Array.isArray(agent?.prompt) ? "files" : "inline",
  );
  const [promptText, setPromptText] = useState(
    typeof agent?.prompt === "string" ? agent.prompt : "",
  );
  const [promptFiles, setPromptFiles] = useState<string[]>(
    Array.isArray(agent?.prompt) && agent.prompt.length > 0
      ? agent.prompt
      : [""],
  );

  const [mcpRows, setMcpRows] = useState<McpServerRow[]>(() =>
    Object.entries(agent?.mcpServers ?? {}).map(([serverName, server]) => ({
      key: nextKey(),
      name: serverName,
      type: server.type,
      url: server.url ?? "",
      command: server.command ?? "",
    })),
  );

  const id = agent?.id ?? slugify(name);

  const candidate: AgentDefinition = useMemo(() => {
    const mcpServers: Record<string, AgentMcpServer> = {};
    for (const row of mcpRows) {
      const trimmedName = row.name.trim();
      if (!trimmedName) continue;
      mcpServers[trimmedName] = {
        type: row.type,
        ...(row.type === "stdio"
          ? { command: row.command.trim() || undefined }
          : { url: row.url.trim() || undefined }),
      };
    }

    const trimmedFiles = promptFiles.map((f) => f.trim()).filter(Boolean);
    const prompt: string | string[] | undefined =
      promptMode === "inline"
        ? promptText || undefined
        : trimmedFiles.length > 0
          ? trimmedFiles
          : undefined;

    return {
      id,
      name,
      description,
      icon,
      accent,
      builtIn: isBuiltIn,
      provider: provider || undefined,
      model: model.trim() || undefined,
      mode: mode || undefined,
      cwd: cwd.trim() || undefined,
      prompt,
      mcpServers: Object.keys(mcpServers).length ? mcpServers : undefined,
      createdAt: agent?.createdAt,
      updatedAt: Date.now(),
    };
  }, [
    id,
    name,
    description,
    icon,
    accent,
    isBuiltIn,
    provider,
    model,
    mode,
    cwd,
    promptMode,
    promptText,
    promptFiles,
    mcpRows,
    agent?.createdAt,
  ]);

  const errors = useMemo(() => validateAgentDefinition(candidate), [candidate]);
  const errorsForField = (prefix: string): string[] =>
    errors
      .filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`))
      .map((e) => e.message);

  const nameErrors = errorsForField("name");
  const iconErrors = errorsForField("icon");
  const accentErrors = errorsForField("accent");
  const mcpErrors = errorsForField("mcpServers");

  const canSave = !isBuiltIn && errors.length === 0;

  const updateMcpRow = (key: string, patch: Partial<McpServerRow>) => {
    setMcpRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--bg-main)]">
      <div className="flex-1 px-6 py-6 max-w-2xl w-full mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          {agent ? `Edit ${agent.name || "agent"}` : "New agent"}
        </h1>

        {isBuiltIn && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
            This is a built-in agent and can&apos;t be edited.
          </div>
        )}

        {/* Name */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Name
          </label>
          <input
            type="text"
            value={name}
            disabled={isBuiltIn}
            onChange={(e) => setName(e.target.value)}
            className={fieldLabel("")}
            placeholder="e.g. Release Manager"
          />
          {nameErrors.length > 0 && (
            <p className="text-xs text-red-400 mt-1">{nameErrors.join(", ")}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Description
          </label>
          <textarea
            value={description}
            disabled={isBuiltIn}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={fieldLabel("resize-none")}
            placeholder="What this agent is for"
          />
        </div>

        {/* Icon + Accent */}
        <div className="flex gap-6">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Icon
            </label>
            <input
              type="text"
              value={icon}
              disabled={isBuiltIn}
              onChange={(e) => setIcon(e.target.value)}
              className={fieldLabel("w-16 text-center")}
              maxLength={4}
            />
            {iconErrors.length > 0 && (
              <p className="text-xs text-red-400 mt-1">
                {iconErrors.join(", ")}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Accent
            </label>
            <div className="mt-1 flex items-center gap-1.5">
              {AGENT_ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={isBuiltIn}
                  onClick={() => setAccent(a)}
                  title={a}
                  aria-label={a}
                  aria-pressed={accent === a}
                  className={`w-6 h-6 rounded-full ${ACCENT_SWATCH_CLASSES[a]} ${
                    accent === a
                      ? "ring-2 ring-offset-2 ring-offset-[var(--bg-main)] ring-[var(--text-primary)]"
                      : ""
                  }`}
                />
              ))}
            </div>
            {accentErrors.length > 0 && (
              <p className="text-xs text-red-400 mt-1">
                {accentErrors.join(", ")}
              </p>
            )}
          </div>
        </div>

        {/* Provider / Model / Mode */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Provider
            </label>
            <select
              value={provider}
              disabled={isBuiltIn}
              onChange={(e) => setProvider(e.target.value as ProviderType | "")}
              className={fieldLabel("")}
            >
              <option value="">Default</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Model
            </label>
            <select
              value={model}
              disabled={isBuiltIn}
              onChange={(e) => setModel(e.target.value)}
              className={fieldLabel("")}
            >
              {/* Distinct from the provider's own "Default (recommended)"
                  entry: this means the agent pins nothing at all. */}
              <option value="">Inherit from provider</option>
              {modelOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Mode
            </label>
            <select
              value={mode}
              disabled={isBuiltIn}
              onChange={(e) => setMode(e.target.value as AgentMode | "")}
              className={fieldLabel("")}
            >
              <option value="">Default</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Working directory */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            Working directory
          </label>
          <input
            type="text"
            value={cwd}
            disabled={isBuiltIn}
            onChange={(e) => setCwd(e.target.value)}
            className={fieldLabel("")}
            placeholder="Leave blank to reuse this agent's last folder"
          />
        </div>

        {/* Prompt */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              Prompt
            </label>
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                disabled={isBuiltIn}
                onClick={() => setPromptMode("inline")}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  promptMode === "inline"
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Inline
              </button>
              <button
                type="button"
                disabled={isBuiltIn}
                onClick={() => setPromptMode("files")}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  promptMode === "files"
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                File paths
              </button>
            </div>
          </div>

          {promptMode === "inline" ? (
            <textarea
              value={promptText}
              disabled={isBuiltIn}
              onChange={(e) => setPromptText(e.target.value)}
              rows={5}
              className={fieldLabel("resize-none font-mono text-xs")}
              placeholder="Instructions for this agent..."
            />
          ) : (
            <div className="mt-1 space-y-1.5">
              {promptFiles.map((path, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={path}
                    disabled={isBuiltIn}
                    onChange={(e) => {
                      const next = [...promptFiles];
                      next[idx] = e.target.value;
                      setPromptFiles(next);
                    }}
                    className={fieldLabel("font-mono text-xs")}
                    placeholder="~/prompts/agent.md"
                  />
                  {!isBuiltIn && (
                    <button
                      type="button"
                      onClick={() =>
                        setPromptFiles(promptFiles.filter((_, i) => i !== idx))
                      }
                      className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title="Remove path"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!isBuiltIn && (
                <button
                  type="button"
                  onClick={() => setPromptFiles([...promptFiles, ""])}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  + Add path
                </button>
              )}
            </div>
          )}
        </div>

        {/* MCP servers */}
        <div>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            MCP servers
          </label>
          <div className="mt-1 space-y-2">
            {mcpRows.map((row) => (
              <div
                key={row.key}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border)] p-2"
              >
                <input
                  type="text"
                  value={row.name}
                  disabled={isBuiltIn}
                  onChange={(e) =>
                    updateMcpRow(row.key, { name: e.target.value })
                  }
                  className={fieldBase("flex-1 min-w-0")}
                  placeholder="name"
                />
                <select
                  value={row.type}
                  disabled={isBuiltIn}
                  onChange={(e) =>
                    updateMcpRow(row.key, {
                      type: e.target.value as McpServerRow["type"],
                    })
                  }
                  className={fieldBase("w-24 flex-none")}
                >
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                  <option value="stdio">stdio</option>
                </select>
                {row.type === "stdio" ? (
                  <input
                    type="text"
                    value={row.command}
                    disabled={isBuiltIn}
                    onChange={(e) =>
                      updateMcpRow(row.key, { command: e.target.value })
                    }
                    className={fieldBase("flex-[2] min-w-0")}
                    placeholder="command"
                  />
                ) : (
                  <input
                    type="text"
                    value={row.url}
                    disabled={isBuiltIn}
                    onChange={(e) =>
                      updateMcpRow(row.key, { url: e.target.value })
                    }
                    className={fieldBase("flex-[2] min-w-0")}
                    placeholder="url"
                  />
                )}
                {!isBuiltIn && (
                  <button
                    type="button"
                    onClick={() =>
                      setMcpRows(mcpRows.filter((r) => r.key !== row.key))
                    }
                    className="p-1 rounded text-[var(--text-muted)] hover:text-red-400 transition-colors"
                    title="Remove server"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {!isBuiltIn && (
              <button
                type="button"
                onClick={() =>
                  setMcpRows([
                    ...mcpRows,
                    {
                      key: nextKey(),
                      name: "",
                      type: "http",
                      url: "",
                      command: "",
                    },
                  ])
                }
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                + Add MCP server
              </button>
            )}
          </div>
          {mcpErrors.length > 0 && (
            <p className="text-xs text-red-400 mt-1">{mcpErrors.join(", ")}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-control)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
          >
            Cancel
          </button>
          {!isBuiltIn && (
            <button
              type="button"
              disabled={!canSave}
              onClick={() => canSave && onSave(candidate)}
              className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              Save
            </button>
          )}
          {!isBuiltIn && agent && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(agent.id)}
              className="ml-auto px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

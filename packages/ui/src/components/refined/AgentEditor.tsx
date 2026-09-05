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
import { getAgentModes, getModeConfig } from "../../utils/modes";
import {
  getAgentAccentSwatchClass,
  getAgentGlyph,
  isAgentGlyph,
} from "../AgentGlyph";

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

const PROVIDER_LABELS: Record<ProviderType, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  copilot: "GitHub Copilot",
};

interface McpServerRow {
  key: string;
  name: string;
  type: "http" | "sse" | "stdio";
  url: string;
  command: string;
  args: string;
  env: string;
  initialArgs?: string[];
  initialEnv?: Record<string, string>;
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

function serializeArgs(args: string[] | undefined): string {
  return args?.join("\n") ?? "";
}

function serializeEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function readArgs(row: McpServerRow): string[] | undefined {
  if (row.args === serializeArgs(row.initialArgs)) return row.initialArgs;
  return row.args === "" ? undefined : row.args.split("\n");
}

function readEnv(row: McpServerRow): Record<string, string> | undefined {
  if (row.env === serializeEnv(row.initialEnv)) return row.initialEnv;
  if (row.env === "") return undefined;

  return Object.fromEntries(
    row.env
      .split("\n")
      .filter((entry) => entry.trim())
      .map((entry) => {
        const delimiter = entry.indexOf("=");
        return [entry.slice(0, delimiter), entry.slice(delimiter + 1)];
      }),
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="border-t border-[var(--border)] pt-4">
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Label({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[13px] font-medium text-[var(--text-secondary)]"
    >
      {children}
    </label>
  );
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
  const [icon, setIcon] = useState(() =>
    getAgentGlyph(agent?.name ?? "Agent", agent?.icon),
  );
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
      args: serializeArgs(server.args),
      env: serializeEnv(server.env),
      initialArgs: server.args,
      initialEnv: server.env,
    })),
  );

  const id = agent?.id ?? slugify(name);

  const candidate: AgentDefinition = useMemo(() => {
    const mcpServers: Record<string, AgentMcpServer> = {};
    for (const row of mcpRows) {
      const trimmedName = row.name.trim();
      if (!trimmedName) continue;
      const args = readArgs(row);
      const env = readEnv(row);
      mcpServers[trimmedName] = {
        type: row.type,
        ...(row.type === "stdio"
          ? { command: row.command.trim() || undefined }
          : { url: row.url.trim() || undefined }),
        ...(args !== undefined ? { args } : {}),
        ...(env !== undefined ? { env } : {}),
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
      telegram: agent?.telegram,
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
    agent?.telegram,
  ]);

  const errors = useMemo(() => validateAgentDefinition(candidate), [candidate]);
  const errorsForField = (prefix: string): string[] =>
    errors
      .filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`))
      .map((e) => e.message);

  const nameErrors = errorsForField("name");
  const iconErrors = errorsForField("icon");
  const glyphError =
    icon.trim() && !isAgentGlyph(icon)
      ? "Use 1–2 letters or numbers."
      : undefined;
  const accentErrors = errorsForField("accent");
  const mcpErrors = errorsForField("mcpServers");
  const mcpFormatErrors = mcpRows.flatMap((row) =>
    row.env
      .split("\n")
      .filter((entry) => entry.trim() && entry.indexOf("=") <= 0)
      .map(
        () =>
          `${row.name.trim() || "MCP server"}: each environment line must use KEY=value.`,
      ),
  );

  const canSave =
    !isBuiltIn &&
    errors.length === 0 &&
    mcpFormatErrors.length === 0 &&
    !glyphError;

  const updateMcpRow = (key: string, patch: Partial<McpServerRow>) => {
    setMcpRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-[var(--bg-main)]">
      <div className="flex-1 w-full mx-auto px-6 max-w-[620px] py-7">
        <div className="mb-7">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            {agent ? `Edit ${agent.name || "agent"}` : "New agent"}
          </h1>
        </div>

        {isBuiltIn && (
          <div className="mb-7 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
            This built-in agent is read-only. Its settings are shown here for
            reference.
          </div>
        )}

        <div className="space-y-7">
          <Section title="Identity">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_128px]">
              <div>
                <Label htmlFor="agent-name">Name</Label>
                <input
                  id="agent-name"
                  type="text"
                  value={name}
                  disabled={isBuiltIn}
                  onChange={(e) => setName(e.target.value)}
                  className={fieldLabel("")}
                  placeholder="e.g. Release Manager"
                />
                {nameErrors.length > 0 && (
                  <p className="mt-1 text-[13px] text-[var(--text-danger)]">
                    {nameErrors.join(", ")}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="agent-icon">Glyph</Label>
                <input
                  id="agent-icon"
                  type="text"
                  value={icon}
                  disabled={isBuiltIn}
                  onChange={(e) => setIcon(e.target.value)}
                  className={fieldLabel("text-center")}
                  maxLength={2}
                />
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  1–2 letters or numbers
                </p>
                {iconErrors.length > 0 && (
                  <p className="mt-1 text-[13px] text-[var(--text-danger)]">
                    {iconErrors.join(", ")}
                  </p>
                )}
                {glyphError && (
                  <p className="mt-1 text-[13px] text-[var(--text-danger)]">
                    {glyphError}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="agent-description">Description</Label>
              <textarea
                id="agent-description"
                value={description}
                disabled={isBuiltIn}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={fieldLabel("resize-none")}
                placeholder="What this agent is for"
              />
            </div>
            <div className="mt-3">
              <fieldset>
                <legend className="text-[13px] font-medium text-[var(--text-secondary)]">
                  Accent
                </legend>
                <div className="mt-1.5 flex items-center gap-1.5">
                  {AGENT_ACCENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={isBuiltIn}
                      onClick={() => setAccent(a)}
                      title={a}
                      aria-label={a}
                      aria-pressed={accent === a}
                      className={`h-5 w-5 rounded-[5px] ${getAgentAccentSwatchClass(a)} transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${accent === a ? "ring-2 ring-offset-2 ring-offset-[var(--bg-main)] ring-[var(--text-primary)]" : "hover:scale-110"}`}
                    />
                  ))}
                </div>
                {accentErrors.length > 0 && (
                  <p className="mt-1 text-[13px] text-[var(--text-danger)]">
                    {accentErrors.join(", ")}
                  </p>
                )}
              </fieldset>
            </div>
          </Section>

          <Section title="Runtime">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="agent-provider">Provider</Label>
                <select
                  id="agent-provider"
                  value={provider}
                  disabled={isBuiltIn}
                  onChange={(e) => {
                    setProvider(e.target.value as ProviderType | "");
                    setMode("");
                  }}
                  className={fieldLabel("")}
                >
                  <option value="">Use thread default</option>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="agent-model">Model</Label>
                <select
                  id="agent-model"
                  value={model}
                  disabled={isBuiltIn}
                  onChange={(e) => setModel(e.target.value)}
                  className={fieldLabel("")}
                >
                  <option value="">
                    {provider ? "Use provider default" : "Use thread default"}
                  </option>
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="agent-permissions">Permissions</Label>
                <select
                  id="agent-permissions"
                  value={mode}
                  disabled={isBuiltIn}
                  onChange={(e) => setMode(e.target.value as AgentMode | "")}
                  className={fieldLabel("")}
                >
                  <option value="">
                    {provider ? "Use provider default" : "Use thread default"}
                  </option>
                  {(provider ? getAgentModes(provider) : MODES).map((entry) => (
                    <option key={entry} value={entry}>
                      {getModeConfig(provider || "copilot", entry).label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="agent-cwd">Working directory</Label>
              <input
                id="agent-cwd"
                type="text"
                value={cwd}
                disabled={isBuiltIn}
                onChange={(e) => setCwd(e.target.value)}
                className={fieldLabel("font-mono text-[13px]")}
                placeholder="Leave blank to reuse this agent's last folder"
              />
            </div>
          </Section>

          <Section title="Behaviour">
            <div className="flex items-center justify-between gap-3">
              {promptMode === "inline" ? (
                <Label htmlFor="agent-instructions">Instructions</Label>
              ) : (
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                  Instructions
                </span>
              )}
              <div className="flex rounded-md border border-[var(--border)] p-0.5 text-[13px]">
                {(["inline", "files"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={isBuiltIn}
                    onClick={() => setPromptMode(choice)}
                    className={`rounded px-2 py-1 transition-colors ${promptMode === choice ? "bg-[var(--bg-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                  >
                    {choice === "inline" ? "Write here" : "File paths"}
                  </button>
                ))}
              </div>
            </div>
            {promptMode === "inline" ? (
              <textarea
                id="agent-instructions"
                value={promptText}
                disabled={isBuiltIn}
                onChange={(e) => setPromptText(e.target.value)}
                rows={6}
                className={fieldLabel("resize-y text-[13px] leading-5")}
                placeholder="Instructions for this agent..."
              />
            ) : (
              <div className="mt-2 space-y-2">
                {promptFiles.map((path, idx) => (
                  <div key={idx}>
                    <Label htmlFor={`agent-prompt-file-${idx}`}>
                      Instruction file {idx + 1}
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id={`agent-prompt-file-${idx}`}
                        type="text"
                        value={path}
                        disabled={isBuiltIn}
                        onChange={(e) => {
                          const next = [...promptFiles];
                          next[idx] = e.target.value;
                          setPromptFiles(next);
                        }}
                        className={fieldBase(
                          "min-w-0 flex-1 font-mono text-[13px]",
                        )}
                        placeholder="~/prompts/agent.md"
                      />
                      {!isBuiltIn && (
                        <button
                          type="button"
                          onClick={() =>
                            setPromptFiles(
                              promptFiles.filter((_, i) => i !== idx),
                            )
                          }
                          className="rounded px-2 py-1.5 text-[13px] text-[var(--text-danger)] hover:bg-[var(--bg-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-danger)]"
                          aria-label={`Remove instruction file ${idx + 1}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => setPromptFiles([...promptFiles, ""])}
                    className="rounded px-2 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    Add another path
                  </button>
                )}
              </div>
            )}
          </Section>

          <Section title="Tools">
            <div className="space-y-3">
              {mcpRows.map((row) => (
                <div
                  key={row.key}
                  className="border-b border-[var(--border)] pb-4 last:border-b-0"
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_104px_minmax(0,1.4fr)_auto] sm:items-end">
                    <div>
                      <Label htmlFor={`agent-mcp-${row.key}-name`}>
                        Server name
                      </Label>
                      <input
                        id={`agent-mcp-${row.key}-name`}
                        type="text"
                        value={row.name}
                        disabled={isBuiltIn}
                        onChange={(e) =>
                          updateMcpRow(row.key, { name: e.target.value })
                        }
                        className={fieldLabel("")}
                        placeholder="name"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`agent-mcp-${row.key}-type`}>Type</Label>
                      <select
                        id={`agent-mcp-${row.key}-type`}
                        value={row.type}
                        disabled={isBuiltIn}
                        onChange={(e) =>
                          updateMcpRow(row.key, {
                            type: e.target.value as McpServerRow["type"],
                          })
                        }
                        className={fieldLabel("")}
                      >
                        <option value="http">HTTP</option>
                        <option value="sse">SSE</option>
                        <option value="stdio">Stdio</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`agent-mcp-${row.key}-endpoint`}>
                        {row.type === "stdio" ? "Command" : "URL"}
                      </Label>
                      <input
                        id={`agent-mcp-${row.key}-endpoint`}
                        type="text"
                        value={row.type === "stdio" ? row.command : row.url}
                        disabled={isBuiltIn}
                        onChange={(e) =>
                          updateMcpRow(
                            row.key,
                            row.type === "stdio"
                              ? { command: e.target.value }
                              : { url: e.target.value },
                          )
                        }
                        className={fieldLabel("font-mono text-[13px]")}
                        placeholder={
                          row.type === "stdio"
                            ? "command"
                            : "https://example.com/mcp"
                        }
                      />
                    </div>
                    {!isBuiltIn && (
                      <button
                        type="button"
                        onClick={() =>
                          setMcpRows(mcpRows.filter((r) => r.key !== row.key))
                        }
                        className="rounded px-2 py-1.5 text-[13px] text-[var(--text-danger)] hover:bg-[var(--bg-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-danger)]"
                        aria-label={`Remove MCP server ${row.name || "row"}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      Command arguments and environment
                    </summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`agent-mcp-${row.key}-args`}>
                          Arguments, one per line
                        </Label>
                        <textarea
                          id={`agent-mcp-${row.key}-args`}
                          value={row.args}
                          disabled={isBuiltIn}
                          onChange={(e) =>
                            updateMcpRow(row.key, { args: e.target.value })
                          }
                          rows={3}
                          className={fieldLabel(
                            "resize-y font-mono text-[13px]",
                          )}
                          placeholder="--flag"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`agent-mcp-${row.key}-env`}>
                          Environment, KEY=value per line
                        </Label>
                        <textarea
                          id={`agent-mcp-${row.key}-env`}
                          value={row.env}
                          disabled={isBuiltIn}
                          onChange={(e) =>
                            updateMcpRow(row.key, { env: e.target.value })
                          }
                          rows={3}
                          className={fieldLabel(
                            "resize-y font-mono text-[13px]",
                          )}
                          placeholder="API_KEY=value"
                        />
                      </div>
                    </div>
                  </details>
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
                        args: "",
                        env: "",
                      },
                    ])
                  }
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                >
                  Add MCP server
                </button>
              )}
            </div>
            {mcpErrors.length > 0 && (
              <p className="mt-2 text-[13px] text-[var(--text-danger)]">
                {mcpErrors.join(", ")}
              </p>
            )}
            {mcpFormatErrors.length > 0 && (
              <p
                role="alert"
                className="mt-2 text-[13px] text-[var(--text-danger)]"
              >
                {mcpFormatErrors.join(" ")}
              </p>
            )}
          </Section>
        </div>
      </div>
      <footer className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-main)] py-3">
        <div className="mx-auto flex w-full items-center gap-2 max-w-[620px] px-6">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--text-control)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
          >
            Cancel
          </button>
          {!isBuiltIn && (
            <button
              type="button"
              disabled={!canSave}
              onClick={() => canSave && onSave(candidate)}
              className="rounded-lg bg-[var(--text-primary)] px-3 py-1.5 text-sm font-medium text-[var(--bg-root)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              Save
            </button>
          )}
          {!isBuiltIn && agent && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(agent.id)}
              className="ml-auto rounded-lg border border-[var(--border-danger)] bg-[var(--bg-danger)] px-3 py-1.5 text-sm font-medium text-[var(--text-danger)] hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-danger)]"
            >
              Delete agent
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/**
 * OpencodeProvider — integrates opencode (github.com/sst/opencode) as a
 * Stratos provider using its HTTP server mode with SSE streaming.
 *
 * Architecture:
 *   - One opencode server process per (cwd-derived) port, shared across all
 *     provider instances for the same worktree via a static registry.
 *   - Sessions are created per Stratos thread and resumed via session ID.
 *   - Streaming uses GET /event (SSE) + POST /session/{id}/message.
 *   - Per-token deltas arrive as "message.part.delta" events.
 *   - Stream completion is signalled by the "session.idle" event.
 */

import { spawn } from "child_process";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { deriveHash, derivePort } from "../utils/worktree";
import type {
  AgentProvider,
  AgentMessage,
  ProviderConfig,
  SendMessageParams,
  ModelInfo,
} from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Port range for opencode servers — distinct from CDP range (9200–9999). */
const PORT_RANGE_START = 8200;
const PORT_RANGE_END = 8999;

/** Timeout waiting for the opencode server to print its ready line. */
const SERVER_START_TIMEOUT_MS = 20_000;

/** Tools opencode exposes natively (shown in session_init). */
const OPENCODE_BUILTIN_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "multiedit",
  "glob",
  "grep",
  "ls",
  "webfetch",
  "websearch",
  "task",
  "lsp",
  "plan",
  "todo",
  "todowrite",
];

/**
 * Map opencode's lowercase tool names to the Title-Case names the Stratos UI
 * routes on (ToolCallCard / FileChangeViewer / MemoryOperationCard).
 *
 * Intentionally NOT mapped (pass through lowercase):
 *   - "todowrite" — would be filtered by INTERACTIVE_TOOLS in useChat.ts
 *   - "task"      — would trigger TaskInfo machinery that expects
 *                   parentToolUseId, which opencode doesn't emit
 *   - "multiedit" — input shape is `edits: [...]`, incompatible with
 *                   FileChangeViewer's flat old_string/new_string
 *   - "plan", "todo", "lsp" — no dedicated UI
 */
const OPENCODE_TOOL_NAME_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  ls: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
};

export function normalizeOpencodeToolName(tool: string): string {
  return OPENCODE_TOOL_NAME_MAP[tool] ?? tool;
}

/**
 * Normalize opencode's camelCase input keys to the snake_case keys
 * FileChangeViewer consumes. Non-destructive: preserves originals.
 */
export function normalizeFileToolInput(
  titleCaseName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!["Edit", "Write", "Read", "Delete"].includes(titleCaseName)) {
    return input;
  }

  const out: Record<string, unknown> = { ...input };

  if (out.file_path === undefined) {
    if (typeof out.filePath === "string") out.file_path = out.filePath;
    else if (typeof out.path === "string") out.file_path = out.path;
  }

  if (titleCaseName === "Edit") {
    if (out.old_string === undefined && typeof out.oldString === "string") {
      out.old_string = out.oldString;
    }
    if (out.new_string === undefined && typeof out.newString === "string") {
      out.new_string = out.newString;
    }
  }

  if (titleCaseName === "Write") {
    if (out.content === undefined && typeof out.text === "string") {
      out.content = out.text;
    }
  }

  return out;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ServerEntry {
  proc: ReturnType<typeof spawn>;
  baseUrl: string;
  refCount: number;
}

interface SseEvent {
  type: string;
  properties: Record<string, unknown>;
}

interface OpencodeProviderInfo {
  id: string;
  name: string;
  models?: Record<
    string,
    {
      name: string;
      capabilities?: { reasoning?: boolean; temperature?: boolean };
      cost?: { input?: number; output?: number };
      limit?: { context?: number; output?: number };
    }
  >;
}

interface OpencodePart {
  id: string;
  type: string;
  text?: string;
  sessionID?: string;
  messageID?: string;
  time?: { start?: number; end?: number };
}

export interface OpencodeToolState {
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  title?: string;
}

export interface OpencodeToolPart extends OpencodePart {
  type: "tool";
  callID: string;
  tool: string;
  state: OpencodeToolState;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveOpencodePort(cwd: string): number {
  const hash = deriveHash(cwd);
  return derivePort(hash, PORT_RANGE_START, PORT_RANGE_END);
}

function resolveOpencodeBinary(binaryPath?: string): string {
  if (binaryPath) return binaryPath;

  // Packaged Electron build: binary bundled alongside app resources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resourcesPath = (process as any).resourcesPath as string | undefined;
  if (resourcesPath) {
    const bundled = join(resourcesPath, "opencode");
    if (existsSync(bundled)) return bundled;
  }

  // Common install paths (Bun global, homebrew, npm global, OpenCode.app)
  const candidates = [
    join(homedir(), ".bun", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
    // macOS OpenCode.app bundle (Mac App Store / direct download). The
    // bundled binary is named `opencode-cli`, not `opencode`.
    "/Applications/OpenCode.app/Contents/MacOS/opencode-cli",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fall back to PATH resolution
  try {
    return execSync("which opencode", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "opencode";
  }
}

/**
 * Translate Stratos's `mcpServers` config into Opencode's `mcp` JSON config.
 * Only stdio-style entries (with `command`) are forwarded — SDK entries are
 * claude-code-only and are skipped.
 */
export function buildOpencodeMcpConfig(
  mcpServers: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [name, raw] of Object.entries(mcpServers)) {
    const srv = raw as {
      type?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
    if (srv.type === "sdk" || !srv.command) continue;
    out[name] = {
      type: "local",
      command: [srv.command, ...(srv.args ?? [])],
      enabled: true,
      ...(srv.env ? { environment: srv.env } : {}),
    };
  }
  return out;
}

function buildOpencodeEnv(config: ProviderConfig): NodeJS.ProcessEnv {
  const providers = config.opencodeConfig?.providers ?? {};
  const customProviders = config.opencodeConfig?.customProviders ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerConfig: Record<string, any> = {};

  // Standard providers: inject apiKey + optional baseURL
  for (const [id, { apiKey, baseURL }] of Object.entries(providers)) {
    if (!apiKey) continue;
    providerConfig[id] = {
      options: { apiKey, ...(baseURL ? { baseURL } : {}) },
    };
  }

  // Custom providers (e.g. Ollama): inject full definition with npm, api, models
  for (const [id, def] of Object.entries(customProviders)) {
    providerConfig[id] = {
      id: def.id,
      name: def.name,
      npm: def.npm,
      api: def.api,
      options: { apiKey: def.apiKey ?? "none" },
      models: def.models,
    };
  }

  // Stratos-provided MCP servers (stratos-scheduler / stratos-preview /
  // stratos-manager) forwarded to opencode's `mcp` config key. SDK-type
  // entries are claude-code-only; skipped here.
  const mcpConfig = buildOpencodeMcpConfig(config.mcpServers ?? {});

  const configObj: Record<string, unknown> = {};
  if (Object.keys(providerConfig).length > 0)
    configObj.provider = providerConfig;
  if (Object.keys(mcpConfig).length > 0) configObj.mcp = mcpConfig;

  const hasEntries = Object.keys(configObj).length > 0;
  return {
    ...process.env,
    ...(hasEntries
      ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(configObj) }
      : {}),
  };
}

async function waitForServerReady(
  proc: ReturnType<typeof spawn>,
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pollInterval !== null) clearInterval(pollInterval);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      done(
        new Error(
          `opencode server did not start on port ${port} within ${timeoutMs / 1000}s`,
        ),
      );
    }, timeoutMs);

    // Watch stdout for the server-ready line
    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line: string) => {
      if (line.includes("listening") && line.includes(String(port))) {
        rl.close();
        done();
      }
    });

    proc.on("error", (err: Error) => {
      rl.close();
      done(err);
    });

    proc.on("exit", (code: number | null) => {
      rl.close();
      done(new Error(`opencode process exited unexpectedly (code ${code})`));
    });

    // Also poll the HTTP endpoint — handles cases where the server was already
    // running or stdout buffering delays the ready line.
    pollInterval = setInterval(async () => {
      if (settled) {
        if (pollInterval !== null) clearInterval(pollInterval);
        return;
      }
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/provider`, {
          signal: AbortSignal.timeout(500),
        });
        if (resp.ok || resp.status === 404) {
          rl.close();
          done();
        }
      } catch {
        // Not ready yet
      }
    }, 500);
  });
}

/**
 * Parse a ReadableStream of SSE data into a stream of typed events.
 * opencode SSE format: `data: {"type":"...","properties":{...}}\n\n`
 */
async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by double newlines
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";

      for (const message of messages) {
        for (const line of message.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as SseEvent;
            if (event && typeof event.type === "string") {
              yield event;
            }
          } catch {
            // Skip malformed frames
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released
    }
  }
}

/**
 * Transform a tool part's current state into zero-or-more AgentMessage
 * events. Opencode emits `message.part.updated` multiple times per tool
 * call (pending → running → running → completed), so `emittedToolUses`
 * dedupes the `tool_use` emission across frames. `tool_result` fires
 * exactly once per call (on completed/error).
 */
export function* transformToolPart(
  part: OpencodeToolPart,
  emittedToolUses: Set<string>,
): Generator<AgentMessage> {
  const { callID, tool, state } = part;

  // Skip pending: input is empty, card would flash with "(no args)".
  if (state.status === "pending") return;

  const toolName = normalizeOpencodeToolName(tool);
  const input = normalizeFileToolInput(toolName, state.input ?? {});

  if (!emittedToolUses.has(callID)) {
    yield { type: "tool_use", toolName, toolCallId: callID, input };
    emittedToolUses.add(callID);
  }

  if (state.status === "completed") {
    yield {
      type: "tool_result",
      toolCallId: callID,
      output: state.output ?? "",
    };
  } else if (state.status === "error") {
    yield {
      type: "tool_result",
      toolCallId: callID,
      output: `Error: ${state.error ?? "Unknown error"}`,
    };
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "Unknown opencode error";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    return String(e.message ?? e.data ?? JSON.stringify(error));
  }
  return String(error);
}

function parseOpencodeModels(providers: OpencodeProviderInfo[]): ModelInfo[] {
  const models: ModelInfo[] = [];
  for (const provider of providers) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const contextWindow = model.limit?.context;
      const inputCost = model.cost?.input;
      const parts: string[] = [];
      if (contextWindow)
        parts.push(`${Math.round(contextWindow / 1000)}k context`);
      if (inputCost) parts.push(`$${(inputCost * 1_000_000).toFixed(2)}/M in`);

      models.push({
        value: `${provider.id}/${modelId}`,
        displayName: model.name,
        description: parts.join(" · ") || `${provider.name} model`,
        supportsEffort: model.capabilities?.reasoning ?? false,
        supportsReasoning: model.capabilities?.reasoning ?? false,
      });
    }
  }
  return models;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class OpencodeProvider implements AgentProvider {
  readonly name = "opencode";

  private config: ProviderConfig | null = null;
  private baseUrl: string | null = null;
  private port: number | null = null;
  private opencodeSessionId: string | null = null;
  private abortController: AbortController | null = null;

  /**
   * Static server registry: one opencode server process per port, shared
   * across all OpencodeProvider instances for the same worktree.
   */
  private static serverRegistry = new Map<number, ServerEntry>();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    const cwd = config.cwd ?? process.cwd();
    const port = config.opencodeConfig?.port ?? deriveOpencodePort(cwd);
    this.port = port;

    // Re-use existing server if already running for this port
    const existing = OpencodeProvider.serverRegistry.get(port);
    if (existing) {
      existing.refCount++;
      this.baseUrl = existing.baseUrl;
      return;
    }

    const binaryPath = resolveOpencodeBinary(config.opencodeConfig?.binaryPath);
    const env = buildOpencodeEnv(config);

    // If a stale opencode server from a prior run is holding our port, kill
    // it before spawning. Otherwise waitForServerReady will adopt the zombie
    // via HTTP probe and we'd be stuck with whatever env it was started with
    // (e.g. without the current Ollama config).
    try {
      const existingPids = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pid of existingPids) {
        try {
          process.kill(parseInt(pid, 10), "SIGTERM");
          console.log(
            `[opencode] killed stale listener on port ${port} (pid=${pid})`,
          );
        } catch {
          // pid may have exited between lsof and kill; ignore
        }
      }
      if (existingPids.length > 0) {
        // Give the OS a moment to release the port
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // lsof returned non-zero (no listener) — nothing to kill
    }

    console.log(
      `[opencode] starting server on port ${port} (binary: ${binaryPath})`,
    );

    const proc = spawn(
      binaryPath,
      ["serve", "--hostname=127.0.0.1", `--port=${port}`],
      {
        env,
        cwd,
        // stdout: pipe so we can detect the ready line
        // stderr: inherit so error logs appear in Electron console
        stdio: ["ignore", "pipe", "inherit"],
      },
    );

    await waitForServerReady(proc, port, SERVER_START_TIMEOUT_MS);

    console.log(`[opencode] server ready at http://127.0.0.1:${port}`);

    const baseUrl = `http://127.0.0.1:${port}`;
    OpencodeProvider.serverRegistry.set(port, { proc, baseUrl, refCount: 1 });
    this.baseUrl = baseUrl;
  }

  canResume(sessionId: string): boolean {
    return this.opencodeSessionId === sessionId;
  }

  async dispose(): Promise<void> {
    this.abortController?.abort();

    if (this.port !== null) {
      const entry = OpencodeProvider.serverRegistry.get(this.port);
      if (entry) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          console.log(
            `[opencode] stopping server on port ${this.port} (refCount=0)`,
          );
          entry.proc.kill("SIGTERM");
          OpencodeProvider.serverRegistry.delete(this.port);
        }
      }
    }

    this.baseUrl = null;
    this.config = null;
    this.opencodeSessionId = null;
    this.port = null;
    this.abortController = null;
  }

  /** Force-restart the server for a given port (e.g. after API key change). */
  static restartServer(port?: number): void {
    if (port !== undefined) {
      const entry = OpencodeProvider.serverRegistry.get(port);
      if (!entry) return;
      console.log(`[opencode] restarting server on port ${port}`);
      entry.proc.kill("SIGTERM");
      OpencodeProvider.serverRegistry.delete(port);
    } else {
      // Restart all running servers (e.g. after global API key change)
      for (const [p, entry] of OpencodeProvider.serverRegistry) {
        console.log(`[opencode] restarting server on port ${p}`);
        entry.proc.kill("SIGTERM");
        OpencodeProvider.serverRegistry.delete(p);
      }
    }
  }

  /** Cheap liveness probe. Returns true if the server responds to /provider. */
  async healthCheck(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/provider`, {
        signal: AbortSignal.timeout(2_000),
      });
      return resp.ok || resp.status === 404;
    } catch {
      return false;
    }
  }

  /**
   * Recover from a dead / wedged / stale-env server. Kills anything on the
   * port and re-runs initialize() with the provider's current config, which
   * spawns a fresh process with the up-to-date env (API keys, Ollama config).
   */
  async recoverServer(): Promise<void> {
    if (!this.config || this.port === null) return;
    console.warn(
      `[opencode] recovering server on port ${this.port} (restart + reinit)`,
    );
    OpencodeProvider.restartServer(this.port);
    this.baseUrl = null;
    const port = this.port;
    this.port = null;
    await this.initialize({
      ...this.config,
      opencodeConfig: { ...(this.config.opencodeConfig ?? {}), port },
    });
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    if (!this.baseUrl) throw new Error("OpencodeProvider not initialized");

    // Auto-recover from a dead server before we start streaming. If the
    // server is wedged or was killed externally, restart it once and retry.
    // After an event has been yielded we can't safely retry, so the check
    // only runs here at the start.
    if (!(await this.healthCheck())) {
      await this.recoverServer();
    }

    this.abortController = new AbortController();

    // ── Resolve session ────────────────────────────────────────────────────

    if (params.sessionId && !this.opencodeSessionId) {
      // Fresh provider instance resuming a thread that already has a session
      this.opencodeSessionId = params.sessionId;
    } else if (!this.opencodeSessionId) {
      // Create a new opencode session for this thread
      const resp = await fetch(`${this.baseUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        throw new Error(
          `opencode: failed to create session (${resp.status} ${resp.statusText})`,
        );
      }
      const session = (await resp.json()) as { id: string };
      this.opencodeSessionId = session.id;
    }

    const sessionId = this.opencodeSessionId!;

    // Emit session_init so agent-manager persists the opencode session ID on the thread
    yield {
      type: "session_init",
      sessionId,
      tools: OPENCODE_BUILTIN_TOOLS,
    };

    // ── Subscribe to SSE event stream ──────────────────────────────────────

    const sseResponse = await fetch(`${this.baseUrl}/event`, {
      signal: this.abortController.signal,
      headers: { Accept: "text/event-stream" },
    });

    if (!sseResponse.ok || !sseResponse.body) {
      throw new Error(
        `opencode: failed to subscribe to event stream (${sseResponse.status})`,
      );
    }

    // ── Fire prompt (fire-and-forget) ─────────────────────────────────────

    const messageParts: Array<Record<string, unknown>> = [
      { type: "text", text: params.prompt },
    ];
    for (const img of params.images ?? []) {
      messageParts.push({
        type: "image",
        url: img.dataUrl,
        mimeType: img.mimeType,
      });
    }

    // Fire the prompt WITHOUT awaiting it. opencode's /message POST blocks
    // for the full duration of inference (minutes for local LLMs like Ollama
    // gemma on first-load). Meanwhile, opencode emits `message.part.delta`,
    // `message.part.updated`, and `session.idle` events on the SSE channel
    // in real time. If we awaited the POST first, the SSE socket would back
    // up and we'd miss the streaming UX (and on some kernels lose events).
    //
    // The user interrupt path (`this.abortController`) cancels the POST and
    // the SSE consumption together.
    const promptPromise = fetch(
      `${this.baseUrl}/session/${sessionId}/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "user",
          parts: messageParts,
          ...(params.model ? { modelID: params.model } : {}),
        }),
        signal: this.abortController.signal,
      },
    ).then((resp) => {
      if (!resp.ok) {
        throw new Error(
          `opencode: failed to send prompt (${resp.status} ${resp.statusText})`,
        );
      }
      return resp;
    });

    // Surface POST-level errors (e.g. 4xx, network reset). We don't await
    // completion here — that happens via SSE's session.idle event — but we
    // do need to catch rejections so they reach the caller instead of
    // becoming an unhandled rejection in the background.
    promptPromise.catch((err) => {
      // Aborts are expected when the user interrupts; surface anything else.
      if (!this.abortController?.signal.aborted) {
        console.error("[opencode] prompt POST failed:", err);
      }
    });

    // ── Process SSE events ─────────────────────────────────────────────────

    // Tracks whether a partID maps to "text" or "reasoning".
    // Delta events don't carry part type — we learn the type when the part
    // completes via "message.part.updated". Deltas are optimistically yielded
    // as "text"; the settled "message.part.updated" event corrects the type.
    const partTypeMap = new Map<string, "text" | "reasoning">();

    // Dedups tool_use emissions across the multiple "message.part.updated"
    // frames opencode fires per tool call (pending → running → completed).
    const emittedToolUses = new Set<string>();

    for await (const event of parseSSE(sseResponse.body)) {
      if (this.abortController.signal.aborted) break;

      // Filter events to this session only
      const props = event.properties ?? {};
      const eventSessionId =
        (props.sessionID as string | undefined) ??
        ((props.info as Record<string, unknown> | undefined)?.id as
          | string
          | undefined);
      if (eventSessionId && eventSessionId !== sessionId) continue;

      switch (event.type) {
        case "message.part.delta": {
          const { partID, delta } = props as {
            partID: string;
            field: string;
            delta: string;
          };
          if (typeof delta !== "string" || !delta) break;

          const partType = partTypeMap.get(partID);
          yield {
            type: partType === "reasoning" ? "thinking" : "text",
            content: delta,
            isStreaming: true,
          };
          break;
        }

        case "message.part.updated": {
          const part = props.part as OpencodePart | undefined;
          if (!part) break;

          // Tool parts: lifecycle is tracked on part.state.status (not
          // part.time). Dispatch every frame; transformToolPart dedupes.
          if (part.type === "tool") {
            yield* transformToolPart(
              part as unknown as OpencodeToolPart,
              emittedToolUses,
            );
            break;
          }

          // Text/reasoning: record type on creation (no time.end) so later
          // deltas resolve to the right message type. Completion is a
          // no-op — content was already streamed via message.part.delta.
          if (!part.time?.end) {
            if (part.type === "text") partTypeMap.set(part.id, "text");
            else if (part.type === "reasoning")
              partTypeMap.set(part.id, "reasoning");
          }
          break;
        }

        case "session.status": {
          const status = props.status as { type?: string } | undefined;
          if (status?.type === "idle") {
            yield { type: "result", content: "" };
            return;
          }
          break;
        }

        case "session.error": {
          yield {
            type: "error",
            message: extractErrorMessage(props.error),
          };
          return;
        }
      }
    }

    // Stream ended without an explicit idle event
    yield { type: "result", content: "" };
  }

  // ── Control ────────────────────────────────────────────────────────────────

  async interrupt(): Promise<void> {
    this.abortController?.abort();

    if (this.opencodeSessionId && this.baseUrl) {
      try {
        await fetch(`${this.baseUrl}/session/${this.opencodeSessionId}/abort`, {
          method: "POST",
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Best-effort; the local SSE abort is sufficient for the UI
      }
    }
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (!this.baseUrl) throw new Error("OpencodeProvider not initialized");

    const resp = await fetch(`${this.baseUrl}/provider`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      console.warn(
        `[opencode] GET /provider returned ${resp.status}; returning empty model list`,
      );
      return [];
    }

    const response = (await resp.json()) as
      | { all?: OpencodeProviderInfo[] }
      | OpencodeProviderInfo[];
    const providers = Array.isArray(response) ? response : (response.all ?? []);
    return parseOpencodeModels(providers);
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    // opencode agents/skills not yet surfaced as slash commands
    return [];
  }
}

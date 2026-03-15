import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo,
  McpServerInfo,
  TodoItem,
} from "./types";

import { spawn, execSync, type ChildProcess } from "child_process";

/**
 * Default port for auto-spawned OpenCode server.
 * Matches the SDK default from `createOpencodeServer()`.
 */
const DEFAULT_PORT = 4096;

/** Timeout (ms) waiting for the server process to print its URL */
const SERVER_START_TIMEOUT = 15_000;

/** SSE event types emitted by the OpenCode server */
interface OpenCodeSSEEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
}

/**
 * OpenCode provider implementation.
 *
 * Communicates with a running OpenCode server via REST API + SSE.
 * Follows the same pattern as the official `@opencode-ai/sdk`:
 *
 * 1. `initialize()` spawns `opencode serve` as a managed child process
 * 2. `sendMessage()` uses `promptAsync` (fire-and-forget) + SSE event stream
 * 3. `dispose()` kills the managed server process
 *
 * Architecture:
 * - Sessions map 1:1 to Stratos threads
 * - Messages sent via POST /session/{id}/prompt_async (non-blocking)
 * - Real-time events received via GET /event (SSE)
 * - Tool calls and permissions are handled by OpenCode's built-in agents
 */
export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode";
  private config: ProviderConfig = {};
  private baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  private sessionId?: string;
  private abortController?: AbortController;
  private serverProcess?: ChildProcess;
  private disposed = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Try to connect to an existing server first (user may have one running)
    const existingUrl = await this.findRunningServer();
    if (existingUrl) {
      this.baseUrl = existingUrl;
      return;
    }

    // No server running — spawn one (same pattern as SDK's createOpencodeServer)
    await this.spawnServer();
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // Create or reuse session
      if (!this.sessionId || !params.sessionId) {
        const session = await this.createSession(params);
        this.sessionId = session.id;
      } else {
        this.sessionId = params.sessionId;
      }

      // Emit session_init
      yield {
        type: "session_init",
        sessionId: this.sessionId,
        tools: [],
        slashCommands: [],
      };

      // Start the SSE connection eagerly BEFORE sending the message.
      // We use a message queue so events arriving while we await the POST
      // are buffered and not lost.
      const queue: AgentMessage[] = [];
      let resolveWait: (() => void) | null = null;
      let sseComplete = false;
      let sseError: Error | null = null;

      // Start SSE reader in background
      this.readEventStream(this.sessionId, signal, {
        onMessage: (msg: AgentMessage) => {
          queue.push(msg);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
        onDone: () => {
          sseComplete = true;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
        onError: (err: Error) => {
          sseError = err;
          sseComplete = true;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        },
      });

      // Build the prompt request body
      const parts: { type: string; text?: string }[] = [];
      parts.push({ type: "text", text: params.prompt });

      // Add images as file parts (data URL format)
      if (params.images?.length) {
        for (const img of params.images) {
          parts.push({
            type: "text",
            text: `[Image: ${img.mimeType}]\n${img.dataUrl}`,
          });
        }
      }

      // Build model field in OpenCode format: { providerID, modelID }
      const model = params.model ?? this.config.model;
      const chatBody: Record<string, unknown> = {
        parts,
        ...(model ? { model: this.parseModelSpec(model) } : {}),
      };

      // Use promptAsync (POST /session/{id}/prompt_async) for non-blocking send.
      // This returns 204 immediately; actual responses arrive via SSE events.
      const chatRes = await fetch(
        `${this.baseUrl}/session/${this.sessionId}/prompt_async`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody),
          signal,
        },
      );

      if (!chatRes.ok) {
        const errText = await chatRes.text().catch(() => "Unknown error");
        yield { type: "error", message: `OpenCode prompt failed: ${errText}` };
        return;
      }

      // Drain the event queue until session is idle
      while (!signal.aborted) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        if (sseComplete) break;

        // Wait for more events
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }

      if (sseError !== null && !signal.aborted) {
        yield {
          type: "error",
          message: (sseError as Error).message,
        };
      }
    } catch (err) {
      if (signal.aborted) return;
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async interrupt(): Promise<void> {
    if (this.sessionId) {
      // Tell the server to abort the session
      try {
        await fetch(`${this.baseUrl}/session/${this.sessionId}/abort`, {
          method: "POST",
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Best-effort
      }
    }
    this.abortController?.abort();
  }

  canResume(sessionId: string): boolean {
    return this.sessionId === sessionId;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    // Try to query the server for configured providers/models
    try {
      const res = await fetch(`${this.baseUrl}/config/providers`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const providers = await res.json();
        return this.parseProviderModels(providers);
      }
    } catch {
      // Fall back to static list
    }

    // Fallback: common models that OpenCode supports
    return [
      {
        value: "claude-sonnet-4-20250514",
        displayName: "Claude Sonnet 4",
        description: "Fast, capable model for everyday coding tasks",
      },
      {
        value: "claude-opus-4-20250514",
        displayName: "Claude Opus 4",
        description: "Most capable model for complex reasoning",
        supportsReasoning: true,
      },
      {
        value: "gpt-4.1",
        displayName: "GPT-4.1",
        description: "OpenAI's flagship coding model",
      },
      {
        value: "o3",
        displayName: "o3",
        description: "OpenAI reasoning model",
        supportsReasoning: true,
      },
      {
        value: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: "Google's advanced reasoning model",
        supportsReasoning: true,
      },
    ];
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    try {
      const res = await fetch(`${this.baseUrl}/command`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const commands = (await res.json()) as {
          name: string;
          description?: string;
        }[];
        return commands;
      }
    } catch {
      // Ignore
    }
    return [];
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/mcp`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const servers = (await res.json()) as {
          name: string;
          status: string;
        }[];
        return servers.map((s) => ({
          name: s.name,
          status:
            s.status === "connected"
              ? ("connected" as const)
              : ("failed" as const),
          tools: [],
        }));
      }
    } catch {
      // Ignore
    }
    return [];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.abortController?.abort();
    this.sessionId = undefined;

    // Kill the managed server process
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }

  // ── Server lifecycle ────────────────────────────────────────────────────

  /**
   * Try to find a running OpenCode server by probing common ports.
   * Returns the server URL if found, null otherwise.
   */
  private async findRunningServer(): Promise<string | null> {
    const ports = [DEFAULT_PORT, 13749, 3000];
    for (const port of ports) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/session`, {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return `http://127.0.0.1:${port}`;
      } catch {
        // Try next port
      }
    }
    return null;
  }

  /**
   * Spawn `opencode serve` as a child process.
   * Same pattern as the SDK's `createOpencodeServer()`:
   * - Parse stdout for "opencode server listening on http://..."
   * - Extract the URL for API calls
   */
  private async spawnServer(): Promise<void> {
    const port = DEFAULT_PORT;
    const args = ["serve", `--hostname=127.0.0.1`, `--port=${port}`];

    const proc = spawn("opencode", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({}),
      },
    });

    this.serverProcess = proc;

    // Wait for the server to print its listening URL
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `OpenCode server did not start within ${SERVER_START_TIMEOUT}ms`,
          ),
        );
      }, SERVER_START_TIMEOUT);

      let output = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const lines = output.split("\n");
        for (const line of lines) {
          if (line.startsWith("opencode server listening")) {
            const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(match[1]!);
              return;
            }
          }
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      proc.on("exit", (code) => {
        clearTimeout(timeout);
        let msg = `OpenCode server exited with code ${code}`;
        if (output.trim()) msg += `\nOutput: ${output}`;
        reject(new Error(msg));
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.baseUrl = url;
  }

  // ── Session management ──────────────────────────────────────────────────

  private async createSession(
    params: SendMessageParams,
  ): Promise<{ id: string }> {
    const cwd = params.cwd ?? this.config.cwd ?? process.env.HOME;

    // OpenCode uses `directory` as a query parameter, not body field
    const url = new URL(`${this.baseUrl}/session`);
    if (cwd) url.searchParams.set("directory", cwd);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Failed to create OpenCode session: ${res.status} ${errText}`,
      );
    }

    return (await res.json()) as { id: string };
  }

  // ── Model parsing ──────────────────────────────────────────────────────

  /**
   * Parse a model string into OpenCode's { providerID, modelID } format.
   * Handles formats like "claude-sonnet-4-20250514" or "opencode/big-pickle".
   */
  private parseModelSpec(model: string): {
    providerID: string;
    modelID: string;
  } {
    // If it contains a slash, treat as "provider/model"
    if (model.includes("/")) {
      const [providerID, modelID] = model.split("/", 2);
      return { providerID: providerID!, modelID: modelID! };
    }

    // Infer provider from model name
    if (model.startsWith("claude-")) {
      return { providerID: "anthropic", modelID: model };
    }
    if (
      model.startsWith("gpt-") ||
      model.startsWith("o1") ||
      model.startsWith("o3") ||
      model.startsWith("o4")
    ) {
      return { providerID: "openai", modelID: model };
    }
    if (model.startsWith("gemini-")) {
      return { providerID: "google", modelID: model };
    }

    // Default: let OpenCode figure it out
    return { providerID: "opencode", modelID: model };
  }

  /**
   * Parse the /config/providers response into ModelInfo[].
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseProviderModels(providers: any): ModelInfo[] {
    const models: ModelInfo[] = [];
    if (!providers || typeof providers !== "object") return models;

    // The response may be an object keyed by provider ID
    for (const [providerID, providerData] of Object.entries(providers)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = providerData as any;
      if (data?.models && typeof data.models === "object") {
        for (const [modelID, modelData] of Object.entries(data.models)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const md = modelData as any;
          models.push({
            value: `${providerID}/${modelID}`,
            displayName: md.name ?? md.displayName ?? modelID,
            description: md.description ?? `${providerID} model`,
            supportsReasoning: md.reasoning === true,
          });
        }
      }
    }

    return models;
  }

  // ── SSE event stream ──────────────────────────────────────────────────

  /**
   * Start reading the SSE event stream eagerly, pushing messages via callbacks.
   * This avoids the lazy-evaluation problem of async generators.
   */
  private readEventStream(
    sessionId: string,
    signal: AbortSignal,
    callbacks: {
      onMessage: (msg: AgentMessage) => void;
      onDone: () => void;
      onError: (err: Error) => void;
    },
  ): void {
    const url = `${this.baseUrl}/event`;

    fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          callbacks.onMessage({
            type: "error",
            message: `Failed to connect to OpenCode event stream: ${res.status}`,
          });
          callbacks.onDone();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentContent = "";

        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (signal.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = this.parseSSEBuffer(buffer);
            buffer = events.remaining;

            for (const event of events.parsed) {
              // Filter to events for our session
              const eventSessionId =
                event.properties.sessionID ??
                event.properties.info?.sessionID ??
                event.properties.part?.sessionID;
              if (eventSessionId && eventSessionId !== sessionId) continue;

              const messages = this.mapEventToAgentMessages(
                event,
                currentContent,
              );

              for (const msg of messages) {
                if (msg.type === "text") {
                  currentContent = msg.content;
                }
                callbacks.onMessage(msg);
              }

              // Session idle = turn complete
              if (
                event.type === "session.idle" &&
                event.properties.sessionID === sessionId
              ) {
                reader.releaseLock();
                callbacks.onDone();
                return;
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        callbacks.onDone();
      })
      .catch((err) => {
        if (signal.aborted) {
          callbacks.onDone();
        } else {
          callbacks.onError(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      });
  }

  /**
   * Parse SSE text into discrete events.
   *
   * OpenCode SSE format: `data: {"type":"...","properties":{...}}`
   * separated by double newlines. The event type is inside the JSON payload.
   */
  private parseSSEBuffer(buffer: string): {
    parsed: OpenCodeSSEEvent[];
    remaining: string;
  } {
    const parsed: OpenCodeSSEEvent[] = [];
    const parts = buffer.split("\n\n");
    const remaining = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      let data = "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          data += line.slice(6);
        } else if (line.startsWith("data:")) {
          data += line.slice(5);
        }
      }

      if (data) {
        try {
          const payload = JSON.parse(data);
          parsed.push({
            type: payload.type || "unknown",
            properties: payload.properties ?? payload,
          });
        } catch {
          // Skip malformed events
        }
      }
    }

    return { parsed, remaining };
  }

  /**
   * Map an OpenCode SSE event to Stratos AgentMessage types.
   *
   * Event types from the OpenCode SDK (types.gen.ts):
   * - message.part.updated  — part content (text, reasoning, tool, step, etc.) + optional delta
   * - message.updated       — message metadata (errors, tokens, completion)
   * - session.idle          — turn complete
   * - session.error         — error from LLM or tool
   * - permission.updated    — tool permission request
   * - todo.updated          — task list changes
   *
   * Ignored: server.connected, session.updated, session.status,
   *          session.diff, file.edited, file.watcher.updated, etc.
   */
  private mapEventToAgentMessages(
    event: OpenCodeSSEEvent,
    currentContent: string,
  ): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const props = event.properties;

    switch (event.type) {
      // ── Content parts ──────────────────────────────────────────────
      case "message.part.updated": {
        const part = props.part;
        const delta = props.delta;
        if (!part) break;

        switch (part.type) {
          case "text":
            if (delta !== undefined) {
              // Incremental streaming delta — append to current content
              messages.push({
                type: "text",
                content: part.text ?? "",
                isStreaming: true,
              });
            } else if (part.text) {
              messages.push({
                type: "text",
                content: part.text,
                isStreaming: !part.time?.end,
              });
            }
            break;

          case "reasoning":
            if (part.text) {
              messages.push({
                type: "thinking",
                content: part.text,
                isStreaming: !part.time?.end,
              });
            }
            break;

          case "tool": {
            // ToolPart: { callID, tool, state: ToolState }
            const toolName = part.tool ?? "unknown";
            const toolCallId = part.callID ?? part.id ?? "";
            const state = part.state;

            if (!state) break;

            if (state.status === "pending" || state.status === "running") {
              messages.push({
                type: "tool_use",
                toolName,
                input: state.input ?? {},
                toolCallId,
              });
            }
            if (state.status === "completed") {
              // Emit tool_use first if we haven't, then the result
              messages.push({
                type: "tool_use",
                toolName,
                input: state.input ?? {},
                toolCallId,
              });
              messages.push({
                type: "tool_result",
                toolCallId,
                output: state.output ?? "",
              });
            }
            if (state.status === "error") {
              messages.push({
                type: "tool_use",
                toolName,
                input: state.input ?? {},
                toolCallId,
              });
              messages.push({
                type: "tool_result",
                toolCallId,
                output: `Error: ${state.error ?? "unknown error"}`,
              });
            }
            break;
          }

          // step-start/step-finish: agent step boundaries — ignore for now
          default:
            break;
        }
        break;
      }

      // ── Message metadata ───────────────────────────────────────────
      case "message.updated": {
        const info = props.info;
        if (!info) break;

        // Only process assistant messages
        if (info.role !== "assistant") break;

        // If the message has an error, emit it
        if (info.error) {
          const errData = info.error.data ?? info.error;
          messages.push({
            type: "error",
            message:
              errData.message ?? info.error.name ?? "Unknown OpenCode error",
          });
        }

        // If message is completed with token usage, emit result
        if (info.tokens && info.time?.completed) {
          const tokens = info.tokens;
          messages.push({
            type: "result",
            content: currentContent,
            cost: info.cost ?? undefined,
            usage: {
              inputTokens: tokens.input ?? 0,
              outputTokens: tokens.output ?? 0,
            },
            stop_reason: "end_turn",
          });
        }
        break;
      }

      // ── Permission requests ────────────────────────────────────────
      case "permission.updated": {
        // OpenCode asks for permission before executing certain tools
        const title = props.title ?? "Permission required";
        messages.push({
          type: "permission_request",
          toolName: title,
          input: props.metadata ?? {},
          requestId: props.id ?? "",
        });
        break;
      }

      // ── Todo updates ───────────────────────────────────────────────
      case "todo.updated": {
        const todos: TodoItem[] = (props.todos ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) => ({
            content: t.content ?? "",
            status:
              t.status === "in_progress"
                ? "in_progress"
                : t.status === "completed"
                  ? "completed"
                  : "pending",
            activeForm: t.content ?? "",
          }),
        );
        if (todos.length > 0) {
          messages.push({ type: "todo_update", todos });
        }
        break;
      }

      // ── Session idle = turn complete ───────────────────────────────
      case "session.idle": {
        messages.push({
          type: "result",
          content: currentContent,
          stop_reason: "end_turn",
        });
        break;
      }

      // ── Session error ──────────────────────────────────────────────
      case "session.error": {
        const errData = props.error?.data ?? props.error ?? props;
        messages.push({
          type: "error",
          message:
            errData.message ?? props.error?.name ?? "Unknown OpenCode error",
        });
        break;
      }

      // Ignore all other events
      default:
        break;
    }

    return messages;
  }
}

/**
 * Check if the OpenCode CLI is installed and available in PATH.
 */
export function isOpenCodeInstalled(): boolean {
  try {
    execSync("opencode --version", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get version of the installed OpenCode CLI.
 */
export function getOpenCodeVersion(): string | null {
  try {
    return execSync("opencode --version", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

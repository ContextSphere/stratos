import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo,
  McpServerInfo,
} from "./types";

import { execSync } from "child_process";

/**
 * Default port for the OpenCode server.
 * Users start it via `opencode serve` (defaults to auto-assigned port).
 * We try to read the port from the OpenCode config or fall back to 13749.
 */
const DEFAULT_PORT = 13749;

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
 * The user must start the server with `opencode serve` before using this provider.
 *
 * Architecture:
 * - Sessions map 1:1 to Stratos threads
 * - Messages sent via POST /session/{id}/chat
 * - Real-time events received via GET /event (SSE)
 * - Tool calls and permissions are handled by OpenCode's built-in agents
 */
export class OpenCodeProvider implements AgentProvider {
  readonly name = "opencode";
  private config: ProviderConfig = {};
  private baseUrl = `http://localhost:${DEFAULT_PORT}`;
  private sessionId?: string;
  private abortController?: AbortController;
  private disposed = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Try to detect the running OpenCode server port
    const port = await this.detectServerPort();
    if (port) {
      this.baseUrl = `http://localhost:${port}`;
    }

    // Verify the server is reachable
    try {
      const res = await fetch(`${this.baseUrl}/session`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        throw new Error(`OpenCode server returned ${res.status}`);
      }
    } catch (err) {
      throw new Error(
        `Cannot connect to OpenCode server at ${this.baseUrl}. ` +
          `Start it with: opencode serve\n` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

      // Send the chat message
      const model = params.model ?? this.config.model;
      const parts: { type: string; text?: string }[] = [];

      // Add text content
      parts.push({ type: "text", text: params.prompt });

      // Add images if provided
      if (params.images?.length) {
        for (const img of params.images) {
          parts.push({
            type: "text",
            text: `[Image: ${img.mimeType}]\n${img.dataUrl}`,
          });
        }
      }

      const chatBody: Record<string, unknown> = {
        parts,
        ...(model ? { modelID: model } : {}),
      };

      const chatRes = await fetch(
        `${this.baseUrl}/session/${this.sessionId}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody),
          signal,
        },
      );

      if (!chatRes.ok) {
        const errText = await chatRes.text().catch(() => "Unknown error");
        yield { type: "error", message: `OpenCode chat failed: ${errText}` };
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
    this.abortController?.abort();
  }

  canResume(sessionId: string): boolean {
    return this.sessionId === sessionId;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    // OpenCode supports many providers/models through its config.
    // Return a curated list of commonly available models.
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
    return [];
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return [];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.abortController?.abort();
    this.sessionId = undefined;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async detectServerPort(): Promise<number | null> {
    // Try to read the OpenCode server port from its state file.
    // OpenCode stores runtime info in ~/.config/opencode/ or similar.
    try {
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");

      // Check common OpenCode state file locations
      const candidates = [
        path.join(os.homedir(), ".config", "opencode", "server.json"),
        path.join(os.homedir(), ".opencode", "server.json"),
      ];

      for (const candidate of candidates) {
        try {
          const content = fs.readFileSync(candidate, "utf-8");
          const state = JSON.parse(content);
          if (state.port && typeof state.port === "number") {
            return state.port;
          }
        } catch {
          // Try next candidate
        }
      }
    } catch {
      // Ignore
    }

    return null;
  }

  private async createSession(
    params: SendMessageParams,
  ): Promise<{ id: string }> {
    const cwd = params.cwd ?? this.config.cwd ?? process.env.HOME;

    const body: Record<string, unknown> = {
      path: cwd,
    };

    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Failed to create OpenCode session: ${res.status} ${errText}`,
      );
    }

    return (await res.json()) as { id: string };
  }

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
                event.properties.sessionID ?? event.properties.info?.sessionID;
              if (eventSessionId && eventSessionId !== sessionId) continue;

              const messages = this.mapEventToAgentMessages(
                event,
                sessionId,
                currentContent,
              );

              for (const msg of messages) {
                if (msg.type === "text") {
                  currentContent = msg.content;
                }
                callbacks.onMessage(msg);
              }

              // Session idle = turn complete
              if (event.type === "session.idle") {
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
   * OpenCode SSE format: each event is a single line `data: {"type":"...","properties":{...}}`
   * separated by double newlines. The event type is inside the JSON payload, not in
   * a separate `event:` field.
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
        // Ignore event: lines — OpenCode embeds the type in the JSON payload
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
   * Actual OpenCode event types observed:
   * - server.connected          — initial connection ack
   * - message.updated           — message metadata (user or assistant)
   * - message.part.updated      — content part (text, thinking, tool_use, tool_result)
   * - session.updated           — session metadata changes
   * - session.status            — busy/idle status
   * - session.error             — error from LLM or tool
   * - session.idle              — turn complete
   * - session.diff              — file diffs
   */
  private mapEventToAgentMessages(
    event: OpenCodeSSEEvent,
    _sessionId: string,
    currentContent: string,
  ): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const props = event.properties;

    switch (event.type) {
      // Content part updates (text, thinking, tool calls, tool results)
      case "message.part.updated": {
        const part = props.part;
        if (!part) break;

        switch (part.type) {
          case "text":
            if (part.text) {
              messages.push({
                type: "text",
                content: part.text,
                isStreaming: true,
              });
            }
            break;

          case "thinking":
            if (part.text || part.thinking) {
              messages.push({
                type: "thinking",
                content: part.text ?? part.thinking ?? "",
                isStreaming: true,
              });
            }
            break;

          case "tool-invocation":
          case "tool_use": {
            const toolName =
              part.toolInvocation?.toolName ??
              part.name ??
              part.tool ??
              "unknown";
            const toolCallId =
              part.toolInvocation?.toolCallId ??
              part.id ??
              `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const state = part.toolInvocation?.state;

            if (state === "call" || state === "partial-call" || !state) {
              messages.push({
                type: "tool_use",
                toolName,
                input: part.toolInvocation?.args ?? part.input ?? {},
                toolCallId,
              });
            }
            if (state === "result") {
              messages.push({
                type: "tool_result",
                toolCallId,
                output:
                  typeof part.toolInvocation?.result === "string"
                    ? part.toolInvocation.result
                    : JSON.stringify(
                        part.toolInvocation?.result ?? part.output ?? "",
                      ),
              });
            }
            break;
          }

          default:
            break;
        }
        break;
      }

      // Message metadata updates (assistant messages may contain error info)
      case "message.updated": {
        const info = props.info;
        if (!info) break;

        // If the message has an error, emit it
        if (info.error) {
          const errData = info.error.data ?? info.error;
          messages.push({
            type: "error",
            message:
              errData.message ?? info.error.name ?? "Unknown OpenCode error",
          });
        }

        // If message has usage info (on completion), capture it
        if (info.tokens && info.time?.completed) {
          const tokens = info.tokens;
          messages.push({
            type: "result",
            content: currentContent,
            usage: {
              inputTokens: tokens.input ?? 0,
              outputTokens: tokens.output ?? 0,
            },
            stop_reason: "end_turn",
          });
        }
        break;
      }

      // Session idle = turn complete
      case "session.idle": {
        messages.push({
          type: "result",
          content: currentContent,
          stop_reason: "end_turn",
        });
        break;
      }

      // Session error
      case "session.error": {
        const errData = props.error?.data ?? props.error ?? props;
        messages.push({
          type: "error",
          message:
            errData.message ?? props.error?.name ?? "Unknown OpenCode error",
        });
        break;
      }

      // Ignore: server.connected, session.updated, session.status, session.diff
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

import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo,
  McpServerInfo,
  TodoItem,
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

      // Start listening for events BEFORE sending the chat message
      // so we don't miss any events
      const eventPromise = this.subscribeToEvents(this.sessionId, signal);

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
        `${this.baseUrl}/session/${this.sessionId}/chat`,
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

      // Process SSE events
      yield* eventPromise;
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
   * Subscribe to OpenCode SSE events for a given session.
   * Yields AgentMessage types as events arrive.
   */
  private async *subscribeToEvents(
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentMessage> {
    const url = `${this.baseUrl}/event`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
    });

    if (!res.ok || !res.body) {
      yield {
        type: "error",
        message: `Failed to connect to OpenCode event stream: ${res.status}`,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentContent = "";
    let sessionIdle = false;

    try {
      while (!signal.aborted && !sessionIdle) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const events = this.parseSSEBuffer(buffer);
        buffer = events.remaining;

        for (const event of events.parsed) {
          const messages = this.mapEventToAgentMessages(
            event,
            sessionId,
            currentContent,
          );

          for (const msg of messages) {
            if (msg.type === "text") {
              currentContent = msg.content;
            }
            yield msg;

            // Check if session is idle (turn completed)
            if (
              event.type === "session.idle" ||
              event.type === "session.complete"
            ) {
              sessionIdle = true;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit final result
    yield {
      type: "result",
      content: currentContent,
    };
  }

  /**
   * Parse SSE text into discrete events.
   * SSE format: lines prefixed with "data: " separated by double newlines.
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
      let eventType = "";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          data += line.slice(6);
        } else if (line.startsWith("data:")) {
          data += line.slice(5);
        }
      }

      if (data) {
        try {
          const properties = JSON.parse(data);
          parsed.push({
            type: eventType || properties.type || "unknown",
            properties,
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
   */
  private mapEventToAgentMessages(
    event: OpenCodeSSEEvent,
    sessionId: string,
    currentContent: string,
  ): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const props = event.properties;

    switch (event.type) {
      // Text content from the assistant
      case "message.part.text":
      case "part.text":
        if (props.content || props.text) {
          messages.push({
            type: "text",
            content: props.content ?? props.text ?? "",
            isStreaming: true,
          });
        }
        break;

      // Thinking/reasoning content
      case "message.part.thinking":
      case "part.thinking":
        if (props.content || props.thinking) {
          messages.push({
            type: "thinking",
            content: props.content ?? props.thinking ?? "",
            isStreaming: true,
          });
        }
        break;

      // Tool invocations
      case "message.part.tool":
      case "tool.start":
      case "part.tool_use": {
        const toolName =
          props.name ?? props.toolName ?? props.tool ?? "unknown";
        const toolCallId =
          props.id ??
          props.toolCallId ??
          `oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        messages.push({
          type: "tool_use",
          toolName,
          input: props.input ?? props.args ?? {},
          toolCallId,
        });
        break;
      }

      // Tool results
      case "tool.result":
      case "tool.complete":
      case "part.tool_result": {
        const resultId =
          props.id ?? props.toolCallId ?? props.tool_use_id ?? "";
        messages.push({
          type: "tool_result",
          toolCallId: resultId,
          output:
            typeof props.output === "string"
              ? props.output
              : JSON.stringify(props.output ?? props.result ?? ""),
        });
        break;
      }

      // Todo/task updates
      case "message.part.todo":
      case "todo.update": {
        const todos: TodoItem[] = (props.todos ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t: any) => ({
            content: t.content ?? t.text ?? "",
            status: t.status ?? "pending",
            activeForm: t.activeForm ?? t.content ?? "",
          }),
        );
        if (todos.length > 0) {
          messages.push({ type: "todo_update", todos });
        }
        break;
      }

      // Session idle = turn complete
      case "session.idle":
      case "session.complete": {
        const usage = props.usage;
        messages.push({
          type: "result",
          content: currentContent,
          ...(usage
            ? {
                usage: {
                  inputTokens: usage.inputTokens ?? usage.input_tokens ?? 0,
                  outputTokens: usage.outputTokens ?? usage.output_tokens ?? 0,
                },
              }
            : {}),
          stop_reason: "end_turn",
        });
        break;
      }

      // Error events
      case "session.error":
      case "error":
        messages.push({
          type: "error",
          message: props.message ?? props.error ?? "Unknown OpenCode error",
        });
        break;

      // Message complete (non-streaming text finalization)
      case "message.complete":
      case "message.updated": {
        // Extract the final text content from the message parts
        if (props.parts) {
          for (const part of props.parts) {
            if (part.type === "text" && part.text) {
              messages.push({
                type: "text",
                content: part.text,
                isStreaming: false,
              });
            }
          }
        }
        break;
      }

      // Ignore other event types (connection, ping, etc.)
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

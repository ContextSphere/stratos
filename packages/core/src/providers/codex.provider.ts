import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo,
} from "./types";

import { execSync, spawn, type ChildProcess } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";

/**
 * Find the Codex CLI binary shipped with @openai/codex via @openai/codex-sdk.
 * This mirrors the findCodexPath() logic in the SDK itself.
 */
function findCodexBinary(): string {
  const { platform, arch } = process;
  let targetTriple: string | null = null;
  switch (platform) {
    case "linux":
    case "android":
      targetTriple =
        arch === "x64"
          ? "x86_64-unknown-linux-musl"
          : arch === "arm64"
            ? "aarch64-unknown-linux-musl"
            : null;
      break;
    case "darwin":
      targetTriple =
        arch === "x64"
          ? "x86_64-apple-darwin"
          : arch === "arm64"
            ? "aarch64-apple-darwin"
            : null;
      break;
    case "win32":
      targetTriple =
        arch === "x64"
          ? "x86_64-pc-windows-msvc"
          : arch === "arm64"
            ? "aarch64-pc-windows-msvc"
            : null;
      break;
  }
  if (!targetTriple) {
    throw new Error(`Unsupported platform: ${platform} (${arch})`);
  }

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const binaryRelPath = path.join("vendor", targetTriple, "codex", binaryName);

  // Walk up from multiple starting points looking for the codex binary
  const startDirs = [
    __dirname,
    process.cwd(),
    ...(process.versions?.electron
      ? [(process as any).resourcesPath ?? ""]
      : []),
  ].filter(Boolean);

  for (const startDir of startDirs) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      // Check pnpm hoisted layout: node_modules/.pnpm/@openai+codex@*-<platform>-<arch>/...
      const pnpmDir = path.join(dir, "node_modules", ".pnpm");
      try {
        const entries = fs.readdirSync(pnpmDir);
        for (const entry of entries) {
          if (
            entry.startsWith("@openai+codex@") &&
            entry.includes(`-${process.platform}-`)
          ) {
            const candidate = path.join(
              pnpmDir,
              entry,
              "node_modules",
              "@openai",
              "codex",
              binaryRelPath,
            );
            if (fs.existsSync(candidate)) return candidate;
          }
        }
      } catch {
        // Directory doesn't exist
      }

      // Check direct node_modules layout (npm/yarn)
      const directCandidate = path.join(
        dir,
        "node_modules",
        "@openai",
        "codex",
        binaryRelPath,
      );
      if (fs.existsSync(directCandidate)) return directCandidate;

      // Also check via @openai/codex-sdk symlink chain
      const sdkCodexDir = path.join(
        dir,
        "node_modules",
        "@openai",
        "codex-sdk",
        "node_modules",
        "@openai",
        "codex",
      );
      const sdkCandidate = path.join(sdkCodexDir, binaryRelPath);
      if (fs.existsSync(sdkCandidate)) return sdkCandidate;

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error(
    "Unable to locate Codex CLI binary. Ensure @openai/codex-sdk is installed with optional dependencies.",
  );
}

/**
 * Resolve the canonical repository root for Codex trust settings.
 * In git worktrees, Codex expects trust on the shared repo root.
 */
function resolveCodexTrustProjectPath(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  try {
    const commonGitDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      {
        cwd,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    if (!commonGitDir) return undefined;
    return path.dirname(commonGitDir);
  } catch {
    return undefined;
  }
}

/**
 * Map Stratos thinking effort to Codex reasoning effort.
 *
 * Stratos: 'low' | 'medium' | 'high' | 'max'
 * Codex:      'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 */
function mapThinkingEffort(effort?: string): string | undefined {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
      return "xhigh";
    default:
      return undefined;
  }
}

/**
 * Map Stratos mode to Codex approval policy and sandbox mode.
 *
 * Claude Code modes → Codex equivalents:
 *
 * plan              → read-only sandbox, never ask (sandbox enforces read-only)
 * default           → workspace-write, untrusted (ask approval for everything)
 * acceptEdits       → workspace-write, on-request (auto-accept file edits, prompt for commands)
 * bypassPermissions → danger-full-access, never (auto-approve everything)
 *
 * Codex approval policy semantics:
 *   untrusted  — always ask for approval (most restrictive, matches Claude "default")
 *   on-request — ask when the model explicitly requests it (matches Claude "acceptEdits")
 *   on-failure — ask only when something fails
 *   never      — never ask, auto-approve everything (matches Claude "bypassPermissions")
 */
function mapModeToPolicy(
  mode?: string,
  configSandbox?: string,
): {
  approvalPolicy: string;
  sandbox: string;
} {
  switch (mode) {
    case "plan":
      return { approvalPolicy: "never", sandbox: "read-only" };
    case "default":
      return {
        approvalPolicy: "untrusted",
        sandbox: configSandbox ?? "workspace-write",
      };
    case "acceptEdits":
      return {
        approvalPolicy: "on-request",
        sandbox: configSandbox ?? "workspace-write",
      };
    case "bypassPermissions":
      return { approvalPolicy: "never", sandbox: "danger-full-access" };
    default:
      return {
        approvalPolicy: "untrusted",
        sandbox: configSandbox ?? "workspace-write",
      };
  }
}

/**
 * OpenAI Codex provider implementation.
 *
 * Uses the Codex **app-server** protocol (JSON-RPC 2.0 over stdio) which supports
 * true token-by-token text streaming via `item/agentMessage/delta` notifications.
 *
 * Protocol flow:
 *   initialize → initialized (notification) → thread/start → turn/start → listen for notifications
 *
 * Features implemented:
 * - Text streaming via `item/agentMessage/delta`
 * - Reasoning streaming via `item/reasoning/summaryTextDelta` and `item/reasoning/textDelta`
 * - Command execution with output streaming via `item/commandExecution/outputDelta`
 * - File change streaming via `item/fileChange/outputDelta`
 * - Plan streaming via `item/plan/delta`
 * - Approval handling via `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`
 * - Dynamic model discovery via `model/list` RPC
 * - Thread resume via `thread/resume`
 * - Image input support via `localImage` UserInput type
 * - Thinking effort mapping
 * - Mode support (plan/default/acceptEdits/bypassPermissions)
 * - System prompt passthrough via `baseInstructions`/`developerInstructions`
 * - Token usage and context window tracking
 * - Turn status handling (completed/interrupted/failed)
 * - Skills discovery via `skills/list`
 */
export class CodexProvider implements AgentProvider {
  readonly name = "codex";
  private config: ProviderConfig = {};
  private threadId?: string;
  private turnId?: string;
  private appServer?: ChildProcess;
  private rl?: readline.Interface;
  private rpcId = 0;
  private initialized = false;
  private sessionInitSent = false;
  /** Pending RPC responses keyed by request ID */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingRpc = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  /** Notification queue for streaming events during a turn */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private notificationQueue: Array<{
    method: string;
    params: any;
    id?: number;
  }> = [];
  /** Resolves when a new notification arrives */
  private notificationResolve?: () => void;
  /** Cached dynamic model list */
  private cachedModels?: ModelInfo[];
  /** Track command output streaming per item */
  private commandOutputBuffers = new Map<string, string>();
  /** Track file change output streaming per item */
  private fileChangeOutputBuffers = new Map<string, string>();
  /** Track reasoning streaming per item */
  private reasoningBuffers = new Map<
    string,
    { summary: string; content: string }
  >();

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendRpc(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    if (!this.appServer?.stdin) {
      return Promise.reject(new Error("App server not running"));
    }
    const id = ++this.rpcId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.appServer.stdin.write(msg + "\n");

    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve, reject });
    });
  }

  /**
   * Send a JSON-RPC notification (no id, no response expected).
   */
  private sendNotification(
    method: string,
    params: Record<string, unknown> = {},
  ): void {
    if (!this.appServer?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.appServer.stdin.write(msg + "\n");
  }

  /**
   * Send a JSON-RPC response to a server request (approval callbacks, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendResponse(id: number, result: any): void {
    if (!this.appServer?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
    this.appServer.stdin.write(msg + "\n");
  }

  /**
   * Start the app-server process if not already running.
   */
  private async ensureAppServer(): Promise<void> {
    if (this.appServer && !this.appServer.killed) return;

    const codexPath = findCodexBinary();
    const appServerArgs = ["app-server"];
    const trustProjectPath = resolveCodexTrustProjectPath(this.config.cwd);
    if (trustProjectPath) {
      appServerArgs.unshift(
        `projects.${trustProjectPath}.trust_level="trusted"`,
      );
      appServerArgs.unshift("-c");
    }

    this.appServer = spawn(codexPath, appServerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
      env: { ...process.env },
    });

    this.appServer.on("exit", () => {
      this.appServer = undefined;
      this.initialized = false;
      this.threadId = undefined;
      this.turnId = undefined;
    });

    // Ignore stderr (logging noise)
    this.appServer.stderr?.resume();

    // Set up line reader for JSONL output
    this.rl = readline.createInterface({
      input: this.appServer.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line: string) => {
      try {
        const msg = JSON.parse(line);

        // JSON-RPC response (has id, no method)
        if (msg.id !== undefined && !msg.method) {
          const pending = this.pendingRpc.get(msg.id);
          if (pending) {
            this.pendingRpc.delete(msg.id);
            if (msg.error) {
              pending.reject(
                new Error(msg.error.message ?? JSON.stringify(msg.error)),
              );
            } else {
              pending.resolve(msg.result);
            }
          }
          return;
        }

        // JSON-RPC server request (has both id and method) — e.g., approval requests
        // or JSON-RPC notification (has method, no id)
        if (msg.method) {
          this.notificationQueue.push({
            method: msg.method,
            params: msg.params ?? {},
            id: msg.id, // present for server requests, undefined for notifications
          });
          if (this.notificationResolve) {
            this.notificationResolve();
            this.notificationResolve = undefined;
          }
        }
      } catch {
        // Ignore unparseable lines
      }
    });

    // Initialize the app-server
    if (!this.initialized) {
      await this.sendRpc("initialize", {
        clientInfo: {
          name: "stratos",
          title: "Stratos",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: false },
      });
      // Send the `initialized` notification as required by the protocol handshake
      this.sendNotification("initialized");
      this.initialized = true;
    }
  }

  /**
   * Wait for the next notification, or return immediately if one is queued.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async waitForNotification(): Promise<{
    method: string;
    params: any;
    id?: number;
  } | null> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.notificationResolve = () => {
        if (this.notificationQueue.length > 0) {
          resolve(this.notificationQueue.shift()!);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Build the UserInput array for a turn/start request.
   * Supports text and images (via localImage type).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildUserInput(params: SendMessageParams): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs: any[] = [];

    // Text input
    if (params.prompt) {
      inputs.push({ type: "text", text: params.prompt, text_elements: [] });
    }

    // Image inputs — use localImage for file paths, image for data URLs
    if (params.images && params.images.length > 0) {
      for (const img of params.images) {
        if (img.dataUrl.startsWith("data:")) {
          // Data URL — use the URL directly as image type
          inputs.push({ type: "image", url: img.dataUrl });
        } else {
          // File path
          inputs.push({ type: "localImage", path: img.dataUrl });
        }
      }
    }

    return inputs;
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // Start app-server if needed
    try {
      await this.ensureAppServer();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        message: `Failed to start Codex: ${errMsg}`,
        code: "CODEX_START_ERROR",
      };
      return;
    }

    const model = params.model ?? this.config.model;
    const mode = params.mode ?? "default";
    const { approvalPolicy, sandbox } = mapModeToPolicy(
      mode,
      this.config.sandboxPolicy,
    );
    const effort = mapThinkingEffort(params.thinkingEffort);

    // Determine if we should resume or start a new thread
    const shouldResume =
      params.sessionId && this.threadId && params.sessionId === this.threadId;

    if (!this.threadId) {
      // Start a new thread
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const threadStartParams: Record<string, any> = {
          approvalPolicy,
          sandbox,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        };
        if (model) threadStartParams.model = model;
        if (params.cwd ?? this.config.cwd) {
          threadStartParams.cwd = params.cwd ?? this.config.cwd;
        }
        // Pass system prompt as base/developer instructions
        if (this.config.systemPrompt) {
          if (typeof this.config.systemPrompt === "string") {
            threadStartParams.developerInstructions = this.config.systemPrompt;
          } else if (
            this.config.systemPrompt.type === "preset" &&
            this.config.systemPrompt.append
          ) {
            threadStartParams.developerInstructions =
              this.config.systemPrompt.append;
          }
        }

        const result = await this.sendRpc("thread/start", threadStartParams);
        this.threadId = result?.thread?.id;

        // Drain any notifications emitted during thread start
        while (this.notificationQueue.length > 0) {
          const notif = this.notificationQueue.shift()!;
          if (notif.method === "thread/started" && notif.params?.thread?.id) {
            this.threadId = notif.params.thread.id;
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        yield {
          type: "error",
          message: `Failed to start thread: ${errMsg}`,
          code: "CODEX_THREAD_ERROR",
        };
        return;
      }
    } else if (shouldResume) {
      // Thread already exists and matches sessionId — we can send another turn.
      // The thread is already started, so we just start a new turn below.
    }

    if (!this.threadId) {
      yield {
        type: "error",
        message: "No thread ID after thread/start",
        code: "CODEX_THREAD_ERROR",
      };
      return;
    }

    // Emit session_init on first message
    if (!this.sessionInitSent) {
      this.sessionInitSent = true;
      yield {
        type: "session_init",
        sessionId: this.threadId,
        tools: [],
        slashCommands: [],
      };
    }

    // Clear notification queue and streaming buffers before starting turn
    this.notificationQueue = [];
    this.commandOutputBuffers.clear();
    this.fileChangeOutputBuffers.clear();
    this.reasoningBuffers.clear();

    // Build turn parameters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turnParams: Record<string, any> = {
      threadId: this.threadId,
      input: this.buildUserInput(params),
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    if (params.cwd) turnParams.cwd = params.cwd;

    // Start a turn
    try {
      const turnResult = await this.sendRpc("turn/start", turnParams);
      this.turnId = turnResult?.turn?.id;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        message: `Failed to start turn: ${errMsg}`,
        code: "CODEX_TURN_ERROR",
      };
      return;
    }

    // Listen for notifications until turn completes
    yield* this.processTurnNotifications(params);
  }

  /**
   * Process all notifications for the current turn until completion.
   */
  private async *processTurnNotifications(
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    let turnComplete = false;
    let streamingText = "";
    let streamingReasoning = "";

    while (!turnComplete) {
      const notif = await this.waitForNotification();
      if (!notif) continue;

      const { method, params: p, id: requestId } = notif;

      if (params.traceCallback) {
        params.traceCallback({
          timestamp: Date.now(),
          sessionId: this.threadId,
          messageType: method,
          data: p,
        });
      }

      switch (method) {
        // =====================
        // TEXT STREAMING
        // =====================
        case "item/agentMessage/delta": {
          const delta = p.delta ?? "";
          if (delta) {
            streamingText += delta;
            yield { type: "text", content: delta, isStreaming: true };
          }
          break;
        }

        // =====================
        // REASONING STREAMING
        // =====================
        case "item/reasoning/summaryTextDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const buf = this.reasoningBuffers.get(itemId) ?? {
              summary: "",
              content: "",
            };
            buf.summary += delta;
            this.reasoningBuffers.set(itemId, buf);
            yield { type: "thinking", content: delta, isStreaming: true };
            streamingReasoning += delta;
          }
          break;
        }

        case "item/reasoning/textDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const buf = this.reasoningBuffers.get(itemId) ?? {
              summary: "",
              content: "",
            };
            buf.content += delta;
            this.reasoningBuffers.set(itemId, buf);
            // Stream raw reasoning as thinking too
            yield { type: "thinking", content: delta, isStreaming: true };
            streamingReasoning += delta;
          }
          break;
        }

        // =====================
        // PLAN STREAMING
        // =====================
        case "item/plan/delta": {
          const delta = p.delta ?? "";
          if (delta) {
            // Plans render as thinking in the UI
            yield { type: "thinking", content: delta, isStreaming: true };
          }
          break;
        }

        // =====================
        // COMMAND EXECUTION OUTPUT STREAMING
        // =====================
        case "item/commandExecution/outputDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const current = this.commandOutputBuffers.get(itemId) ?? "";
            this.commandOutputBuffers.set(itemId, current + delta);
          }
          break;
        }

        // =====================
        // FILE CHANGE OUTPUT STREAMING
        // =====================
        case "item/fileChange/outputDelta": {
          const delta = p.delta ?? "";
          const itemId = p.itemId ?? "";
          if (delta) {
            const current = this.fileChangeOutputBuffers.get(itemId) ?? "";
            this.fileChangeOutputBuffers.set(itemId, current + delta);
          }
          break;
        }

        // =====================
        // ITEM LIFECYCLE
        // =====================
        case "item/started": {
          const item = p.item ?? p;
          const itemType = item?.type;

          if (itemType === "agentMessage") {
            streamingText = "";
          }
          if (itemType === "reasoning") {
            streamingReasoning = "";
          }
          if (itemType === "commandExecution") {
            // Emit tool_use at start so user sees the command being run
            const toolCallId = item.id ?? `cmd_${Date.now()}`;
            yield {
              type: "tool_use",
              toolName: "Bash",
              input: {
                command: item.command ?? "",
                ...(item.cwd ? { cwd: item.cwd } : {}),
              },
              toolCallId,
            };
          }
          break;
        }

        case "item/completed": {
          const item = p.item ?? p;
          yield* this.handleItemCompleted(
            item,
            streamingText,
            streamingReasoning,
          );

          // Reset streaming state
          if (item?.type === "agentMessage") {
            streamingText = "";
          }
          if (item?.type === "reasoning") {
            streamingReasoning = "";
          }
          break;
        }

        // =====================
        // APPROVAL REQUESTS (server requests with id)
        // =====================
        case "item/commandExecution/requestApproval": {
          if (requestId !== undefined) {
            yield* this.handleCommandApproval(p, requestId, params);
          }
          break;
        }

        case "item/fileChange/requestApproval": {
          if (requestId !== undefined) {
            yield* this.handleFileChangeApproval(p, requestId, params);
          }
          break;
        }

        // =====================
        // TURN LIFECYCLE
        // =====================
        case "turn/started": {
          const turn = p.turn ?? p;
          if (turn?.id) {
            this.turnId = turn.id;
          }
          break;
        }

        case "turn/completed": {
          turnComplete = true;
          const turn = p.turn ?? p;
          const status = turn?.status ?? "completed";
          this.turnId = undefined;

          // Extract token usage
          const usage = p.tokenUsage ?? turn?.tokenUsage;
          const tokenUsage = usage?.total
            ? {
                inputTokens: usage.total.inputTokens ?? 0,
                outputTokens: usage.total.outputTokens ?? 0,
              }
            : undefined;

          if (status === "failed") {
            const errorMsg = turn?.error?.message ?? "Turn failed";
            yield {
              type: "error",
              message: errorMsg,
              code: "CODEX_TURN_FAILED",
            };
          }

          yield {
            type: "result",
            content: "",
            ...(tokenUsage ? { usage: tokenUsage } : {}),
            stop_reason:
              status === "completed"
                ? "end_turn"
                : status === "interrupted"
                  ? "stop_sequence"
                  : status === "failed"
                    ? "end_turn"
                    : "end_turn",
          };
          break;
        }

        // =====================
        // TOKEN USAGE UPDATES
        // =====================
        case "thread/tokenUsage/updated": {
          // We extract usage at turn/completed — nothing to emit here
          break;
        }

        // =====================
        // THREAD NAME UPDATES
        // =====================
        case "thread/name/updated": {
          // Could be used to update the chat title; nothing to emit for now
          break;
        }

        // =====================
        // CONTEXT COMPACTION
        // =====================
        case "thread/compacted": {
          // Agent compacted its context window — informational
          break;
        }

        // =====================
        // MODEL REROUTED
        // =====================
        case "model/rerouted": {
          // Server rerouted to a different model — informational
          break;
        }

        // =====================
        // ERRORS
        // =====================
        case "error": {
          yield {
            type: "error",
            message: p.message ?? "Unknown error",
            code: "CODEX_ERROR",
          };
          turnComplete = true;
          break;
        }

        // =====================
        // LIFECYCLE / INFORMATIONAL — ignored
        // =====================
        case "thread/started":
        case "thread/status/changed":
        case "thread/closed":
        case "thread/archived":
        case "thread/unarchived":
        case "skills/changed":
        case "serverRequest/resolved":
        case "item/mcpToolCall/progress":
        case "item/commandExecution/terminalInteraction":
        case "item/reasoning/summaryPartAdded":
        case "turn/plan/updated":
        case "turn/diff/updated":
        case "rawResponseItem/completed":
        case "configWarning":
        case "deprecationNotice":
        case "account/updated":
        case "account/rateLimits/updated":
          break;

        default:
          // Ignore other notifications (codex/event/*, mcp/*, etc.)
          break;
      }
    }
  }

  /**
   * Handle a completed item notification.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *handleItemCompleted(
    item: any,
    streamingText: string,
    streamingReasoning: string,
  ): Generator<AgentMessage> {
    const itemType = item?.type;

    switch (itemType) {
      case "agentMessage": {
        if (streamingText) {
          // Deltas were streamed; UI already has the text. Just finalize.
          yield { type: "text", content: "", isStreaming: false };
        } else {
          // No deltas were received — emit full text (fallback)
          const finalText = item.text ?? "";
          if (finalText) {
            yield { type: "text", content: finalText, isStreaming: false };
          }
        }
        break;
      }

      case "reasoning": {
        if (streamingReasoning) {
          // Already streamed via deltas — finalize
          yield { type: "thinking", content: "", isStreaming: false };
        } else {
          // Fallback: emit summary or content
          const summaries = item.summary ?? [];
          const contents = item.content ?? [];
          const text = summaries.join("\n") || contents.join("\n") || "";
          if (text) {
            yield { type: "thinking", content: text, isStreaming: false };
          }
        }
        // Clean up buffer
        if (item.id) this.reasoningBuffers.delete(item.id);
        break;
      }

      case "plan": {
        // Plan completed — finalize thinking
        const text = item.text ?? "";
        if (text) {
          yield { type: "thinking", content: "", isStreaming: false };
        }
        break;
      }

      case "commandExecution": {
        const toolCallId = item.id ?? `cmd_${Date.now()}`;
        // Use streamed output if available, otherwise fall back to aggregatedOutput
        const streamedOutput = this.commandOutputBuffers.get(toolCallId);
        const output = streamedOutput ?? item.aggregatedOutput ?? "";
        const outputParts: string[] = [];
        if (output) outputParts.push(output);
        if (
          item.exitCode !== undefined &&
          item.exitCode !== null &&
          item.exitCode !== 0
        ) {
          outputParts.push(`\nExit code: ${item.exitCode}`);
        }
        if (item.durationMs !== undefined && item.durationMs !== null) {
          outputParts.push(`\nDuration: ${item.durationMs}ms`);
        }

        // If the tool_use was already emitted at item/started, just emit tool_result
        yield {
          type: "tool_result",
          toolCallId,
          output:
            outputParts.join("") ||
            (item.status === "completed" ? "(completed)" : `(${item.status})`),
        };

        // Clean up buffer
        this.commandOutputBuffers.delete(toolCallId);
        break;
      }

      case "fileChange": {
        const changes = item.changes ?? [];
        const itemId = item.id;
        const streamedDiff = itemId
          ? this.fileChangeOutputBuffers.get(itemId)
          : undefined;

        for (const change of changes) {
          const toolCallId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const toolName =
            change.kind === "add"
              ? "Write"
              : change.kind === "delete"
                ? "Delete"
                : "Edit";
          yield {
            type: "tool_use",
            toolName,
            input: {
              file_path: change.path ?? "",
              kind: change.kind ?? "update",
            },
            toolCallId,
          };
          yield {
            type: "tool_result",
            toolCallId,
            output: streamedDiff
              ? `${change.kind ?? "update"}: ${change.path ?? ""}\n${streamedDiff}`
              : `${change.kind ?? "update"}: ${change.path ?? ""}`,
          };
        }

        // Clean up buffer
        if (itemId) this.fileChangeOutputBuffers.delete(itemId);
        break;
      }

      case "mcpToolCall": {
        const toolCallId = item.id ?? `mcp_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: `mcp__${item.server}__${item.tool}`,
          input: item.arguments ?? {},
          toolCallId,
        };
        let output = "";
        if (item.error) {
          output = item.error.message ?? "MCP tool call failed";
        } else if (item.result) {
          if (item.result.content && Array.isArray(item.result.content)) {
            output = item.result.content
              .map((b: { text?: string }) => b.text ?? "")
              .join("\n");
          } else {
            output = JSON.stringify(item.result);
          }
        }
        const durationSuffix = item.durationMs ? ` (${item.durationMs}ms)` : "";
        yield {
          type: "tool_result",
          toolCallId,
          output: (output || `(${item.status})`) + durationSuffix,
        };
        break;
      }

      case "dynamicToolCall": {
        const toolCallId = item.id ?? `dyn_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: item.tool ?? "DynamicTool",
          input: item.arguments ?? {},
          toolCallId,
        };
        let output = "";
        if (item.contentItems && Array.isArray(item.contentItems)) {
          output = item.contentItems
            .map((ci: { text?: string }) => ci.text ?? "")
            .filter(Boolean)
            .join("\n");
        }
        const success =
          item.success === true
            ? "(success)"
            : item.success === false
              ? "(failed)"
              : `(${item.status})`;
        yield { type: "tool_result", toolCallId, output: output || success };
        break;
      }

      case "webSearch": {
        const toolCallId = item.id ?? `search_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "WebSearch",
          input: { query: item.query ?? "" },
          toolCallId,
        };
        yield { type: "tool_result", toolCallId, output: "Search completed" };
        break;
      }

      case "imageView": {
        const toolCallId = item.id ?? `imgview_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "Read",
          input: { file_path: item.path ?? "" },
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallId,
          output: `Viewed image: ${item.path ?? ""}`,
        };
        break;
      }

      case "imageGeneration": {
        const toolCallId = item.id ?? `imggen_${Date.now()}`;
        yield {
          type: "tool_use",
          toolName: "ImageGeneration",
          input: { prompt: item.revisedPrompt ?? "" },
          toolCallId,
        };
        yield {
          type: "tool_result",
          toolCallId,
          output: item.result ?? `(${item.status})`,
        };
        break;
      }

      case "contextCompaction": {
        // Informational — the agent compacted its context
        yield {
          type: "text",
          content: "\n*[Context compacted]*\n",
          isStreaming: false,
        };
        break;
      }

      case "error": {
        yield {
          type: "error",
          message: item.message ?? "Unknown item error",
          code: "CODEX_ITEM_ERROR",
        };
        break;
      }

      default: {
        // Unknown item types
        const text = item?.text ?? item?.content ?? item?.message;
        if (typeof text === "string" && text) {
          yield { type: "text", content: text, isStreaming: false };
        }
        break;
      }
    }
  }

  /**
   * Handle command execution approval request.
   * Maps to the permissionHandler in SendMessageParams.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *handleCommandApproval(
    p: any,
    requestId: number,
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    const command = p.command ?? "";
    const cwd = p.cwd ?? "";
    const reason = p.reason ?? undefined;

    // Emit a permission_request so the UI can show an approval dialog
    const permRequestId = `cmd_approval_${requestId}`;
    yield {
      type: "permission_request",
      toolName: "Bash",
      input: {
        command,
        cwd,
        ...(reason ? { reason } : {}),
      },
      requestId: permRequestId,
    };

    // Ask the permission handler
    try {
      const result = await params.permissionHandler("Bash", {
        command,
        cwd,
        ...(reason ? { reason } : {}),
      });

      if (result.approved) {
        this.sendResponse(requestId, { decision: "accept" });
      } else {
        this.sendResponse(requestId, { decision: "decline" });
      }
    } catch {
      // On error, decline
      this.sendResponse(requestId, { decision: "decline" });
    }
  }

  /**
   * Handle file change approval request.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *handleFileChangeApproval(
    p: any,
    requestId: number,
    params: SendMessageParams,
  ): AsyncGenerator<AgentMessage> {
    const reason = p.reason ?? undefined;
    const grantRoot = p.grantRoot ?? undefined;

    // Emit a permission_request so the UI can show an approval dialog
    const permRequestId = `file_approval_${requestId}`;
    yield {
      type: "permission_request",
      toolName: "Edit",
      input: {
        ...(reason ? { reason } : {}),
        ...(grantRoot ? { grantRoot } : {}),
      },
      requestId: permRequestId,
    };

    // Ask the permission handler
    try {
      const result = await params.permissionHandler("Edit", {
        ...(reason ? { reason } : {}),
        ...(grantRoot ? { grantRoot } : {}),
      });

      if (result.approved) {
        this.sendResponse(requestId, { decision: "accept" });
      } else {
        this.sendResponse(requestId, { decision: "decline" });
      }
    } catch {
      this.sendResponse(requestId, { decision: "decline" });
    }
  }

  async interrupt(): Promise<void> {
    if (this.threadId && this.appServer) {
      const interruptParams: { threadId: string; turnId?: string } = {
        threadId: this.threadId,
      };
      if (this.turnId) {
        interruptParams.turnId = this.turnId;
      }

      try {
        await this.sendRpc("turn/interrupt", interruptParams);
      } catch (err) {
        // Compatibility fallback for servers that may reject turnId.
        if (interruptParams.turnId) {
          try {
            await this.sendRpc("turn/interrupt", { threadId: this.threadId });
            return;
          } catch {
            // Fall through to warning below
          }
        }
        // Surface interrupt failures for diagnostics instead of swallowing.
        console.warn(
          "[codex.provider] interrupt failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  canResume(sessionId: string): boolean {
    return this.threadId === sessionId;
  }

  /**
   * Get available models via `model/list` RPC.
   * Falls back to static list if app-server isn't available.
   */
  async getAvailableModels(): Promise<ModelInfo[]> {
    if (this.cachedModels) return this.cachedModels;

    try {
      await this.ensureAppServer();
      const result = await this.sendRpc("model/list", { includeHidden: false });
      const models: ModelInfo[] = (result?.data ?? []).map(
        (m: {
          id: string;
          model: string;
          displayName: string;
          description: string;
          isDefault?: boolean;
          hidden?: boolean;
        }) => ({
          value: m.model ?? m.id,
          displayName: m.displayName ?? m.model ?? m.id,
          description: m.description ?? "",
        }),
      );

      if (models.length > 0) {
        this.cachedModels = models;
        return models;
      }
    } catch {
      // Fall through to static list
    }

    // Fallback static list
    return [
      {
        value: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        description: "Latest frontier agentic coding model",
      },
      {
        value: "gpt-5.2-codex",
        displayName: "GPT-5.2 Codex",
        description: "Advanced agentic coding model",
      },
      {
        value: "gpt-5.1-codex",
        displayName: "GPT-5.1 Codex",
        description: "Agentic coding model with deep reasoning",
      },
      {
        value: "gpt-5.1-codex-mini",
        displayName: "GPT-5.1 Codex Mini",
        description: "Fast, lightweight coding model",
      },
      {
        value: "gpt-5.4",
        displayName: "GPT-5.4",
        description: "Latest general-purpose model",
      },
      {
        value: "gpt-5.2",
        displayName: "GPT-5.2",
        description: "General-purpose model with coding capabilities",
      },
    ];
  }

  /**
   * Discover available skills via `skills/list` RPC.
   */
  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    try {
      await this.ensureAppServer();
      const result = await this.sendRpc("skills/list", {
        cwds: this.config.cwd ? [this.config.cwd] : [],
      });

      // Result contains skills; map to slash command format
      const skills = result?.skills ?? result?.data ?? [];
      if (Array.isArray(skills)) {
        return skills.map((skill: { name?: string; description?: string }) => ({
          name: skill.name
            ? skill.name.startsWith("/")
              ? skill.name
              : `/${skill.name}`
            : "/unknown",
          description: skill.description,
        }));
      }
    } catch {
      // Skills discovery is optional
    }
    return [];
  }

  async dispose(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    if (this.appServer && !this.appServer.killed) {
      this.appServer.kill();
      this.appServer = undefined;
    }
    this.threadId = undefined;
    this.turnId = undefined;
    this.sessionInitSent = false;
    this.initialized = false;
    this.pendingRpc.clear();
    this.notificationQueue = [];
    this.cachedModels = undefined;
    this.commandOutputBuffers.clear();
    this.fileChangeOutputBuffers.clear();
    this.reasoningBuffers.clear();
  }
}

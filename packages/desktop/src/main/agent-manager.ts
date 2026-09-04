import { BrowserWindow, ipcMain, Notification, shell } from "electron";
import type { McpElicitationRequest } from "@stratosapp/core";
import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../common/ipc-channels";
import {
  ClaudeCodeProvider,
  OpencodeProvider,
  createProvider,
  FileStorageAdapter,
  appendTraceEntry,
  normalizeMode,
  deriveHash,
  derivePort,
  getWorktreeInfo,
} from "@stratosapp/core";
import type {
  AgentProvider,
  AgentMessage,
  AgentMode,
  McpServerInfo,
  PermissionHandler,
  SendMessageParams,
  ProviderType,
  PendingMessage,
  PendingDelivery,
  EnqueueResult,
} from "@stratosapp/core";
import { MAX_PENDING_PER_THREAD } from "@stratosapp/core";
import {
  loadSettings,
  setProviderSettings,
  getOpencodeProviderKeys,
  setOpencodeProviderKey,
  deleteOpencodeProviderKey,
  getOpencodeModelAllowlist,
  setOpencodeModelAllowlist,
  getOpencodeEnabledModels,
  setOpencodeEnabledModels,
  disableOpencodeProvider,
  clearOpencodeProvider,
  getArchivedOpencodeEnabledModels,
  getOllamaConfig,
  setOllamaConfig,
  clearOllamaConfig,
  isManagerEnabled,
} from "./settings/settings.store";
import type { OllamaConfig, OllamaModelInfo } from "./settings/settings.store";
import { resolveToolBehavior, effectiveToolName } from "./agent-session-logic";
import { resolveClaudePathOrUndefined } from "./integrations/claude-path";
import {
  resolveAgentOverlay,
  mergeSystemPromptAppend,
  mergeAgentMcpServers,
} from "./agents/resolve";
import { createStratosHandlers } from "./mcp/handlers";
import { handlersToSdkMcp } from "./mcp/sdk-adapter";
import { startStratosMcpSocketServer } from "./mcp/socket-mcp-server";
import type { StratosMcpSocketServer } from "./mcp/socket-mcp-server";
import {
  getStratosMcpPath,
  getStratosMcpSocketPath,
  installStratosMcpProxy,
  cleanupLegacyMcpBinaries,
} from "./mcp/stdio-proxy";
import { getFileWatcherCount } from "./files/files.ipc";

/**
 * Build explicit MCP servers for an agent session.
 *
 * Unified: all Stratos tools (scheduler + preview + manager, 19 total) live
 * under one MCP server named `stratos`. Per-provider transport:
 *   - claude-code: in-process SDK MCP (bypasses LinkedIn's allowedMcpServers
 *     allowlist which blocks arbitrary stdio MCPs).
 *   - codex / opencode: stdio subprocess `~/.stratos/bin/stratos-mcp` that
 *     proxies MCP JSON-RPC over a Unix socket back to main. Wired via the
 *     providers' own config surfaces.
 *
 * Project-level (.mcp.json) and user-level (~/.claude/.mcp.json) servers are
 * auto-discovered by the SDK via `settingSources`; we only inject servers
 * that can't be statically configured.
 */
interface BuildMcpServersOpts {
  cwd: string;
  providerName: ProviderType;
  socketPath: string;
  // SDK handler deps — only used for claude-code.
  sdkHandlers?: ReturnType<typeof createStratosHandlers>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMcpServers(opts: BuildMcpServersOpts): Record<string, any> {
  const { cwd, providerName, socketPath, sdkHandlers } = opts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servers: Record<string, any> = {};

  if (providerName === "claude-code" && sdkHandlers) {
    // In-process SDK MCP — bypasses LinkedIn's allowedMcpServers allowlist.
    servers["stratos"] = handlersToSdkMcp("stratos", "1.0.0", sdkHandlers);
  } else {
    // stdio MCP — for codex/opencode. The provider forwards this into its
    // own config surface (Codex `-c mcp_servers.*`, Opencode `mcp` JSON).
    servers["stratos"] = {
      command: "node",
      args: [getStratosMcpPath()],
      env: { STRATOS_MCP_SOCK: socketPath },
    };
  }

  // Add chrome-devtools for cross-worktree debugging (ContextSphere pattern)
  if (process.env.STRATOS_WORKTREE) {
    try {
      let targetRoot: string;
      try {
        targetRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {
        targetRoot = cwd;
      }
      const targetHash = deriveHash(targetRoot);
      const selfHash = getWorktreeInfo().hash;

      // Only add chrome-devtools when targeting a different worktree
      if (targetHash !== selfHash) {
        const cdpPort = derivePort(targetHash, 9200, 9999);
        servers["chrome-devtools"] = {
          command: "npx",
          args: [
            "chrome-devtools-mcp",
            `--browser-url=http://127.0.0.1:${cdpPort}`,
          ],
        };
      }
    } catch {}
  }

  return servers;
}

function safeLog(fn: (...args: unknown[]) => void, ...args: unknown[]) {
  try {
    fn(...args);
  } catch (e: any) {
    if (e?.code !== "EPIPE") throw e;
  }
}

// ─── Ollama helpers ─────────────────────────────────────────────────────────

/**
 * Reads `{family}.context_length` out of Ollama's model_info bag. The field
 * may arrive as a plain object (Ollama REST JSON) or a Map (ollama-js typing);
 * handle both.
 */
function extractContextLength(
  modelInfo: unknown,
  family: string,
): number | undefined {
  const read = (key: string): unknown => {
    if (modelInfo instanceof Map) return modelInfo.get(key);
    if (modelInfo && typeof modelInfo === "object") {
      return (modelInfo as Record<string, unknown>)[key];
    }
    return undefined;
  };
  const direct = read(`${family}.context_length`);
  if (typeof direct === "number") return direct;
  const entries =
    modelInfo instanceof Map
      ? Array.from(modelInfo.entries())
      : modelInfo && typeof modelInfo === "object"
        ? Object.entries(modelInfo as Record<string, unknown>)
        : [];
  for (const [key, value] of entries) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

/**
 * Discover Ollama models via the official `ollama` SDK (typed wrapper around
 * `/api/tags` + `/api/show`). Returns enriched model info with capabilities
 * and context window.
 */
async function discoverOllamaModels(
  baseURL: string,
): Promise<OllamaModelInfo[]> {
  const { Ollama } = await import("ollama");
  const client = new Ollama({ host: baseURL });

  const { models } = await client.list();

  return Promise.all(
    models.map(async (m) => {
      const family = m.details?.family ?? "";
      const base = {
        name: m.name,
        size: m.size,
        parameterSize: m.details?.parameter_size ?? "unknown",
        family,
        quantization: m.details?.quantization_level ?? "unknown",
      };
      try {
        const show = await client.show({ model: m.name });
        const caps = show.capabilities ?? [];
        return {
          ...base,
          capabilities: {
            vision: caps.includes("vision"),
            tools: caps.includes("tools"),
            thinking: caps.includes("thinking"),
          },
          contextLength:
            extractContextLength(show.model_info, family) ?? 131072,
        };
      } catch {
        // If show() fails for a model, return with safe defaults
        return {
          ...base,
          capabilities: { vision: false, tools: true, thinking: false },
          contextLength: 131072,
        };
      }
    }),
  );
}

/**
 * Build custom opencode provider definition for Ollama, if configured.
 */
function buildOllamaCustomProvider(): Record<
  string,
  import("@stratosapp/core").OpencodeCustomProvider
> {
  const config = getOllamaConfig();
  if (!config || Object.keys(config.models).length === 0) return {};

  return {
    ollama: {
      id: "ollama",
      name: "Ollama",
      npm: "@ai-sdk/openai-compatible",
      api: `${config.baseURL}/v1`,
      apiKey: "ollama",
      models: Object.fromEntries(
        Object.entries(config.models).map(([id, m]) => [
          id,
          {
            id,
            name: `${m.name} (${m.parameterSize})`,
            tool_call: m.capabilities.tools,
            temperature: true,
            reasoning: m.capabilities.thinking,
            attachment: m.capabilities.vision,
            limit: {
              context: m.contextLength,
              output: 8192,
            },
          },
        ]),
      ),
    },
  };
}

export type RunOrigin = "user" | "manager" | "scheduler";

/** Minimal interface satisfied by WakeupManager. Declared here (not imported)
 *  because WakeupManager needs an AgentManager reference — a real import
 *  would create a circular dependency at module load time. */
export interface WakeupHandler {
  scheduleWakeup(params: {
    threadId: string;
    delaySeconds: number;
    prompt: string;
    reason?: string;
  }): unknown;
  cancelForThread(threadId: string): number;
}

export interface StreamCompletedEvent {
  threadId: string;
  runId: string;
  status: "completed" | "error" | "interrupted";
  errorMessage?: string;
  /** Who initiated this stream run. Used by the Manager to decide whether to
   * surface a completion directive — "user" runs are silent so the Manager
   * doesn't auto-respond (or forward to WhatsApp) when the user talks to a
   * manager-spawned agent directly. */
  origin: RunOrigin;
}

interface ThreadSession {
  provider: AgentProvider;
  sessionId?: string;
  abortController?: AbortController;
  /** True when the current stream is a stale-session retry started without
   *  resume. The session_init from this retry must NOT overwrite the stored
   *  sessionId — the old sessionId is still the source of truth for loading
   *  message history via the SDK transcript. */
  isStaleRetry?: boolean;
  /** True when the user explicitly requested an interrupt. Prevents the stale
   *  session detector from auto-retrying after the SDK raises "process exited"
   *  as a result of provider.interrupt() killing the subprocess. */
  interruptRequested?: boolean;
  /** Timer handle for MCP status watcher — polls pending MCPs until connected. */
  mcpWatcherTimer?: ReturnType<typeof setTimeout>;
  /** Current plan markdown for the pending plan review. Per-thread so
   *  concurrent plan-mode threads don't thrash each other's content.
   *  Cleared when the session is evicted (clearSession) or when the plan
   *  review resolves. Capped at MAX_PLAN_CONTENT_BYTES to prevent a single
   *  huge plan from bloating memory. */
  lastPlanMarkdown?: { content: string; title: string };
}

export class AgentManager {
  private window: BrowserWindow;
  private sessions = new Map<string, ThreadSession>();
  private sessionAccessOrder: string[] = []; // LRU tracking: most recent at end
  // Each idle Claude subprocess holds 150-400 MB of native memory (its own
  // V8 heap + pipe buffers). After the recurring OOMs in May 2026, dropped
  // from 2 → 1 so a single idle subprocess gives snappy resume on the most
  // recent thread without bloating RSS for less-recent ones.
  private static readonly MAX_IDLE_SESSIONS = 1;
  private managerMcpStatusProvider?: () => Promise<McpServerInfo[]>;
  private completionListeners = new Set<
    (event: StreamCompletedEvent) => void
  >();
  private activeStreams = new Set<string>();
  private activeStreamIds = new Map<string, string>();
  private streamSequence = 0;
  /** Messages typed while a turn was running, awaiting the next boundary.
   *  In-memory by design: a restart clears them rather than firing a stale
   *  prompt at a working tree that has since moved on. */
  private pendingByThread = new Map<string, PendingMessage[]>();
  private modelsCache = new Map<string, { models: unknown[]; ts: number }>();
  private static readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private storage: FileStorageAdapter;
  private pendingPermissions = new Map<
    string,
    {
      threadId: string;
      resolve: (result: {
        approved: boolean;
        modifiedInput?: Record<string, unknown>;
        denyMessage?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updatedPermissions?: any[];
      }) => void;
    }
  >();
  private pendingQuestions = new Map<
    string,
    {
      threadId: string;
      resolve: (result: {
        approved: boolean;
        modifiedInput?: Record<string, unknown>;
      }) => void;
      input: Record<string, unknown>;
    }
  >();
  private pendingPlanReviews = new Map<
    string,
    {
      resolve: (result: {
        approved: boolean;
        modifiedInput?: Record<string, unknown>;
        denyMessage?: string;
      }) => void;
      threadId: string | null;
      input: Record<string, unknown>;
    }
  >();
  private pendingElicitations = new Map<
    string,
    {
      threadId: string;
      resolve: (result: {
        action: "accept" | "decline" | "cancel";
        content?: Record<string, unknown>;
      }) => void;
    }
  >();
  /** Tracks effective mode per thread during active streams (reflects plan-review changes). */
  private threadEffectiveModes = new Map<string, AgentMode>();
  private elicitationCounter = 0;
  private questionCounter = 0;
  private planReviewCounter = 0;
  /** Creation timestamp for each pending permission/question/plan-review/elicitation request.
   *  Used by the idle sweep to auto-reject requests that have been pending too long
   *  (e.g. renderer crash left them unresolvable). */
  private pendingRequestCreatedAt = new Map<string, number>();
  private static readonly PENDING_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
  /** 500 KB cap on stored plan content to prevent a single large plan from bloating memory. */
  private static readonly MAX_PLAN_CONTENT_BYTES = 500_000;
  private cachedSlashCommands: { name: string; description?: string }[] = [];
  private mcpSocketPath: string;
  private mcpSocketServer: StratosMcpSocketServer;
  /** Background notifications: track live ones so we can drop their listeners. */
  private activeNotifications = new Set<Notification>();
  /** Per-(threadId,type) timestamp of the last notification, for debouncing. */
  private lastNotificationAt = new Map<string, number>();
  private static readonly NOTIFICATION_COOLDOWN_MS = 30_000;
  // Periodic idle-session eviction. evictIdleSessions() only runs when a new
  // stream starts. If many threads stream, complete, and then sit idle without
  // a new stream starting, their SDK control queries (each holding a child
  // claude CLI process and Node-side state) accumulate. Periodic sweep catches
  // this case.
  private idleEvictTimer?: ReturnType<typeof setInterval>;
  /** Host-side handler for the `ScheduleWakeup` deferred tool. Optional —
   *  wired post-construction from main/index.ts because WakeupManager itself
   *  needs an AgentManager reference. See scheduler/wakeup-manager.ts. */
  private wakeupHandler: WakeupHandler | null = null;

  constructor(window: BrowserWindow, storage?: FileStorageAdapter) {
    this.window = window;
    this.storage = storage ?? new FileStorageAdapter();

    // Install the generic stdio proxy and clean up legacy per-MCP binaries.
    cleanupLegacyMcpBinaries();
    installStratosMcpProxy();

    // Start the unified Unix-socket MCP server. Codex/opencode subprocesses
    // spawn the stdio proxy which tunnels their MCP traffic back here.
    this.mcpSocketPath = getStratosMcpSocketPath(getWorktreeInfo().hash);
    const handlers = createStratosHandlers({
      storage: this.storage,
      agentManager: this,
      window: this.window,
      sendToRenderer: (channel, data) => this.sendToRenderer(channel, data),
      includeManager: isManagerEnabled(),
    });
    this.mcpSocketServer = startStratosMcpSocketServer({
      socketPath: this.mcpSocketPath,
      serverName: "stratos",
      serverVersion: "1.0.0",
      handlers,
    });

    this.registerIpc();
    this.detectOrphanedThreads().catch((err) => {
      safeLog(console.error, "[agent-manager] orphan detection failed:", err);
    });

    // When the renderer navigates away (HMR reload, F5, devtools refresh,
    // crash-recovery reload), every in-flight pending* IPC request becomes
    // un-resolvable. The closures in those Maps retain `input` payloads and
    // resolve callbacks, which root the runStream() async-generator state.
    // Reject and drop them so they can be GC'd.
    const onRendererGone = (reason: string) => {
      this.rejectAllPendingForRendererGone(reason);
    };
    this.window.webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) onRendererGone("did-start-navigation");
      },
    );
    this.window.webContents.on("did-finish-load", () => {
      onRendererGone("did-finish-load");
    });
    this.window.webContents.on("destroyed", () => {
      onRendererGone("destroyed");
    });

    // Periodic idle-session sweep. See field comment for rationale.
    this.idleEvictTimer = setInterval(() => {
      try {
        this.evictIdleSessions();

        const now = Date.now();

        // Evict expired modelsCache entries so stale model lists don't linger.
        for (const [k, v] of this.modelsCache) {
          if (now - v.ts > AgentManager.MODEL_CACHE_TTL_MS) {
            this.modelsCache.delete(k);
          }
        }

        // Auto-reject pending requests that have been waiting longer than the
        // timeout. This cleans up orphaned requests after renderer crashes where
        // rejectAllPendingForRendererGone may not have fired in time.
        for (const [id, ts] of this.pendingRequestCreatedAt) {
          if (now - ts < AgentManager.PENDING_REQUEST_TIMEOUT_MS) continue;
          this.pendingRequestCreatedAt.delete(id);
          if (this.pendingPermissions.has(id)) {
            this.pendingPermissions
              .get(id)!
              .resolve({ approved: false, denyMessage: "Request timed out" });
            this.pendingPermissions.delete(id);
          } else if (this.pendingQuestions.has(id)) {
            this.pendingQuestions.get(id)!.resolve({ approved: false });
            this.pendingQuestions.delete(id);
          } else if (this.pendingPlanReviews.has(id)) {
            this.pendingPlanReviews
              .get(id)!
              .resolve({ approved: false, denyMessage: "Request timed out" });
            this.pendingPlanReviews.delete(id);
          } else if (this.pendingElicitations.has(id)) {
            this.pendingElicitations.get(id)!.resolve({ action: "cancel" });
            this.pendingElicitations.delete(id);
          }
          // else: already cleaned up, just remove the timestamp
        }
      } catch (err) {
        safeLog(console.error, "[agent-manager] idle eviction error:", err);
      }
    }, 60_000);
    this.idleEvictTimer.unref?.();
  }

  private registerIpc(): void {
    ipcMain.handle(
      IPC_CHANNELS.SEND_MESSAGE,
      async (
        _event,
        prompt: string,
        threadId?: string,
        images?: { dataUrl: string; mimeType: string }[],
      ) => {
        if (!threadId) return;
        // Use the same atomic admission path as mid-turn sends. A second IPC
        // send that arrives before the renderer observes isRunning is queued
        // instead of starting a concurrent provider turn.
        this.enqueueMessage(threadId, prompt, images, "queue").catch((err) => {
          safeLog(
            console.error,
            `[agent-manager] send error for thread ${threadId}:`,
            err,
          );
        });
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.PENDING_ENQUEUE,
      async (
        _event,
        threadId: string,
        prompt: string,
        images?: { dataUrl: string; mimeType: string }[],
        delivery?: PendingDelivery,
      ) => {
        if (!threadId) return { status: "queued", fellBack: false };
        return this.enqueueMessage(
          threadId,
          prompt,
          images,
          delivery ?? "queue",
        );
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.PENDING_CANCEL,
      async (_event, threadId: string, id: string) =>
        this.cancelPending(threadId, id),
    );

    ipcMain.handle(
      IPC_CHANNELS.PENDING_LIST,
      async (_event, threadId: string) => this.listPending(threadId),
    );

    ipcMain.handle(
      IPC_CHANNELS.PENDING_PROMOTE,
      async (_event, threadId: string, id: string, to: "steer" | "break") =>
        this.promotePending(threadId, id, to),
    );

    ipcMain.handle(
      IPC_CHANNELS.INTERRUPT,
      async (_event, threadId?: string) => {
        if (!threadId) return;
        const session = this.sessions.get(threadId);
        if (session) {
          session.interruptRequested = true;
          try {
            await session.provider.interrupt();
          } catch (err) {
            // Session may already be dead (e.g. "Query closed before response received").
            // Log a warning but don't re-throw — a thrown handler rejects the renderer's
            // invoke() call, which prevents the UI's 5s force-clear timeout from running.
            console.warn(
              `[agent-manager] interrupt failed for thread ${threadId}:`,
              err,
            );
          }
        }
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.GET_AVAILABLE_MODELS,
      async (_event, providerName?: string) => {
        const key = providerName ?? "claude-code";
        const cached = this.modelsCache.get(key);
        if (
          cached &&
          Date.now() - cached.ts < AgentManager.MODEL_CACHE_TTL_MS
        ) {
          return cached.models;
        }
        let provider = createProvider(key as ProviderType);
        const settings = loadSettings();
        const cliPath =
          key === "claude-code"
            ? await resolveClaudePathOrUndefined(
                settings.cliPath as string | undefined,
              )
            : undefined;
        const opencodeConfig =
          key === "opencode"
            ? {
                providers: getOpencodeProviderKeys(),
                customProviders: buildOllamaCustomProvider(),
              }
            : undefined;
        await provider.initialize({
          cliPath,
          ...(opencodeConfig ? { opencodeConfig } : {}),
        });
        try {
          let models = await provider.getAvailableModels();
          if (key === "opencode") {
            // Drift detection: if a sub-provider we configured (API key or
            // Ollama) is missing from the server's /provider response, the
            // server is running with stale env. Restart + refetch once.
            const ollama = getOllamaConfig();
            const expected = new Set<string>([
              ...Object.keys(getOpencodeProviderKeys()),
              ...(ollama && Object.keys(ollama.models).length > 0
                ? ["ollama"]
                : []),
            ]);
            const present = new Set(models.map((m) => m.value.split("/")[0]));
            const missing = [...expected].filter((id) => !present.has(id));
            if (missing.length > 0) {
              console.warn(
                "[agent-manager] opencode provider drift — missing:",
                missing,
                "— restarting + refetching",
              );
              OpencodeProvider.restartServer();
              await provider.dispose();
              provider = createProvider(key as ProviderType);
              await provider.initialize({
                cliPath,
                ...(opencodeConfig ? { opencodeConfig } : {}),
              });
              models = await provider.getAvailableModels();
            }
            const enabled = getOpencodeEnabledModels();
            models = models.filter((m) => {
              const providerId = m.value.split("/")[0];
              const picks = enabled[providerId];
              if (!picks) return false;
              if (picks.length === 0) return true; // legacy: all models
              return picks.includes(m.value);
            });
          }
          this.modelsCache.set(key, { models, ts: Date.now() });
          return models;
        } finally {
          await provider.dispose();
        }
      },
    );

    // Handle tool permission responses from the renderer
    ipcMain.on(
      IPC_CHANNELS.TOOL_RESPONSE,
      (
        _event,
        data: {
          requestId: string;
          approved: boolean;
          updatedPermissions?: unknown[];
        },
      ) => {
        const pending = this.pendingPermissions.get(data.requestId);
        if (pending) {
          pending.resolve({
            approved: data.approved,
            updatedPermissions: data.updatedPermissions,
          });
          this.pendingPermissions.delete(data.requestId);
        }
      },
    );

    // Handle ask-user-question responses
    ipcMain.on(
      IPC_CHANNELS.ASK_USER_RESPONSE,
      (
        _event,
        data: { requestId: string; answers: Record<string, string> },
      ) => {
        const pending = this.pendingQuestions.get(data.requestId);
        if (pending) {
          pending.resolve({
            approved: true,
            modifiedInput: {
              questions: pending.input.questions,
              answers: data.answers,
            },
          });
          this.pendingQuestions.delete(data.requestId);
        }
      },
    );

    // Handle plan review responses
    ipcMain.on(
      IPC_CHANNELS.PLAN_REVIEW_RESPONSE,
      async (
        _event,
        data: {
          requestId: string;
          decision: { type: string; feedback?: string };
        },
      ) => {
        const pending = this.pendingPlanReviews.get(data.requestId);
        if (!pending) return;
        const { resolve, threadId, input } = pending;
        this.pendingPlanReviews.delete(data.requestId);
        // Free per-thread plan markdown — it's been sent to the renderer already
        if (threadId) {
          const session = this.sessions.get(threadId);
          if (session) delete session.lastPlanMarkdown;
        }

        switch (data.decision.type) {
          case "clear-bypass":
          case "bypass":
            if (threadId) {
              this.threadEffectiveModes.set(threadId, "bypassPermissions");
              try {
                await this.storage.updateThread(threadId, {
                  mode: "bypassPermissions",
                });
              } catch {}
              this.sendToRenderer(
                IPC_CHANNELS.MODE_CHANGED,
                { mode: "bypassPermissions" },
                threadId,
              );
            }
            resolve({ approved: true });
            break;
          case "manual":
            if (threadId) {
              this.threadEffectiveModes.set(threadId, "default");
              try {
                await this.storage.updateThread(threadId, { mode: "default" });
              } catch {}
              this.sendToRenderer(
                IPC_CHANNELS.MODE_CHANGED,
                { mode: "default" },
                threadId,
              );
            }
            resolve({
              approved: true,
              modifiedInput: { ...input, allowedPrompts: [] },
            });
            break;
          case "implement":
            if (threadId) {
              try {
                await this.storage.updateThread(threadId, {
                  mode: "fullAccess",
                });
              } catch {}
              this.sendToRenderer(
                IPC_CHANNELS.MODE_CHANGED,
                { mode: "fullAccess" },
                threadId,
              );
            }
            resolve({ approved: true });
            // Auto-trigger implementation turn from main process.
            // We can't rely on the renderer's sendMessage because of
            // stale closure issues with runningThreadIds guards.
            if (threadId) {
              setTimeout(() => {
                this.enqueueMessage(
                  threadId,
                  "Implement the plan",
                  undefined,
                  "queue",
                ).catch((err) => {
                  safeLog(
                    console.error,
                    `[agent-manager] implement-plan stream error:`,
                    err,
                  );
                });
              }, 100);
            }
            break;
          case "feedback":
          case "deny":
          default:
            resolve({
              approved: false,
              denyMessage: data.decision.feedback ?? "User provided feedback",
            });
            break;
        }
      },
    );

    // MCP elicitation response
    ipcMain.on(
      IPC_CHANNELS.MCP_ELICITATION_RESPONSE,
      (
        _event,
        data: {
          requestId: string;
          action: "accept" | "decline" | "cancel";
          content?: Record<string, unknown>;
        },
      ) => {
        const pending = this.pendingElicitations.get(data.requestId);
        if (pending) {
          pending.resolve({ action: data.action, content: data.content });
          this.pendingElicitations.delete(data.requestId);
        }
      },
    );

    // MCP reconnect server
    ipcMain.handle(
      IPC_CHANNELS.MCP_RECONNECT_SERVER,
      async (_event, threadId: string, serverName: string) => {
        const session = this.sessions.get(threadId);
        if (!session) {
          console.warn(`[MCP] reconnect: no session for thread ${threadId}`);
          return;
        }
        if (!session.provider.reconnectMcpServer) {
          console.warn(
            `[MCP] reconnect: provider has no reconnectMcpServer method`,
          );
          return;
        }
        const result = await session.provider.reconnectMcpServer(serverName);
        if (result?.authUrl) {
          shell.openExternal(result.authUrl);
        }
        await this.pushMcpStatus(threadId);
      },
    );

    // MCP server status
    ipcMain.handle(
      IPC_CHANNELS.MCP_SERVER_STATUS,
      async (_event, threadId: string) => {
        return this.getMcpStatusForThread(threadId);
      },
    );

    // Context window usage breakdown. Three cases, in order:
    //   1. A live session exists in this process — use its provider.
    //   2. The thread has a persisted SDK sessionId from a prior run —
    //      probe via a transient resumed query (claude-code only).
    //   3. Neither — return null and the indicator stays hidden.
    ipcMain.handle(
      IPC_CHANNELS.CONTEXT_USAGE_GET,
      async (_event, threadId: string) => {
        const session = this.sessions.get(threadId);
        if (session?.provider.getContextUsage) {
          try {
            const usage = await session.provider.getContextUsage();
            if (usage) return usage;
          } catch (err) {
            console.warn(`[context] live getContextUsage failed:`, err);
          }
        }

        const thread = await this.storage.getThread(threadId);
        if (!thread?.sessionId) return null;
        const providerName = (thread.provider ?? "claude-code") as ProviderType;
        if (providerName !== "claude-code") return null;

        try {
          const probe = createProvider("claude-code");
          const settings = loadSettings();
          const cliPath = await resolveClaudePathOrUndefined(
            settings.cliPath as string | undefined,
          );
          await probe.initialize({
            ...(cliPath ? { cliPath } : {}),
            ...(thread.model ? { model: thread.model } : {}),
            cwd: thread.cwd ?? process.env.HOME!,
            settingSources: ["project", "user", "local"],
          });
          const usage = await probe.getContextUsage?.({
            sessionId: thread.sessionId,
          });
          await probe.dispose?.();
          return usage ?? null;
        } catch (err) {
          console.warn(`[context] probe getContextUsage failed:`, err);
          return null;
        }
      },
    );

    // MCP toggle server
    ipcMain.handle(
      IPC_CHANNELS.MCP_TOGGLE_SERVER,
      async (
        _event,
        threadId: string,
        serverName: string,
        enabled: boolean,
      ) => {
        const session = this.sessions.get(threadId);
        if (!session) {
          console.warn(`[MCP] toggle: no session for thread ${threadId}`);
          return;
        }
        if (!session.provider.toggleMcpServer) {
          console.warn(`[MCP] toggle: provider has no toggleMcpServer method`);
          return;
        }
        await session.provider.toggleMcpServer(serverName, enabled);
        await this.pushMcpStatus(threadId);
      },
    );

    // MCP open config file
    ipcMain.handle(
      IPC_CHANNELS.MCP_OPEN_CONFIG,
      async (_event, configPath: string) => {
        await shell.openPath(configPath);
      },
    );

    // Handle orphaned thread recovery
    ipcMain.handle(
      IPC_CHANNELS.THREADS_RECOVER_ORPHANED,
      async (_event, threadId: string) => {
        try {
          this.storage.clearPersistedSessionId(threadId);
          this.clearSession(threadId);
        } catch (err) {
          safeLog(
            console.error,
            `[agent-manager] failed to recover orphaned thread ${threadId}:`,
            err,
          );
        }
      },
    );

    // Opencode provider key management
    ipcMain.handle(IPC_CHANNELS.OPENCODE_GET_PROVIDER_KEYS, async () => {
      return getOpencodeProviderKeys();
    });

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_SET_PROVIDER_KEY,
      async (_event, providerId: string, apiKey: string, baseURL?: string) => {
        setOpencodeProviderKey(providerId, {
          apiKey,
          ...(baseURL ? { baseURL } : {}),
        });
        // Restart the opencode server so it picks up the new key
        OpencodeProvider.restartServer();
        // Invalidate models cache for opencode
        this.modelsCache.delete("opencode");
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_DELETE_PROVIDER_KEY,
      async (_event, providerId: string) => {
        deleteOpencodeProviderKey(providerId);
        // Restart the opencode server so it drops the old key
        OpencodeProvider.restartServer();
        // Invalidate models cache for opencode
        this.modelsCache.delete("opencode");
      },
    );

    // Opencode model allowlist
    ipcMain.handle(IPC_CHANNELS.OPENCODE_GET_MODEL_ALLOWLIST, async () => {
      return getOpencodeModelAllowlist();
    });

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_SET_MODEL_ALLOWLIST,
      async (_event, allowlist: string[]) => {
        setOpencodeModelAllowlist(allowlist);
        this.modelsCache.delete("opencode");
      },
    );

    // Opencode — raw per-provider model list (bypasses the enabled-models filter)
    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_LIST_PROVIDER_MODELS,
      async (_event, providerId: string) => {
        const provider = createProvider("opencode");
        const opencodeConfig = {
          providers: getOpencodeProviderKeys(),
          customProviders: buildOllamaCustomProvider(),
        };
        await provider.initialize({ opencodeConfig });
        try {
          const all = await provider.getAvailableModels();
          return all.filter((m) => m.value.split("/")[0] === providerId);
        } finally {
          await provider.dispose();
        }
      },
    );

    ipcMain.handle(IPC_CHANNELS.OPENCODE_GET_ENABLED_MODELS, async () => {
      return getOpencodeEnabledModels();
    });

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_SET_ENABLED_MODELS,
      async (_event, providerId: string, modelValues: string[]) => {
        setOpencodeEnabledModels(providerId, modelValues);
        this.modelsCache.delete("opencode");
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_DISABLE_PROVIDER,
      async (_event, providerId: string) => {
        disableOpencodeProvider(providerId);
        this.modelsCache.delete("opencode");
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_CLEAR_PROVIDER,
      async (_event, providerId: string) => {
        clearOpencodeProvider(providerId);
        this.modelsCache.delete("opencode");
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.OPENCODE_RESTORE_PROVIDER,
      async (_event, providerId: string) => {
        const archived = getArchivedOpencodeEnabledModels(providerId);
        if (archived && archived.length > 0) {
          setOpencodeEnabledModels(providerId, archived);
          this.modelsCache.delete("opencode");
          return archived;
        }
        return null;
      },
    );

    // Ollama — local model server
    ipcMain.handle(IPC_CHANNELS.OLLAMA_GET_CONFIG, async () => {
      return getOllamaConfig();
    });

    ipcMain.handle(
      IPC_CHANNELS.OLLAMA_SET_CONFIG,
      async (_event, config: OllamaConfig) => {
        setOllamaConfig(config);
        // Restart opencode server so it picks up the new Ollama provider
        OpencodeProvider.restartServer();
        this.modelsCache.delete("opencode");
      },
    );

    ipcMain.handle(IPC_CHANNELS.OLLAMA_CLEAR_CONFIG, async () => {
      clearOllamaConfig();
      OpencodeProvider.restartServer();
      this.modelsCache.delete("opencode");
    });

    ipcMain.handle(
      IPC_CHANNELS.OLLAMA_DISCOVER_MODELS,
      async (_event, baseURL: string) => {
        return discoverOllamaModels(baseURL);
      },
    );
  }

  /**
   * Atomically reserve a thread before any asynchronous setup begins. Every
   * caller goes through this boundary, so there can be only one provider turn
   * per thread even before the renderer receives its running-state event.
   */
  private runStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
    origin: RunOrigin = "user",
    echoUserMessage = false,
  ): Promise<void> {
    if (this.activeStreams.has(threadId)) {
      return Promise.reject(
        new Error(`Thread ${threadId} already has an active stream`),
      );
    }

    const streamId = `${threadId}-${Date.now()}-${++this.streamSequence}`;
    this.activeStreams.add(threadId);
    this.activeStreamIds.set(threadId, streamId);

    return this.runStreamInternal(
      threadId,
      prompt,
      images,
      origin,
      echoUserMessage,
      streamId,
    ).finally(() => {
      // Most releases happen in runStreamInternal where completion semantics
      // are known. This is the safety net for failures during early setup.
      if (this.activeStreamIds.get(threadId) === streamId) {
        this.activeStreamIds.delete(threadId);
        this.activeStreams.delete(threadId);
        this.threadEffectiveModes.delete(threadId);
        this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
          threadId,
          isRunning: false,
        });
        this.maybeRunPostStreamGc();
      }
    });
  }

  private async runStreamInternal(
    threadId: string,
    prompt: string,
    images: { dataUrl: string; mimeType: string }[] | undefined,
    origin: RunOrigin,
    echoUserMessage: boolean,
    streamId: string,
  ): Promise<void> {
    // Each new stream attempt clears any prior interrupt intent so that a
    // user-triggered stop followed by a fresh send works correctly.
    const sessionAtStart = this.sessions.get(threadId);
    if (sessionAtStart) sessionAtStart.interruptRequested = false;

    // When set to true in the stale-session catch branch, the finally block
    // skips cleanup so it doesn't send isRunning:false while the retry runs.
    let isRetrying = false;
    // Captured in the catch block so the finally can tell the Manager Agent
    // whether this run ended cleanly, with an error, or via user interrupt.
    let caughtError: unknown = null;

    let thread = await this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Stale model check: only runs before the first message (no session yet).
    // If the model cache is populated and thread.model isn't in it, fall back
    // silently to the first available model and self-correct the saved setting.
    if (thread.model && !this.sessions.has(threadId)) {
      const cached = this.modelsCache.get(thread.provider ?? "claude-code");
      if (cached && cached.models.length > 0) {
        const modelValues = cached.models.map(
          (m) => (m as { value: string }).value,
        );
        if (!modelValues.includes(thread.model)) {
          const fallback = modelValues[0];
          console.warn(
            `[agent-manager] thread ${threadId}: model "${thread.model}" not in available list, falling back to "${fallback}"`,
          );
          await this.storage.updateThread(threadId, { model: fallback });
          if (thread.provider) {
            setProviderSettings(thread.provider, { lastUsedModel: fallback });
          }
          thread = { ...thread, model: fallback };
        }
      }
    }

    // runId aliases streamId and is persisted immediately so that a crash
    // between stream start and completion leaves lastRunId !== lastReportedRunId,
    // enabling reconcile-on-startup to re-queue the missed notification.
    const runId = streamId;
    if (thread.spawnedBy === "manager") {
      this.storage.updateThread(threadId, {
        lastRunId: runId,
        lastRunOrigin: origin,
      });
    }

    // For non-user-initiated runs (scheduler wakeup, manager/MCP send_message),
    // there is no renderer-side optimistic user message to bootstrap streaming
    // state. The renderer's useChat hook auto-initializes streamingThreadsRef
    // when it sees a `user_message` event but DROPS any other event when no
    // state exists — so without this synthetic message the entire turn's
    // events (session_init, text, tool_use, result) get discarded by the UI.
    // Symptom: thread stays in "thinking" state with no visible progress
    // until the user switches threads and back (which falls through to the
    // disk-load path that reads the SDK transcript). Carrying _streamId here
    // also lets the renderer reject late events from a prior interrupted run.
    if (origin !== "user" || echoUserMessage) {
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "user_message",
          content: prompt,
          images,
          _streamId: streamId,
        },
        threadId,
      );
    }

    // Lazy worktree creation: if user selected worktree mode but no worktree exists yet
    if (thread.worktreeMode === "worktree" && !thread.worktree && thread.cwd) {
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "worktree_progress",
          step: "Creating git worktree...",
          status: "running",
          _streamId: streamId,
        },
        threadId,
      );

      try {
        const branchName = `stratos/${threadId}`;
        const worktreeDir = join(homedir(), ".stratos", "worktrees", threadId);
        mkdirSync(worktreeDir, { recursive: true });

        execFileSync(
          "git",
          ["worktree", "add", "-b", branchName, worktreeDir],
          {
            cwd: thread.cwd,
            encoding: "utf-8",
            timeout: 30000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        await this.storage.updateThread(threadId, {
          worktree: {
            path: worktreeDir,
            branch: branchName,
            sourceRepoPath: thread.cwd,
          },
          cwd: worktreeDir,
        });

        // Reload thread with updated cwd
        thread = (await this.storage.getThread(threadId))!;

        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          {
            type: "worktree_progress",
            step: "Creating git worktree...",
            status: "completed",
            _streamId: streamId,
          },
          threadId,
        );
      } catch (err: any) {
        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          {
            type: "worktree_progress",
            step: `Failed to create worktree: ${err?.message ?? "Unknown error"}`,
            status: "error",
            _streamId: streamId,
          },
          threadId,
        );
        // Fall back to local mode
      }
    }

    // Get or create a session for this thread
    let session = this.sessions.get(threadId);
    if (!session) {
      const providerName = (thread.provider ?? "claude-code") as ProviderType;
      const provider = createProvider(providerName);
      const settings = loadSettings();
      const resolvedClaudeCliPath =
        providerName === "claude-code"
          ? await resolveClaudePathOrUndefined(
              settings.cliPath as string | undefined,
            )
          : undefined;
      const { overlay: agentOverlay } = await resolveAgentOverlay(thread);
      const threadCwd = thread.cwd ?? agentOverlay.cwd ?? process.env.HOME!;
      const builtMcpServers = buildMcpServers({
        cwd: threadCwd,
        providerName,
        socketPath: this.mcpSocketPath,
        sdkHandlers:
          providerName === "claude-code"
            ? createStratosHandlers({
                storage: this.storage,
                agentManager: this,
                window: this.window,
                sendToRenderer: (channel, data) =>
                  this.sendToRenderer(channel, data),
                includeManager: isManagerEnabled(),
              })
            : undefined,
      });
      const mcpServers = mergeAgentMcpServers(builtMcpServers, agentOverlay);
      await provider.initialize({
        ...(providerName === "claude-code"
          ? {
              cliPath: resolvedClaudeCliPath,
              settingSources: ["project", "user", "local"] as (
                | "project"
                | "user"
                | "local"
              )[],
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: mergeSystemPromptAppend(
                  [
                    `\n# Host Environment`,
                    `You are running inside Stratos, an Electron desktop application (PID: ${process.pid}).`,
                    `DO NOT kill, terminate, or signal this process or its parent Electron process.`,
                    `DO NOT run broad process kills like \`pkill -f electron\`, \`killall Electron\`, or any command that could terminate Electron processes — this would kill your own host application.`,
                    `If you need to stop a dev server or child process, target it by its specific PID or port, not by process name.`,
                    ``,
                    `# Stratos MCP`,
                    `You have access to the \`stratos\` MCP server, which exposes Stratos-specific tools for schedules${isManagerEnabled() ? ", the side preview pane, and session management" : " and the side preview pane"}.`,
                    ``,
                    `## Scheduled prompts`,
                    `- \`schedule_create\` — create a recurring or one-shot scheduled prompt (call \`schedule_folders\` first to get a valid folder)`,
                    `- \`schedule_list\` — list all scheduled prompts with status and last-run info`,
                    `- \`schedule_delete\` — permanently delete a schedule by ID`,
                    `- \`schedule_enable\` / \`schedule_disable\` — toggle a schedule on/off without deleting it`,
                    `- \`schedule_folders\` — list available folders (id, name, path)`,
                    `Each schedule fires in a new Stratos thread. Use the folder or cwd argument to control which folder the thread appears in.`,
                    ``,
                    `## Preview pane`,
                    `- \`preview_open_file(file_path, title?)\` — open any file in the side preview pane (markdown files render as formatted text, all other files open in a code editor). Always use absolute paths.`,
                    `- \`preview_close()\` — close the preview pane.`,
                    `Use this after creating or editing a file so the user can see the result immediately.`,
                  ].join("\n"),
                  agentOverlay,
                ),
              },
            }
          : {}),
        ...(providerName === "opencode"
          ? {
              opencodeConfig: {
                providers: getOpencodeProviderKeys(),
                customProviders: buildOllamaCustomProvider(),
              },
            }
          : {}),
        model: thread.model ?? agentOverlay.model,
        cwd: threadCwd,
        mcpServers,
        ...(agentOverlay.agents ? { agents: agentOverlay.agents } : {}),
      });
      session = { provider, sessionId: thread.sessionId };
      this.sessions.set(threadId, session);
    }

    // Update LRU tracking and evict idle sessions to prevent OOM
    this.touchSession(threadId);
    this.evictIdleSessions();

    // Notify renderer that streaming started
    this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
      threadId,
      isRunning: true,
    });

    const permissionHandler: PermissionHandler = async (
      toolName,
      input,
      options,
    ) => {
      const currentThread = await this.storage.getThread(threadId);
      const currentProvider =
        currentThread?.provider ?? thread.provider ?? "claude-code";
      // Use threadEffectiveModes for the current mode — it reflects plan-review decisions
      // immediately without requiring a storage round-trip, fixing the race where concurrent
      // canUseTool requests fire before the plan-review storage update completes.
      const currentMode =
        this.threadEffectiveModes.get(threadId) ??
        normalizeMode(currentThread?.mode ?? thread.mode, currentProvider);

      const behavior = resolveToolBehavior(
        currentMode,
        effectiveToolName(toolName, input),
        currentProvider,
      );

      if (behavior === "always_approve") {
        return { approved: true };
      }
      if (behavior === "plan_review") {
        return this.requestPlanReview(threadId, input);
      }
      if (behavior === "ask_user") {
        this.notifyIfBackground(threadId, "question");
        return this.requestUserAnswer(threadId, input);
      }

      // Generic permission prompt
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.sendToRenderer(
        IPC_CHANNELS.TOOL_PERMISSION,
        {
          requestId,
          toolName,
          input,
          suggestions: options?.suggestions,
          decisionReason: options?.decisionReason,
        },
        threadId,
      );
      this.notifyIfBackground(threadId, "permission");
      return new Promise((resolve) => {
        this.pendingPermissions.set(requestId, { threadId, resolve });
        this.pendingRequestCreatedAt.set(requestId, Date.now());
      });
    };

    const onElicitation = async (
      request: McpElicitationRequest,
    ): Promise<{
      action: "accept" | "decline" | "cancel";
      content?: Record<string, unknown>;
    }> => {
      if (request.mode === "url" && request.url) {
        // Open auth URL in default browser — validate scheme first
        try {
          const { protocol } = new URL(request.url);
          if (protocol !== "https:" && protocol !== "http:") {
            return { action: "decline" };
          }
        } catch {
          return { action: "decline" };
        }
        shell.openExternal(request.url);
        // For URL-based auth, accept immediately — the SDK will wait for
        // the OAuth callback/completion via elicitation_complete
        return { action: "accept" };
      }

      // For form mode or unknown, forward to renderer
      const requestId = `elicitation_${++this.elicitationCounter}`;
      this.sendToRenderer(
        IPC_CHANNELS.MCP_ELICITATION,
        { requestId, ...request },
        threadId,
      );
      return new Promise((resolve) => {
        this.pendingElicitations.set(requestId, { threadId, resolve });
        this.pendingRequestCreatedAt.set(requestId, Date.now());
      });
    };

    const mode = normalizeMode(thread.mode, thread.provider);
    this.threadEffectiveModes.set(threadId, mode);
    const planContentChunks: string[] = [];
    let sawPlanUpdate = false;
    const params: SendMessageParams = {
      prompt,
      sessionId: session.sessionId,
      model: thread.model,
      cwd: thread.cwd ?? process.env.HOME,
      additionalDirectories: thread.additionalCwds,
      thinkingEffort: thread.thinkingEffort,
      mode,
      images,
      permissionHandler,
      onElicitation,
      traceCallback: (entry) => {
        appendTraceEntry(threadId, entry);
      },
    };

    let specificErrorSent = false;
    const pendingWriteTools = new Map<
      string,
      { filePath: string; content: string }
    >();

    try {
      for await (const msg of session.provider.sendMessage(params)) {
        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          { ...msg, _streamId: streamId },
          threadId,
        );

        if (msg.type === "error") {
          specificErrorSent = true;
        }

        if (mode === "plan" && msg.type === "plan_update") {
          sawPlanUpdate = true;
          if (msg.content) {
            planContentChunks.push(msg.content);
          }
        }

        // Track plan markdown for artifact viewer.
        // We stage on tool_use (to capture content from the SDK message) but
        // only open/watch on tool_result — by then the file actually exists on disk.
        if (
          msg.type === "tool_use" &&
          msg.toolName === "Write" &&
          typeof msg.input?.file_path === "string" &&
          typeof msg.input?.content === "string"
        ) {
          pendingWriteTools.set(msg.toolCallId, {
            filePath: msg.input.file_path as string,
            content: msg.input.content as string,
          });
        }
        if (
          msg.type === "tool_result" &&
          pendingWriteTools.has(msg.toolCallId)
        ) {
          const pending = pendingWriteTools.get(msg.toolCallId)!;
          pendingWriteTools.delete(msg.toolCallId);
          this.openPreviewFile(pending.filePath, pending.content, threadId);
        }

        // ScheduleWakeup: the bundled Claude Code CLI's built-in deferred tool
        // for /loop dynamic pacing. Its in-CLI poller never runs in SDK mode
        // (Ink REPL isn't mounted), so we register the wakeup host-side here
        // and fire it via WakeupManager. See scheduler/wakeup-manager.ts.
        if (
          msg.type === "tool_use" &&
          msg.toolName === "ScheduleWakeup" &&
          this.wakeupHandler &&
          msg.input &&
          typeof msg.input.delaySeconds === "number" &&
          typeof msg.input.prompt === "string"
        ) {
          try {
            this.wakeupHandler.scheduleWakeup({
              threadId,
              delaySeconds: msg.input.delaySeconds,
              prompt: msg.input.prompt,
              ...(typeof msg.input.reason === "string"
                ? { reason: msg.input.reason }
                : {}),
            });
          } catch (err) {
            safeLog(
              console.error,
              `[agent-manager] wakeupHandler.scheduleWakeup failed for thread ${threadId}:`,
              err,
            );
          }
        }

        // Track session ID from init message
        if (msg.type === "session_init") {
          const wasStaleRetry = session.isStaleRetry;
          session.sessionId = msg.sessionId;
          session.isStaleRetry = false;
          // Persist sessionId to thread for resume — but skip this when the
          // session_init comes from a stale-session retry. The old sessionId
          // must stay in storage so loadMessages continues to read message
          // history from the original SDK transcript.
          if (!wasStaleRetry) {
            try {
              this.storage.updateThread(threadId, { sessionId: msg.sessionId });
            } catch {}
          }
          // Notify renderer of session readiness
          this.sendToRenderer(
            IPC_CHANNELS.SESSION_READY,
            {
              sessionId: msg.sessionId,
              tools: (msg as any).tools ?? [],
            },
            threadId,
          );
          // Start polling for MCP status updates — slow MCPs (e.g. ones that
          // load tools from external APIs) may still be "pending" at this point.
          this.startMcpWatcher(threadId);
        }
      }

      const latestPlanContent = planContentChunks.join("");
      if (
        mode === "plan" &&
        sawPlanUpdate &&
        !specificErrorSent &&
        latestPlanContent.trim().length > 0 &&
        !this.hasPendingPlanReviewForThread(threadId)
      ) {
        const planContent = latestPlanContent.trim();
        const planTitle = "Plan";
        this.setPlanMarkdown(threadId, planContent, planTitle);
        this.sendToRenderer(
          IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
          {
            content: planContent,
            title: planTitle,
          },
          threadId,
        );
        // Codex can complete plan turns without ExitPlanMode.
        // Trigger the same review UX used by explicit plan-exit tools.
        void this.requestPlanReview(threadId, { allowedPrompts: [] });
      }
    } catch (err: any) {
      caughtError = err;
      // If the error is due to a stale session, retry once without the
      // sessionId so a fresh session is started. Two shapes we treat as stale:
      //   - "process exited" / "exited with code": the SDK subprocess died.
      //   - "no conversation found with session id": the CLI couldn't find
      //     the JSONL for our persisted sessionId (transcript was deleted
      //     or never existed). Without this branch the resume retries the
      //     same dead session ID forever.
      // Do NOT retry if the user explicitly interrupted — provider.interrupt()
      // kills the subprocess which also raises "process exited", and we must
      // not mistake a user stop for a dead session.
      const isStaleSession =
        session.sessionId &&
        !session.interruptRequested &&
        typeof err?.message === "string" &&
        /process exited|exited with code|no conversation found with session id/i.test(
          err.message,
        );

      if (isStaleSession) {
        console.warn(
          `[agent-manager] Stale session for thread ${threadId}, retrying without resume`,
        );
        // Clear in-memory so the retry starts a fresh session without resume.
        // Mark as stale retry so the new session_init does NOT overwrite the
        // stored sessionId — the old sessionId remains the source of truth for
        // loading message history from the SDK transcript.
        session.sessionId = undefined;
        session.isStaleRetry = true;
        // Signal the finally block to skip cleanup — the retry's own finally
        // will send isRunning:false when it eventually completes.
        isRetrying = true;
        if (this.activeStreamIds.get(threadId) === streamId) {
          this.activeStreamIds.delete(threadId);
          this.activeStreams.delete(threadId);
          this.threadEffectiveModes.delete(threadId);
        }
        return this.runStream(threadId, prompt, images, origin, false);
      }

      // Provider shutdown commonly rejects its async iterator after an
      // intentional interrupt. That is a successful Stop action, not a chat
      // error, and must never flash as an error bubble in the renderer.
      if (!specificErrorSent && !session.interruptRequested) {
        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          {
            type: "error",
            message: err?.message ?? "Unknown error",
            code: "AGENT_ERROR",
            _streamId: streamId,
          },
          threadId,
        );
      }
    } finally {
      // Skip cleanup when we're about to retry — the recursive runStream call
      // owns the running state from here and its own finally will send
      // isRunning:false when it eventually finishes.
      if (!isRetrying && this.activeStreamIds.get(threadId) === streamId) {
        this.activeStreams.delete(threadId);
        this.activeStreamIds.delete(threadId);
        this.threadEffectiveModes.delete(threadId);
        this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
          threadId,
          isRunning: false,
        });

        const latestSession = this.sessions.get(threadId);
        const status: StreamCompletedEvent["status"] =
          latestSession?.interruptRequested
            ? "interrupted"
            : caughtError
              ? "error"
              : "completed";

        // Persist completion status for manager-spawned threads so the UI can
        // show it deterministically after reload — no LLM involvement needed.
        const completedThread = this.storage.getThread(threadId);
        if (completedThread?.spawnedBy === "manager") {
          const errorMsg =
            caughtError &&
            typeof (caughtError as { message?: unknown })?.message === "string"
              ? ((caughtError as { message: string }).message as string)
              : undefined;
          this.storage.updateThread(threadId, {
            lastCompletionStatus: status,
            lastCompletionError: errorMsg,
          });
          this.sendToRenderer(IPC_CHANNELS.THREADS_CHANGED, undefined);
        }

        // Deliver the next queued message, if the user left one. Runs after
        // the isRunning:false / completion bookkeeping above so the renderer
        // sees a clean turn boundary before the next turn starts.
        this.drainPending(threadId, status === "interrupted");

        this.emitStreamCompleted({
          threadId,
          runId,
          status,
          origin,
          ...(caughtError && typeof (caughtError as any)?.message === "string"
            ? { errorMessage: (caughtError as any).message }
            : {}),
        });

        // Stream just ended — this session is now idle. If the idle pool is
        // over MAX_IDLE_SESSIONS, evict the oldest now (instead of waiting
        // for the next stream start or the periodic timer).
        this.evictIdleSessions();
        this.maybeRunPostStreamGc();
      }
    }
  }

  /**
   * Start a persistent MCP health monitor for a session.
   *
   * The SDK has no event API for MCP status changes, so we poll. Two speeds:
   *   - 3 s  while any server is "pending"  (startup / reconnect phase)
   *   - 15 s once all servers are stable    (crash detection, tool-list changes)
   *
   * Runs for the lifetime of the session — stops only when clearSession() fires
   * (which calls clearTimeout on mcpWatcherTimer). Re-calling startMcpWatcher
   * on the same thread replaces the existing watcher safely.
   */
  private startMcpWatcher(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (!session) return;

    // Replace any existing watcher for this thread
    if (session.mcpWatcherTimer) {
      clearTimeout(session.mcpWatcherTimer);
      session.mcpWatcherTimer = undefined;
    }

    const FAST_INTERVAL_MS = 3_000; // while any MCP is pending
    const SLOW_INTERVAL_MS = 15_000; // steady-state health check

    const poll = async () => {
      const s = this.sessions.get(threadId);
      if (!s) return; // session cleared — stop

      try {
        const statuses = await this.getMcpStatusForThread(threadId);
        if (statuses.length > 0) {
          this.sendToRenderer(IPC_CHANNELS.MCP_STATUS_CHANGED, {
            threadId,
            servers: statuses,
          });
          const hasPending = (statuses as Array<{ status?: string }>).some(
            (sv) => sv.status === "pending",
          );
          s.mcpWatcherTimer = setTimeout(
            poll,
            hasPending ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS,
          );
          return;
        }
      } catch {
        // ignore errors — watcher is best-effort
      }
      // No servers yet or error — retry at slow rate
      s.mcpWatcherTimer = setTimeout(poll, SLOW_INTERVAL_MS);
    };

    // First poll after 2 s to give MCPs time to start their init handshake
    session.mcpWatcherTimer = setTimeout(poll, 2000);
  }

  /**
   * Register a lookup for the Manager Agent's MCP status. The manager runs
   * outside AgentManager.sessions, so MCP status queries for its thread need
   * to be delegated.
   */
  /**
   * Subscribe to stream-completion events. Fires once per runStream exit
   * (success, error, or interrupt), with the final status. Used by the
   * Manager Agent to auto-report when one of its spawned sessions finishes.
   * Returns an unsubscribe function.
   */
  onStreamCompleted(
    listener: (event: StreamCompletedEvent) => void,
  ): () => void {
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  private emitStreamCompleted(event: StreamCompletedEvent): void {
    for (const listener of this.completionListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[agent-manager] stream-completion listener threw:", err);
      }
    }
  }

  setManagerMcpStatusProvider(provider: () => Promise<McpServerInfo[]>): void {
    this.managerMcpStatusProvider = provider;
  }

  /** Wire the WakeupManager so the agent-manager can defer ScheduleWakeup
   *  tool calls to a host-side timer. See scheduler/wakeup-manager.ts and
   *  the runStream tool_use observer below. */
  setWakeupHandler(handler: WakeupHandler): void {
    this.wakeupHandler = handler;
  }

  private async getMcpStatusForThread(
    threadId: string,
  ): Promise<McpServerInfo[]> {
    const thread = await this.storage.getThread(threadId);
    if (thread?.isManagerThread && this.managerMcpStatusProvider) {
      try {
        return await this.managerMcpStatusProvider();
      } catch {
        return [];
      }
    }
    const session = this.sessions.get(threadId);
    if (!session?.provider.getMcpServerStatus) return [];
    try {
      const statuses = await session.provider.getMcpServerStatus();
      const cwd = thread?.cwd ?? process.env.HOME!;
      const home = homedir();
      for (const s of statuses) {
        if (s.scope && !s.configPath) {
          switch (s.scope) {
            case "project":
              s.configPath = join(cwd, ".mcp.json");
              break;
            case "user":
              // User-level MCPs are stored in ~/.claude.json (Claude Code settings),
              // not ~/.claude/.mcp.json
              s.configPath = join(home, ".claude.json");
              break;
            case "local":
              s.configPath = join(cwd, ".claude", ".mcp.json");
              break;
          }
        }
      }
      return statuses;
    } catch {
      return [];
    }
  }

  private async pushMcpStatus(threadId: string): Promise<void> {
    const servers = await this.getMcpStatusForThread(threadId);
    this.sendToRenderer(IPC_CHANNELS.MCP_STATUS_CHANGED, {
      threadId,
      servers,
    });
  }

  private sendToRenderer(
    channel: string,
    data: unknown,
    threadId?: string,
  ): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed())
      return;
    if (threadId) {
      this.window.webContents.send(channel, data, threadId);
    } else {
      this.window.webContents.send(channel, data);
    }
  }

  private notifyIfBackground(
    threadId: string,
    type: "permission" | "question" | "plan_review",
  ): void {
    if (this.window.isDestroyed() || this.window.isFocused()) return;

    // Debounce: skip if we've already fired a notification for this thread+type
    // within the cooldown window. Without this, a chatty agent (many tool
    // calls in a row) spawns a new NSUserNotification per call — each retains
    // a click-handler closure capturing `this.window` and `threadId`, and macOS
    // holds onto the NSObject until the user interacts. This is also the
    // suspected source of the `representedObject` log spam.
    const key = `${threadId}|${type}`;
    const now = Date.now();
    const last = this.lastNotificationAt.get(key) ?? 0;
    if (now - last < AgentManager.NOTIFICATION_COOLDOWN_MS) return;
    this.lastNotificationAt.set(key, now);

    const titles: Record<string, string> = {
      permission: "Permission Required",
      question: "Question from Agent",
      plan_review: "Plan Review Required",
    };
    const bodies: Record<string, string> = {
      permission: "A tool needs your approval to proceed.",
      question: "The agent has a question for you.",
      plan_review: "A plan is ready for your review.",
    };

    const notification = new Notification({
      title: titles[type],
      body: bodies[type],
    });
    // Drop refs to the notification + its click listener once macOS is done
    // with it. Without these handlers the closure (which captures `this.window`
    // and `threadId`) lives until the JS GC notices — which can be a long time
    // because Notification keeps an internal C++ reference.
    const drop = () => {
      notification.removeAllListeners();
      this.activeNotifications.delete(notification);
    };
    notification.on("click", () => {
      this.window.show();
      this.window.focus();
      this.sendToRenderer(IPC_CHANNELS.THREAD_ACTIVATE, { threadId });
      drop();
    });
    notification.on("close", drop);
    notification.on("failed", drop);
    this.activeNotifications.add(notification);
    notification.show();
  }

  private setPlanMarkdown(
    threadId: string,
    content: string,
    title: string,
  ): void {
    const session = this.sessions.get(threadId);
    if (!session) return;
    const capped =
      content.length > AgentManager.MAX_PLAN_CONTENT_BYTES
        ? content.slice(0, AgentManager.MAX_PLAN_CONTENT_BYTES) +
          "\n\n[… truncated — plan exceeds 500 KB]"
        : content;
    session.lastPlanMarkdown = { content: capped, title };
  }

  private hasPendingPlanReviewForThread(threadId: string): boolean {
    for (const pending of this.pendingPlanReviews.values()) {
      if (pending.threadId === threadId) return true;
    }
    return false;
  }

  private requestPlanReview(
    threadId: string | null,
    input: Record<string, unknown>,
  ): Promise<{
    approved: boolean;
    modifiedInput?: Record<string, unknown>;
    denyMessage?: string;
  }> {
    const requestId = `plan_review_${++this.planReviewCounter}`;
    this.notifyIfBackground(threadId ?? "", "plan_review");
    return new Promise((resolve) => {
      this.pendingPlanReviews.set(requestId, { resolve, threadId, input });
      this.pendingRequestCreatedAt.set(requestId, Date.now());
      const planMd = threadId
        ? this.sessions.get(threadId)?.lastPlanMarkdown
        : undefined;
      this.sendToRenderer(
        IPC_CHANNELS.PLAN_REVIEW,
        {
          requestId,
          input,
          ...(planMd
            ? {
                planContent: planMd.content,
                planTitle: planMd.title,
              }
            : {}),
        },
        threadId ?? undefined,
      );
    });
  }

  private requestUserAnswer(
    threadId: string | null,
    input: Record<string, unknown>,
  ): Promise<{ approved: boolean; modifiedInput?: Record<string, unknown> }> {
    const requestId = `question_${++this.questionCounter}`;
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, {
        threadId: threadId ?? "",
        resolve,
        input,
      });
      this.pendingRequestCreatedAt.set(requestId, Date.now());
      this.sendToRenderer(
        IPC_CHANNELS.ASK_USER_QUESTION,
        {
          requestId,
          input,
        },
        threadId ?? undefined,
      );
    });
  }

  private async detectOrphanedThreads(): Promise<void> {
    try {
      const threads = this.storage.listThreads();
      const orphanedIds: string[] = [];
      for (const thread of threads) {
        if (thread.sessionId && !this.activeStreams.has(thread.id)) {
          orphanedIds.push(thread.id);
        }
      }
      if (orphanedIds.length > 0) {
        // Delay slightly so renderer has time to initialize
        setTimeout(() => {
          this.sendToRenderer(IPC_CHANNELS.THREADS_ORPHANED, {
            threadIds: orphanedIds,
          });
        }, 2000);
      }
    } catch (err) {
      safeLog(console.error, "[agent-manager] orphan detection error:", err);
    }
  }

  private openPreviewFile(
    filePath: string,
    content: string,
    threadId: string,
  ): void {
    // Out-of-band file modifications are picked up by the renderer-side
    // fs.watchFile watcher in files.ipc.ts (FILES_FILE_WATCH_START), which
    // both FileExplorer and ArtifactEditorPreview consume. Keeping a second
    // fs.watch in the main process here just doubled the file-read + IPC
    // work on every Write tool result and contributed to the streaming
    // burst-allocation pattern documented in
    // docs/learnings/gc-memory-debugging.md.
    const fileName = basename(filePath);
    this.setPlanMarkdown(threadId, content, fileName);
    this.sendToRenderer(
      IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
      { content, title: fileName, filePath },
      threadId,
    );
  }

  /**
   * Best-effort GC nudge after the LAST stream ends. The streaming hot path
   * promotes a lot of short-lived strings (parsed SDK messages, IPC payloads,
   * tool I/O previews) into V8 old_space; without an explicit GC, V8 can sit
   * at the post-stream high-water mark for a long time, which means the next
   * stream starts with little headroom and runs hot toward the heap limit.
   * Requires the renderer/main to be launched with `--expose-gc` (wired in
   * packages/desktop/src/main/index.ts). No-op when unavailable.
   */
  private maybeRunPostStreamGc(): void {
    if (this.activeStreams.size > 0) return;
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== "function") return;
    try {
      gc();
    } catch {
      // best-effort; never let a GC error bubble out of stream cleanup
    }
  }

  /**
   * RSS safety valve: under sustained native-memory pressure, free EVERY
   * idle session (not just the surplus over MAX_IDLE_SESSIONS) and force a
   * GC. The crash-capture telemetry calls this when RSS stays above the
   * configured ceiling while no streams are running — exactly the "post-
   * spike, RSS stuck at 4 GB" pattern observed in May 2026 OOM crashes.
   *
   * Manager thread is exempt (mirrors evictIdleSessions). Returns the number
   * of sessions evicted so the caller can log it.
   */
  forceEvictAllIdleSessions(): number {
    const idleIds = this.sessionAccessOrder.filter((id) => {
      if (this.activeStreams.has(id) || !this.sessions.has(id)) return false;
      const thread = this.storage.getThread(id);
      if (thread?.isManagerThread) return false;
      return true;
    });
    for (const id of idleIds) {
      safeLog(
        console.log,
        `[agent-manager] RSS safety valve evicting idle session ${id}`,
      );
      this.clearSession(id);
    }
    if (idleIds.length > 0) {
      this.maybeRunPostStreamGc();
    }
    return idleIds.length;
  }

  /** Touch session in LRU order (most recent at end). */
  private touchSession(threadId: string): void {
    this.sessionAccessOrder = this.sessionAccessOrder.filter(
      (id) => id !== threadId,
    );
    this.sessionAccessOrder.push(threadId);
  }

  /** Evict idle sessions beyond MAX_IDLE_SESSIONS to prevent OOM. */
  private evictIdleSessions(): void {
    // Count idle sessions (not actively streaming, not the manager thread)
    const idleIds = this.sessionAccessOrder.filter((id) => {
      if (this.activeStreams.has(id) || !this.sessions.has(id)) return false;
      // Exempt manager thread from eviction
      const thread = this.storage.getThread(id);
      if (thread?.isManagerThread) return false;
      return true;
    });
    const toEvict = idleIds.length - AgentManager.MAX_IDLE_SESSIONS;
    if (toEvict <= 0) return;

    // Evict oldest idle sessions (front of the list = least recently used)
    const evictIds = idleIds.slice(0, toEvict);
    for (const id of evictIds) {
      safeLog(
        console.log,
        `[agent-manager] evicting idle session for thread ${id}`,
      );
      this.clearSession(id);
    }
  }

  /**
   * Run a prompt autonomously for a scheduled execution.
   * Auto-approves all tools, auto-declines AskUserQuestion and MCP elicitations.
   */
  async runScheduledPrompt(threadId: string, prompt: string): Promise<void> {
    let thread = await this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const streamId = `${threadId}-${Date.now()}`;

    // Get or create a session for this thread
    let session = this.sessions.get(threadId);
    if (!session) {
      const providerName = (thread.provider ?? "claude-code") as ProviderType;
      const provider = createProvider(providerName);
      const settings = loadSettings();
      const resolvedClaudeCliPath =
        providerName === "claude-code"
          ? await resolveClaudePathOrUndefined(
              settings.cliPath as string | undefined,
            )
          : undefined;
      const { overlay: agentOverlay } = await resolveAgentOverlay(thread);
      const threadCwd = thread.cwd ?? agentOverlay.cwd ?? process.env.HOME!;
      const builtMcpServers = buildMcpServers({
        cwd: threadCwd,
        providerName,
        socketPath: this.mcpSocketPath,
        sdkHandlers:
          providerName === "claude-code"
            ? createStratosHandlers({
                storage: this.storage,
                agentManager: this,
                window: this.window,
                sendToRenderer: (channel, data) =>
                  this.sendToRenderer(channel, data),
                includeManager: isManagerEnabled(),
              })
            : undefined,
      });
      const mcpServers = mergeAgentMcpServers(builtMcpServers, agentOverlay);
      await provider.initialize({
        ...(providerName === "claude-code"
          ? {
              cliPath: resolvedClaudeCliPath,
              settingSources: ["project", "user", "local"] as (
                | "project"
                | "user"
                | "local"
              )[],
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: mergeSystemPromptAppend(
                  [
                    `\n# Host Environment`,
                    `You are running inside Stratos as a scheduled automation (PID: ${process.pid}).`,
                    `DO NOT kill, terminate, or signal this process or its parent Electron process.`,
                    `DO NOT run broad process kills like \`pkill -f electron\`, \`killall Electron\`, or any command that could terminate Electron processes.`,
                    `If you need to stop a dev server or child process, target it by its specific PID or port, not by process name.`,
                    ``,
                    `# Stratos MCP`,
                    `The \`stratos\` MCP server exposes:`,
                    `- \`schedule_create\`, \`schedule_list\`, \`schedule_folders\` — manage scheduled prompts`,
                    `- \`schedule_report\` — call this at the end of your run with a 1-3 sentence summary of what you did. Look for a [SCHEDULED TASK] context block in your prompt with the scheduleId. Your summary is forwarded to the Manager as a status update.`,
                    `- \`preview_open_file(file_path, title?)\` / \`preview_close()\` — control the side preview pane (use absolute paths)`,
                  ].join("\n"),
                  agentOverlay,
                ),
              },
            }
          : {}),
        ...(providerName === "opencode"
          ? {
              opencodeConfig: {
                providers: getOpencodeProviderKeys(),
                customProviders: buildOllamaCustomProvider(),
              },
            }
          : {}),
        model: thread.model ?? agentOverlay.model,
        cwd: threadCwd,
        mcpServers,
        ...(agentOverlay.agents ? { agents: agentOverlay.agents } : {}),
      });
      session = { provider, sessionId: thread.sessionId };
      this.sessions.set(threadId, session);
    }

    this.touchSession(threadId);
    this.evictIdleSessions();

    this.activeStreams.add(threadId);
    this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
      threadId,
      isRunning: true,
    });

    // Autonomous permission handler: approve everything, auto-decline questions
    const permissionHandler: PermissionHandler = async (toolName, input) => {
      const name = effectiveToolName(toolName, input);
      if (name === "AskUserQuestion") {
        return { approved: false };
      }
      return { approved: true };
    };

    // Auto-decline MCP elicitations
    const onElicitation = async (): Promise<{
      action: "accept" | "decline" | "cancel";
    }> => {
      return { action: "decline" };
    };

    const mode = normalizeMode(thread.mode, thread.provider);
    this.threadEffectiveModes.set(threadId, mode);
    const params: SendMessageParams = {
      prompt,
      sessionId: session.sessionId,
      model: thread.model,
      cwd: thread.cwd ?? process.env.HOME,
      thinkingEffort: thread.thinkingEffort,
      mode,
      permissionHandler,
      onElicitation,
      traceCallback: (entry) => {
        appendTraceEntry(threadId, entry);
      },
    };

    try {
      for await (const msg of session.provider.sendMessage(params)) {
        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          { ...msg, _streamId: streamId },
          threadId,
        );
        if (msg.type === "session_init") {
          session.sessionId = msg.sessionId;
          try {
            this.storage.updateThread(threadId, { sessionId: msg.sessionId });
          } catch {}
          this.startMcpWatcher(threadId);
        }
      }
    } catch (err: any) {
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "error",
          message: err?.message ?? "Unknown error",
          code: "AGENT_ERROR",
          _streamId: streamId,
        },
        threadId,
      );
      throw err;
    } finally {
      this.activeStreams.delete(threadId);
      this.threadEffectiveModes.delete(threadId);
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
        threadId,
        isRunning: false,
      });
      this.maybeRunPostStreamGc();
    }
  }

  clearSession(threadId: string): void {
    // Invalidate stream ownership before disposing the provider. A late
    // finally from that stream must not drain queued work into a deleted or
    // reset thread.
    this.activeStreamIds.delete(threadId);
    this.activeStreams.delete(threadId);

    const session = this.sessions.get(threadId);
    if (session) {
      if (session.mcpWatcherTimer) {
        clearTimeout(session.mcpWatcherTimer);
        session.mcpWatcherTimer = undefined;
      }
      session.provider.dispose().catch(() => {});
      this.sessions.delete(threadId);
    }
    this.sessionAccessOrder = this.sessionAccessOrder.filter(
      (id) => id !== threadId,
    );
    this.threadEffectiveModes.delete(threadId);
    if (this.pendingByThread.delete(threadId)) {
      this.emitPendingChanged(threadId);
    }
    // Prune notification debounce entries for this thread to prevent the map
    // from growing forever as threads are created, used, and evicted.
    for (const key of this.lastNotificationAt.keys()) {
      if (key.startsWith(`${threadId}-`)) this.lastNotificationAt.delete(key);
    }
    this.rejectPendingForThread(threadId, "session cleared");
  }

  /**
   * Resolve and remove every pending* request that belongs to a thread.
   * Called when a session is evicted or a thread is deleted so that closures
   * in those Maps (which retain `input` payloads and keep runStream's async
   * generator alive) can finally be GC'd.
   */
  private rejectPendingForThread(threadId: string, reason: string): void {
    let count = 0;
    for (const [id, p] of this.pendingPermissions) {
      if (p.threadId === threadId) {
        p.resolve({ approved: false, denyMessage: reason });
        this.pendingPermissions.delete(id);
        this.pendingRequestCreatedAt.delete(id);
        count++;
      }
    }
    for (const [id, p] of this.pendingQuestions) {
      if (p.threadId === threadId) {
        p.resolve({ approved: false });
        this.pendingQuestions.delete(id);
        this.pendingRequestCreatedAt.delete(id);
        count++;
      }
    }
    for (const [id, p] of this.pendingPlanReviews) {
      if (p.threadId === threadId) {
        p.resolve({ approved: false, denyMessage: reason });
        this.pendingPlanReviews.delete(id);
        this.pendingRequestCreatedAt.delete(id);
        count++;
      }
    }
    for (const [id, p] of this.pendingElicitations) {
      if (p.threadId === threadId) {
        p.resolve({ action: "cancel" });
        this.pendingElicitations.delete(id);
        this.pendingRequestCreatedAt.delete(id);
        count++;
      }
    }
    if (count > 0) {
      safeLog(
        console.log,
        `[agent-manager] rejected ${count} pending request(s) for thread ${threadId} (${reason})`,
      );
    }
  }

  getRunningThreadIds(): string[] {
    return Array.from(this.activeStreams);
  }

  /**
   * Snapshot of in-memory collection sizes — used by crash-capture
   * telemetry so each memory log line / threshold heap dump records
   * "what was the app doing at this point". Cheap to call.
   */
  getDiagnosticState(): Record<string, number> {
    return {
      sessions: this.sessions.size,
      sessionAccessOrder: this.sessionAccessOrder.length,
      activeStreams: this.activeStreams.size,
      modelsCache: this.modelsCache.size,
      pendingPermissions: this.pendingPermissions.size,
      pendingQuestions: this.pendingQuestions.size,
      pendingPlanReviews: this.pendingPlanReviews.size,
      pendingElicitations: this.pendingElicitations.size,
      threadEffectiveModes: this.threadEffectiveModes.size,
      // Now reflects the renderer-driven fs.watchFile watchers in
      // files.ipc.ts (the only file-watcher path that survives — the old
      // per-thread fs.watch in this file was removed as redundant).
      previewFileWatchers: getFileWatcherCount(),
      completionListeners: this.completionListeners.size,
      cachedSlashCommands: this.cachedSlashCommands.length,
      activeNotifications: this.activeNotifications.size,
      lastNotificationAt: this.lastNotificationAt.size,
    };
  }

  /** Check if a thread is currently streaming. */
  isStreaming(threadId: string): boolean {
    return this.activeStreams.has(threadId);
  }

  /** Start a stream for a thread (used by ManagerSession bridge and MCP
   * handlers). `origin` defaults to "manager" because all current callers of
   * this public method are manager-driven; user-initiated runs go through
   * the IPC SEND_MESSAGE handler which calls runStream directly. */
  async startStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
    origin: RunOrigin = "manager",
  ): Promise<void> {
    return this.runStream(threadId, prompt, images, origin);
  }

  /** Interrupt a running session (used by ManagerSession bridge). */
  async interruptSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (session) {
      session.interruptRequested = true;
      try {
        await session.provider.interrupt();
      } catch {
        // Session may already be dead
      }
    }
  }

  // ────────────────────────── mid-turn messages ──────────────────────────

  /** Snapshot of the queued messages for a thread. */
  listPending(threadId: string): PendingMessage[] {
    return [...(this.pendingByThread.get(threadId) ?? [])];
  }

  private emitPendingChanged(threadId: string): void {
    this.sendToRenderer(IPC_CHANNELS.PENDING_CHANGED, {
      threadId,
      pending: this.listPending(threadId),
    });
  }

  private addPending(msg: PendingMessage): void {
    const list = this.pendingByThread.get(msg.threadId) ?? [];
    list.push(msg);
    // Cap the queue the same way ManagerSession caps notifications: an agent
    // that runs for twenty minutes invites a pile of messages that no longer
    // make sense together. Drop the oldest non-forced entry so a `break`
    // (which the user is actively waiting on) is never the one evicted.
    while (list.length > MAX_PENDING_PER_THREAD) {
      const idx = list.findIndex((m) => !m.force);
      const [dropped] = list.splice(idx === -1 ? 0 : idx, 1);
      safeLog(
        console.warn,
        `[agent-manager] pending queue at cap for thread ${msg.threadId}; dropped ${dropped?.id}`,
      );
    }
    this.pendingByThread.set(msg.threadId, list);
    this.emitPendingChanged(msg.threadId);
  }

  /**
   * Deliver a message that was typed while a turn may already be running.
   *
   * When the thread is idle this is just a normal send. When it is streaming,
   * `delivery` decides: `steer` tries to inject into the live turn and falls
   * back to queueing if the provider can't, `break` interrupts and delivers
   * immediately, and `queue` waits for the turn to finish on its own.
   */
  async enqueueMessage(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
    delivery: PendingDelivery = "queue",
    origin: RunOrigin = "user",
  ): Promise<EnqueueResult> {
    // Nothing running — this is an ordinary send.
    if (!this.activeStreams.has(threadId)) {
      this.runStream(threadId, prompt, images, origin, true).catch((err) => {
        safeLog(
          console.error,
          `[agent-manager] stream error for thread ${threadId}:`,
          err,
        );
      });
      return { status: "sent", fellBack: false };
    }

    if (delivery === "steer") {
      const session = this.sessions.get(threadId);
      const provider = session?.provider;

      // Some transports accept more input without reliably pre-empting the
      // output already being generated. Their declared strategy gives Steer
      // the expected UX meaning: interrupt, then deliver the correction as the
      // forced next turn. Live-capable providers preserve the current turn.
      if (provider?.midTurnSteering === "interrupt-and-restart") {
        const msg = this.makePending(
          threadId,
          prompt,
          images,
          "steer",
          false,
          true,
        );
        this.addPending(msg);
        await this.interruptSession(threadId);
        return { status: "queued", id: msg.id, fellBack: false };
      }

      if (provider?.midTurnSteering === "live" && provider.pushMessage) {
        try {
          const accepted = await provider.pushMessage(prompt, images);
          if (accepted) {
            // Mirror the steered text into the transcript so the user can see
            // what they said landed mid-turn rather than vanishing.
            this.sendToRenderer(
              IPC_CHANNELS.STREAM_MESSAGE,
              {
                type: "steered_message",
                content: prompt,
                images,
                _streamId: this.activeStreamIds.get(threadId),
              },
              threadId,
            );
            return { status: "steered", fellBack: false };
          }
        } catch (err) {
          safeLog(
            console.warn,
            `[agent-manager] steer failed for thread ${threadId}:`,
            err,
          );
        }
      }
      // Provider can't steer, or there was no live turn to steer after all.
      const msg = this.makePending(
        threadId,
        prompt,
        images,
        "steer",
        true,
        false,
      );
      this.addPending(msg);
      return { status: "queued", id: msg.id, fellBack: true };
    }

    const force = delivery === "break";
    const msg = this.makePending(
      threadId,
      prompt,
      images,
      delivery,
      false,
      force,
    );
    this.addPending(msg);

    if (force) {
      // Break: stop the current turn. The drain in runStream's finally honours
      // `force` even though interruptRequested is set, so this message still
      // goes out — unlike a plain queued one, which Stop intentionally drops.
      await this.interruptSession(threadId);
    }

    return { status: "queued", id: msg.id, fellBack: false };
  }

  private makePending(
    threadId: string,
    prompt: string,
    images: { dataUrl: string; mimeType: string }[] | undefined,
    requested: PendingDelivery,
    fellBack: boolean,
    force: boolean,
  ): PendingMessage {
    return {
      id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      threadId,
      prompt,
      ...(images && images.length > 0 ? { images } : {}),
      requested,
      fellBack,
      force,
      createdAt: Date.now(),
    };
  }

  /** Remove a queued message before it is delivered. */
  cancelPending(threadId: string, id: string): boolean {
    const list = this.pendingByThread.get(threadId);
    if (!list) return false;
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) this.pendingByThread.delete(threadId);
    this.emitPendingChanged(threadId);
    return true;
  }

  /**
   * Re-target a queued message: `steer` injects it into the running turn now,
   * `break` interrupts the turn and sends it immediately. Mirrors opencode's
   * inbox promotion endpoints, generalised across providers.
   */
  async promotePending(
    threadId: string,
    id: string,
    to: "steer" | "break",
  ): Promise<EnqueueResult | null> {
    const list = this.pendingByThread.get(threadId);
    const msg = list?.find((m) => m.id === id);
    if (!msg || !list) return null;

    if (to === "steer") {
      const provider = this.sessions.get(threadId)?.provider;

      // Providers that declare interrupt-and-restart promote by moving this
      // item to the front, marking it forced, and stopping the current turn.
      if (
        provider?.midTurnSteering === "interrupt-and-restart" &&
        this.activeStreams.has(threadId)
      ) {
        msg.force = true;
        list.splice(list.indexOf(msg), 1);
        list.unshift(msg);
        this.emitPendingChanged(threadId);
        await this.interruptSession(threadId);
        return { status: "queued", id: msg.id, fellBack: false };
      }

      if (
        provider?.midTurnSteering !== "live" ||
        !provider.pushMessage ||
        !this.activeStreams.has(threadId)
      ) {
        msg.fellBack = true;
        this.emitPendingChanged(threadId);
        return { status: "queued", id: msg.id, fellBack: true };
      }
      let accepted = false;
      try {
        accepted = await provider.pushMessage(msg.prompt, msg.images);
      } catch {
        accepted = false;
      }
      if (!accepted) {
        msg.fellBack = true;
        this.emitPendingChanged(threadId);
        return { status: "queued", id: msg.id, fellBack: true };
      }
      this.cancelPending(threadId, id);
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "steered_message",
          content: msg.prompt,
          images: msg.images,
          _streamId: this.activeStreamIds.get(threadId),
        },
        threadId,
      );
      return { status: "steered", fellBack: false };
    }

    // break — mark it forced so the drain honours it past the interrupt, then
    // move it to the front so it is the next thing delivered.
    msg.force = true;
    list.splice(list.indexOf(msg), 1);
    list.unshift(msg);
    this.emitPendingChanged(threadId);
    if (this.activeStreams.has(threadId)) {
      await this.interruptSession(threadId);
    }
    return { status: "queued", id: msg.id, fellBack: false };
  }

  /**
   * Deliver the next queued message for a thread, if any. Called from
   * runStream's finally once the turn has fully wound down.
   *
   * A plain queued message is dropped when the user interrupted — Stop should
   * mean stop. A `force` message (from break) is delivered anyway, since
   * interrupting is precisely what the user asked for.
   */
  private drainPending(threadId: string, interrupted: boolean): void {
    const list = this.pendingByThread.get(threadId);
    if (!list || list.length === 0) return;

    const idx = interrupted ? list.findIndex((m) => m.force) : 0;
    if (idx === -1) {
      // Interrupted with nothing forced: the queue is stale intent, drop it.
      this.pendingByThread.delete(threadId);
      this.emitPendingChanged(threadId);
      return;
    }

    const [next] = list.splice(idx, 1);
    if (list.length === 0) this.pendingByThread.delete(threadId);
    this.emitPendingChanged(threadId);

    this.runStream(threadId, next.prompt, next.images, "user", true).catch(
      (err) => {
        safeLog(
          console.error,
          `[agent-manager] queued message failed for thread ${threadId}:`,
          err,
        );
      },
    );
  }

  getSlashCommands(): { name: string; description?: string }[] {
    return this.cachedSlashCommands;
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    const provider = new ClaudeCodeProvider();
    const settings = loadSettings();
    const cliPath = await resolveClaudePathOrUndefined(
      settings.cliPath as string | undefined,
    );
    await provider.initialize({
      cliPath,
      settingSources: ["project", "user", "local"],
    });
    try {
      const commands = await provider.discoverSlashCommands();
      this.cachedSlashCommands = commands;
      // Broadcast to renderer
      this.sendToRenderer(IPC_CHANNELS.SLASH_COMMANDS_LIST, commands);
      return commands;
    } catch (err) {
      safeLog(
        console.error,
        "[agent-manager] Failed to discover slash commands:",
        err,
      );
      return [];
    } finally {
      await provider.dispose();
    }
  }

  /**
   * Reject and drop all pending* requests when the renderer goes away
   * (reload, navigation, crash). Without this, the closures retain `input`
   * payloads and `resolve` callbacks indefinitely — and the resolve callbacks
   * root the runStream async-generator state, so the SDK keeps streaming
   * into a void.
   */
  private rejectAllPendingForRendererGone(reason: string): void {
    const total =
      this.pendingPermissions.size +
      this.pendingQuestions.size +
      this.pendingPlanReviews.size +
      this.pendingElicitations.size;
    if (total === 0) return;
    safeLog(
      console.log,
      `[agent-manager] renderer ${reason} — rejecting ${total} pending request(s)`,
    );
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ approved: false, denyMessage: "renderer reloaded" });
    }
    for (const [, pending] of this.pendingQuestions) {
      pending.resolve({ approved: false });
    }
    for (const [, pending] of this.pendingPlanReviews) {
      pending.resolve({ approved: false, denyMessage: "renderer reloaded" });
    }
    for (const [, pending] of this.pendingElicitations) {
      pending.resolve({ action: "cancel" });
    }
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();
    this.pendingPlanReviews.clear();
    this.pendingElicitations.clear();
  }

  unregisterIpc(): void {
    ipcMain.removeHandler(IPC_CHANNELS.SEND_MESSAGE);
    ipcMain.removeHandler(IPC_CHANNELS.PENDING_ENQUEUE);
    ipcMain.removeHandler(IPC_CHANNELS.PENDING_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.PENDING_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.PENDING_PROMOTE);
    ipcMain.removeHandler(IPC_CHANNELS.INTERRUPT);
    ipcMain.removeHandler(IPC_CHANNELS.GET_AVAILABLE_MODELS);
    ipcMain.removeHandler(IPC_CHANNELS.THREADS_RECOVER_ORPHANED);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_SERVER_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_TOGGLE_SERVER);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_OPEN_CONFIG);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_RECONNECT_SERVER);
    ipcMain.removeHandler(IPC_CHANNELS.CONTEXT_USAGE_GET);
    ipcMain.removeAllListeners(IPC_CHANNELS.MCP_ELICITATION_RESPONSE);
    ipcMain.removeAllListeners(IPC_CHANNELS.TOOL_RESPONSE);
    ipcMain.removeAllListeners(IPC_CHANNELS.ASK_USER_RESPONSE);
    ipcMain.removeAllListeners(IPC_CHANNELS.PLAN_REVIEW_RESPONSE);
  }

  dispose(): void {
    // Reject pending promises before clearing
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ approved: false });
    }
    for (const [, pending] of this.pendingQuestions) {
      pending.resolve({ approved: false });
    }
    for (const [, pending] of this.pendingPlanReviews) {
      pending.resolve({ approved: false });
    }
    for (const [, pending] of this.pendingElicitations) {
      pending.resolve({ action: "decline" });
    }

    for (const [, session] of this.sessions) {
      session.provider.dispose().catch(() => {});
    }
    this.sessions.clear();
    this.activeStreams.clear();
    this.activeStreamIds.clear();
    this.pendingByThread.clear();
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();
    this.pendingPlanReviews.clear();
    this.pendingElicitations.clear();
    for (const n of this.activeNotifications) {
      try {
        n.removeAllListeners();
        n.close();
      } catch {}
    }
    this.activeNotifications.clear();
    this.lastNotificationAt.clear();
    if (this.idleEvictTimer) {
      clearInterval(this.idleEvictTimer);
      this.idleEvictTimer = undefined;
    }
    this.mcpSocketServer.close().catch(() => {});
    this.unregisterIpc();
  }
}

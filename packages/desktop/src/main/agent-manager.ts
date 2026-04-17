import { BrowserWindow, ipcMain, Notification, shell } from "electron";
import type { McpElicitationRequest } from "@stratosapp/core";
import { execSync } from "child_process";
import { mkdirSync, watch, promises as fsPromises } from "fs";
import type { FSWatcher } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../common/ipc-channels";
import {
  ClaudeCodeProvider,
  CodexProvider,
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
  PermissionHandler,
  SendMessageParams,
  ProviderType,
} from "@stratosapp/core";
import {
  loadSettings,
  setProviderSettings,
  getOpencodeProviderKeys,
  setOpencodeProviderKey,
  deleteOpencodeProviderKey,
  getOpencodeModelAllowlist,
  setOpencodeModelAllowlist,
  getOllamaConfig,
  setOllamaConfig,
  clearOllamaConfig,
} from "./settings/settings.store";
import type { OllamaConfig, OllamaModelInfo } from "./settings/settings.store";
import { resolveToolBehavior, effectiveToolName } from "./agent-session-logic";
import { resolveClaudePathOrUndefined } from "./integrations/claude-path";
import { getScheduleMcpPath } from "./scheduler/scheduler";

/**
 * Build explicit MCP servers for an agent session.
 *
 * Project-level (.mcp.json) and user-level (~/.claude/.mcp.json) servers are
 * auto-discovered by the SDK via `settingSources`, so we only need to inject
 * servers that can't be statically configured:
 *   - stratos-scheduler: always present, gives agents schedule_create/list/etc.
 *   - chrome-devtools: worktree mode only, for cross-worktree CDP debugging.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMcpServers(cwd: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servers: Record<string, any> = {
    "stratos-scheduler": {
      command: "node",
      args: [getScheduleMcpPath()],
    },
  };

  // Add chrome-devtools for cross-worktree debugging (ContextSphere pattern)
  if (process.env.STRATOS_WORKTREE) {
    try {
      let targetRoot: string;
      try {
        targetRoot = execSync("git rev-parse --show-toplevel", {
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

function extractContextLength(
  modelInfo: Record<string, unknown>,
  family: string,
): number | undefined {
  // Try family-specific key first (e.g. "gemma4.context_length")
  const familyKey = `${family}.context_length`;
  if (typeof modelInfo[familyKey] === "number") {
    return modelInfo[familyKey] as number;
  }
  // Fallback: search for any key ending in ".context_length"
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

/**
 * Discover Ollama models via /api/tags + /api/show per model.
 * Returns enriched model info with capabilities and context window.
 */
async function discoverOllamaModels(
  baseURL: string,
): Promise<OllamaModelInfo[]> {
  const tagsResp = await fetch(`${baseURL}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!tagsResp.ok) {
    throw new Error(`Ollama not reachable at ${baseURL} (${tagsResp.status})`);
  }
  const { models } = (await tagsResp.json()) as {
    models: {
      name: string;
      size: number;
      details?: {
        family?: string;
        parameter_size?: string;
        quantization_level?: string;
      };
    }[];
  };

  // Enrich each model with capabilities + context window from /api/show
  return Promise.all(
    models.map(async (m) => {
      const family = m.details?.family ?? "";
      try {
        const showResp = await fetch(`${baseURL}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m.name }),
          signal: AbortSignal.timeout(5000),
        });
        const show = (await showResp.json()) as {
          capabilities?: string[];
          model_info?: Record<string, unknown>;
        };
        const caps: string[] = show.capabilities ?? [];
        const ctxLen = extractContextLength(show.model_info ?? {}, family);

        return {
          name: m.name,
          size: m.size,
          parameterSize: m.details?.parameter_size ?? "unknown",
          family,
          quantization: m.details?.quantization_level ?? "unknown",
          capabilities: {
            vision: caps.includes("vision"),
            tools: caps.includes("tools"),
            thinking: caps.includes("thinking"),
          },
          contextLength: ctxLen ?? 131072,
        };
      } catch {
        // If /api/show fails for a model, return with safe defaults
        return {
          name: m.name,
          size: m.size,
          parameterSize: m.details?.parameter_size ?? "unknown",
          family,
          quantization: m.details?.quantization_level ?? "unknown",
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
}

export class AgentManager {
  private window: BrowserWindow;
  private sessions = new Map<string, ThreadSession>();
  private sessionAccessOrder: string[] = []; // LRU tracking: most recent at end
  private static readonly MAX_IDLE_SESSIONS = 3;
  private activeStreams = new Set<string>();
  private modelsCache = new Map<string, { models: unknown[]; ts: number }>();
  private static readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private storage: FileStorageAdapter;
  private pendingPermissions = new Map<
    string,
    {
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
  private lastPlanMarkdown: { content: string; title: string } | null = null;
  private previewFileWatchers = new Map<string, FSWatcher>();
  private cachedSlashCommands: { name: string; description?: string }[] = [];

  constructor(window: BrowserWindow, storage?: FileStorageAdapter) {
    this.window = window;
    this.storage = storage ?? new FileStorageAdapter();
    this.registerIpc();
    this.detectOrphanedThreads().catch((err) => {
      safeLog(console.error, "[agent-manager] orphan detection failed:", err);
    });
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
        // Fire-and-forget: start streaming in background, return immediately
        this.runStream(threadId, prompt, images).catch((err) => {
          safeLog(
            console.error,
            `[agent-manager] stream error for thread ${threadId}:`,
            err,
          );
        });
      },
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
        const provider = createProvider(key as ProviderType);
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
            const allowlist = getOpencodeModelAllowlist();
            models = models.filter((m) =>
              allowlist.includes(m.value.split("/")[0]),
            );
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
        // Free plan markdown memory — it's been sent to the renderer already
        this.lastPlanMarkdown = null;

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
                this.sendToRenderer(
                  IPC_CHANNELS.STREAM_MESSAGE,
                  {
                    type: "user_message",
                    content: "Implement the plan",
                  },
                  threadId,
                );
                this.runStream(threadId, "Implement the plan").catch((err) => {
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

  private async runStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> {
    // Each new stream attempt clears any prior interrupt intent so that a
    // user-triggered stop followed by a fresh send works correctly.
    const sessionAtStart = this.sessions.get(threadId);
    if (sessionAtStart) sessionAtStart.interruptRequested = false;

    // When set to true in the stale-session catch branch, the finally block
    // skips cleanup so it doesn't send isRunning:false while the retry runs.
    let isRetrying = false;

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

    // Generate a unique ID for this stream so the renderer can discard
    // late-arriving events from a previous (interrupted) stream on the same thread.
    // Declared here (before worktree creation) so worktree progress messages can carry it.
    const streamId = `${threadId}-${Date.now()}`;

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

        execSync(`git worktree add -b "${branchName}" "${worktreeDir}"`, {
          cwd: thread.cwd,
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        });

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
      const threadCwd = thread.cwd ?? process.env.HOME!;
      const mcpServers = buildMcpServers(threadCwd);
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
                append: [
                  `\n# Host Environment`,
                  `You are running inside Stratos, an Electron desktop application (PID: ${process.pid}).`,
                  `DO NOT kill, terminate, or signal this process or its parent Electron process.`,
                  `DO NOT run broad process kills like \`pkill -f electron\`, \`killall Electron\`, or any command that could terminate Electron processes — this would kill your own host application.`,
                  `If you need to stop a dev server or child process, target it by its specific PID or port, not by process name.`,
                  ``,
                  `# Scheduled Prompts`,
                  `You have access to the \`stratos-scheduler\` MCP which lets you create and manage scheduled prompts:`,
                  `- \`schedule_create\` — create a recurring or one-shot scheduled prompt (call \`schedule_folders\` first to get a valid folder)`,
                  `- \`schedule_list\` — list all scheduled prompts with status and last-run info`,
                  `- \`schedule_delete\` — permanently delete a schedule by ID`,
                  `- \`schedule_enable\` / \`schedule_disable\` — toggle a schedule on/off without deleting it`,
                  `- \`schedule_folders\` — list available folders (id, name, path)`,
                  `Each schedule fires in a new Stratos thread. Use the folder or cwd argument to control which folder the thread appears in.`,
                ].join("\n"),
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
        model: thread.model,
        cwd: threadCwd,
        mcpServers,
      });
      session = { provider, sessionId: thread.sessionId };
      this.sessions.set(threadId, session);
    }

    // Update LRU tracking and evict idle sessions to prevent OOM
    this.touchSession(threadId);
    this.evictIdleSessions();

    // Track active stream
    this.activeStreams.add(threadId);

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
        this.pendingPermissions.set(requestId, { resolve });
      });
    };

    const onElicitation = async (
      request: McpElicitationRequest,
    ): Promise<{
      action: "accept" | "decline" | "cancel";
      content?: Record<string, unknown>;
    }> => {
      if (request.mode === "url" && request.url) {
        // Open auth URL in default browser
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
        this.pendingElicitations.set(requestId, { resolve });
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
        this.lastPlanMarkdown = { content: planContent, title: planTitle };
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
      // If the error is due to a stale session (process exited), retry once
      // without the sessionId so a fresh session is started.
      // Do NOT retry if the user explicitly interrupted — provider.interrupt()
      // kills the subprocess which also raises "process exited", and we must
      // not mistake a user stop for a dead session.
      const isStaleSession =
        session.sessionId &&
        !session.interruptRequested &&
        typeof err?.message === "string" &&
        /process exited|exited with code/i.test(err.message);

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
        this.activeStreams.delete(threadId);
        this.threadEffectiveModes.delete(threadId);
        return this.runStream(threadId, prompt, images);
      }

      if (!specificErrorSent) {
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
      if (!isRetrying) {
        this.activeStreams.delete(threadId);
        this.threadEffectiveModes.delete(threadId);
        this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
          threadId,
          isRunning: false,
        });
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

  private async getMcpStatusForThread(threadId: string): Promise<unknown[]> {
    const session = this.sessions.get(threadId);
    if (!session?.provider.getMcpServerStatus) return [];
    try {
      const statuses = await session.provider.getMcpServerStatus();
      const thread = await this.storage.getThread(threadId);
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
    notification.on("click", () => {
      this.window.show();
      this.window.focus();
      this.sendToRenderer(IPC_CHANNELS.THREAD_ACTIVATE, { threadId });
    });
    notification.show();
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
      this.sendToRenderer(
        IPC_CHANNELS.PLAN_REVIEW,
        {
          requestId,
          input,
          ...(this.lastPlanMarkdown
            ? {
                planContent: this.lastPlanMarkdown.content,
                planTitle: this.lastPlanMarkdown.title,
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
      this.pendingQuestions.set(requestId, { resolve, input });
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
    const fileName = basename(filePath);
    this.lastPlanMarkdown = { content, title: fileName };
    this.sendToRenderer(
      IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
      { content, title: fileName, filePath },
      threadId,
    );
    this.watchPreviewFile(filePath, threadId);
  }

  private watchPreviewFile(filePath: string, threadId: string): void {
    // Replace any existing watcher for this thread
    this.previewFileWatchers.get(threadId)?.close();

    let debounce: NodeJS.Timeout | null = null;
    let watcher: FSWatcher;
    try {
      watcher = watch(filePath, { persistent: false }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          try {
            const content = await fsPromises.readFile(filePath, "utf-8");
            const fileName = basename(filePath);
            this.lastPlanMarkdown = { content, title: fileName };
            this.sendToRenderer(
              IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
              { content, title: fileName, filePath },
              threadId,
            );
          } catch {
            // file deleted or unreadable — ignore
          }
        }, 150);
      });
    } catch {
      // File doesn't exist or is inaccessible — skip watching
      return;
    }

    watcher.on("error", () => watcher.close());
    this.previewFileWatchers.set(threadId, watcher);
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
      const threadCwd = thread.cwd ?? process.env.HOME!;
      const mcpServers = buildMcpServers(threadCwd);
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
                append: [
                  `\n# Host Environment`,
                  `You are running inside Stratos as a scheduled automation (PID: ${process.pid}).`,
                  `DO NOT kill, terminate, or signal this process or its parent Electron process.`,
                  `DO NOT run broad process kills like \`pkill -f electron\`, \`killall Electron\`, or any command that could terminate Electron processes.`,
                  `If you need to stop a dev server or child process, target it by its specific PID or port, not by process name.`,
                  ``,
                  `# Scheduled Prompts`,
                  `You have access to the \`stratos-scheduler\` MCP to create additional schedules:`,
                  `- \`schedule_create\` — schedule a new prompt`,
                  `- \`schedule_list\` — list existing schedules`,
                  `- \`schedule_folders\` — list available folders`,
                ].join("\n"),
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
        model: thread.model,
        cwd: threadCwd,
        mcpServers,
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
    }
  }

  clearSession(threadId: string): void {
    this.previewFileWatchers.get(threadId)?.close();
    this.previewFileWatchers.delete(threadId);

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
  }

  getRunningThreadIds(): string[] {
    return Array.from(this.activeStreams);
  }

  /** Check if a thread is currently streaming. */
  isStreaming(threadId: string): boolean {
    return this.activeStreams.has(threadId);
  }

  /** Start a stream for a thread (used by ManagerSession bridge). */
  async startStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> {
    return this.runStream(threadId, prompt, images);
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

  unregisterIpc(): void {
    ipcMain.removeHandler(IPC_CHANNELS.SEND_MESSAGE);
    ipcMain.removeHandler(IPC_CHANNELS.INTERRUPT);
    ipcMain.removeHandler(IPC_CHANNELS.GET_AVAILABLE_MODELS);
    ipcMain.removeHandler(IPC_CHANNELS.THREADS_RECOVER_ORPHANED);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_SERVER_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_TOGGLE_SERVER);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_OPEN_CONFIG);
    ipcMain.removeHandler(IPC_CHANNELS.MCP_RECONNECT_SERVER);
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
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();
    this.pendingPlanReviews.clear();
    this.pendingElicitations.clear();
    this.unregisterIpc();
  }
}

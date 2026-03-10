import { BrowserWindow, ipcMain, Notification, shell } from "electron";
import type { McpElicitationRequest } from "@stratosapp/core";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../common/ipc-channels";
import {
  ClaudeCodeProvider,
  CodexProvider,
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
  PermissionHandler,
  SendMessageParams,
  ProviderType,
} from "@stratosapp/core";
import { loadSettings } from "./settings/settings.store";
import { resolveToolBehavior, effectiveToolName } from "./agent-session-logic";

/**
 * Build explicit MCP servers for an agent session.
 *
 * Project-level (.mcp.json) and user-level (~/.claude/.mcp.json) servers are
 * auto-discovered by the SDK via `settingSources`, so we
 * only need to inject servers that can't be statically configured — currently
 * just chrome-devtools for cross-worktree debugging.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMcpServers(cwd: string): Record<string, any> | undefined {
  // Add chrome-devtools for cross-worktree debugging (ContextSphere pattern)
  if (!process.env.STRATOS_WORKTREE) return undefined;

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
      return {
        "chrome-devtools": {
          command: "npx",
          args: [
            "chrome-devtools-mcp",
            `--browser-url=http://127.0.0.1:${cdpPort}`,
          ],
        },
      };
    }
  } catch {}

  return undefined;
}

function safeLog(fn: (...args: unknown[]) => void, ...args: unknown[]) {
  try {
    fn(...args);
  } catch (e: any) {
    if (e?.code !== "EPIPE") throw e;
  }
}

interface ThreadSession {
  provider: AgentProvider;
  sessionId?: string;
  abortController?: AbortController;
}

export class AgentManager {
  private window: BrowserWindow;
  private sessions = new Map<string, ThreadSession>();
  private activeStreams = new Set<string>();
  private storage = new FileStorageAdapter();
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
  private elicitationCounter = 0;
  private questionCounter = 0;
  private planReviewCounter = 0;
  private lastPlanMarkdown: { content: string; title: string } | null = null;
  private cachedSlashCommands: { name: string; description?: string }[] = [];

  constructor(window: BrowserWindow) {
    this.window = window;
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
          await session.provider.interrupt();
        }
      },
    );

    ipcMain.handle(
      IPC_CHANNELS.GET_AVAILABLE_MODELS,
      async (_event, providerName?: string) => {
        const provider = createProvider(
          (providerName ?? "claude-code") as ProviderType,
        );
        const settings = loadSettings();
        await provider.initialize({
          cliPath: settings.cliPath as string | undefined,
        });
        try {
          return await provider.getAvailableModels();
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

        switch (data.decision.type) {
          case "clear-bypass":
          case "bypass":
            if (threadId) {
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
  }

  private async runStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> {
    let thread = await this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Lazy worktree creation: if user selected worktree mode but no worktree exists yet
    if (thread.worktreeMode === "worktree" && !thread.worktree && thread.cwd) {
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "worktree_progress",
          step: "Creating git worktree...",
          status: "running",
        },
        threadId,
      );

      try {
        const shortId = threadId.slice(-7);
        const branchName = `stratos/${shortId}`;
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
      const threadCwd = thread.cwd ?? process.env.HOME!;
      const mcpServers = buildMcpServers(threadCwd);
      await provider.initialize({
        ...(providerName === "claude-code"
          ? {
              cliPath: settings.cliPath as string | undefined,
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
                ].join("\n"),
              },
            }
          : {}),
        model: thread.model,
        cwd: threadCwd,
        ...(mcpServers ? { mcpServers } : {}),
      });
      session = { provider, sessionId: thread.sessionId };
      this.sessions.set(threadId, session);
    }

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
      const currentMode = normalizeMode(currentThread?.mode, currentProvider);

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
    let latestPlanContent = "";
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

    try {
      for await (const msg of session.provider.sendMessage(params)) {
        this.sendToRenderer(IPC_CHANNELS.STREAM_MESSAGE, msg, threadId);

        if (msg.type === "error") {
          specificErrorSent = true;
        }

        if (mode === "plan" && msg.type === "plan_update") {
          sawPlanUpdate = true;
          if (msg.content) {
            latestPlanContent += msg.content;
          }
        }

        // Track plan markdown for artifact viewer
        if (
          msg.type === "tool_use" &&
          msg.toolName === "Write" &&
          typeof msg.input?.file_path === "string" &&
          msg.input.file_path.endsWith(".md") &&
          typeof msg.input?.content === "string"
        ) {
          const filePath = msg.input.file_path as string;
          const content = msg.input.content as string;
          const fileName = filePath.split("/").pop() ?? filePath;
          this.lastPlanMarkdown = { content, title: fileName };
          this.sendToRenderer(
            IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN,
            {
              content,
              title: fileName,
              filePath,
            },
            threadId,
          );
        }

        // Track session ID from init message
        if (msg.type === "session_init") {
          session.sessionId = msg.sessionId;
          // Persist sessionId to thread for resume
          try {
            this.storage.updateThread(threadId, { sessionId: msg.sessionId });
          } catch {}
          // Notify renderer of session readiness
          this.sendToRenderer(
            IPC_CHANNELS.SESSION_READY,
            {
              sessionId: msg.sessionId,
              tools: (msg as any).tools ?? [],
            },
            threadId,
          );
        }
      }

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
      if (!specificErrorSent) {
        this.sendToRenderer(
          IPC_CHANNELS.STREAM_MESSAGE,
          {
            type: "error",
            message: err?.message ?? "Unknown error",
            code: "AGENT_ERROR",
          },
          threadId,
        );
      }
    } finally {
      this.activeStreams.delete(threadId);
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
        threadId,
        isRunning: false,
      });
    }
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
              s.configPath = join(home, ".claude", ".mcp.json");
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

  clearSession(threadId: string): void {
    const session = this.sessions.get(threadId);
    if (session) {
      session.provider.dispose().catch(() => {});
      this.sessions.delete(threadId);
    }
  }

  getRunningThreadIds(): string[] {
    return Array.from(this.activeStreams);
  }

  getSlashCommands(): { name: string; description?: string }[] {
    return this.cachedSlashCommands;
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    const provider = new ClaudeCodeProvider();
    const settings = loadSettings();
    await provider.initialize({
      cliPath: settings.cliPath as string | undefined,
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

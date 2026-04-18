/**
 * Singleton Manager Agent session.
 *
 * The Manager is a thin orchestrator that uses MCP tools to control other
 * agent sessions. It runs under ~/.stratos/manager/ and is always non-blocking.
 */
import { BrowserWindow } from "electron";
import { writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentManager } from "../agent-manager";
import {
  createProvider,
  FileStorageAdapter,
  appendTraceEntry,
} from "@stratosapp/core";
import type {
  AgentProvider,
  AgentMessage,
  ProviderType,
} from "@stratosapp/core";
import { ManagerBridge } from "./manager-bridge";
import { MANAGER_MCP_SOURCE } from "./manager-mcp-source";
import { resolveClaudePathOrUndefined } from "../integrations/claude-path";
import { loadSettings } from "../settings/settings.store";
import { getOpencodeProviderKeys } from "../settings/settings.store";
import { getScheduleMcpPath } from "../scheduler/scheduler";

const MANAGER_DIR = join(homedir(), ".stratos", "manager");
const MANAGER_SOCK = join(MANAGER_DIR, "manager.sock");
const MANAGER_MCP_BIN = join(
  homedir(),
  ".stratos",
  "bin",
  "stratos-manager-mcp",
);

const MANAGER_SYSTEM_PROMPT = `You are the Stratos Manager — a session orchestrator for AI coding agents.

## Your Role
- You manage agent sessions on behalf of the user
- You do NOT write code, analyze files, or do technical work yourself
- You dispatch tasks to agent sessions using your tools
- You report results clearly and concisely

## Guidelines
- When the user describes a task, create a session in the appropriate workspace
- When unsure which workspace, ask the user
- When unsure which provider, default to claude-code
- Always confirm before deleting sessions or workspaces
- When reporting session status, summarize the agent's recent activity
- If a session has errors, offer to restart it

## Conversational Relay
When the user wants you to tell an agent something or ask an agent a question:
- Use send_message to dispatch the prompt — it returns immediately
- Tell the user the message was sent
- When they ask what happened, use get_session with includeTranscript: true
- Summarize the agent's recent activity from the transcript — don't dump it raw
- If the user says "tell cosmic-fox to X", send exactly X as the prompt — don't rephrase

## Checking on Sessions
- If the user asks "what did X do?" or "is X done?", use get_session
- Read the summary, status, and currentActivity fields first
- Only request the transcript if you need more detail to answer the user's question

## Available Providers
- claude-code: Anthropic's Claude with full tool use (default for coding tasks)
- opencode: Multi-model provider (OpenAI, Gemini, etc.)
- codex: OpenAI's Codex agent

## Session Modes
- plan: Read-only, agent creates a plan for review
- default: Each tool requires user approval
- acceptEdits: Auto-approve file/shell operations
- bypassPermissions: Full automation, no approvals`;

export class ManagerSession {
  private static instance: ManagerSession | null = null;

  private agentManager: AgentManager;
  private storage: FileStorageAdapter;
  private window: BrowserWindow;
  private bridge: ManagerBridge;

  private threadId: string | null = null;
  private provider: AgentProvider | null = null;
  private currentProvider: ProviderType = "claude-code";
  private sessionId: string | undefined;
  private activeStream = false;

  private constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.window = window;
    this.bridge = new ManagerBridge(agentManager, storage, MANAGER_SOCK);
  }

  static initialize(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ): ManagerSession {
    if (ManagerSession.instance) {
      return ManagerSession.instance;
    }

    const session = new ManagerSession(agentManager, storage, window);
    session.setup();
    ManagerSession.instance = session;
    return session;
  }

  static getInstance(): ManagerSession | null {
    return ManagerSession.instance;
  }

  private setup(): void {
    // Ensure directories exist
    mkdirSync(MANAGER_DIR, { recursive: true });
    mkdirSync(join(homedir(), ".stratos", "bin"), { recursive: true });

    // Install MCP server script
    writeFileSync(MANAGER_MCP_BIN, MANAGER_MCP_SOURCE, "utf-8");
    chmodSync(MANAGER_MCP_BIN, 0o755);

    // Start the UDS bridge
    this.bridge.start();

    // Find or create the manager thread
    const threads = this.storage.listThreads();
    const existing = threads.find((t) => t.isManagerThread);
    if (existing) {
      this.threadId = existing.id;
      this.currentProvider =
        (existing.provider as ProviderType) ?? "claude-code";
    }
  }

  /** Get or create the manager thread ID. */
  async getThreadId(): Promise<string> {
    if (this.threadId) return this.threadId;

    const thread = this.storage.createThread(
      "Manager",
      undefined,
      MANAGER_DIR,
      this.currentProvider,
    );

    this.storage.updateThread(thread.id, {
      isManagerThread: true,
      mode: "bypassPermissions",
    });

    this.threadId = thread.id;
    return thread.id;
  }

  get isActive(): boolean {
    return this.activeStream;
  }

  /** Send a message to the Manager Agent. */
  async send(
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> {
    const threadId = await this.getThreadId();

    if (this.activeStream) {
      console.warn("[manager-session] already streaming, ignoring send");
      return;
    }

    this.activeStream = true;
    this.sendToRenderer(IPC_CHANNELS.MANAGER_STATUS, {
      isActive: true,
      threadId,
    });

    try {
      // Ensure provider session exists
      if (!this.provider) {
        await this.initProvider();
      }

      const streamId = `manager-${Date.now()}`;

      // Build user message for renderer
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "user_message",
          content: prompt,
          images: images ?? [],
          _streamId: streamId,
        },
        threadId,
      );

      const stream = this.provider!.sendMessage({
        prompt,
        sessionId: this.sessionId,
        model: this.storage.getThread(threadId)?.model,
        cwd: MANAGER_DIR,
        mode: "bypassPermissions",
        images,
        permissionHandler: async () => ({
          approved: true,
        }),
        onElicitation: async () => ({
          action: "decline" as const,
        }),
        traceCallback: (entry) => {
          appendTraceEntry(threadId, entry);
        },
      });

      for await (const msg of stream) {
        this.handleMessage(msg, threadId, streamId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[manager-session] stream error:", message);
      this.sendToRenderer(
        IPC_CHANNELS.STREAM_MESSAGE,
        {
          type: "error",
          message,
          _streamId: `manager-${Date.now()}`,
        },
        threadId,
      );

      // Reset provider on error so it reinitializes next time
      if (this.provider) {
        try {
          await this.provider.dispose();
        } catch {}
        this.provider = null;
        this.sessionId = undefined;
      }
    } finally {
      this.activeStream = false;
      this.sendToRenderer(IPC_CHANNELS.MANAGER_STATUS, {
        isActive: false,
        threadId,
      });
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
        threadId,
        isRunning: false,
      });
    }
  }

  /** Interrupt the current Manager stream. */
  async interrupt(): Promise<void> {
    if (this.provider && this.activeStream) {
      try {
        await this.provider.interrupt();
      } catch {}
    }
  }

  /** Switch the Manager's provider. */
  async switchProvider(provider: ProviderType, model?: string): Promise<void> {
    // Dispose current provider
    if (this.provider) {
      try {
        await this.provider.dispose();
      } catch {}
      this.provider = null;
      this.sessionId = undefined;
    }

    this.currentProvider = provider;

    // Update the thread
    const threadId = await this.getThreadId();
    this.storage.updateThread(threadId, { provider, model });
  }

  dispose(): void {
    this.bridge.stop();
    if (this.provider) {
      this.provider.dispose().catch(() => {});
      this.provider = null;
    }
    ManagerSession.instance = null;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async initProvider(): Promise<void> {
    const threadId = await this.getThreadId();
    const thread = this.storage.getThread(threadId);
    const providerName = this.currentProvider;

    this.provider = createProvider(providerName);

    const settings = loadSettings();
    const cliPath =
      providerName === "claude-code"
        ? await resolveClaudePathOrUndefined(
            settings.cliPath as string | undefined,
          )
        : undefined;

    const opencodeConfig =
      providerName === "opencode"
        ? { providers: getOpencodeProviderKeys() }
        : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpServers: Record<string, any> = {
      "stratos-manager": {
        command: "node",
        args: [MANAGER_MCP_BIN],
        env: { STRATOS_MANAGER_SOCK: MANAGER_SOCK },
      },
      "stratos-scheduler": {
        command: "node",
        args: [getScheduleMcpPath()],
      },
    };

    await this.provider.initialize({
      model: thread?.model,
      cwd: MANAGER_DIR,
      systemPrompt: MANAGER_SYSTEM_PROMPT,
      mcpServers,
      settingSources: ["user"],
      cliPath,
      ...(opencodeConfig ? { opencodeConfig } : {}),
    });
  }

  private handleMessage(
    msg: AgentMessage,
    threadId: string,
    streamId: string,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enriched = { ...msg, _streamId: streamId } as any;

    if (msg.type === "session_init") {
      this.sessionId = msg.sessionId;
    }

    // Forward all messages through the standard STREAM_MESSAGE channel
    // so the existing useChat hook works for the manager thread
    this.sendToRenderer(IPC_CHANNELS.STREAM_MESSAGE, enriched, threadId);

    // Also send running state
    if (msg.type === "session_init") {
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
        threadId,
        isRunning: true,
      });
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.webContents.send(channel, ...args);
      } catch {}
    }
  }
}

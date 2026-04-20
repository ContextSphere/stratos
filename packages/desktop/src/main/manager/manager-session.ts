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
import type { AgentManager, StreamCompletedEvent } from "../agent-manager";
import {
  createProvider,
  FileStorageAdapter,
  appendTraceEntry,
} from "@stratosapp/core";
import type {
  AgentProvider,
  AgentMessage,
  McpServerInfo,
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

const MANAGER_SYSTEM_PROMPT = `You are the Stratos Manager — a session orchestrator for AI coding agents. You are NOT a coding assistant, designer, planner, reviewer, or analyst.

## Hard constraints
- Your ONLY actions are the \`stratos-manager\` and \`stratos-scheduler\` MCP tools. Everything else you do is short conversational text to the user.
- You NEVER write, edit, read, analyze, or explain code yourself.
- You NEVER produce designs, design docs, design proposals, design reviews, architecture docs, plans, RFCs, technical analyses, code reviews, "here's how I would do X" walkthroughs, bullet-pointed proposals, or any other intellectual product that a coding agent could produce. ALL of those are dispatchable work.
- You NEVER offer to "build", "scaffold", "implement", "set up", "wire up", "design", "plan", "draft", "outline", "propose", "review", or "fix" anything directly. That is the job of agent sessions.
- If the user asks for a design, plan, architecture, review, analysis, proposal, or walkthrough, you MUST dispatch it: create a session with an appropriate prompt (often in \`acceptEdits\` or \`bypassPermissions\` mode so the agent can write the design to a file), then tell the user where it lives. Do not produce the content yourself even in the chat.
- If the user asks for technical work (anything that would normally require Bash/Read/Write/Edit/Grep), you MUST refuse to do it yourself and instead offer to dispatch it to a session. Template: "I don't do that directly — I dispatch it. Which workspace should I create a session in, and what exactly should the agent do?"
- If the user asks "what is your role?" or similar, answer ONLY in terms of session orchestration. Do not describe capabilities you don't have.

## Decision rule
Before every reply that goes beyond a single sentence, ask yourself: "Could an agent session produce this better?" If the answer is yes (or even maybe), STOP, do not write it, and instead dispatch.

## What you do
- Create, list, inspect, send-message-to, stop, and delete agent sessions via \`mcp__stratos-manager__*\`.
- Manage workspaces (list/create/remove) and show a dashboard overview.
- Relay messages between the user and sessions.
- Summarize session transcripts when the user asks what an agent did.
- Schedule recurring triggers via \`mcp__stratos-scheduler__*\` when the user asks.

## Conversational relay
- "Tell cosmic-fox to X" → call \`send_message\` with prompt exactly "X". Don't rephrase. Then tell the user it was sent.
- "What did X do?" / "is X done?" → call \`get_session\`. Read summary/status/currentActivity first; only pull the transcript if needed.
- Always confirm before \`delete_session\` or \`remove_workspace\`.

## Defaults
- Unsure which workspace? Ask the user.
- Unsure which provider? Default to \`claude-code\`.
- Unsure which mode? For design/plan work, default to \`acceptEdits\` so the agent can write files. For code changes requiring caution, default to \`default\` (prompts on each tool).

## Providers you can assign to sessions
- \`claude-code\`: Anthropic's Claude with full tool use (default for coding tasks)
- \`opencode\`: Multi-model provider (OpenAI, Gemini, etc.)
- \`codex\`: OpenAI's Codex agent

## Session modes you can assign
- \`plan\`: read-only planning
- \`default\`: prompts for each tool
- \`acceptEdits\`: auto-approves edits, prompts for shell
- \`bypassPermissions\`: full automation

## Examples of correct behavior
- User: "Design a feature X for me." → You: "Got it. Which workspace? I'll spin up an agent to produce the design doc." → create_session with prompt "Produce a detailed design for feature X at docs/design-x.md".
- User: "Walk me through how auth works." → You: "That's agent work. Which workspace is the auth code in? I'll have an agent read it and write a walkthrough." → create_session.
- User: "What do you think about approach Y vs Z?" → You: "I don't weigh in on technical tradeoffs — I dispatch. Want me to start an agent to analyze both approaches and write up a comparison?"

## Examples of WRONG behavior (never do these)
- Producing a "Design Proposal" section in chat — always dispatch.
- Writing bullet lists of "Feature 1 Problem… Feature 2 Solution…" — always dispatch.
- Offering "here's how I'd approach this" followed by an explanation — always dispatch.
- Starting any reply with "Great, let's think through…" or "Here's a detailed breakdown…" — those are red flags that you're about to do the work yourself.`;

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
  private notificationQueue: Array<{ prompt: string }> = [];
  private completionUnsub?: () => void;

  private constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.window = window;
    this.bridge = new ManagerBridge(
      agentManager,
      storage,
      MANAGER_SOCK,
      window,
    );
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
      // Restore the stored sessionId so the next send resumes the SDK
      // session rather than starting a fresh one, preserving history
      // across app restarts.
      this.sessionId = existing.sessionId;
    }

    // Auto-report child session completions to the Manager. When any thread
    // spawned via create_session finishes, inject a directive into the
    // Manager chat so it can summarise the result for the user — no polling.
    this.completionUnsub = this.agentManager.onStreamCompleted((event) =>
      this.handleChildCompletion(event),
    );
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

  /** MCP server status for the Manager's provider — used by the ToolsPopover. */
  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.provider?.getMcpServerStatus) return [];
    try {
      return await this.provider.getMcpServerStatus();
    } catch {
      return [];
    }
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

      // Reset provider on error so it reinitializes next time.
      // CRITICAL: do NOT clear this.sessionId — the next send should still
      // resume the original SDK session so prior conversation context
      // survives the error. Overwriting it here caused every error to
      // fork a brand-new session, orphaning the transcript and making
      // the manager appear to "forget" everything.
      if (this.provider) {
        try {
          await this.provider.dispose();
        } catch {}
        this.provider = null;
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
      // Any child-completion notifications that queued up while this turn
      // was active now get a chance to run.
      this.drainNotificationQueue();
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
    this.completionUnsub?.();
    this.completionUnsub = undefined;
    this.bridge.stop();
    if (this.provider) {
      this.provider.dispose().catch(() => {});
      this.provider = null;
    }
    ManagerSession.instance = null;
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Called when any thread's stream finishes. If the thread was spawned via
   * the Manager's create_session MCP tool, inject a notification so the
   * Manager can fetch the transcript and summarise for the user.
   */
  private handleChildCompletion(event: StreamCompletedEvent): void {
    const thread = this.storage.getThread(event.threadId);
    if (!thread || thread.spawnedBy !== "manager") return;
    if (thread.reportedToManager) return;

    // Set the flag before queueing so a crash between here and the inject
    // won't cause duplicate notifications on restart. Accepted tradeoff:
    // may rarely miss a notification if the process dies mid-call.
    this.storage.updateThread(event.threadId, { reportedToManager: true });

    const title = thread.title?.trim() || event.threadId;
    const provider = thread.provider ?? "claude-code";
    const statusLine =
      event.status === "completed"
        ? "finished successfully"
        : event.status === "interrupted"
          ? "was interrupted"
          : `ended with an error${event.errorMessage ? ` (${event.errorMessage})` : ""}`;

    const directive = [
      `[stratos-notification] session="${event.threadId}" title="${title}" provider="${provider}" status="${event.status}"`,
      "",
      `Session "${title}" (threadId: ${event.threadId}, provider: ${provider}) ${statusLine}.`,
      `Use mcp__stratos-manager__get_session with includeTranscript=true to fetch the result, then give the user a concise 2–3 sentence summary of what the agent did and any notable output. If the session errored, say so.`,
    ].join("\n");

    this.notificationQueue.push({ prompt: directive });
    this.drainNotificationQueue();
  }

  private drainNotificationQueue(): void {
    if (this.activeStream) return;
    const next = this.notificationQueue.shift();
    if (!next) return;
    // Schedule on next tick so the caller's finally (which clears
    // activeStream) has fully unwound before we start the next turn.
    setImmediate(() => {
      this.send(next.prompt).catch((err) => {
        console.error(
          "[manager-session] failed to dispatch child-completion notification:",
          err,
        );
      });
    });
  }

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
      // Strip all built-in tools (Bash, Read, Write, Edit, Grep, etc.) so
      // the manager can only dispatch via its MCP tools. Empty array passes
      // `tools: []` to the SDK, disabling built-ins; MCP tools remain
      // available because they're registered via mcpServers.
      allowedTools: [],
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
      // Persist the sessionId on the thread so useChat can re-load the
      // SDK transcript when the user switches to another thread and back.
      // Without this, loadMessages → sdkMessagesToStored(thread.sessionId)
      // has no sessionId and returns [], wiping the manager's chat history.
      try {
        this.storage.updateThread(threadId, { sessionId: msg.sessionId });
      } catch {
        // Non-fatal — history won't restore on next switch but live stream
        // continues to work.
      }
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

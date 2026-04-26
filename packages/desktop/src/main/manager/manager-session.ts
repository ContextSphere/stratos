/**
 * Singleton Manager Agent session.
 *
 * The Manager is a thin orchestrator that uses MCP tools to control other
 * agent sessions. It runs under ~/.stratos/manager/ and is always non-blocking.
 */
import { BrowserWindow } from "electron";
import { mkdirSync } from "fs";
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
import { resolveClaudePathOrUndefined } from "../integrations/claude-path";
import { loadSettings } from "../settings/settings.store";
import { getOpencodeProviderKeys } from "../settings/settings.store";
import { createStratosHandlers } from "../mcp/handlers";
import { handlersToSdkMcp } from "../mcp/sdk-adapter";
import { getStratosMcpPath, getStratosMcpSocketPath } from "../mcp/stdio-proxy";
import { getWorktreeInfo } from "@stratosapp/core";
import { clearManagerTurnImages, setManagerTurnImages } from "./turn-state";
import { setManagerRef } from "./manager-ref";

const MANAGER_DIR = join(homedir(), ".stratos", "manager");

const MANAGER_SYSTEM_PROMPT = `You are the Stratos Manager — a session orchestrator for AI coding agents. You are NOT a coding assistant, designer, planner, reviewer, or analyst.

## Hard constraints
- Your PRIMARY actions are the \`stratos\` MCP tools (\`mcp__stratos__*\`) — creating, listing, inspecting, messaging, and stopping agent sessions.
- You DO have access to built-in tools (Bash, Read, Grep, Glob, WebFetch, etc.) but ONLY for lightweight orchestration-support investigation: fetching a PR via \`gh\`, checking a file path exists, grepping for a symbol to decide which session to route to, etc. Use them when the context genuinely helps you dispatch better — not as a shortcut to doing the work yourself.
- You NEVER write, edit, or author code, designs, design docs, design proposals, design reviews, architecture docs, plans, RFCs, technical analyses, code reviews, "here's how I would do X" walkthroughs, bullet-pointed proposals, or any other intellectual product that a coding agent could produce. ALL of those are dispatchable work.
- You NEVER offer to "build", "scaffold", "implement", "set up", "wire up", "design", "plan", "draft", "outline", "propose", "review", or "fix" anything directly. That is the job of agent sessions.
- If the user asks for a design, plan, architecture, review, analysis, proposal, or walkthrough, you MUST dispatch it: create a session with an appropriate prompt (often in \`acceptEdits\` or \`bypassPermissions\` mode so the agent can write the design to a file), then tell the user where it lives. Do not produce the content yourself even in the chat.
- If the user asks for substantive technical work (anything beyond a quick \`gh\`/\`grep\`-style lookup), dispatch it. Template: "I don't do that directly — I dispatch it. Which workspace should I create a session in, and what exactly should the agent do?"
- If the user asks "what is your role?" or similar, answer in terms of session orchestration (including the supporting investigation you do to orchestrate well).

## Investigation before dispatch
You may (and often should) do quick context-gathering before dispatching:
- \`gh pr list --author @me\`, \`gh pr view <n>\`, \`gh issue view\` to understand PRs/issues referenced by the user.
- \`Read\`/\`Grep\`/\`Glob\` to identify the right workspace or confirm a file path before creating a session.
- \`mcp__stratos__search_sessions\` / \`list_sessions\` to find the right existing thread to continue (thread affinity).
- \`WebFetch\` to pull a linked spec/doc the agent will need.
Keep this investigation tight: gather JUST enough context to route correctly or to write a precise prompt, then dispatch. Do not expand the investigation into the actual task.

## Fan-out pattern
When the user asks you to act on multiple items (e.g. "summarize each of my open PRs"), the correct pattern is:
1. Use a built-in tool (e.g. \`gh pr list --author @me --json number,title,url,headRefName\`) to enumerate the items yourself.
2. Spawn ONE session per item via \`mcp__stratos__create_session\`, each with a focused prompt containing the specific item's context (PR number, URL, etc.).
3. Report back to the user which sessions were spawned. Do NOT summarize the items yourself — that's the spawned agents' job.

## Decision rule
Before every reply that goes beyond a single sentence, ask yourself: "Could an agent session produce this better?" If the answer is yes (or even maybe), STOP, do not write it, and instead dispatch.

## What you do
- Create, list, inspect, send-message-to, stop, and delete agent sessions via \`mcp__stratos__{create,list,get,send_message_to,stop,delete}_session\`.
- Manage workspaces (list/create/remove) via \`mcp__stratos__{list,create,remove}_workspace\` and show a dashboard via \`mcp__stratos__get_dashboard\`.
- Relay messages between the user and sessions.
- Summarize session transcripts when the user asks what an agent did.
- Schedule recurring triggers via \`mcp__stratos__schedule_*\` when the user asks.

## Conversational relay
- "Tell cosmic-fox to X" → call \`send_message\` with prompt exactly "X". Don't rephrase. Then tell the user it was sent.
- "What did X do?" / "is X done?" → call \`get_session\`. Read summary/status/currentActivity first; only pull the transcript if needed.
- Always confirm before \`delete_session\` or \`remove_workspace\`.

## Defaults
- Unsure which workspace? Ask the user.
- Unsure which provider? Default to \`claude-code\`.
- Unsure which mode? For design/plan work, default to \`acceptEdits\` so the agent can write files. For code changes requiring caution, default to \`default\` (prompts on each tool).

## Thread affinity
When a session was used to produce design, research, or planning for a feature, that same session should be given the implementation task — not a new session. Use \`send_message\` to continue work in the existing session rather than spinning up a fresh one. Related work belongs in the same thread so the agent retains full context from prior turns and does not duplicate effort or contradict earlier decisions. Only create a new session when the work is genuinely unrelated to any existing session.

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
- User: "Summarize the status of each of my open PRs." → You: run \`gh pr list --author @me --json number,title,url,headRefName,repository\`; then for each PR, call \`create_session\` with a prompt like "Summarize the current status of PR #<n> at <url>: CI, review comments, mergeability, what's blocking it." → Report the list of spawned sessions back to the user.

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

  private threadId: string | null = null;
  private provider: AgentProvider | null = null;
  private currentProvider: ProviderType = "claude-code";
  private sessionId: string | undefined;
  private activeStream = false;
  private gatewayReplyFn: ((reply: string) => void) | null = null;
  private notificationForwardFn: ((text: string) => Promise<void>) | null =
    null;
  private notificationQueue: Array<{ prompt: string }> = [];
  private completionUnsub?: () => void;
  private isNotificationInFlight = false;
  private notificationBackoffUntil = 0;

  /**
   * "remote" — Manager replies and notifications are forwarded to WhatsApp.
   * "local"  — User is actively using the Stratos UI; nothing goes to WhatsApp.
   *
   * Starts remote so that async notifications fire on boot before the user
   * has touched the UI. Switches to local the moment sendFromUI is called.
   * An idle timer resets back to remote after 5 minutes of UI inactivity.
   */
  private mode: "remote" | "local" = "remote";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  private constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.window = window;
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
    setManagerRef(session);
    return session;
  }

  static getInstance(): ManagerSession | null {
    return ManagerSession.instance;
  }

  private setup(): void {
    // Ensure directories exist (the unified socket + stdio proxy install
    // happens in AgentManager's constructor; manager just reuses them).
    mkdirSync(MANAGER_DIR, { recursive: true });

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
    // Register images so the stratos MCP handlers can inject them into any
    // create_session or send_message tool calls the Manager LLM makes during
    // this turn — both the in-process SDK adapter (claude-code) and the
    // Unix-socket server (codex/opencode) read from the same module-level
    // turn-state singleton.
    setManagerTurnImages(images);
    this.sendToRenderer(IPC_CHANNELS.MANAGER_STATUS, {
      isActive: true,
      threadId,
    });

    let replyText = "";

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

      // When images are attached, tell the Manager LLM they will be forwarded
      // automatically — it doesn't need to re-encode them in tool call params.
      // Prepend as a bracketed note so it's visible alongside the user's message.
      const imageHint =
        images && images.length > 0
          ? `[Note: The user has attached ${images.length} image${images.length === 1 ? "" : "s"} to this message. They will be automatically forwarded to any agent sessions you create or message during this turn — you do not need to include image data in your tool call parameters. You can describe the image content in the prompt you send to child agents.]\n\n`
          : "";

      const stream = this.provider!.sendMessage({
        prompt: imageHint + prompt,
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

      let currentBlock = "";
      const textBlocks: string[] = [];
      for await (const msg of stream) {
        this.handleMessage(msg, threadId, streamId);
        if (msg.type === "text") {
          currentBlock += msg.content;
          if (!msg.isStreaming && currentBlock.trim()) {
            textBlocks.push(currentBlock.trim());
            currentBlock = "";
          }
        } else if (msg.type === "result") {
          if (currentBlock.trim()) {
            textBlocks.push(currentBlock.trim());
            currentBlock = "";
          }
        }
      }
      if (currentBlock.trim()) textBlocks.push(currentBlock.trim());
      replyText = textBlocks.join("\n\n");
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
      // Clear turn images so they don't leak into subsequent turns.
      clearManagerTurnImages();
      this.sendToRenderer(IPC_CHANNELS.MANAGER_STATUS, {
        isActive: false,
        threadId,
      });
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, {
        threadId,
        isRunning: false,
      });
      // Forward reply to WhatsApp gateway if one is registered.
      // Always call to resolve the pending Promise — an empty replyText
      // means the Manager used tools only or errored; send a fallback so
      // the WhatsApp user isn't left with a hanging "typing..." indicator.
      if (this.gatewayReplyFn) {
        const fn = this.gatewayReplyFn;
        this.gatewayReplyFn = null;
        fn(replyText || "Stratos processed your request.");
      }
      // When the turn was triggered by a child-completion notification
      // (isNotificationInFlight is still true at this point — drained to
      // false by drainNotificationQueue's own .finally()), forward the
      // Manager's summary to WhatsApp so the user gets an async update.
      if (
        this.isNotificationInFlight &&
        this.notificationForwardFn &&
        replyText &&
        this.mode === "remote"
      ) {
        const forwardFn = this.notificationForwardFn;
        forwardFn(replyText).catch((err) => {
          console.error(
            "[manager-session] failed to forward notification to WhatsApp:",
            err,
          );
        });
      }
      // Any child-completion notifications that queued up while this turn
      // was active now get a chance to run.
      this.drainNotificationQueue();
    }
  }

  /**
   * Called by the Stratos UI. Switches to local mode (stops WhatsApp
   * forwarding) and resets the idle timer that switches back to remote.
   *
   * The idle timer is deliberately started AFTER the stream finishes, not on
   * submit. Starting it on submit means a stream that runs longer than
   * IDLE_TIMEOUT_MS would flip mode back to "remote" mid-turn, causing
   * child-completion notifications to be forwarded to WhatsApp while the user
   * is actively using the UI.
   */
  async sendFromUI(
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[],
  ): Promise<void> {
    this.gatewayReplyFn = null;
    // Suppress WhatsApp forwarding immediately, but do NOT start the idle
    // countdown yet — the stream hasn't finished.
    this.mode = "local";
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    try {
      await this.send(prompt, images);
    } finally {
      // Start the inactivity countdown only after the stream ends so the
      // 5-minute window measures idle time after the turn, not elapsed time
      // since submit.
      this.resetIdleTimer();
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // After 5 minutes of UI inactivity, revert to remote so async
    // notifications reach WhatsApp again.
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.mode = "remote";
    }, ManagerSession.IDLE_TIMEOUT_MS);
  }

  /**
   * Route a message from the WhatsApp gateway into the Manager.
   * Calls onReply when the Manager finishes producing a response.
   */
  async sendFromGateway(
    prompt: string,
    onReply: (reply: string) => void,
  ): Promise<void> {
    this.gatewayReplyFn = onReply;
    await this.send(prompt);
  }

  /**
   * Register a function that receives the Manager's reply text whenever a
   * child-completion notification turn finishes. WhatsApp IPC uses this to
   * forward async summaries back to the last sender's JID.
   */
  setNotificationForward(fn: ((text: string) => Promise<void>) | null): void {
    this.notificationForwardFn = fn;
    if (fn) {
      // A WhatsApp message just arrived — switch to remote immediately and
      // cancel any pending idle-back timer.
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = null;
      this.mode = "remote";
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

  /**
   * Switch the Manager's provider. Fully resets session state — different
   * providers have incompatible conversation persistence (Claude SDK JSONL
   * vs. Codex disk vs. Opencode disk), so carrying state across a switch
   * produces broken transcripts. User explicitly opted into the reset.
   */
  async switchProvider(provider: ProviderType, model?: string): Promise<void> {
    const threadId = await this.getThreadId();

    // 1. Tear down the in-memory provider + session state.
    if (this.provider) {
      try {
        await this.provider.dispose();
      } catch {}
    }
    this.provider = null;
    this.sessionId = undefined;
    this.notificationQueue = [];
    this.isNotificationInFlight = false;
    this.notificationBackoffUntil = 0;
    this.currentProvider = provider;

    // 2. Wipe persisted state that belongs to the old provider.
    //    clearPersistedSessionId removes thread.sessionId so loadMessages
    //    doesn't try to fetch an orphaned SDK transcript.
    //    clearThreadMessages removes the disk messages file used by
    //    codex/opencode; no-op for claude-code threads.
    this.storage.clearPersistedSessionId(threadId);
    this.storage.clearThreadMessages(threadId);
    this.storage.updateThread(threadId, {
      provider,
      model,
      sessionTools: undefined,
    });

    // 3. Tell the renderer to refresh. THREADS_CHANGED refreshes the
    //    sidebar thread list (picks up the new provider badge).
    //    THREAD_MESSAGES_RELOAD tells useChat to re-read the transcript
    //    for this thread — since we cleared the sessionId and wiped disk
    //    messages, loadMessages returns [] and the chat view goes blank.
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.THREADS_CHANGED);
      this.window.webContents.send(IPC_CHANNELS.THREAD_MESSAGES_RELOAD, {
        threadId,
      });
    }
  }

  dispose(): void {
    this.completionUnsub?.();
    this.completionUnsub = undefined;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
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
      `Use mcp__stratos__get_session with includeTranscript=true to fetch the result, then give the user a concise 2–3 sentence summary of what the agent did and any notable output. If the session errored, say so.`,
    ].join("\n");

    this.notificationQueue.push({ prompt: directive });
    this.drainNotificationQueue();
  }

  private drainNotificationQueue(): void {
    if (this.activeStream || this.isNotificationInFlight) return;
    if (Date.now() < this.notificationBackoffUntil) return;
    const next = this.notificationQueue[0];
    if (!next) return;
    // Dequeue now; we'll re-queue at the front if send() fails.
    this.notificationQueue.shift();
    this.isNotificationInFlight = true;
    // Schedule on next tick so the caller's finally (which clears
    // activeStream) has fully unwound before we start the next turn.
    setImmediate(() => {
      this.send(next.prompt)
        .catch((err) => {
          console.error(
            "[manager-session] failed to dispatch child-completion notification:",
            err,
          );
          // Re-queue at the front so the notification isn't lost. Apply a
          // backoff so a broken provider doesn't spin in a tight retry loop;
          // the next user-triggered send() will retry after the window clears.
          this.notificationQueue.unshift(next);
          this.notificationBackoffUntil = Date.now() + 10_000;
        })
        .finally(() => {
          // send()'s own finally already called drainNotificationQueue while
          // isNotificationInFlight was true (a no-op). Now that we've cleared
          // the flag, schedule one more drain to pick up any queued items.
          this.isNotificationInFlight = false;
          if (!this.activeStream && this.notificationQueue.length > 0) {
            setImmediate(() => this.drainNotificationQueue());
          }
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

    // Unified `stratos` MCP for all three providers:
    //   - claude-code: in-process SDK MCP (policy-safe).
    //   - codex/opencode: stdio proxy → unified Unix socket → main.
    const stratosSocketPath = getStratosMcpSocketPath(getWorktreeInfo().hash);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpServers: Record<string, any> =
      providerName === "claude-code"
        ? {
            stratos: handlersToSdkMcp(
              "stratos",
              "1.0.0",
              createStratosHandlers({
                storage: this.storage,
                agentManager: this.agentManager,
                window: this.window,
                sendToRenderer: (channel, data) => {
                  if (
                    !this.window.isDestroyed() &&
                    !this.window.webContents.isDestroyed()
                  ) {
                    this.window.webContents.send(channel, data);
                  }
                },
              }),
            ),
          }
        : {
            stratos: {
              command: "node",
              args: [getStratosMcpPath()],
              env: { STRATOS_MCP_SOCK: stratosSocketPath },
            },
          };

    await this.provider.initialize({
      model: thread?.model,
      cwd: MANAGER_DIR,
      systemPrompt: MANAGER_SYSTEM_PROMPT,
      mcpServers,
      settingSources: ["user"],
      cliPath,
      // Manager has full built-in tools (Bash, Read, Grep, WebFetch, etc.)
      // so it can do lightweight investigation (fetch a PR, inspect a file,
      // search transcripts) before orchestrating. The system prompt keeps
      // intellectual/code-producing work off the manager and routed to
      // dispatched sessions.
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

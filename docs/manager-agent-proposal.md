# Manager Agent — Design Proposal

**Status:** Draft  
**Date:** 2026-04-17  
**Author:** ajprakas

---

## 1. Overview

The Manager Agent is a singleton orchestrator that gives the user a single conversational interface to control all Stratos agent sessions. Instead of interacting with agents individually through the UI, the user talks to the Manager and it handles the rest — starting sessions, routing tasks to the right agent, querying status, stopping work, creating workspaces, and anything else the UI can do today.

**Core principle:** The Manager Agent is a _thin orchestrator_. It doesn't write code itself. It parses user intent, dispatches to worker agents, and reports results. Think of it as `tmux` for AI agents — session management through natural language.

### Key Properties

| Property                          | Value                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| **Singleton**                     | Exactly one Manager Agent instance exists at a time                                  |
| **Stateless between invocations** | Not a continuously-running agent — wakes on user request, orchestrates, goes idle    |
| **Provider-agnostic**             | Can use any provider (claude-code, opencode, codex); provider switchable mid-session |
| **Workspace**                     | Runs under `~/.stratos/manager/` — no project-specific working directory             |
| **Capabilities**                  | Everything the UI can do, exposed as tools                                           |

---

## 2. Industry Research

### 2.1 Relevant Patterns

| Framework                          | Pattern                                                   | Relevance to Manager Agent                               |
| ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| **Anthropic Orchestrator-Workers** | Central agent uses tools to spawn/query/terminate workers | Direct match — this is the pattern we're implementing    |
| **AutoGen GroupChatManager**       | Thin routing agent that doesn't participate in work       | Validates the "thin orchestrator" approach               |
| **LangGraph Supervisor**           | Graph node with `route_to_agent(name, task)` tools        | Tool-schema design inspiration                           |
| **CrewAI Hierarchical Process**    | Manager delegates to role-based agents                    | Role assignment per workspace                            |
| **OpenAI Swarm**                   | Peer-to-peer handoffs, no central controller              | Counter-pattern — we explicitly want centralized control |
| **Cursor Background Agents**       | Multiple isolated agents with a status panel              | UI pattern for showing orchestrated sessions             |

### 2.2 Key Takeaways

1. **Tools are the interface.** Every successful orchestration framework exposes agent management as structured tool calls, not free-form text. The Manager Agent needs a clean tool schema for session lifecycle operations.

2. **The orchestrator must be thin.** AutoGen, LangGraph, and Anthropic's own docs all converge: the manager should parse intent, select a tool, dispatch, and report. If it starts doing the actual work, it becomes a bottleneck and loses context on the orchestration picture.

3. **Provider switching = new session + context transfer.** No framework handles provider switching within a session gracefully. The practical pattern is: create a new session with the target provider, optionally summarize and transfer context from the old session.

4. **Session persistence is table stakes.** LangGraph's checkpointing and AutoGen's StateStore both prioritize the ability to serialize and resume multi-agent state. Stratos already has this via `FileStorageAdapter` + SDK session resume.

5. **Singleton constraint simplifies everything.** Unlike CrewAI/AutoGen which need complex agent graphs, a singleton Manager with direct tool access to existing infrastructure avoids distributed coordination problems entirely.

---

## 3. Architecture

### 3.1 Where It Lives

```
┌─────────────────────────────────────────────────────────┐
│                      User                                │
│              (UI chat or keyboard shortcut)               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              Manager Agent Session                        │
│                                                           │
│  Provider: opencode (default) / claude-code / codex      │
│  CWD: ~/.stratos/manager/                                │
│  Mode: bypassPermissions (for management tools)          │
│  Tools: management tool suite (see §4)                   │
│                                                           │
│  System Prompt:                                          │
│    "You are a session manager for Stratos. You do NOT    │
│     write code yourself. You use your tools to create,   │
│     query, and control agent sessions on behalf of the   │
│     user. Always confirm destructive operations."        │
└────────┬────────┬────────┬────────┬─────────────────────┘
         │        │        │        │
    ┌────▼──┐ ┌──▼───┐ ┌──▼───┐ ┌──▼────────────┐
    │Agent 1│ │Agent 2│ │Agent 3│ │ ... Agent N   │
    │(thread)│ │(thread)│ │(thread)│ │              │
    └───────┘ └───────┘ └───────┘ └───────────────┘
```

### 3.2 Integration with Existing Architecture

The Manager Agent is **not** a new architectural layer. It's a special agent session that uses custom MCP tools wired to `AgentManager`'s existing capabilities. This keeps the blast radius small — we're adding tools, not restructuring the core.

```
                    ┌──────────────────────────────┐
                    │     Manager Agent Session     │
                    │   (AgentProvider instance)    │
                    └──────────────┬───────────────┘
                                   │ tool calls
                    ┌──────────────▼───────────────┐
                    │   Manager MCP Server          │
                    │   (stratos-manager-mcp)       │
                    │                               │
                    │   Exposes management ops as   │
                    │   MCP tools (JSON-RPC)        │
                    └──────────────┬───────────────┘
                                   │ direct function calls
                    ┌──────────────▼───────────────┐
                    │   AgentManager + Storage      │
                    │   (existing infrastructure)   │
                    └──────────────────────────────┘
```

**Why an MCP server?** The Manager Agent is just another agent session — it uses a provider (`sendMessage`) which streams tool calls. By exposing management operations as MCP tools, the agent can call them naturally. This follows the same pattern as `stratos-scheduler` MCP, which already gives agents schedule management tools.

### 3.3 Component Breakdown

| Component             | Package   | What It Does                                                                     |
| --------------------- | --------- | -------------------------------------------------------------------------------- |
| `ManagerSession`      | `desktop` | Singleton lifecycle — create/resume/dispose the manager's agent session          |
| `stratos-manager-mcp` | `desktop` | MCP server exposing management tools; calls into AgentManager and StorageAdapter |
| `ManagerIpcHandlers`  | `desktop` | IPC handlers for renderer to talk to / stop / query the manager                  |
| Manager UI            | `ui`      | Dedicated panel or chat thread for manager interaction                           |

### 3.4 Singleton Enforcement

```typescript
class ManagerSession {
  private static instance: ManagerSession | null = null;
  private session: { provider: AgentProvider; threadId: string } | null = null;
  private currentProvider: ProviderType = "opencode";

  static getInstance(): ManagerSession {
    if (!ManagerSession.instance) {
      ManagerSession.instance = new ManagerSession();
    }
    return ManagerSession.instance;
  }

  /** Is the manager currently processing a request? */
  get isActive(): boolean { ... }

  /** Send a message to the manager. Creates session on first use. */
  async send(prompt: string, images?: ImageInput[]): Promise<AsyncGenerator<AgentMessage>> { ... }

  /** Switch provider for the next invocation. Current session is disposed. */
  async switchProvider(provider: ProviderType, model?: string): Promise<void> { ... }

  /** Dispose the current session (agent goes idle). */
  async dispose(): Promise<void> { ... }
}
```

**Idle behavior:** After completing a request, the Manager's provider session stays alive (for session resume / context continuity) but is not actively streaming. The LRU eviction in `AgentManager` may reclaim it if other sessions need the slot — that's fine, the Manager can recreate its session on the next invocation.

---

## 4. Tool Schema (MCP)

The Manager Agent's power comes from its tools. These map 1:1 to existing `AgentManager` + `StorageAdapter` operations.

### 4.1 Session Lifecycle

```typescript
// Start a new agent session in a workspace
tool create_session {
  input: {
    workspace: string;           // Absolute path to working directory
    prompt: string;              // Initial prompt to send
    provider?: ProviderType;     // Default: "claude-code"
    model?: string;              // Default: provider's default
    mode?: AgentMode;            // Default: "default"
    title?: string;              // Thread title (auto-generated if omitted)
    images?: ImageInput[];       // Optional image attachments
    worktreeMode?: "local" | "worktree";  // Git worktree isolation
  }
  output: {
    threadId: string;
    status: "started";
  }
}

// Send a follow-up message to an existing session (always non-blocking)
tool send_message {
  input: {
    threadId: string;
    prompt: string;
    images?: ImageInput[];
  }
  output: {
    status: "sent" | "queued";   // "queued" if session is mid-stream
  }
}

// Stop a running session gracefully
tool stop_session {
  input: { threadId: string }
  output: { status: "stopped" | "was_not_running" }
}

// Delete a session and its data
tool delete_session {
  input: { threadId: string }
  output: { status: "deleted" }
}
```

**The Manager never blocks.** Every tool returns immediately. The pattern for conversational relay is:

1. `send_message` — fire the prompt to the session
2. Manager tells the user it's dispatched
3. User (or Manager, on next turn) calls `get_session` to check status and read the response

This keeps the Manager always responsive — it can dispatch to 5 sessions, respond to the user, and check on them later, all without ever waiting.

### 4.2 Session Query

```typescript
// List all sessions with status (paginated)
tool list_sessions {
  input: {
    filter?: {
      workspace?: string;        // Filter by cwd
      provider?: ProviderType;
      status?: "running" | "idle" | "error";
    }
    limit?: number;              // Max results per page (default: 20, max: 50)
    cursor?: string;             // Opaque cursor from previous response
    sortBy?: "lastActivity" | "createdAt" | "title";  // Default: lastActivity (desc)
  }
  output: {
    sessions: Array<{
      threadId: string;
      title: string;
      summary: string;           // Human-readable summary of what the session is doing/did
      workspace: string;
      provider: ProviderType;
      model?: string;
      status: "running" | "idle" | "error";
      lastActivity: string;      // ISO timestamp
      messageCount: number;
    }>
    totalCount: number;          // Total matching sessions (so Manager can say "showing 20 of 143")
    nextCursor?: string;         // Omitted on last page
    hasMore: boolean;
  }
}

// Get detailed status + recent transcript of a session
tool get_session {
  input: {
    threadId: string;
    includeTranscript?: boolean;  // Include last N messages
    transcriptLimit?: number;     // Default: 20
  }
  output: {
    thread: Thread;
    summary: string;             // Human-readable summary (see §4.6)
    status: "running" | "idle" | "error";
    currentActivity?: string;    // What the agent is doing right now (if running)
    recentMessages?: StoredMessage[];
    tools?: string[];            // Available tools in session
    mcpServers?: McpServerInfo[];
  }
}

// Search sessions by content or metadata (paginated)
tool search_sessions {
  input: {
    query: string;               // Free-text search over titles + transcripts
    workspace?: string;          // Scope to workspace
    limit?: number;              // Default: 10, max: 30
    cursor?: string;
  }
  output: {
    results: Array<{
      threadId: string;
      title: string;
      summary: string;
      matchContext: string;      // Snippet showing the match
      relevanceScore: number;
    }>
    totalCount: number;
    nextCursor?: string;
    hasMore: boolean;
  }
}
```

**Pagination notes:**

- **Cursor-based, not offset-based** — stable under concurrent session creation/deletion. The cursor is an opaque string (internally: the `threadId` + sort value of the last returned item).
- **Default page size of 20** keeps the Manager's context lean. The Manager can always fetch more pages if the user asks "show me more" or if it needs to find a specific session.
- **`totalCount`** lets the Manager communicate scope to the user ("You have 143 sessions, here are the 20 most recent") without fetching them all.
- **`search_sessions`** has a smaller default limit (10) since search results include `matchContext` snippets which are heavier.

### 4.3 Workspace Management

```typescript
// Add a new workspace (folder) to Stratos
tool create_workspace {
  input: {
    path: string;                // Absolute path
    name?: string;               // Display name (defaults to basename)
  }
  output: {
    folderId: string;
    name: string;
    path: string;
  }
}

// List all registered workspaces
tool list_workspaces {
  input: {}
  output: {
    workspaces: Array<{
      folderId: string;
      name: string;
      path: string;
      sessionCount: number;      // How many threads use this cwd
    }>
  }
}

// Remove a workspace registration (does not delete files)
tool remove_workspace {
  input: { folderId: string }
  output: { status: "removed" }
}
```

### 4.4 Provider & Model Management

```typescript
// Switch the manager's own provider
tool switch_manager_provider {
  input: {
    provider: ProviderType;
    model?: string;
  }
  output: {
    status: "switched";
    previousProvider: ProviderType;
    newProvider: ProviderType;
  }
}

// List available models for a provider
tool list_models {
  input: { provider?: ProviderType }  // Default: all providers
  output: {
    models: Array<{
      provider: ProviderType;
      value: string;
      displayName: string;
      description: string;
    }>
  }
}
```

### 4.5 Bulk Operations

```typescript
// Stop all running sessions
tool stop_all_sessions {
  input: { workspace?: string }   // Optional: only in this workspace
  output: {
    stopped: string[];            // Thread IDs that were stopped
  }
}

// Get aggregate status across all sessions
tool get_dashboard {
  input: {}
  output: {
    totalSessions: number;
    running: number;
    idle: number;
    errored: number;
    workspaces: number;
    byProvider: Record<ProviderType, number>;
  }
}
```

### 4.6 Session Summaries

The `summary` and `currentActivity` fields are key to making the Manager useful — without them, the Manager can only report thread IDs and raw transcripts, forcing the user (or the LLM) to piece together what's happening.

**How summaries are generated:**

| Field             | Source                                                                                                                                                                          | When Updated                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `summary`         | Derived from the initial user prompt + the thread title. For richer summaries: extract from the first assistant `result` message (which often contains a summary of work done). | On session creation (from prompt), updated on first `result` message.        |
| `currentActivity` | Derived from the most recent `tool_use` message in an active stream. E.g., if the last tool call was `Edit { file: "src/auth.ts" }`, the activity is `"Editing src/auth.ts"`.   | Live — computed on each `get_session` call from `AgentManager` stream state. |

**Implementation approach:**

```typescript
function deriveSummary(thread: Thread, messages: StoredMessage[]): string {
  // 1. If we have a result message with a summary, use it
  const lastResult = messages.findLast((m) => m.type === "result");
  if (lastResult?.content) {
    return truncate(lastResult.content, 200);
  }
  // 2. Fall back to the first user prompt
  const firstPrompt = messages.find((m) => m.role === "user");
  if (firstPrompt?.content) {
    return `Working on: ${truncate(firstPrompt.content, 150)}`;
  }
  // 3. Fall back to thread title
  return thread.title;
}

function deriveCurrentActivity(
  threadId: string,
  agentManager: AgentManager,
): string | undefined {
  if (!agentManager.isStreaming(threadId)) return undefined;
  const lastToolUse = agentManager.getLastToolUse(threadId);
  if (!lastToolUse) return "Thinking...";
  return formatToolActivity(lastToolUse.toolName, lastToolUse.input);
  // e.g. "Reading src/auth.ts", "Running pnpm test", "Editing login.tsx"
}
```

**Why not LLM-generated summaries?** Tempting, but adds latency and cost to every `list_sessions` / `get_session` call. The heuristic approach above is fast, free, and good enough for the Manager to make routing decisions. If a user wants a deep summary, they can ask the Manager to `get_session` with `includeTranscript: true` and let the Manager LLM summarize the transcript itself.

---

## 5. Provider Switching Mid-Session

### The Problem

The Manager Agent itself runs on a provider (default: opencode). The user should be able to say "switch to Claude for this" mid-conversation.

### Design

Provider switching is a **session boundary operation**, not a hot-swap:

1. User says: "switch to claude-code" (or "use sonnet for this")
2. Manager Agent calls `switch_manager_provider` tool
3. `ManagerSession` implementation:
   a. Serializes current conversation context (summary of recent turns)
   b. Disposes current provider session
   c. Creates new provider session with the target provider
   d. Injects the context summary as a system prompt preamble
   e. Returns control to the new provider instance
4. Manager continues with new provider, retaining conversational context

```typescript
async switchProvider(provider: ProviderType, model?: string): Promise<void> {
  const contextSummary = await this.summarizeCurrentContext();

  await this.session.provider.dispose();

  const newProvider = createProvider(provider);
  await newProvider.initialize({
    cwd: MANAGER_CWD,
    model,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `\n\nPrior conversation context:\n${contextSummary}`,
    },
    mcpServers: { "stratos-manager": this.buildManagerMcp() },
  });

  this.session.provider = newProvider;
  this.currentProvider = provider;
}
```

**Trade-off:** The new provider loses fine-grained conversation history. This is acceptable because:

- The Manager is thin — its conversations are short management commands, not deep code discussions
- The context summary preserves the important bits (what sessions exist, what the user asked for)
- Alternative (multiplexing both providers) adds massive complexity for little gain

---

## 6. Request-Response Lifecycle

The Manager Agent is **not** a long-running daemon. It follows a request-response pattern:

### 6.1 Dispatch Flow (fire-and-forget)

```
┌─────┐                    ┌─────────┐              ┌──────────┐
│User │                    │Manager  │              │AgentMgr  │
└──┬──┘                    └────┬────┘              └────┬─────┘
   │                            │                        │
   │  "start a session in       │                        │
   │   ~/myproject to fix       │                        │
   │   the login bug"           │                        │
   │ ──────────────────────────>│                        │
   │                            │                        │
   │                            │  create_session({      │
   │                            │    workspace: ~/myproject,
   │                            │    prompt: "fix the    │
   │                            │    login bug"          │
   │                            │  })                    │
   │                            │ ──────────────────────>│
   │                            │                        │
   │                            │   { threadId:          │
   │                            │     "cosmic-fox" }     │
   │                            │ <──────────────────────│
   │                            │                        │
   │  "Started 'cosmic-fox'     │                        │
   │   — working on login fix." │                        │
   │ <──────────────────────────│                        │
```

### 6.2 Conversational Relay (send_and_wait)

This is the key flow for "talk to the Manager, Manager talks to the agent":

### 6.2 Conversational Relay (send + check back)

The user talks to the Manager, Manager talks to the agent, user checks back later:

```
┌─────┐                    ┌─────────┐              ┌──────────┐  ┌──────────┐
│User │                    │Manager  │              │AgentMgr  │  │cosmic-fox│
│     │                    │Session  │              │          │  │(agent)   │
└──┬──┘                    └────┬────┘              └────┬─────┘  └────┬─────┘
   │                            │                        │             │
   │  "tell cosmic-fox to       │                        │             │
   │   also add unit tests"     │                        │             │
   │ ──────────────────────────>│                        │             │
   │                            │                        │             │
   │                            │  send_message({        │             │
   │                            │    threadId: "cosmic-fox",           │
   │                            │    prompt: "Also add   │             │
   │                            │    unit tests for the  │             │
   │                            │    login fix"          │             │
   │                            │  })                    │             │
   │                            │ ──────────────────────>│             │
   │                            │     { status: "sent" } │             │
   │                            │ <──────────────────────│             │
   │                            │                        │ ──────────> │
   │  "Sent. cosmic-fox is      │                        │  (working   │
   │   working on it now."      │                        │   async...) │
   │ <──────────────────────────│                        │             │
   │                            │                        │             │
   │      ... time passes ...   │                        │             │
   │                            │                        │             │
   │  "what did cosmic-fox do?" │                        │             │
   │ ──────────────────────────>│                        │             │
   │                            │                        │             │
   │                            │  get_session({         │             │
   │                            │    threadId: "cosmic-fox",           │
   │                            │    includeTranscript:   │             │
   │                            │      true              │             │
   │                            │  })                    │             │
   │                            │ ──────────────────────>│             │
   │                            │                        │             │
   │                            │  { status: "idle",     │             │
   │                            │    summary: "Added     │             │
   │                            │    unit tests...",     │             │
   │                            │    recentMessages: ... }│             │
   │                            │ <──────────────────────│             │
   │                            │                        │             │
   │  "cosmic-fox finished.     │                        │             │
   │   It added 3 test files:   │                        │             │
   │   login.test.ts,           │                        │             │
   │   auth.test.ts.            │                        │             │
   │   All tests passing."      │                        │             │
   │ <──────────────────────────│                        │             │
```

### 6.3 Multi-Session Dispatch

Same pattern scales naturally — dispatch to N sessions, check on them when needed:

```
┌─────┐                    ┌─────────┐              ┌──────────┐
│User │                    │Manager  │              │AgentMgr  │
└──┬──┘                    └────┬────┘              └────┬─────┘
   │                            │                        │
   │  "run tests in all         │                        │
   │   three projects"          │                        │
   │ ──────────────────────────>│                        │
   │                            │                        │
   │                            │  send_message(fox, "run tests")
   │                            │  send_message(bear, "run tests")
   │                            │  send_message(hawk, "run tests")
   │                            │ ──────────────────────>│
   │                            │                        │
   │  "Dispatched test runs     │                        │
   │   to all 3 sessions."      │                        │
   │ <──────────────────────────│                        │
   │                            │                        │
   │  "are they done?"          │                        │
   │ ──────────────────────────>│                        │
   │                            │                        │
   │                            │  get_session(fox)      │
   │                            │  get_session(bear)     │
   │                            │  get_session(hawk)     │
   │                            │ ──────────────────────>│
   │                            │                        │
   │  "fox: done, all pass      │                        │
   │   bear: still running      │                        │
   │   hawk: 2 test failures"   │                        │
   │ <──────────────────────────│                        │
   │                            │                        │
   │  "tell hawk to fix those   │                        │
   │   failures"                │                        │
   │ ──────────────────────────>│                        │
   │                            │                        │
   │                            │  send_message(hawk,    │
   │                            │    "fix the 2 test     │
   │                            │     failures")         │
   │                            │ ──────────────────────>│
   │                            │                        │
   │  "Sent. hawk is on it."    │                        │
   │ <──────────────────────────│                        │
```

### 6.4 Idle State

After responding, the Manager goes idle:

- Provider session stays alive (for context continuity on next message)
- No background processing, no polling
- The managed agent sessions continue running independently
- Next user message re-activates the Manager

### 6.5 When Does the Manager Actually "Run"?

Only when the user sends it a message. The managed sessions are fully independent — they run via `AgentManager.runStream()` exactly as they do today. The Manager doesn't supervise them continuously; it's a control plane, not a data plane. No tool ever blocks — every call returns immediately.

---

## 7. System Prompt

The Manager Agent's system prompt is critical to keeping it thin:

```markdown
You are the Stratos Manager — a session orchestrator for AI coding agents.

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

- Use `send_message` to dispatch the prompt — it returns immediately
- Tell the user the message was sent
- When they ask what happened, use `get_session` with `includeTranscript: true`
- Summarize the agent's recent activity from the transcript — don't dump it raw
- If the user says "tell cosmic-fox to X", send exactly X as the prompt — don't rephrase

## Checking on Sessions

- If the user asks "what did X do?" or "is X done?", use `get_session`
- Read the `summary`, `status`, and `currentActivity` fields first
- Only request the transcript if you need more detail to answer the user's question

## Available Providers

- claude-code: Anthropic's Claude with full tool use (default)
- opencode: Multi-model provider (OpenAI, Gemini, etc.)
- codex: OpenAI's Codex agent

## Session Modes

- plan: Read-only, agent creates a plan for review
- default: Each tool requires user approval
- acceptEdits: Auto-approve file/shell operations
- bypassPermissions: Full automation, no approvals
```

---

## 8. UI Integration

### 8.1 Option A: Dedicated Manager Panel (Recommended)

A persistent panel (sidebar or top-bar accessible) that is always the Manager:

```
┌─────────────────────────────────────────────────────────┐
│  ☰  Stratos                        [Manager] [+Thread]  │
├───────────┬─────────────────────────────────────────────┤
│           │                                              │
│ Threads   │   Manager                                    │
│           │                                              │
│ cosmic-fox│   You: start a session in ~/myproject        │
│ lazy-bear │        to fix the login bug                  │
│ red-hawk  │                                              │
│           │   Manager: Started session "cosmic-fox"      │
│           │   in ~/myproject with claude-code.           │
│           │   Working on login bug fix.                  │
│           │                                              │
│           │   You: what's cosmic-fox doing?              │
│           │                                              │
│           │   Manager: cosmic-fox is running.            │
│           │   It found a null check issue in auth.ts     │
│           │   and is writing a fix.                      │
│           │                                              │
│           │   [input: Talk to Manager...]                │
│           │                                              │
└───────────┴─────────────────────────────────────────────┘
```

- The Manager panel looks like a chat but uses the Manager Agent's session
- Clicking a thread in the sidebar still opens the regular agent view
- Manager messages that reference sessions link to those threads

### 8.2 Option B: Special Thread

The Manager is a pinned thread at the top of the thread list:

- Always exists, cannot be deleted
- Has a distinct visual treatment (icon, color)
- Otherwise behaves like any other thread

**Recommendation:** Start with Option B (simpler, reuses existing thread UI) and evolve to Option A if usage patterns warrant it.

### 8.3 IPC Additions

```typescript
// In ipc-channels.ts
MANAGER_SEND = "manager:send"; // User sends message to Manager
MANAGER_STREAM = "manager:stream"; // Manager streams response back
MANAGER_STATUS = "manager:status"; // Is Manager active/idle?
MANAGER_SWITCH_PROVIDER = "manager:switch-provider";
MANAGER_INTERRUPT = "manager:interrupt";
```

---

## 9. Implementation Plan

### Phase 1: Foundation (Core + MCP Server)

**Goal:** Manager Agent can create, list, query, and stop sessions via tools.

1. **`stratos-manager-mcp` server** — New MCP server in `packages/desktop/src/main/manager/`
   - Implements `create_session`, `list_sessions`, `get_session`, `stop_session`, `delete_session`
   - Calls into `AgentManager` and `FileStorageAdapter` directly (same process)
   - Follow the pattern of `stratos-scheduler` MCP

2. **`ManagerSession` class** — Singleton in `packages/desktop/src/main/manager/`
   - Creates a dedicated agent session with the management MCP tools
   - Default provider: opencode
   - System prompt from §7
   - CWD: `~/.stratos/manager/`

3. **IPC handlers** — Wire Manager to renderer
   - `MANAGER_SEND`, `MANAGER_STREAM`, `MANAGER_STATUS`

4. **Basic UI** — Pinned "Manager" thread (Option B)
   - Special thread that routes to `ManagerSession` instead of `AgentManager`
   - Distinct visual indicator

### Phase 2: Workspace + Search

**Goal:** Manager can create workspaces and search across sessions.

5. **Workspace tools** — `create_workspace`, `list_workspaces`, `remove_workspace`
6. **Search tool** — `search_sessions` with full-text search over thread titles + transcripts
7. **Dashboard tool** — `get_dashboard` for aggregate status

### Phase 3: Provider Switching + Polish

**Goal:** Provider switching, bulk operations, and UX refinement.

8. **Provider switching** — `switch_manager_provider` with context transfer
9. **Bulk operations** — `stop_all_sessions`
10. **UI polish** — Session links in Manager messages, status indicators, keyboard shortcut to focus Manager

### Phase 4: Advanced (Future)

11. **Proactive notifications** — Manager notifies user when a managed session errors or completes
12. **Cross-session context** — Manager can transfer context/files between sessions
13. **Conditional workflows** — "When cosmic-fox finishes, start a session to run the tests"
14. **Voice/shortcut activation** — Global hotkey to talk to Manager from anywhere

---

## 10. Open Questions

| #   | Question                                                                    | Options                                                                                                               | Recommendation                                                                                            |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | **Should the Manager handle permission escalations from managed sessions?** | (a) Manager forwards to user, (b) Manager decides autonomously, (c) Each session handles its own permissions as today | **(c)** — Keep existing permission flow unchanged. Manager is control plane only.                         |
| 2   | **How to handle `send_message` to a session that's mid-stream?**            | (a) Queue until current stream completes, (b) Interrupt + send, (c) Reject with error                                 | **(a)** — Queue, with timeout. Interrupting could lose work.                                              |
| 3   | **Should the Manager persist its own conversation history?**                | (a) Yes, in `~/.stratos/manager/history.json`, (b) No, ephemeral                                                      | **(a)** — Persistence allows "what did I ask you to do yesterday?"                                        |
| 4   | **MCP server: in-process or separate process?**                             | (a) In-process (direct function calls), (b) Spawned subprocess like stratos-scheduler                                 | **(a)** — In-process is simpler and faster. The Manager MCP doesn't need to be usable by external agents. |
| 5   | **Default provider for Manager?**                                           | (a) opencode, (b) claude-code, (c) User-configurable                                                                  | **(c)** — User-configurable with opencode as default (cheaper for management tasks).                      |
| 6   | **Should managed sessions know they were started by the Manager?**          | (a) Yes, via thread metadata, (b) No                                                                                  | **(a)** — Useful for UI indicators and potential future cross-session communication.                      |
| 7   | **LRU eviction: should the Manager session be exempt?**                     | (a) Yes, always keep alive, (b) No, evict like others                                                                 | **(a)** — The Manager is lightweight and its context continuity is valuable.                              |

---

## 11. Risks & Mitigations

| Risk                                                                                                               | Impact                                                     | Mitigation                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manager becomes a bottleneck** — users route everything through it instead of directly interacting with sessions | Slower workflows, unnecessary LLM calls for simple actions | System prompt explicitly directs users to interact with sessions directly for ongoing work. Manager is for orchestration, not conversation relay. |
| **Context loss on provider switch**                                                                                | Manager forgets what it was managing                       | Context summary injection (§5). Also: management state is in storage, not in the LLM's context — the tools always return fresh data.              |
| **Runaway session creation**                                                                                       | Manager spawns too many sessions, resource exhaustion      | Rate limit in `create_session` tool (max 10 active sessions). LRU eviction already handles provider cleanup.                                      |
| **MCP tool errors crash Manager session**                                                                          | Manager becomes unresponsive                               | Tool implementations catch all errors and return structured error messages. Manager's provider session continues.                                 |
| **Stale information**                                                                                              | Manager tells user a session is "running" when it crashed  | `get_session` always queries live state from AgentManager, never caches.                                                                          |

---

## 12. Non-Goals (Explicitly Out of Scope)

- **Agent-to-agent communication**: Sessions don't talk to each other. The Manager is the only coordinator.
- **Automatic task decomposition**: Manager doesn't break down "build me an app" into sub-tasks. That's the individual agent's job.
- **Continuous supervision**: Manager doesn't watch sessions in real-time. It queries on demand.
- **Multi-user support**: Single user, single Manager instance.
- **Code execution by Manager**: The Manager never writes, reads, or analyzes code files itself.

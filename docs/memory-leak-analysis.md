# Memory Leak Analysis — Stratos (3 GB Heap Investigation)

> **Date:** 2026-04-30  
> **Status:** Analysis only — no fixes applied yet  
> **Trigger:** Main-process heap size observed above 3 GB in production

---

## Executive Summary

Five root causes account for the majority of the 3 GB heap. Two of them (JSONL full-load before slice, and Manager's `get_sessions` / `search_sessions` loading every transcript) are likely the primary drivers and can trigger hundreds of MB of simultaneous allocations in a single operation. The rest are structural leaks that compound over time. None of these are in hot paths that would be hard to fix — all have clear remediation strategies.

---

## Issue Index

| #   | Severity    | Area          | File                                  | Summary                                                             |
| --- | ----------- | ------------- | ------------------------------------- | ------------------------------------------------------------------- |
| 1   | 🔴 Critical | Core storage  | `sdk-transcript.ts:155`               | Entire JSONL deserialized before 2000-message slice                 |
| 2   | 🔴 Critical | MCP handlers  | `mcp/handlers/manager.ts:336, 440`    | `get_sessions` / `search_sessions` loads full transcript per thread |
| 3   | 🔴 Critical | Provider      | `claude-code.provider.ts:250`         | Up to 3+1 live `claude` subprocesses via idle `controlQuery`        |
| 4   | 🟠 High     | Renderer      | `useChat.ts:259` + `ChatView.tsx:208` | No message virtualization; streaming array churn                    |
| 5   | 🟠 High     | Agent manager | `agent-manager.ts:360`                | `lastPlanMarkdown` unbounded in memory                              |
| 6   | 🟡 Medium   | Agent manager | `agent-manager.ts:368`                | `lastNotificationAt` map grows forever                              |
| 7   | 🟡 Medium   | Agent manager | `agent-manager.ts:306`                | `modelsCache` no hard entry cap                                     |
| 8   | 🟡 Medium   | Agent manager | `agent-manager.ts:302`                | `completionListeners` Set can accumulate closures                   |
| 9   | 🟡 Medium   | Renderer      | `useChat.ts`                          | Streaming state immutable-array churn                               |
| 10  | 🟢 Low      | Agent manager | `agent-manager.ts:309–354`            | Pending-request Maps orphaned on renderer crash                     |

---

## Detailed Findings

### Issue 1 — `getSessionMessages` deserializes entire JSONL before slicing

**Severity:** 🔴 Critical  
**File:** `packages/core/src/storage/sdk-transcript.ts:155`

```ts
const allSdkMessages = await getSessionMessages(sessionId); // loads EVERYTHING from disk

const sdkMessages =
  allSdkMessages.length > MAX_SDK_MESSAGES
    ? allSdkMessages.slice(-MAX_SDK_MESSAGES) // THEN trims to 2000
    : allSdkMessages;
```

**What happens:** `getSessionMessages` (from `@anthropic-ai/claude-agent-sdk`) reads the thread's entire `.jsonl` file into memory. For a long-lived thread — weeks of use, large tool results (file contents, search output), `includePartialMessages: true` streaming chunks — this file can reach hundreds of MB. The 2 000-message cap at line 160 is a band-aid: it limits the _returned_ array but the full deserialized payload has already been allocated. The comment at lines 142–148 explicitly acknowledges the OOM risk but the fix is incomplete.

**When it fires:** Every `THREADS_LOAD_MESSAGES` IPC call (switching threads, app startup for the active thread, Manager `get_session` with `includeTranscript: true`).

**Memory impact:** Proportional to transcript file size. A single thread with months of large tool outputs can easily spike 500 MB–1 GB for one load. Multiple parallel loads (see Issue 2) multiply this.

**Fix direction:** Investigate whether the SDK exposes a `limit`/`offset` parameter for `getSessionMessages`. If not, bypass the SDK call and tail-read the raw `.jsonl` file directly — read only the last N lines without full deserialization. The JSONL path is deterministic from the `sessionId`.

**Implications of fix:** Requires understanding the SDK's internal storage format. If `.jsonl` format changes between SDK versions, a direct file read creates a coupling. Safest: propose upstream SDK feature, or add a wrapper that reads the file in reverse chunks.

---

### Issue 2 — Manager `get_sessions` / `search_sessions` loads every transcript in parallel

**Severity:** 🔴 Critical  
**File:** `packages/desktop/src/main/mcp/handlers/manager.ts:334–336, 440`

```ts
// get_sessions — runs for every thread in the current page (up to 50)
const sessions = await Promise.all(
  page.map(async (t) => {
    const messages = await storage.loadMessages(t.id); // full transcript per thread
    return { ..., summary: deriveSummary(t, messages), messageCount: messages.length };
  }),
);

// search_sessions — runs for EVERY thread in the workspace
for (const t of threads) {
  const messages = await storage.loadMessages(t.id); // full transcript for all threads
  ...
}
```

**What happens:** `get_sessions` (called frequently by the Manager agent to orient itself) loads complete SDK transcripts for every thread on the page — up to 50 at once — via `Promise.all`. `search_sessions` does this for _every thread in the workspace_ with no pagination. If the workspace has 100 threads and each thread's JSONL is 50 MB, a single `search_sessions` call attempts to hold 5 GB in memory simultaneously.

**When it fires:** Any Manager run that calls `get_sessions` (routine), any Manager or user call to `search_sessions`.

**Memory impact:** N threads × average JSONL size. Worst case: hundreds of GB attempted; practical case with moderate thread counts still easily explains 3 GB.

**Fix direction:**

- `get_sessions`: derive the summary from thread metadata (title, `updatedAt`, last-user-message persisted to the `Thread` struct) without loading the transcript. Only load `messageCount` via a lightweight line-count on the JSONL, not full deserialization.
- `search_sessions`: add a transcript index file (title + last-message snippet) written at stream completion, so search can query the index without loading full transcripts. Alternatively, make transcript search opt-in with explicit `includeTranscript: true` and a per-thread limit.

**Implications of fix:** Manager agents that rely on `deriveSummary` inspecting message content will get less rich summaries. The Manager prompt may need to be updated to rely on the index/title. `search_sessions` quality degrades for content-based queries unless the index includes enough context.

---

### Issue 3 — Up to 4 live `claude` subprocesses from idle `controlQuery`

**Severity:** 🔴 Critical  
**File:** `packages/core/src/providers/claude-code.provider.ts:224–295`  
**Related:** `packages/desktop/src/main/agent-manager.ts:300` (`MAX_IDLE_SESSIONS = 3`)

```ts
// After every completed turn, a new background process is spun up:
private ensureControlQuery(): void {
  this.closeControlQuery();
  if (!this.sessionId) return;

  const controlQ = query({ prompt: parkedPrompt(), options: { resume: this.sessionId, ... } });
  this.controlQuery = controlQ;

  (async () => {
    for await (const _msg of controlQ) { /* discard */ }  // fire-and-forget drain
  })();
}
```

**What happens:** After each conversation turn completes, `ensureControlQuery()` spawns a fresh `claude` CLI subprocess in "parked" state. This subprocess keeps the MCP transport alive so MCP operations (toggle, reconnect, status) work between turns without starting a new session. `MAX_IDLE_SESSIONS = 3` means up to 3 idle sessions are kept in memory — each with its own live subprocess — plus the currently active one. Total: up to 4 `claude` processes running simultaneously.

Each `claude` subprocess is itself a Node.js process with its own V8 heap, typically 150–400 MB depending on MCP server connections. The fire-and-forget drain loop (`lines 286–295`) is untracked — if `closeControlQuery()` is called while the drain is blocked waiting on the next message, the process may not terminate immediately.

**When it fires:** After every conversation turn in every session that has MCP servers configured.

**Memory impact:** 3 × (150–400 MB per subprocess) = 450 MB–1.2 GB of subprocess memory outside the main Electron heap, but contributing to total RSS.

**Fix direction:**

- Reduce `MAX_IDLE_SESSIONS` from 3 to 1 (keep only the most recently active session alive).
- Evaluate whether the `controlQuery` is truly necessary for the common case: if MCP server reconnect operations can be deferred to the start of the next turn (re-run the query without a parked prompt), the control query can be eliminated entirely, dropping idle subprocess count to 0.
- If the control query must stay: add a timeout (e.g., 2 minutes of inactivity) after which the control query is closed and will be recreated on demand.

**Implications of fix:** Reducing `MAX_IDLE_SESSIONS` means switching back to a recently-used thread takes longer (needs to restart the `claude` process). Eliminating the control query means MCP toggle/reconnect between turns would fail or require a new query. The idle timeout approach balances responsiveness and memory.

---

### Issue 4 — No message virtualization in `ChatView`; renderer holds full React tree

**Severity:** 🟠 High  
**Files:** `packages/ui/src/components/ChatView.tsx:208`, `packages/desktop/src/renderer/hooks/useChat.ts:206`

```tsx
// ChatView.tsx — renders ALL messages at once
{messages.map((msg, idx) => (
  <MessageBubble key={msg.id} ... />
))}
```

**What happens:** The renderer renders every message as a full React fiber node with associated DOM. `MessageBubble` components that display markdown (via `react-markdown`), syntax-highlighted code blocks, tool call trees, and thinking blocks are heavyweight — each can generate hundreds of DOM nodes. With the 2 000-message cap from Issue 1, the renderer can hold a React tree with thousands of active DOM nodes.

This is the renderer process's V8 heap (separate from the main process), but in Electron's unified memory model both heaps contribute to total app RAM. The renderer does not release DOM nodes when messages scroll off-screen.

**Memory impact:** Roughly proportional to message count × DOM nodes per message. A thread with 500 messages of tool-heavy output can easily hold 200–500 MB in the renderer process.

**Fix direction:** Integrate `react-window` (fixed-size) or `react-virtual` (dynamic-size) to virtualize the message list. Only render the ~20–30 messages in the visible viewport. This is a moderate implementation effort since `MessageBubble` heights are not uniform.

**Implications of fix:** Variable-height virtualization requires either measuring row heights (adds layout cost on first render) or using a dynamic virtualizer that estimates and corrects. Auto-scroll-to-bottom behavior needs to be re-implemented carefully — virtualized lists require explicit scroll management. This is a non-trivial UI change that needs careful testing of edge cases (streaming messages growing in height, tool result expansion, plan review modal).

---

### Issue 5 — `lastPlanMarkdown` holds full plan document indefinitely

**Severity:** 🟠 High  
**File:** `packages/desktop/src/main/agent-manager.ts:360, 1344`

```ts
private lastPlanMarkdown: { content: string; title: string } | null = null;

// Set on every plan_update event and file watcher tick:
this.lastPlanMarkdown = { content: planContent, title: planTitle };

// Cleared only when plan review resolves:
this.lastPlanMarkdown = null;  // line 616
```

**What happens:** During plan mode, every `plan_update` event replaces `lastPlanMarkdown` with the full current plan. Plans can be large — a plan to refactor a large codebase might be 50–200 KB of markdown. The preview file watcher also updates this on every file change. `lastPlanMarkdown` is cleared when plan review resolves (approved or denied), but if a plan review is never triggered (stream errors, thread crashes, user abandons the thread), the large string stays in memory for the lifetime of the process.

Additionally, `lastPlanMarkdown` is at `AgentManager` scope (not per-thread), meaning it's overwritten by whichever thread most recently sent a `plan_update`. Multiple concurrent plan-mode threads could thrash this field, and the content of whichever thread _last_ sent an update lives in memory even after other threads complete.

**Fix direction:**

- Move `lastPlanMarkdown` to be per-thread (store in `ThreadSession`).
- Clear it in `clearSession()` (already called on eviction).
- Cap plan content at a reasonable size before storing (e.g., 500 KB) to prevent a single huge plan from bloating memory.

**Implications of fix:** Per-thread storage means the plan review modal always shows the correct thread's plan even if another thread sends a plan update concurrently. Current behavior (global field) is probably already buggy for concurrent plan-mode threads.

---

### Issue 6 — `lastNotificationAt` Map grows forever

**Severity:** 🟡 Medium  
**File:** `packages/desktop/src/main/agent-manager.ts:368`

```ts
private lastNotificationAt = new Map<string, number>();
private static readonly NOTIFICATION_COOLDOWN_MS = 30_000;
```

**What happens:** This Map stores a timestamp per `${threadId}-${notificationType}` key for debouncing. It is never pruned. Over weeks of use with hundreds of threads firing many notification types, this accumulates thousands of string keys and timestamps. Each entry is small (~100 bytes), but the Map itself is never released and the thread IDs it references prevent GC of associated string objects.

**Fix direction:** Add a periodic sweep (e.g., in the existing `idleEvictTimer` callback) that deletes entries older than `NOTIFICATION_COOLDOWN_MS` or associated with deleted threads. Alternatively, clear the thread's entries in `clearSession()`.

**Implications of fix:** Minimal. Notification debouncing still works correctly — the debounce only matters for the 30-second window anyway, so evicting old entries has no functional impact.

---

### Issue 7 — `modelsCache` has no hard entry cap

**Severity:** 🟡 Medium  
**File:** `packages/desktop/src/main/agent-manager.ts:306–307`

```ts
private modelsCache = new Map<string, { models: unknown[]; ts: number }>();
private static readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
```

**What happens:** The cache key is a serialized provider config string. Entries expire after 5 minutes but are only evicted lazily on next read, not proactively. If `GET_AVAILABLE_MODELS` is called with many different provider configurations (e.g., different model overrides), the map accumulates one entry per unique config. Models arrays from providers like Anthropic can contain hundreds of objects. There is no maximum entry count.

**Fix direction:** Add a hard cap (e.g., 20 entries) with LRU eviction. Alternatively, add a periodic sweep in `idleEvictTimer` to delete entries older than the TTL.

**Implications of fix:** Negligible functional impact. Models list for a given provider config is stable enough that re-fetching after eviction is acceptable.

---

### Issue 8 — `completionListeners` Set accumulates closures if callers don't clean up

**Severity:** 🟡 Medium  
**File:** `packages/desktop/src/main/agent-manager.ts:302–304`

```ts
private completionListeners = new Set<(event: StreamCompletedEvent) => void>();
```

**What happens:** `addCompletionListener(fn)` returns a cleanup function. Callers that forget to call cleanup leave their closure (which may capture large state from `ManagerSession` or `SchedulerManager`) rooted in this Set for the lifetime of the process. The Set is cleared in `dispose()` but not during normal operation.

**Fix direction:** Audit all `addCompletionListener` call sites to verify cleanup is always called. Consider adding a `WeakRef` or auto-expiry pattern, or a maximum size check with a warning log.

**Implications of fix:** Requires auditing call sites. If any call site is missing cleanup today, fixing it may change behavior (e.g., if a completion listener is meant to be permanent but the missing cleanup is an accident vs. intentional).

---

### Issue 9 — Streaming message array immutable-copy churn

**Severity:** 🟡 Medium  
**File:** `packages/desktop/src/renderer/hooks/useChat.ts:437–442`

```ts
const apply = (updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
  const next = updater(state!.messages); // creates a new array on every event
  state!.messages = next;
  if (activeThreadIdRef.current === threadId) {
    setMessages(next);
  }
};
```

**What happens:** Every streaming event (text chunk, tool progress update, thinking block) calls `apply()`, which spreads the existing messages array into a new one. During an active stream, this fires dozens to hundreds of times per second. Each call allocates a new `ChatMessage[]` of N elements — the old array is eligible for GC but the GC pressure from this churn is significant. For a thread with 200 messages receiving 100 streaming events, that's 20 000 array object allocations per stream.

**Fix direction:** Use a mutable ref for the in-progress stream array and only create a new reference when `setMessages` is called. Batch streaming updates at a fixed interval (e.g., 50 ms) using `requestAnimationFrame` or a debounced flush instead of updating on every event.

**Implications of fix:** Batching introduces visible latency in the streaming display. A 50 ms batch interval is imperceptible to users but reduces array allocation by ~20×. React's concurrent mode may already batch some of these updates — worth profiling before implementing.

---

### Issue 10 — Pending-request Maps orphaned on renderer crash / unexpected disconnect

**Severity:** 🟢 Low  
**File:** `packages/desktop/src/main/agent-manager.ts:309–354`

```ts
private pendingPermissions = new Map<string, { threadId, resolve, ... }>();
private pendingQuestions = new Map<string, { threadId, resolve, input }>();
private pendingPlanReviews = new Map<string, { resolve, threadId, input }>();
private pendingElicitations = new Map<string, { threadId, resolve }>();
```

**What happens:** When a permission/question/plan-review/elicitation request is in flight and the renderer disconnects (HMR reload, crash, F5), the `rejectAllPendingForRendererGone()` call clears these maps. However, if the listener that calls `rejectAllPendingForRendererGone` fires after new requests have been enqueued for the new renderer session, it could incorrectly reject live requests. More importantly, each pending entry holds `input` payloads (tool call arguments, which can include file contents) and a `resolve` callback that roots the generator frame of `runStream()`.

**Fix direction:** Already partially addressed — `rejectAllPendingForRendererGone` exists and fires on `did-start-navigation` and `did-finish-load`. Consider adding a timeout-based cleanup (e.g., auto-reject any request that has been pending for more than 5 minutes) as a safety net.

**Implications of fix:** Timeout-based auto-reject could surprise users who left a permission dialog open for a long time. Should be paired with a UI notification that the request expired.

---

## Memory Budget Estimate

Based on the analysis, here's a rough breakdown of where 3 GB might be coming from in a long-running session:

| Source                                  | Estimate        | Notes                                         |
| --------------------------------------- | --------------- | --------------------------------------------- |
| `getSessionMessages` full-load spike    | 500 MB – 2 GB   | Per load event; may not be GC'd between loads |
| 3 idle `claude` subprocesses (RSS)      | 450 MB – 1.2 GB | Outside main heap; contributes to total RSS   |
| Renderer React tree (no virtualization) | 200 – 500 MB    | Renderer V8 heap                              |
| Streaming array churn (GC lag)          | 100 – 300 MB    | Temporary; pressure on GC                     |
| `lastPlanMarkdown` + misc Maps          | 10 – 50 MB      | Persistent; low absolute size                 |
| **Total**                               | **~1.3 – 4 GB** | Matches observed 3 GB                         |

---

## Recommended Fix Priority

| Priority | Issue                                                        | Effort      | Impact    | Risk                                                                |
| -------- | ------------------------------------------------------------ | ----------- | --------- | ------------------------------------------------------------------- |
| P0       | Issue 2: `get_sessions` / `search_sessions` transcript loads | Medium      | Very High | Low — purely additive, no behavior change if metadata is sufficient |
| P0       | Issue 1: `getSessionMessages` full-load                      | Medium–High | Very High | Medium — depends on SDK internals / JSONL format                    |
| P1       | Issue 3: Reduce `MAX_IDLE_SESSIONS` + control query timeout  | Low         | High      | Low–Medium — slight latency increase on thread switch               |
| P1       | Issue 4: Message virtualization                              | High        | High      | High — significant UI refactor                                      |
| P2       | Issue 5: `lastPlanMarkdown` per-thread + cap                 | Low         | Medium    | Low                                                                 |
| P2       | Issue 9: Streaming array batching                            | Low         | Medium    | Low                                                                 |
| P3       | Issues 6, 7, 8                                               | Low         | Low       | Very Low                                                            |
| P3       | Issue 10: Timeout-based pending cleanup                      | Low         | Low       | Low                                                                 |

---

## Open Questions

1. **Does the SDK's `getSessionMessages` support pagination?** If yes, Issue 1 is trivially fixed. Check `@anthropic-ai/claude-agent-sdk` API surface.
2. **What is the actual average JSONL file size** for heavy users? Running `du -sh ~/.claude/projects/*/` would quantify the real-world scope of Issue 1.
3. **Is the `controlQuery` actually used in practice?** Checking whether any MCP toggle/reconnect operations are ever called between turns (vs. always at the start of a turn) would determine if it can be safely eliminated.
4. **Is `MAX_IDLE_SESSIONS = 3` intentional?** The comment says it's for performance (fast thread switching). Is the 3× subprocess overhead considered acceptable?
5. **Can `deriveSummary` work without the full transcript?** If the `Thread` struct stores the last-user-message text, the Manager's context summary could be derived without loading messages at all.

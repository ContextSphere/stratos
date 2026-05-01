/**
 * Manager handler definitions — 11 tools for orchestrating other agent sessions.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import type { AgentManager } from "../../agent-manager";
import type { FileStorageAdapter, StoredMessage } from "@stratosapp/core";
import { getScheduledPrompt } from "@stratosapp/core";
import { IPC_CHANNELS } from "../../../common/ipc-channels";
import { getManagerTurnImages } from "../../manager/turn-state";
import { type HandlerDef, defineHandler, textResult } from "./types";
import { getManagerRef } from "../../manager/manager-ref";
import { decoratePromptWithSchedule } from "../../scheduler/decorate-prompt";

const imagesSchema = z
  .array(
    z.object({
      dataUrl: z.string(),
      mimeType: z.string(),
    }),
  )
  .optional()
  .describe(
    "Images to forward to the agent. Normally omit this — Stratos auto-forwards images the user attached in the current Manager turn.",
  );

function resolveImages(
  explicit: { dataUrl: string; mimeType: string }[] | undefined,
): { dataUrl: string; mimeType: string }[] | undefined {
  if (explicit && explicit.length > 0) return explicit;
  const pending = getManagerTurnImages();
  return pending.length > 0 ? pending : undefined;
}

interface ThreadLike {
  id: string;
  title: string;
  cwd?: string;
  provider?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  isManagerThread?: boolean;
  sessionTools?: unknown[];
  [key: string]: unknown;
}

function deriveSummary(thread: ThreadLike, messages: StoredMessage[]): string {
  const lastResult = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  if (lastResult && typeof lastResult.content === "string") {
    return lastResult.content.slice(0, 200);
  }
  const firstUser = messages.find((m) => m.role === "user" && m.content);
  if (firstUser && typeof firstUser.content === "string") {
    return `Working on: ${firstUser.content.slice(0, 150)}`;
  }
  return thread.title;
}

function broadcast(window: BrowserWindow, channel: string): void {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel);
}

export interface ManagerDeps {
  agentManager: AgentManager;
  storage: FileStorageAdapter;
  window: BrowserWindow;
}

export function createManagerHandlers(deps: ManagerDeps): HandlerDef[] {
  const { agentManager, storage, window } = deps;

  return [
    defineHandler({
      name: "create_session",
      description:
        "Start a new agent session in a workspace. Returns the thread ID immediately (non-blocking). Use get_session later to check status. When dispatching a [SCHEDULED TASK], pass the Schedule ID via the scheduledPromptId parameter so the run is tracked.",
      inputSchema: {
        workspace: z
          .string()
          .describe("Absolute path to the working directory"),
        prompt: z.string().describe("Initial prompt to send to the agent"),
        provider: z
          .enum(["claude-code", "codex", "opencode"])
          .optional()
          .describe("Agent provider (default: claude-code)"),
        model: z
          .string()
          .optional()
          .describe("Model override (e.g. claude-sonnet-4-5-20250514)"),
        mode: z
          .enum(["plan", "default", "acceptEdits", "bypassPermissions"])
          .optional()
          .describe("Permission mode"),
        title: z
          .string()
          .optional()
          .describe("Thread title (auto-generated if omitted)"),
        worktreeMode: z
          .enum(["local", "worktree"])
          .optional()
          .describe("Git worktree isolation"),
        scheduledPromptId: z
          .string()
          .optional()
          .describe(
            "When dispatching a [SCHEDULED TASK], pass the Schedule ID from the context block. Required for scheduler bookkeeping (lastRunStatus, summary record). Omit otherwise.",
          ),
        images: imagesSchema,
      },
      handler: async (args) => {
        try {
          const folders = storage.listFolders();
          const folderAdded = !folders.find((f) => f.path === args.workspace);
          if (folderAdded) storage.addFolder(args.workspace);

          const previousActive = storage.getActiveThreadId();
          const thread = storage.createThread(
            args.title ?? "New chat",
            args.model,
            args.workspace,
            args.provider ?? "claude-code",
          );

          const updates: Record<string, unknown> = {
            spawnedBy: "manager",
            mode: args.mode ?? "bypassPermissions",
          };
          if (args.worktreeMode) updates.worktreeMode = args.worktreeMode;
          if (args.scheduledPromptId)
            updates.scheduledPromptId = args.scheduledPromptId;
          storage.updateThread(thread.id, updates);

          if (previousActive && previousActive !== thread.id) {
            storage.setActiveThreadId(previousActive);
          }

          if (folderAdded) broadcast(window, IPC_CHANNELS.FOLDERS_CHANGED);
          broadcast(window, IPC_CHANNELS.THREADS_CHANGED);

          // When this session was spawned for a scheduled task, append the
          // [SCHEDULED TASK] postscript so the agent has the scheduleId it
          // needs to call schedule_report. Single source of truth: the same
          // helper used by SchedulerManager.executeDirect.
          let promptToRun = args.prompt;
          if (args.scheduledPromptId) {
            const sched = getScheduledPrompt(args.scheduledPromptId);
            if (sched) {
              promptToRun = decoratePromptWithSchedule({
                promptText: args.prompt,
                prompt: sched,
                workspace: args.workspace,
              });
            }
          }

          const images = resolveImages(args.images);
          agentManager
            .startStream(thread.id, promptToRun, images)
            .catch((err) => {
              console.error(
                `[mcp:manager] stream error for thread ${thread.id}:`,
                err,
              );
            });

          return textResult(
            JSON.stringify({ threadId: thread.id, status: "started" }, null, 2),
          );
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "send_message",
      description:
        "Send a follow-up message to an existing agent session (non-blocking). Returns immediately. Use get_session to check what happened.",
      inputSchema: {
        threadId: z.string().describe("Thread ID of the target session"),
        prompt: z.string().describe("Message to send to the agent"),
        images: imagesSchema,
      },
      handler: async (args) => {
        try {
          const thread = storage.getThread(args.threadId);
          if (!thread)
            return textResult(`Thread not found: ${args.threadId}`, true);

          if (agentManager.isStreaming(args.threadId)) {
            return textResult(JSON.stringify({ status: "queued" }, null, 2));
          }

          const images = resolveImages(args.images);
          agentManager
            .startStream(args.threadId, args.prompt, images)
            .catch((err) => {
              console.error(
                `[mcp:manager] stream error for thread ${args.threadId}:`,
                err,
              );
            });
          return textResult(JSON.stringify({ status: "sent" }, null, 2));
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "stop_session",
      description: "Gracefully stop a running agent session.",
      inputSchema: { threadId: z.string().describe("Thread ID to stop") },
      handler: async (args) => {
        try {
          if (!agentManager.isStreaming(args.threadId)) {
            return textResult(
              JSON.stringify({ status: "was_not_running" }, null, 2),
            );
          }
          await agentManager.interruptSession(args.threadId);
          return textResult(JSON.stringify({ status: "stopped" }, null, 2));
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "delete_session",
      description: "Delete an agent session and its data. Cannot be undone.",
      inputSchema: { threadId: z.string().describe("Thread ID to delete") },
      handler: async (args) => {
        try {
          const thread = storage.getThread(args.threadId);
          if (!thread)
            return textResult(`Thread not found: ${args.threadId}`, true);
          if (thread.isManagerThread)
            return textResult("Cannot delete the Manager thread", true);

          if (agentManager.isStreaming(args.threadId)) {
            await agentManager.interruptSession(args.threadId);
          }
          agentManager.clearSession(args.threadId);
          storage.deleteThread(args.threadId);
          broadcast(window, IPC_CHANNELS.THREADS_CHANGED);
          return textResult(JSON.stringify({ status: "deleted" }, null, 2));
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "list_sessions",
      description:
        "List all agent sessions with status and summary. Paginated — use cursor for next page.",
      inputSchema: {
        filter: z
          .object({
            workspace: z
              .string()
              .optional()
              .describe("Filter by working directory path"),
            provider: z
              .enum(["claude-code", "codex", "opencode"])
              .optional()
              .describe("Filter by provider"),
          })
          .optional(),
        limit: z
          .number()
          .optional()
          .describe("Max results per page (default: 20, max: 50)"),
        cursor: z
          .string()
          .optional()
          .describe("Cursor from previous response for pagination"),
        sortBy: z
          .enum(["lastActivity", "createdAt", "title"])
          .optional()
          .describe("Sort order"),
      },
      handler: async (args) => {
        const allThreads = storage.listThreads() as ThreadLike[];
        let threads = allThreads.filter((t) => !t.isManagerThread);

        if (args.filter) {
          if (args.filter.workspace) {
            const ws = args.filter.workspace;
            threads = threads.filter((t) => t.cwd === ws);
          }
          if (args.filter.provider) {
            const pv = args.filter.provider;
            threads = threads.filter(
              (t) => (t.provider ?? "claude-code") === pv,
            );
          }
        }

        const sortBy = args.sortBy ?? "lastActivity";
        if (sortBy === "createdAt")
          threads.sort((a, b) => b.createdAt - a.createdAt);
        else if (sortBy === "title")
          threads.sort((a, b) => a.title.localeCompare(b.title));
        else threads.sort((a, b) => b.updatedAt - a.updatedAt);

        const totalCount = threads.length;
        let startIdx = 0;
        const cursorMatch = args.cursor?.match(/^idx:(\d+)$/);
        if (cursorMatch) startIdx = parseInt(cursorMatch[1], 10);

        const pageSize = Math.min(Math.max(args.limit ?? 20, 1), 50);
        const page = threads.slice(startIdx, startIdx + pageSize);
        const hasMore = startIdx + pageSize < totalCount;
        const nextCursor = hasMore ? `idx:${startIdx + pageSize}` : undefined;

        // Derive session info from thread metadata only — do NOT load transcripts.
        // Loading the full SDK JSONL for every thread on a page is the primary
        // driver of the 3 GB heap spike (see docs/memory-leak-analysis.md #2).
        const sessions = page.map((t) => ({
          threadId: t.id,
          title: t.title,
          summary: t.title,
          workspace: t.cwd ?? "",
          provider: t.provider ?? "claude-code",
          model: t.model ?? undefined,
          status: agentManager.isStreaming(t.id) ? "running" : "idle",
          lastActivity: new Date(t.updatedAt).toISOString(),
        }));

        return textResult(
          JSON.stringify(
            { sessions, totalCount, nextCursor, hasMore },
            null,
            2,
          ),
        );
      },
    }),

    defineHandler({
      name: "get_session",
      description:
        "Get detailed status of a specific session, including summary and optionally recent messages.",
      inputSchema: {
        threadId: z.string().describe("Thread ID to inspect"),
        includeTranscript: z
          .boolean()
          .optional()
          .describe("Include recent messages (default: false)"),
        transcriptLimit: z
          .number()
          .optional()
          .describe("Max messages to include (default: 20)"),
      },
      handler: async (args) => {
        const thread = storage.getThread(args.threadId) as
          | ThreadLike
          | undefined;
        if (!thread)
          return textResult(`Thread not found: ${args.threadId}`, true);

        let messages: StoredMessage[] = [];
        if (args.includeTranscript) {
          const all = await storage.loadMessages(args.threadId);
          const lim = args.transcriptLimit ?? 20;
          messages = lim > 0 ? all.slice(-lim) : all;
        }

        const result = {
          thread,
          summary: deriveSummary(thread, messages),
          status: agentManager.isStreaming(args.threadId) ? "running" : "idle",
          ...(args.includeTranscript ? { recentMessages: messages } : {}),
          tools: thread.sessionTools ?? [],
        };
        return textResult(JSON.stringify(result, null, 2));
      },
    }),

    defineHandler({
      name: "search_sessions",
      description:
        "Search sessions by title. Returns paginated results with match context. Note: message-content search is only available for non-claude-code providers (codex/opencode); claude-code sessions are matched by title only.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Search query (matches against session titles; message content is only searched for codex/opencode sessions)",
          ),
        workspace: z
          .string()
          .optional()
          .describe("Scope search to this workspace path"),
        limit: z
          .number()
          .optional()
          .describe("Max results per page (default: 10, max: 30)"),
        cursor: z.string().optional().describe("Cursor from previous response"),
      },
      handler: async (args) => {
        let threads = (storage.listThreads() as ThreadLike[]).filter(
          (t) => !t.isManagerThread,
        );
        if (args.workspace) {
          const ws = args.workspace;
          threads = threads.filter((t) => t.cwd === ws);
        }

        const lower = args.query.toLowerCase();
        type Hit = {
          threadId: string;
          title: string;
          summary: string;
          matchContext: string;
          relevanceScore: number;
        };
        const results: Hit[] = [];
        for (const t of threads) {
          const titleMatch = t.title.toLowerCase().includes(lower);
          let matchContext = "";
          let score = 0;
          if (titleMatch) {
            matchContext = t.title;
            score = 2;
          }
          // Only search message content for non-claude-code threads (disk-backed).
          // claude-code threads read from the SDK JSONL which can be hundreds of MB;
          // loading every thread's JSONL for a workspace-wide search causes OOM.
          // Title search still applies for all threads above.
          if (!titleMatch && (t.provider ?? "claude-code") !== "claude-code") {
            const messages = await storage.loadMessages(t.id);
            for (const m of messages) {
              if (typeof m.content !== "string") continue;
              const idx = m.content.toLowerCase().indexOf(lower);
              if (idx >= 0) {
                matchContext = m.content.slice(
                  Math.max(0, idx - 50),
                  idx + args.query.length + 50,
                );
                score = Math.max(score, 1);
                break;
              }
            }
          }
          if (score > 0) {
            results.push({
              threadId: t.id,
              title: t.title,
              summary: t.title,
              matchContext,
              relevanceScore: score,
            });
          }
        }

        results.sort((a, b) => b.relevanceScore - a.relevanceScore);

        const totalCount = results.length;
        let startIdx = 0;
        const cursorMatch = args.cursor?.match(/^idx:(\d+)$/);
        if (cursorMatch) startIdx = parseInt(cursorMatch[1], 10);
        const pageSize = Math.min(Math.max(args.limit ?? 10, 1), 30);
        const page = results.slice(startIdx, startIdx + pageSize);
        const hasMore = startIdx + pageSize < totalCount;
        const nextCursor = hasMore ? `idx:${startIdx + pageSize}` : undefined;

        return textResult(
          JSON.stringify(
            { results: page, totalCount, nextCursor, hasMore },
            null,
            2,
          ),
        );
      },
    }),

    defineHandler({
      name: "get_dashboard",
      description:
        "Get an overview of all sessions — total counts, status breakdown, and per-provider stats.",
      inputSchema: {},
      handler: async () => {
        const threads = (storage.listThreads() as ThreadLike[]).filter(
          (t) => !t.isManagerThread,
        );
        const folders = storage.listFolders();
        const byProvider: Record<string, number> = {};
        let running = 0;
        for (const t of threads) {
          const p = t.provider ?? "claude-code";
          byProvider[p] = (byProvider[p] ?? 0) + 1;
          if (agentManager.isStreaming(t.id)) running++;
        }
        return textResult(
          JSON.stringify(
            {
              totalSessions: threads.length,
              running,
              idle: threads.length - running,
              errored: 0,
              workspaces: folders.length,
              byProvider,
            },
            null,
            2,
          ),
        );
      },
    }),

    defineHandler({
      name: "list_workspaces",
      description:
        "List all registered workspaces (folders) with session counts.",
      inputSchema: {},
      handler: async () => {
        const folders = storage.listFolders();
        const threads = (storage.listThreads() as ThreadLike[]).filter(
          (t) => !t.isManagerThread,
        );
        const workspaces = folders.map((f) => ({
          folderId: f.id,
          name: f.name,
          path: f.path,
          sessionCount: threads.filter((t) => t.cwd === f.path).length,
        }));
        return textResult(JSON.stringify({ workspaces }, null, 2));
      },
    }),

    defineHandler({
      name: "create_workspace",
      description:
        "Register a new workspace (folder) in Stratos. Does not create the directory — it must already exist.",
      inputSchema: {
        path: z.string().describe("Absolute path to the directory"),
        name: z
          .string()
          .optional()
          .describe("Display name (defaults to directory basename)"),
      },
      handler: async (args) => {
        try {
          const folder = storage.addFolder(args.path, args.name);
          broadcast(window, IPC_CHANNELS.FOLDERS_CHANGED);
          return textResult(
            JSON.stringify(
              { folderId: folder.id, name: folder.name, path: folder.path },
              null,
              2,
            ),
          );
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "remove_workspace",
      description:
        "Unregister a workspace from Stratos. Does not delete the directory or its sessions.",
      inputSchema: {
        folderId: z.string().describe("Folder ID (from list_workspaces)"),
      },
      handler: async (args) => {
        try {
          storage.removeFolder(args.folderId);
          broadcast(window, IPC_CHANNELS.FOLDERS_CHANGED);
          broadcast(window, IPC_CHANNELS.THREADS_CHANGED);
          return textResult(JSON.stringify({ status: "removed" }, null, 2));
        } catch (err) {
          return textResult(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
      },
    }),

    defineHandler({
      name: "manager_post",
      description:
        "Send a message to the Stratos Manager fire-and-forget. Returns immediately with {status:'queued'}. When the Manager finishes, it POSTs the reply to callbackUrl as {reply: string}.",
      inputSchema: {
        message: z.string().describe("The message to send to the Manager."),
        callbackUrl: z
          .string()
          .describe("URL to POST the reply to when the Manager finishes."),
      },
      handler: async (args) => {
        const manager = getManagerRef();
        if (!manager) {
          return textResult("Manager not initialized.", true);
        }
        if (manager.isActive) {
          return textResult(JSON.stringify({ status: "busy" }), true);
        }
        const callbackUrl = args.callbackUrl as string;
        manager
          .sendFromGateway(args.message as string, (reply) => {
            fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reply }),
            }).catch((err) =>
              console.error("[manager_post] callback failed:", err),
            );
          })
          .catch((err) => console.error("[manager_post]", err));
        return textResult(JSON.stringify({ status: "queued" }));
      },
    }),
  ];
}

/**
 * Unix domain socket bridge between the Manager MCP server subprocess
 * and the main Electron process.
 *
 * The MCP server sends JSON-RPC requests over the socket; this bridge
 * dispatches them to AgentManager and FileStorageAdapter, returning
 * results synchronously (from the subprocess's perspective).
 */
import type { BrowserWindow } from "electron";
import { createServer, type Server } from "net";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import type { AgentManager } from "../agent-manager";
import type { FileStorageAdapter } from "@stratosapp/core";

export class ManagerBridge {
  private server: Server | null = null;
  private agentManager: AgentManager;
  private storage: FileStorageAdapter;
  private socketPath: string;
  private window: BrowserWindow;
  /** Images attached to the currently-active Manager turn, set by ManagerSession. */
  private pendingTurnImages: { dataUrl: string; mimeType: string }[] = [];

  constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    socketPath: string,
    window: BrowserWindow,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.socketPath = socketPath;
    this.window = window;
  }

  /** Called by ManagerSession before a turn's stream begins. */
  setTurnImages(
    images: { dataUrl: string; mimeType: string }[] | undefined,
  ): void {
    this.pendingTurnImages = images ?? [];
  }

  /** Called by ManagerSession in the finally block after a turn completes. */
  clearTurnImages(): void {
    this.pendingTurnImages = [];
  }

  /**
   * Broadcast a channel to the renderer. Used to keep the sidebar's thread
   * and folder lists in sync with manager-driven mutations — without this,
   * sessions/workspaces created by the Manager Agent don't appear until the
   * user reloads.
   */
  private broadcast(channel: string): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
      return;
    }
    this.window.webContents.send(channel);
  }

  start(): void {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }

    mkdirSync(dirname(this.socketPath), { recursive: true });

    this.server = createServer((conn) => {
      let buffer = "";
      conn.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          this.handleRequest(line.trim(), conn);
        }
      });
      conn.on("error", () => {
        // Client disconnected — ignore
      });
    });

    this.server.listen(this.socketPath);
    this.server.on("error", (err) => {
      console.error("[manager-bridge] socket server error:", err);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }
  }

  private async handleRequest(
    raw: string,
    conn: import("net").Socket,
  ): Promise<void> {
    let req: { id: number; method: string; params?: Record<string, unknown> };
    try {
      req = JSON.parse(raw);
    } catch {
      this.respond(conn, {
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    try {
      const result = await this.dispatch(
        req.method,
        (req.params ?? {}) as Record<string, unknown>,
      );
      this.respond(conn, { id: req.id, result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.respond(conn, {
        id: req.id,
        error: { code: -32000, message },
      });
    }
  }

  private respond(
    conn: import("net").Socket,
    obj: Record<string, unknown>,
  ): void {
    try {
      conn.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");
    } catch {
      // Connection may be closed
    }
  }

  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "create_session":
        return this.createSession(params);
      case "send_message":
        return this.sendMessage(params);
      case "stop_session":
        return this.stopSession(params);
      case "delete_session":
        return this.deleteSession(params);
      case "create_workspace":
        return this.createWorkspace(params);
      case "remove_workspace":
        return this.removeWorkspace(params);
      case "get_messages":
        return this.getMessages(params);
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Load a thread's transcript via FileStorageAdapter, which knows how to
   * read from the Claude SDK JSONL for claude-code threads and from disk
   * for other providers. The MCP subprocess can't do this itself — it only
   * sees ~/.stratos/threads/messages/ which is never populated for
   * claude-code sessions.
   */
  private async getMessages(
    params: Record<string, unknown>,
  ): Promise<{ messages: unknown[] }> {
    const threadId = params.threadId as string;
    const limit = (params.limit as number | undefined) ?? 20;
    if (!threadId) throw new Error("threadId is required");
    const messages = await this.storage.loadMessages(threadId);
    const sliced = limit > 0 ? messages.slice(-limit) : messages;
    return { messages: sliced };
  }

  private async createSession(
    params: Record<string, unknown>,
  ): Promise<{ threadId: string; status: string }> {
    const workspace = params.workspace as string;
    const prompt = params.prompt as string;
    const provider = (params.provider as string) || "claude-code";
    const model = params.model as string | undefined;
    const mode = params.mode as string | undefined;
    const title = params.title as string | undefined;
    const worktreeMode = params.worktreeMode as string | undefined;
    // Prefer images explicitly included by the LLM in the tool call; fall back
    // to images the user attached in the current Manager turn.
    const explicitImages = params.images as
      | { dataUrl: string; mimeType: string }[]
      | undefined;
    const images =
      explicitImages && explicitImages.length > 0
        ? explicitImages
        : this.pendingTurnImages.length > 0
          ? this.pendingTurnImages
          : undefined;

    // Ensure folder is registered
    const folders = this.storage.listFolders();
    const folderAdded = !folders.find((f) => f.path === workspace);
    if (folderAdded) {
      this.storage.addFolder(workspace);
    }

    // FileStorageAdapter.createThread unconditionally sets activeThreadId
    // to the new thread, which would yank the user's view away from the
    // Manager chat. Restore the previous active thread after the create.
    const previousActive = this.storage.getActiveThreadId();

    // Create thread — derive a title from the prompt if none was provided
    const derivedTitle = (() => {
      if (title) return title;
      const trimmed = prompt?.trim() ?? "";
      if (!trimmed) return "New chat";
      return trimmed.length > 50 ? trimmed.slice(0, 50) + "..." : trimmed;
    })();
    const thread = this.storage.createThread(
      derivedTitle,
      model,
      workspace,
      provider,
    );

    // Apply optional settings + mark as manager-spawned so AgentManager's
    // completion event can notify the Manager Agent when the child finishes.
    const updates: Record<string, unknown> = { spawnedBy: "manager" };
    if (mode) updates.mode = mode;
    if (worktreeMode) updates.worktreeMode = worktreeMode;
    this.storage.updateThread(thread.id, updates);

    if (previousActive && previousActive !== thread.id) {
      this.storage.setActiveThreadId(previousActive);
    }

    if (folderAdded) this.broadcast(IPC_CHANNELS.FOLDERS_CHANGED);
    this.broadcast(IPC_CHANNELS.THREADS_CHANGED);

    // Fire-and-forget: start the stream
    this.agentManager.startStream(thread.id, prompt, images).catch((err) => {
      console.error(
        `[manager-bridge] stream error for thread ${thread.id}:`,
        err,
      );
    });

    return { threadId: thread.id, status: "started" };
  }

  private async sendMessage(
    params: Record<string, unknown>,
  ): Promise<{ status: string }> {
    const threadId = params.threadId as string;
    const prompt = params.prompt as string;
    const explicitImages = params.images as
      | { dataUrl: string; mimeType: string }[]
      | undefined;
    const images =
      explicitImages && explicitImages.length > 0
        ? explicitImages
        : this.pendingTurnImages.length > 0
          ? this.pendingTurnImages
          : undefined;

    const thread = this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const isRunning = this.agentManager.isStreaming(threadId);

    if (isRunning) {
      // Queue: the message will be sent after the current stream completes.
      // For now, we reject — the user can retry.
      return { status: "queued" };
    }

    // Fire-and-forget
    this.agentManager.startStream(threadId, prompt, images).catch((err) => {
      console.error(
        `[manager-bridge] stream error for thread ${threadId}:`,
        err,
      );
    });

    return { status: "sent" };
  }

  private async stopSession(
    params: Record<string, unknown>,
  ): Promise<{ status: string }> {
    const threadId = params.threadId as string;
    const isRunning = this.agentManager.isStreaming(threadId);

    if (!isRunning) {
      return { status: "was_not_running" };
    }

    await this.agentManager.interruptSession(threadId);
    return { status: "stopped" };
  }

  private async deleteSession(
    params: Record<string, unknown>,
  ): Promise<{ status: string }> {
    const threadId = params.threadId as string;
    const thread = this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    if (thread.isManagerThread)
      throw new Error("Cannot delete the Manager thread");

    // Stop if running
    if (this.agentManager.isStreaming(threadId)) {
      await this.agentManager.interruptSession(threadId);
    }

    this.agentManager.clearSession(threadId);
    this.storage.deleteThread(threadId);
    this.broadcast(IPC_CHANNELS.THREADS_CHANGED);
    return { status: "deleted" };
  }

  private createWorkspace(params: Record<string, unknown>): {
    folderId: string;
    name: string;
    path: string;
  } {
    const path = params.path as string;
    const name = params.name as string | undefined;

    const folder = this.storage.addFolder(path, name);
    this.broadcast(IPC_CHANNELS.FOLDERS_CHANGED);
    return { folderId: folder.id, name: folder.name, path: folder.path };
  }

  private removeWorkspace(params: Record<string, unknown>): { status: string } {
    const folderId = params.folderId as string;
    this.storage.removeFolder(folderId);
    // removeFolder cascades — deletes every thread whose cwd matches the
    // folder path (see FileStorageAdapter.removeFolder). Refresh both lists.
    this.broadcast(IPC_CHANNELS.FOLDERS_CHANGED);
    this.broadcast(IPC_CHANNELS.THREADS_CHANGED);
    return { status: "removed" };
  }
}

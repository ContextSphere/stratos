/**
 * Unix domain socket bridge between the Manager MCP server subprocess
 * and the main Electron process.
 *
 * The MCP server sends JSON-RPC requests over the socket; this bridge
 * dispatches them to AgentManager and FileStorageAdapter, returning
 * results synchronously (from the subprocess's perspective).
 */
import { createServer, type Server } from "net";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { AgentManager } from "../agent-manager";
import type { FileStorageAdapter } from "@stratosapp/core";

export class ManagerBridge {
  private server: Server | null = null;
  private agentManager: AgentManager;
  private storage: FileStorageAdapter;
  private socketPath: string;

  constructor(
    agentManager: AgentManager,
    storage: FileStorageAdapter,
    socketPath: string,
  ) {
    this.agentManager = agentManager;
    this.storage = storage;
    this.socketPath = socketPath;
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
      default:
        throw new Error(`Unknown method: ${method}`);
    }
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

    // Ensure folder is registered
    const folders = this.storage.listFolders();
    if (!folders.find((f) => f.path === workspace)) {
      this.storage.addFolder(workspace);
    }

    // Create thread
    const thread = this.storage.createThread(
      title || "New chat",
      model,
      workspace,
      provider,
    );

    // Apply optional settings
    const updates: Record<string, unknown> = {};
    if (mode) updates.mode = mode;
    if (worktreeMode) updates.worktreeMode = worktreeMode;
    if (Object.keys(updates).length > 0) {
      this.storage.updateThread(thread.id, updates);
    }

    // Fire-and-forget: start the stream
    this.agentManager.startStream(thread.id, prompt).catch((err) => {
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

    const thread = this.storage.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const isRunning = this.agentManager.isStreaming(threadId);

    if (isRunning) {
      // Queue: the message will be sent after the current stream completes.
      // For now, we reject — the user can retry.
      return { status: "queued" };
    }

    // Fire-and-forget
    this.agentManager.startStream(threadId, prompt).catch((err) => {
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
    return { folderId: folder.id, name: folder.name, path: folder.path };
  }

  private removeWorkspace(params: Record<string, unknown>): { status: string } {
    const folderId = params.folderId as string;
    this.storage.removeFolder(folderId);
    return { status: "removed" };
  }
}

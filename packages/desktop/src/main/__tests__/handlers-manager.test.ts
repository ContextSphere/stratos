/**
 * Transport-agnostic tests for the manager handlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createManagerHandlers } from "../mcp/handlers/manager";
import { IPC_CHANNELS } from "../../common/ipc-channels";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

function byName(defs: ReturnType<typeof createManagerHandlers>, name: string) {
  const d = defs.find((h) => h.name === name);
  if (!d) throw new Error(`missing tool: ${name}`);
  return d;
}

function makeDeps() {
  const sendSpy = vi.fn();
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: sendSpy },
  };
  const threads: Record<string, Record<string, unknown>> = {};
  const folders: { id: string; name: string; path: string }[] = [];
  const messages: Record<string, { role: string; content: string }[]> = {};

  const storage = {
    listThreads: vi.fn(() => Object.values(threads)),
    listFolders: vi.fn(() => folders),
    getThread: vi.fn((id: string) => threads[id] ?? null),
    getActiveThreadId: vi.fn(() => null),
    setActiveThreadId: vi.fn(),
    createThread: vi.fn(
      (title: string, model: string, cwd: string, provider: string) => {
        const id = `t_${Object.keys(threads).length + 1}`;
        const now = Date.now();
        threads[id] = {
          id,
          title,
          model,
          cwd,
          provider,
          createdAt: now,
          updatedAt: now,
        };
        return threads[id];
      },
    ),
    updateThread: vi.fn((id: string, updates: Record<string, unknown>) => {
      if (threads[id]) Object.assign(threads[id], updates);
      return threads[id] ?? null;
    }),
    deleteThread: vi.fn((id: string) => {
      delete threads[id];
      return true;
    }),
    addFolder: vi.fn((p: string, name?: string) => {
      const folder = {
        id: `f_${folders.length + 1}`,
        name: name ?? p.split("/").pop()!,
        path: p,
      };
      folders.push(folder);
      return folder;
    }),
    removeFolder: vi.fn((id: string) => {
      const idx = folders.findIndex((f) => f.id === id);
      if (idx >= 0) folders.splice(idx, 1);
    }),
    loadMessages: vi.fn(async (id: string) => messages[id] ?? []),
  };

  const agentManager = {
    startStream: vi.fn().mockResolvedValue(undefined),
    isStreaming: vi.fn().mockReturnValue(false),
    interruptSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn(),
  };

  return {
    deps: {
      agentManager: agentManager as unknown as Parameters<
        typeof createManagerHandlers
      >[0]["agentManager"],
      storage: storage as unknown as Parameters<
        typeof createManagerHandlers
      >[0]["storage"],
      window: window as unknown as Parameters<
        typeof createManagerHandlers
      >[0]["window"],
    },
    sendSpy,
    storage,
    agentManager,
    threads,
    folders,
    messages,
  };
}

describe("manager handlers", () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  it("produces exactly 12 tools with the expected names", () => {
    const defs = createManagerHandlers(ctx.deps);
    expect(defs.map((d) => d.name).sort()).toEqual([
      "create_session",
      "create_workspace",
      "delete_session",
      "get_dashboard",
      "get_session",
      "list_sessions",
      "list_workspaces",
      "manager_post",
      "remove_workspace",
      "search_sessions",
      "send_message",
      "stop_session",
    ]);
  });

  it("create_session creates thread + broadcasts THREADS_CHANGED", async () => {
    ctx.folders.push({ id: "f1", name: "ws", path: "/tmp/ws" });
    const defs = createManagerHandlers(ctx.deps);

    const res = await byName(defs, "create_session").handler({
      workspace: "/tmp/ws",
      prompt: "hi",
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe("started");
    expect(parsed.threadId).toMatch(/^t_/);
    expect(ctx.agentManager.startStream).toHaveBeenCalledWith(
      parsed.threadId,
      "hi",
      undefined,
    );
    expect(ctx.sendSpy).toHaveBeenCalledWith(IPC_CHANNELS.THREADS_CHANGED);
  });

  it("send_message returns queued when session is already streaming", async () => {
    ctx.threads["t1"] = { id: "t1", title: "x", createdAt: 0, updatedAt: 0 };
    ctx.agentManager.isStreaming.mockReturnValue(true);
    const defs = createManagerHandlers(ctx.deps);

    const res = await byName(defs, "send_message").handler({
      threadId: "t1",
      prompt: "go",
    });

    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.status).toBe("queued");
    expect(ctx.agentManager.startStream).not.toHaveBeenCalled();
  });

  it("delete_session refuses to delete the Manager thread", async () => {
    ctx.threads["t1"] = {
      id: "t1",
      title: "x",
      createdAt: 0,
      updatedAt: 0,
      isManagerThread: true,
    };
    const defs = createManagerHandlers(ctx.deps);
    const res = await byName(defs, "delete_session").handler({
      threadId: "t1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Cannot delete the Manager thread");
  });

  it("list_sessions filters manager threads and paginates", async () => {
    for (let i = 1; i <= 3; i++) {
      ctx.threads[`t${i}`] = {
        id: `t${i}`,
        title: `thread ${i}`,
        createdAt: i,
        updatedAt: i,
      };
    }
    ctx.threads["mgr"] = {
      id: "mgr",
      title: "Manager",
      createdAt: 0,
      updatedAt: 99,
      isManagerThread: true,
    };
    const defs = createManagerHandlers(ctx.deps);

    const res = await byName(defs, "list_sessions").handler({ limit: 2 });
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.totalCount).toBe(3);
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextCursor).toBe("idx:2");
    expect(
      parsed.sessions.map((s: { threadId: string }) => s.threadId),
    ).not.toContain("mgr");
  });

  it("get_dashboard groups by provider and counts running", async () => {
    ctx.threads["t1"] = {
      id: "t1",
      title: "a",
      provider: "claude-code",
      createdAt: 0,
      updatedAt: 0,
    };
    ctx.threads["t2"] = {
      id: "t2",
      title: "b",
      provider: "codex",
      createdAt: 0,
      updatedAt: 0,
    };
    ctx.agentManager.isStreaming.mockImplementation(
      (id: string) => id === "t1",
    );
    const defs = createManagerHandlers(ctx.deps);

    const res = await byName(defs, "get_dashboard").handler({});
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.totalSessions).toBe(2);
    expect(parsed.running).toBe(1);
    expect(parsed.idle).toBe(1);
    expect(parsed.byProvider).toEqual({ "claude-code": 1, codex: 1 });
  });

  it("create_workspace broadcasts FOLDERS_CHANGED", async () => {
    const defs = createManagerHandlers(ctx.deps);
    const res = await byName(defs, "create_workspace").handler({
      path: "/tmp/new-ws",
    });
    expect(res.isError).toBeFalsy();
    expect(ctx.sendSpy).toHaveBeenCalledWith(IPC_CHANNELS.FOLDERS_CHANGED);
  });
});

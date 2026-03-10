import { describe, it, expect, vi, afterEach } from "vitest";
import { CodexProvider } from "../providers/codex.provider";

describe("CodexProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends turn/interrupt with threadId and turnId when available", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_123";
    provider.turnId = "turn_456";
    provider.appServer = {};
    provider.sendRpc = vi.fn().mockResolvedValue({});

    await provider.interrupt();

    expect(provider.sendRpc).toHaveBeenCalledTimes(1);
    expect(provider.sendRpc).toHaveBeenCalledWith("turn/interrupt", {
      threadId: "thr_123",
      turnId: "turn_456",
    });
  });

  it("falls back to thread-only interrupt if turnId interrupt fails", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_123";
    provider.turnId = "turn_456";
    provider.appServer = {};
    provider.sendRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("turnId rejected"))
      .mockResolvedValueOnce({});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await provider.interrupt();

    expect(provider.sendRpc).toHaveBeenNthCalledWith(1, "turn/interrupt", {
      threadId: "thr_123",
      turnId: "turn_456",
    });
    expect(provider.sendRpc).toHaveBeenNthCalledWith(2, "turn/interrupt", {
      threadId: "thr_123",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("clears turnId when turn/completed is received", async () => {
    const provider = new CodexProvider() as any;
    provider.turnId = "turn_456";
    provider.waitForNotification = vi.fn().mockResolvedValueOnce({
      method: "turn/completed",
      params: {
        turn: { status: "interrupted" },
      },
    });

    const out: unknown[] = [];
    for await (const msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler: async () => ({ approved: true }),
    })) {
      out.push(msg);
    }

    expect(provider.turnId).toBeUndefined();
    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "result",
          stop_reason: "stop_sequence",
        }),
      ]),
    );
  });

  it("applies mode policy on turn/start for existing threads", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_existing";
    provider.ensureAppServer = vi.fn().mockResolvedValue(undefined);
    provider.sendRpc = vi
      .fn()
      .mockImplementation((method: string, params: any) => {
        if (method === "turn/start") {
          return Promise.resolve({ turn: { id: "turn_1" }, ...params });
        }
        return Promise.resolve({});
      });
    provider.waitForNotification = vi.fn().mockResolvedValueOnce({
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    });

    const out: unknown[] = [];
    for await (const msg of provider.sendMessage({
      prompt: "hello",
      mode: "plan",
      permissionHandler: async () => ({ approved: true }),
    })) {
      out.push(msg);
    }

    expect(provider.sendRpc).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "thr_existing",
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    );
    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session_init",
          sessionId: "thr_existing",
        }),
        expect.objectContaining({ type: "result", stop_reason: "end_turn" }),
      ]),
    );
  });

  it("includes file change metadata in Edit permission payload", async () => {
    const provider = new CodexProvider() as any;
    const permissionHandler = vi.fn().mockResolvedValue({ approved: true });
    provider.sendResponse = vi.fn();
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "item/started",
        params: {
          item: {
            type: "fileChange",
            id: "fc_1",
            changes: [
              {
                path: "/repo/a.ts",
                kind: "update",
                diff: "@@ -1 +1 @@",
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        method: "item/fileChange/requestApproval",
        id: 42,
        params: {
          itemId: "fc_1",
          reason: null,
          grantRoot: null,
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: {
          turn: { status: "completed" },
        },
      });

    const out: unknown[] = [];
    for await (const msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler,
    })) {
      out.push(msg);
    }

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "permission_request",
          toolName: "Edit",
          input: expect.objectContaining({
            itemId: "fc_1",
            file_path: "/repo/a.ts",
            kind: "update",
            diff: "@@ -1 +1 @@",
            changes: [
              {
                file_path: "/repo/a.ts",
                kind: "update",
                diff: "@@ -1 +1 @@",
              },
            ],
          }),
        }),
      ]),
    );
    expect(permissionHandler).toHaveBeenCalledWith(
      "Edit",
      expect.objectContaining({
        itemId: "fc_1",
        file_path: "/repo/a.ts",
        kind: "update",
      }),
    );
    expect(provider.sendResponse).toHaveBeenCalledWith(42, {
      decision: "accept",
    });
  });

  it("keeps itemId in Edit approval payload when reason/grantRoot are null", async () => {
    const provider = new CodexProvider() as any;
    const permissionHandler = vi.fn().mockResolvedValue({ approved: true });
    provider.sendResponse = vi.fn();
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "item/fileChange/requestApproval",
        id: 43,
        params: {
          itemId: "fc_2",
          reason: null,
          grantRoot: null,
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: {
          turn: { status: "completed" },
        },
      });

    const out: unknown[] = [];
    for await (const msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler,
    })) {
      out.push(msg);
    }

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "permission_request",
          toolName: "Edit",
          input: expect.objectContaining({
            itemId: "fc_2",
          }),
        }),
      ]),
    );
    expect(permissionHandler).toHaveBeenCalledWith(
      "Edit",
      expect.objectContaining({
        itemId: "fc_2",
      }),
    );
    expect(permissionHandler).not.toHaveBeenCalledWith("Edit", {});
  });

  it("preserves reason and grantRoot in Edit approval payload", async () => {
    const provider = new CodexProvider() as any;
    const permissionHandler = vi.fn().mockResolvedValue({ approved: true });
    provider.sendResponse = vi.fn();
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "item/fileChange/requestApproval",
        id: 44,
        params: {
          itemId: "fc_3",
          reason: "Write access required",
          grantRoot: "/tmp",
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: {
          turn: { status: "completed" },
        },
      });

    const out: unknown[] = [];
    for await (const msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler,
    })) {
      out.push(msg);
    }

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "permission_request",
          toolName: "Edit",
          input: expect.objectContaining({
            itemId: "fc_3",
            reason: "Write access required",
            grantRoot: "/tmp",
          }),
        }),
      ]),
    );
    expect(permissionHandler).toHaveBeenCalledWith(
      "Edit",
      expect.objectContaining({
        itemId: "fc_3",
        reason: "Write access required",
        grantRoot: "/tmp",
      }),
    );
  });
});

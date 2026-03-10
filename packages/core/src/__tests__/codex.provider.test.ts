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
});

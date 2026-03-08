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
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { CodexProvider } from "../providers/codex.provider";
import { CopilotProvider } from "../providers/copilot.provider";
import { ClaudeCodeProvider } from "../providers/claude-code.provider";
import { SteerQueue } from "../utils/steer-queue";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexProvider.pushMessage", () => {
  it("sends turn/steer with expectedTurnId matching the active turn", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_123";
    provider.turnId = "turn_456";
    provider.appServer = {};
    provider.sendRpc = vi.fn().mockResolvedValue({ turnId: "turn_456" });

    await expect(provider.pushMessage("use the v2 API")).resolves.toBe(true);

    expect(provider.sendRpc).toHaveBeenCalledWith("turn/steer", {
      threadId: "thr_123",
      input: [{ type: "text", text: "use the v2 API", text_elements: [] }],
      expectedTurnId: "turn_456",
    });
  });

  it("returns false without an RPC when no turn is in flight", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_123";
    provider.turnId = undefined;
    provider.appServer = {};
    provider.sendRpc = vi.fn();

    await expect(provider.pushMessage("too late")).resolves.toBe(false);
    expect(provider.sendRpc).not.toHaveBeenCalled();
  });

  it("returns false when the server rejects the steer", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_123";
    provider.turnId = "turn_456";
    provider.appServer = {};
    provider.sendRpc = vi.fn().mockRejectedValue(new Error("no active turn"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(provider.pushMessage("nope")).resolves.toBe(false);
  });
});

describe("CopilotProvider.pushMessage", () => {
  it("sends with mode 'immediate' while a turn is active", async () => {
    const provider = new CopilotProvider() as any;
    const send = vi.fn().mockResolvedValue("msg_1");
    provider.currentSession = { send };
    provider.turnActive = true;

    await expect(
      provider.pushMessage("actually, skip the refactor"),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "actually, skip the refactor",
        mode: "immediate",
      }),
    );
  });

  it("returns false when no turn is active", async () => {
    const provider = new CopilotProvider() as any;
    const send = vi.fn();
    provider.currentSession = { send };
    provider.turnActive = false;

    await expect(provider.pushMessage("hello")).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns false when the SDK send rejects", async () => {
    const provider = new CopilotProvider() as any;
    provider.currentSession = {
      send: vi.fn().mockRejectedValue(new Error("closed")),
    };
    provider.turnActive = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(provider.pushMessage("hi")).resolves.toBe(false);
  });
});

describe("ClaudeCodeProvider.pushMessage", () => {
  it("enqueues a user message onto the live steer queue", async () => {
    const provider = new ClaudeCodeProvider() as any;
    const queue = new SteerQueue<any>();
    provider.steerQueue = queue;
    provider.sessionId = "sess_1";

    await expect(provider.pushMessage("also fix the test")).resolves.toBe(true);
    expect(queue.pending).toBe(1);

    const seen: any[] = [];
    queue.close();
    for await (const item of queue.drain()) seen.push(item);

    expect(seen[0]).toMatchObject({
      type: "user",
      message: { role: "user", content: "also fix the test" },
      session_id: "sess_1",
    });
  });

  it("builds image blocks when attachments are present", async () => {
    const provider = new ClaudeCodeProvider() as any;
    const queue = new SteerQueue<any>();
    provider.steerQueue = queue;

    await provider.pushMessage("look at this", [
      { dataUrl: "data:image/png;base64,AAAB", mimeType: "image/png" },
    ]);

    queue.close();
    const seen: any[] = [];
    for await (const item of queue.drain()) seen.push(item);

    expect(seen[0].message.content).toEqual([
      { type: "text", text: "look at this" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AAAB" },
      },
    ]);
  });

  it("returns false when there is no live turn", async () => {
    const provider = new ClaudeCodeProvider() as any;
    provider.steerQueue = undefined;
    await expect(provider.pushMessage("nothing running")).resolves.toBe(false);
  });

  it("returns false once the turn's queue has closed", async () => {
    const provider = new ClaudeCodeProvider() as any;
    const queue = new SteerQueue<any>();
    provider.steerQueue = queue;
    queue.close();

    await expect(provider.pushMessage("too late")).resolves.toBe(false);
  });
});

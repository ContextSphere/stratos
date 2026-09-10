import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, SessionEventHandler } from "@github/copilot-sdk";
import { CopilotProvider } from "../providers/copilot.provider";
import type { AgentMessage, SendMessageParams } from "../providers/types";

// The provider loads the SDK's CommonJS entry point.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk: typeof import("@github/copilot-sdk") = require("@github/copilot-sdk");

const metadata = {
  id: "event",
  parentId: null,
  timestamp: "2026-09-10T00:00:00.000Z",
  ephemeral: true as const,
};
const idle: SessionEvent = { ...metadata, type: "session.idle", data: {} };
const failure: SessionEvent = {
  ...metadata,
  type: "session.error",
  data: {
    errorType: "system",
    message: "WebSocket receive failed: Connection reset [ECONNRESET]",
  },
};
const params: SendMessageParams = {
  prompt: "hello",
  permissionHandler: async () => ({ approved: true }),
};

describe("CopilotProvider turn lifecycle", () => {
  let provider: CopilotProvider;
  let handlers: SessionEventHandler[];
  let session: InstanceType<typeof sdk.CopilotSession>;

  beforeEach(() => {
    provider = new CopilotProvider();
    handlers = [];
    // All RPC methods used by these tests are mocked; no runtime is started.
    session = Object.assign(new sdk.CopilotSession(), {
      sessionId: "copilot-session",
    });
    vi.spyOn(session, "send").mockResolvedValue("message");
    vi.spyOn(session, "abort").mockResolvedValue(undefined);
    vi.spyOn(session, "disconnect").mockResolvedValue(undefined);
    vi.spyOn(sdk.CopilotClient.prototype, "createSession").mockImplementation(
      async (config) => {
        handlers.push(config!.onEvent!);
        return session;
      },
    );
    vi.spyOn(sdk.CopilotClient.prototype, "resumeSession").mockImplementation(
      async (_id, config) => {
        handlers.push(config!.onEvent!);
        return session;
      },
    );
  });

  afterEach(async () => {
    for (const handler of handlers) handler(idle);
    await provider.dispose();
    vi.restoreAllMocks();
  });

  function startTurn(overrides: Partial<SendMessageParams> = {}) {
    const messages: AgentMessage[] = [];
    let finished = false;
    const done = (async () => {
      for await (const message of provider.sendMessage({
        ...params,
        ...overrides,
      })) {
        messages.push(message);
      }
      finished = true;
    })();
    return { messages, done, isFinished: () => finished };
  }

  async function expectFinished(turn: ReturnType<typeof startTurn>) {
    await vi.waitFor(() => expect(turn.isFinished()).toBe(true));
    await turn.done;
    expect(await provider.pushMessage("not steering a stopped turn")).toBe(
      false,
    );
  }

  it("ends on a session error without waiting for idle and can resume immediately", async () => {
    const first = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    const firstHandler = handlers[0];
    firstHandler(failure);

    await expectFinished(first);
    expect(first.messages.filter((m) => m.type === "error")).toEqual([
      { type: "error", message: failure.data.message, code: "system" },
    ]);
    expect(first.messages.some((m) => m.type === "result")).toBe(false);

    const next = startTurn({
      prompt: "continue",
      sessionId: session.sessionId,
    });
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledTimes(2));
    firstHandler(failure);
    firstHandler(idle);
    expect(await provider.pushMessage("still steering the new turn")).toBe(
      true,
    );
    expect(next.messages.some((m) => m.type === "error")).toBe(false);
    handlers[1](idle);
    await expectFinished(next);
  });

  it("ends when the send RPC rejects without emitting idle", async () => {
    vi.mocked(session.send).mockRejectedValue(new Error("connection closed"));
    const turn = startTurn();

    await expectFinished(turn);
    expect(turn.messages).toContainEqual({
      type: "error",
      message: "connection closed",
      code: "system",
    });
  });

  it.each(["acknowledged", "rejected"])(
    "ends after an %s abort RPC without an idle event",
    async (outcome) => {
      if (outcome === "rejected") {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.mocked(session.abort).mockRejectedValue(
          new Error("session already dead"),
        );
      }
      const turn = startTurn();
      await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());

      await provider.interrupt();

      await expectFinished(turn);
      expect(session.abort).toHaveBeenCalledOnce();
      expect(turn.messages.some((m) => m.type === "error")).toBe(false);
    },
  );

  it("ends on an abort event without waiting for idle", async () => {
    const turn = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    handlers[0]({
      ...metadata,
      type: "abort",
      data: { reason: "user_initiated" },
    });

    await expectFinished(turn);
  });

  it("does not wait for an unresolved send RPC after a terminal error", async () => {
    vi.mocked(session.send).mockImplementation(() => new Promise(() => {}));
    const turn = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    handlers[0](failure);

    await expectFinished(turn);
  });

  it("does not send when stopped while the session is being created", async () => {
    let finishCreation!: () => void;
    vi.mocked(sdk.CopilotClient.prototype.createSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreation = () => resolve(session);
        }),
    );
    const turn = startTurn();
    await vi.waitFor(() => expect(finishCreation).toBeDefined());

    await provider.interrupt();
    finishCreation();

    await expectFinished(turn);
    expect(session.send).not.toHaveBeenCalled();
  });

  it("does not close a replacement turn when an old abort RPC settles", async () => {
    let finishAbort!: () => void;
    vi.mocked(session.abort).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAbort = resolve;
        }),
    );
    const first = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    const interrupted = provider.interrupt();
    handlers[0]({
      ...metadata,
      type: "abort",
      data: { reason: "user_initiated" },
    });
    await expectFinished(first);

    const next = startTurn({ sessionId: session.sessionId });
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledTimes(2));
    finishAbort();
    await interrupted;
    expect(await provider.pushMessage("new turn is still active")).toBe(true);
    handlers[1](idle);
    await expectFinished(next);
  });

  it("releases a waiting turn on disposal without an idle event", async () => {
    const turn = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());

    await provider.dispose();

    await expectFinished(turn);
  });

  it("does not let subagent terminal events finish the parent turn", async () => {
    const turn = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    handlers[0]({ ...failure, agentId: "child" });
    handlers[0]({ ...idle, agentId: "child" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(turn.isFinished()).toBe(false);
    expect(
      turn.messages.some((m) => m.type === "error" || m.type === "result"),
    ).toBe(false);
    expect(await provider.pushMessage("parent is still active")).toBe(true);
    handlers[0](idle);
    await expectFinished(turn);
  });

  it("does not treat model-call failure telemetry as a terminal error", async () => {
    const turn = startTurn();
    await vi.waitFor(() => expect(session.send).toHaveBeenCalledOnce());
    handlers[0]({
      ...metadata,
      type: "model.call_failure",
      data: { source: "top_level", errorMessage: "retrying request" },
    });
    handlers[0](idle);

    await expectFinished(turn);
    expect(turn.messages.some((m) => m.type === "error")).toBe(false);
    expect(turn.messages.filter((m) => m.type === "result")).toHaveLength(1);
  });
});

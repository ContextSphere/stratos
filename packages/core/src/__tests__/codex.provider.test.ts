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

  it("does not send request_user_input flag in thread/start payload", async () => {
    const provider = new CodexProvider() as any;
    provider.ensureAppServer = vi.fn().mockResolvedValue(undefined);
    provider.sendRpc = vi.fn().mockImplementation((method: string) => {
      if (method === "thread/start") {
        return Promise.resolve({ thread: { id: "thr_new" } });
      }
      if (method === "turn/start") {
        return Promise.resolve({ turn: { id: "turn_1" } });
      }
      return Promise.resolve({});
    });
    provider.waitForNotification = vi.fn().mockResolvedValueOnce({
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    });

    for await (const _msg of provider.sendMessage({
      prompt: "hello",
      mode: "default",
      model: "gpt-5.3-codex",
      permissionHandler: async () => ({ approved: true }),
    })) {
      // no-op
    }

    expect(provider.sendRpc).toHaveBeenCalledWith(
      "thread/start",
      expect.not.objectContaining({
        config: expect.anything(),
      }),
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

  it("handles requestUserInput via AskUserQuestion and returns app-server answer payload", async () => {
    const provider = new CodexProvider() as any;
    const permissionHandler = vi.fn().mockResolvedValue({
      approved: true,
      modifiedInput: {
        answers: {
          "Pick one option": "A",
          "Pick multiple options": "B, C",
        },
      },
    });
    provider.sendResponse = vi.fn();
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "item/tool/requestUserInput",
        id: 99,
        params: {
          questions: [
            {
              id: "q1",
              question: "Pick one option",
              multiSelect: false,
              options: [{ label: "A" }, { label: "B" }],
            },
            {
              id: "q2",
              question: "Pick multiple options",
              multiSelect: true,
              options: [{ label: "B" }, { label: "C" }],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });

    for await (const _msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler,
    })) {
      // no-op
    }

    expect(permissionHandler).toHaveBeenCalledWith(
      "AskUserQuestion",
      expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({
            id: "q1",
            question: "Pick one option",
          }),
          expect.objectContaining({
            id: "q2",
            question: "Pick multiple options",
            multiSelect: true,
          }),
        ]),
      }),
    );
    expect(provider.sendResponse).toHaveBeenCalledWith(99, {
      answers: {
        q1: { answers: ["A"] },
        q2: { answers: ["B", "C"] },
      },
    });
  });

  it("emits plan_update for turn plan updates", async () => {
    const provider = new CodexProvider() as any;
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "turn/plan/updated",
        params: {
          explanation: "Plan summary",
          plan: [
            { step: "Step one", status: "in_progress" },
            { step: "Step two", status: "pending" },
          ],
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });

    const out: unknown[] = [];
    for await (const msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler: async () => ({ approved: true }),
    })) {
      out.push(msg);
    }

    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "plan_update",
          isStreaming: true,
          content: expect.stringContaining("## Plan"),
        }),
      ]),
    );
  });

  it("returns empty answers when AskUserQuestion is denied", async () => {
    const provider = new CodexProvider() as any;
    const permissionHandler = vi.fn().mockResolvedValue({ approved: false });
    provider.sendResponse = vi.fn();
    provider.waitForNotification = vi
      .fn()
      .mockResolvedValueOnce({
        method: "item/tool/requestUserInput",
        id: 100,
        params: {
          questions: [{ id: "q1", question: "Pick one", options: [] }],
        },
      })
      .mockResolvedValueOnce({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });

    for await (const _msg of provider.processTurnNotifications({
      prompt: "test",
      permissionHandler,
    })) {
      // no-op
    }

    expect(provider.sendResponse).toHaveBeenCalledWith(100, { answers: {} });
  });

  it("sends plan collaborationMode object when model is known", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_existing";
    provider.ensureAppServer = vi.fn().mockResolvedValue(undefined);
    provider.planCollaborationMode = {
      mode: "plan",
      settings: {
        model: "gpt-5.1-codex",
        reasoning_effort: "medium",
        developer_instructions: null,
      },
    };
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

    for await (const _msg of provider.sendMessage({
      prompt: "hello",
      mode: "plan",
      permissionHandler: async () => ({ approved: true }),
    })) {
      // no-op
    }

    expect(provider.sendRpc).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "thr_existing",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.1-codex",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      }),
    );
  });

  it("does not send collaborationMode when mode is default", async () => {
    const provider = new CodexProvider() as any;
    provider.threadId = "thr_existing";
    provider.ensureAppServer = vi.fn().mockResolvedValue(undefined);
    provider.planCollaborationMode = {
      mode: "plan",
      settings: {
        model: "gpt-5.3-codex",
        reasoning_effort: "medium",
        developer_instructions: null,
      },
    };
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

    for await (const _msg of provider.sendMessage({
      prompt: "hello",
      mode: "default",
      permissionHandler: async () => ({ approved: true }),
    })) {
      // no-op
    }

    const turnStartCall = provider.sendRpc.mock.calls.find(
      ([method]: [string]) => method === "turn/start",
    );
    expect(turnStartCall).toBeDefined();
    expect(turnStartCall[1]).not.toHaveProperty("collaborationMode");
  });
});

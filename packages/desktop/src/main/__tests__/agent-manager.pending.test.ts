import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  Notification: vi
    .fn()
    .mockImplementation(() => ({ on: vi.fn(), show: vi.fn() })),
  shell: { openExternal: vi.fn() },
}));

vi.mock("@stratosapp/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stratosapp/core")>();
  return { ...original, ClaudeCodeProvider: vi.fn() };
});

vi.mock("../settings/settings.store", () => ({
  loadSettings: vi.fn().mockReturnValue({}),
  setProviderSettings: vi.fn(),
  isManagerEnabled: vi.fn().mockReturnValue(false),
}));

describe("AgentManager — mid-turn messages", () => {
  let sent: Array<{ channel: string; data: any; threadId?: string }>;
  let mockWindow: any;
  let AgentManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    sent = [];
    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isFocused: vi.fn().mockReturnValue(true),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
        send: vi.fn((channel: string, data: unknown, threadId?: string) => {
          sent.push({ channel, data, threadId });
        }),
      },
    };
    AgentManager = (await import("../agent-manager")).AgentManager;
  });

  /** Manager with runStream stubbed so no provider/subprocess is needed. */
  function makeManager() {
    const manager = new AgentManager(mockWindow) as any;
    const runStream = vi.fn().mockResolvedValue(undefined);
    manager.runStream = runStream;
    return { manager, runStream };
  }

  function markRunning(manager: any, threadId: string, provider?: any) {
    manager.activeStreams.add(threadId);
    if (provider) {
      // dispose/interrupt are always present on a real AgentProvider; stub them
      // so manager.dispose() in the test teardown doesn't blow up.
      manager.sessions.set(threadId, {
        provider: {
          dispose: vi.fn().mockResolvedValue(undefined),
          interrupt: vi.fn().mockResolvedValue(undefined),
          ...provider,
        },
      });
    }
  }

  describe("enqueueMessage", () => {
    it("sends immediately when nothing is running", async () => {
      const { manager, runStream } = makeManager();

      const res = await manager.enqueueMessage("t1", "hello");

      expect(res).toEqual({ status: "sent", fellBack: false });
      expect(runStream).toHaveBeenCalledWith(
        "t1",
        "hello",
        undefined,
        "user",
        true,
      );
      expect(manager.listPending("t1")).toEqual([]);
      manager.dispose();
    });

    it("queues instead of sending while a turn is running", async () => {
      const { manager, runStream } = makeManager();
      markRunning(manager, "t1");

      const res = await manager.enqueueMessage("t1", "next, write tests");

      expect(res.status).toBe("queued");
      expect(res.fellBack).toBe(false);
      expect(runStream).not.toHaveBeenCalled();
      expect(manager.listPending("t1")).toHaveLength(1);
      expect(manager.listPending("t1")[0].prompt).toBe("next, write tests");
      manager.dispose();
    });

    it("steers into the live turn when the provider supports it", async () => {
      const { manager, runStream } = makeManager();
      const pushMessage = vi.fn().mockResolvedValue(true);
      markRunning(manager, "t1", { pushMessage });

      const res = await manager.enqueueMessage(
        "t1",
        "actually use the v2 API",
        undefined,
        "steer",
      );

      expect(res).toEqual({ status: "steered", fellBack: false });
      expect(pushMessage).toHaveBeenCalledWith(
        "actually use the v2 API",
        undefined,
      );
      // Nothing queued: it went straight into the running turn.
      expect(manager.listPending("t1")).toEqual([]);
      expect(runStream).not.toHaveBeenCalled();
      // The steered text is mirrored into the transcript.
      expect(sent.some((m) => m.data?.type === "steered_message")).toBe(true);
      manager.dispose();
    });

    it("interrupts Codex and forces the correction into the next turn", async () => {
      const { manager, runStream } = makeManager();
      const interrupt = vi.fn().mockResolvedValue(undefined);
      const pushMessage = vi.fn().mockResolvedValue(true);
      markRunning(manager, "t1", {
        name: "codex",
        interrupt,
        pushMessage,
      });

      const res = await manager.enqueueMessage(
        "t1",
        "stop and do this instead",
        undefined,
        "steer",
      );

      expect(res.status).toBe("queued");
      expect(res.fellBack).toBe(false);
      expect(pushMessage).not.toHaveBeenCalled();
      expect(interrupt).toHaveBeenCalledOnce();
      expect(runStream).not.toHaveBeenCalled();
      expect(manager.listPending("t1")[0]).toMatchObject({
        prompt: "stop and do this instead",
        requested: "steer",
        force: true,
      });
      manager.dispose();
    });

    it("interrupts Claude and forces the correction into the next turn", async () => {
      const { manager } = makeManager();
      const interrupt = vi.fn().mockResolvedValue(undefined);
      const pushMessage = vi.fn().mockResolvedValue(true);
      markRunning(manager, "t1", {
        name: "claude-code",
        interrupt,
        pushMessage,
      });

      const res = await manager.enqueueMessage(
        "t1",
        "stop and do this instead",
        undefined,
        "steer",
      );

      expect(res.status).toBe("queued");
      expect(res.fellBack).toBe(false);
      expect(pushMessage).not.toHaveBeenCalled();
      expect(interrupt).toHaveBeenCalledOnce();
      expect(manager.listPending("t1")[0]).toMatchObject({
        requested: "steer",
        force: true,
      });
      manager.dispose();
    });

    it("falls back to queueing when the provider cannot steer", async () => {
      const { manager } = makeManager();
      // No pushMessage at all — the opencode case until its API migration.
      markRunning(manager, "t1", {});

      const res = await manager.enqueueMessage(
        "t1",
        "correct me",
        undefined,
        "steer",
      );

      expect(res.status).toBe("queued");
      expect(res.fellBack).toBe(true);
      const pending = manager.listPending("t1");
      expect(pending).toHaveLength(1);
      expect(pending[0].fellBack).toBe(true);
      expect(pending[0].requested).toBe("steer");
      manager.dispose();
    });

    it("falls back to queueing when pushMessage reports no live turn", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1", {
        pushMessage: vi.fn().mockResolvedValue(false),
      });

      const res = await manager.enqueueMessage("t1", "hi", undefined, "steer");

      expect(res.fellBack).toBe(true);
      expect(manager.listPending("t1")).toHaveLength(1);
      manager.dispose();
    });

    it("falls back to queueing when pushMessage throws", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1", {
        pushMessage: vi.fn().mockRejectedValue(new Error("transport dead")),
      });

      const res = await manager.enqueueMessage("t1", "hi", undefined, "steer");

      expect(res.fellBack).toBe(true);
      expect(manager.listPending("t1")).toHaveLength(1);
      manager.dispose();
    });

    it("break interrupts the running turn and marks the message forced", async () => {
      const { manager } = makeManager();
      const interrupt = vi.fn().mockResolvedValue(undefined);
      markRunning(manager, "t1", { interrupt });

      const res = await manager.enqueueMessage(
        "t1",
        "stop, wrong direction",
        undefined,
        "break",
      );

      expect(res.status).toBe("queued");
      expect(interrupt).toHaveBeenCalled();
      expect(manager.listPending("t1")[0].force).toBe(true);
      manager.dispose();
    });

    it("caps the queue and drops the oldest non-forced entry", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1");

      for (let i = 0; i < 13; i++) {
        await manager.enqueueMessage("t1", `msg ${i}`);
      }

      const pending = manager.listPending("t1");
      expect(pending).toHaveLength(10);
      // Oldest were evicted; the newest survive.
      expect(pending[0].prompt).toBe("msg 3");
      expect(pending[9].prompt).toBe("msg 12");
      manager.dispose();
    });

    it("never evicts a forced (break) message when capping", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1", { interrupt: vi.fn() });

      await manager.enqueueMessage("t1", "urgent", undefined, "break");
      for (let i = 0; i < 12; i++) {
        await manager.enqueueMessage("t1", `msg ${i}`);
      }

      const pending = manager.listPending("t1");
      expect(pending).toHaveLength(10);
      expect(pending.some((m: any) => m.prompt === "urgent")).toBe(true);
      manager.dispose();
    });
  });

  describe("drainPending", () => {
    it("delivers the next queued message in FIFO order", async () => {
      const { manager, runStream } = makeManager();
      markRunning(manager, "t1");
      await manager.enqueueMessage("t1", "first");
      await manager.enqueueMessage("t1", "second");

      manager.drainPending("t1", false);

      expect(runStream).toHaveBeenCalledWith(
        "t1",
        "first",
        undefined,
        "user",
        true,
      );
      expect(manager.listPending("t1")).toHaveLength(1);
      expect(manager.listPending("t1")[0].prompt).toBe("second");
      manager.dispose();
    });

    it("drops the queue when the user interrupted", async () => {
      // Stop should mean stop: a queued follow-up is stale intent.
      const { manager, runStream } = makeManager();
      markRunning(manager, "t1");
      await manager.enqueueMessage("t1", "queued follow-up");

      manager.drainPending("t1", true);

      expect(runStream).not.toHaveBeenCalled();
      expect(manager.listPending("t1")).toEqual([]);
      manager.dispose();
    });

    it("still delivers a forced message after an interrupt", async () => {
      // Break asked for the interrupt, so its message must survive it.
      const { manager, runStream } = makeManager();
      markRunning(manager, "t1", { interrupt: vi.fn() });
      await manager.enqueueMessage("t1", "do this instead", undefined, "break");

      manager.drainPending("t1", true);

      expect(runStream).toHaveBeenCalledWith(
        "t1",
        "do this instead",
        undefined,
        "user",
        true,
      );
      manager.dispose();
    });

    it("is a no-op when nothing is queued", async () => {
      const { manager, runStream } = makeManager();
      manager.drainPending("t1", false);
      expect(runStream).not.toHaveBeenCalled();
      manager.dispose();
    });

    it("preserves images through the queue", async () => {
      const { manager, runStream } = makeManager();
      markRunning(manager, "t1");
      const images = [
        { dataUrl: "data:image/png;base64,AA", mimeType: "image/png" },
      ];
      await manager.enqueueMessage("t1", "look", images);

      manager.drainPending("t1", false);

      expect(runStream).toHaveBeenCalledWith(
        "t1",
        "look",
        images,
        "user",
        true,
      );
      manager.dispose();
    });
  });

  describe("cancelPending / promotePending", () => {
    it("cancels a queued message and notifies the renderer", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1");
      const res = await manager.enqueueMessage("t1", "never mind");

      expect(manager.cancelPending("t1", res.id)).toBe(true);
      expect(manager.listPending("t1")).toEqual([]);
      expect(
        sent.filter((m) => m.channel === "chat:pending:changed").length,
      ).toBeGreaterThan(0);
      manager.dispose();
    });

    it("returns false cancelling an unknown id", async () => {
      const { manager } = makeManager();
      expect(manager.cancelPending("t1", "nope")).toBe(false);
      manager.dispose();
    });

    it("promoting to steer removes it from the queue on success", async () => {
      const { manager } = makeManager();
      const pushMessage = vi.fn().mockResolvedValue(true);
      markRunning(manager, "t1", { pushMessage });
      const res = await manager.enqueueMessage("t1", "actually, do X");

      const promoted = await manager.promotePending("t1", res.id, "steer");

      expect(promoted.status).toBe("steered");
      expect(pushMessage).toHaveBeenCalledWith("actually, do X", undefined);
      expect(manager.listPending("t1")).toEqual([]);
      manager.dispose();
    });

    it("promoting a Codex item interrupts and moves it to the front", async () => {
      const { manager } = makeManager();
      const interrupt = vi.fn().mockResolvedValue(undefined);
      const pushMessage = vi.fn().mockResolvedValue(true);
      markRunning(manager, "t1", {
        name: "codex",
        interrupt,
        pushMessage,
      });
      await manager.enqueueMessage("t1", "first");
      const second = await manager.enqueueMessage("t1", "second");

      const promoted = await manager.promotePending("t1", second.id, "steer");

      expect(promoted.status).toBe("queued");
      expect(promoted.fellBack).toBe(false);
      expect(pushMessage).not.toHaveBeenCalled();
      expect(interrupt).toHaveBeenCalledOnce();
      expect(manager.listPending("t1")[0]).toMatchObject({
        prompt: "second",
        requested: "queue",
        force: true,
      });
      manager.dispose();
    });

    it("promoting to steer keeps it queued and flags fallback on failure", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1", {
        pushMessage: vi.fn().mockResolvedValue(false),
      });
      const res = await manager.enqueueMessage("t1", "hmm");

      const promoted = await manager.promotePending("t1", res.id, "steer");

      expect(promoted.fellBack).toBe(true);
      expect(manager.listPending("t1")).toHaveLength(1);
      expect(manager.listPending("t1")[0].fellBack).toBe(true);
      manager.dispose();
    });

    it("promoting to steer flags fallback when the provider has no steer method", async () => {
      const { manager } = makeManager();
      markRunning(manager, "t1", {});
      const res = await manager.enqueueMessage("t1", "hmm");

      const promoted = await manager.promotePending("t1", res.id, "steer");

      expect(promoted.fellBack).toBe(true);
      expect(manager.listPending("t1")[0].fellBack).toBe(true);
      manager.dispose();
    });

    it("promoting to break interrupts and moves the message to the front", async () => {
      const { manager } = makeManager();
      const interrupt = vi.fn().mockResolvedValue(undefined);
      markRunning(manager, "t1", { interrupt });
      await manager.enqueueMessage("t1", "first");
      const second = await manager.enqueueMessage("t1", "second");

      await manager.promotePending("t1", second.id, "break");

      expect(interrupt).toHaveBeenCalled();
      const pending = manager.listPending("t1");
      expect(pending[0].prompt).toBe("second");
      expect(pending[0].force).toBe(true);
      manager.dispose();
    });

    it("returns null promoting an unknown id", async () => {
      const { manager } = makeManager();
      await expect(
        manager.promotePending("t1", "nope", "steer"),
      ).resolves.toBeNull();
      manager.dispose();
    });
  });
});

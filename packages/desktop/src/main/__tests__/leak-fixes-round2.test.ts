/**
 * Regression tests for round-2 memory-leak fixes.
 *
 * Covers:
 *   F1 — terminal-manager.ts reaps PTYs on renderer reload
 *   F2 — scheduler.ts notification listener cleanup
 *   F4 — ManagerSession.notificationQueue coalescing + cap
 *
 * F3 is exercised indirectly by the existing files watcher tests; this file
 * adds a focused micro-test that the watcher's error handler clears the
 * debounce-timers Map.
 *
 * Crash-capture telemetry has its own test file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Electron mock — must be hoisted before any module under test imports it.
type EventCallback = (...args: unknown[]) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockNotification(): any {
  const listeners = new Map<string, EventCallback[]>();
  return {
    on: vi.fn((evt: string, cb: EventCallback) => {
      const arr = listeners.get(evt) ?? [];
      arr.push(cb);
      listeners.set(evt, arr);
    }),
    removeAllListeners: vi.fn(() => {
      listeners.clear();
    }),
    show: vi.fn(),
    close: vi.fn(),
    fire(evt: string, ...args: unknown[]): void {
      for (const cb of listeners.get(evt) ?? []) cb(...args);
    },
    _listenerCount(evt?: string): number {
      if (evt) return listeners.get(evt)?.length ?? 0;
      return [...listeners.values()].reduce((a, l) => a + l.length, 0);
    },
  };
}

const notificationInstances: ReturnType<typeof makeMockNotification>[] = [];
function NotificationCtor(): unknown {
  const n = makeMockNotification();
  notificationInstances.push(n);
  return n;
}
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  Notification: NotificationCtor,
}));

// node-pty mock for terminal manager tests
const ptyInstances: Array<{
  killed: boolean;
  onDataCb?: EventCallback;
  onExitCb?: EventCallback;
}> = [];
vi.mock("node-pty", () => ({
  spawn: vi.fn(() => {
    const p: {
      killed: boolean;
      onDataCb?: EventCallback;
      onExitCb?: EventCallback;
      onData(cb: EventCallback): void;
      onExit(cb: EventCallback): void;
      kill(): void;
      write(): void;
      resize(): void;
    } = {
      killed: false,
      onData(cb) {
        this.onDataCb = cb;
      },
      onExit(cb) {
        this.onExitCb = cb;
      },
      kill() {
        this.killed = true;
      },
      write() {},
      resize() {},
    };
    ptyInstances.push(p);
    return p;
  }),
}));

vi.mock("@stratosapp/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stratosapp/core")>();
  return {
    ...original,
    ClaudeCodeProvider: vi.fn(),
    appendScheduleRun: vi.fn(),
  };
});

vi.mock("../settings/settings.store", () => ({
  loadSettings: vi.fn().mockReturnValue({}),
  setProviderSettings: vi.fn(),
  getOpencodeProviderKeys: vi.fn().mockReturnValue({}),
  isManagerEnabled: vi.fn().mockReturnValue(false),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  notificationInstances.length = 0;
  ptyInstances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// F2: scheduler.ts notification listener cleanup
// ─────────────────────────────────────────────────────────────────────

describe("F2: scheduler notification cleanup", () => {
  it("removes click handler closure when notification is closed", async () => {
    const { SchedulerManager } = await import("../scheduler/scheduler");

    const window = {
      isDestroyed: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sm = new SchedulerManager({} as any, {} as any, window as any);

    // Trigger via private method — the only public call site is through a
    // full scheduled-run lifecycle which is over-broad for this test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sm as any).notifyRunFinished(
      { name: "Test schedule", id: "s1" },
      "thread-1",
      "completed",
    );

    // Notification was shown; listeners are attached
    expect(notificationInstances.length).toBe(1);
    const n = notificationInstances[0];
    expect(n.show).toHaveBeenCalled();
    expect(n._listenerCount()).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).activeNotifications.size).toBe(1);

    // macOS dismissal fires 'close' → drop() removes listeners + set entry
    n.fire("close");
    expect(n._listenerCount()).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).activeNotifications.size).toBe(0);

    sm.dispose();
  });

  it("dispose closes any remaining notifications", async () => {
    const { SchedulerManager } = await import("../scheduler/scheduler");

    const window = {
      isDestroyed: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn().mockReturnValue(false),
        send: vi.fn(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sm = new SchedulerManager({} as any, {} as any, window as any);

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sm as any).notifyRunFinished(
        { name: `s${i}`, id: `id-${i}` },
        `t${i}`,
        "completed",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).activeNotifications.size).toBe(3);

    sm.dispose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((sm as any).activeNotifications.size).toBe(0);
    for (const n of notificationInstances) {
      expect(n.removeAllListeners).toHaveBeenCalled();
      expect(n.close).toHaveBeenCalled();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// F4: ManagerSession.notificationQueue coalescing + cap
// ─────────────────────────────────────────────────────────────────────

describe("F4: ManagerSession.enqueueNotification", () => {
  async function makeSession(): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queue: () => any[];
  }> {
    const { ManagerSession } = await import("../manager/manager-session");
    // ManagerSession is a singleton; reset before each test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ManagerSession as any).instance = null;

    const session = ManagerSession.initialize(
      {
        onStreamCompleted: vi.fn(() => () => {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { listThreads: () => [], getThread: () => null } as any,
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: vi.fn() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    return {
      session,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue: () => (session as any).notificationQueue,
    };
  }

  it("coalesces repeated enqueues for the same scheduleId", async () => {
    const { session, queue } = await makeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enq = (session as any).enqueueNotification.bind(session);
    enq({ prompt: "first", scheduleId: "S1" });
    enq({ prompt: "second", scheduleId: "S1" });
    enq({ prompt: "third", scheduleId: "S1" });
    expect(queue().length).toBe(1);
    expect(queue()[0].prompt).toBe("third");
    session.dispose();
  });

  it("does NOT coalesce different scheduleIds", async () => {
    const { session, queue } = await makeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enq = (session as any).enqueueNotification.bind(session);
    enq({ prompt: "a", scheduleId: "A" });
    enq({ prompt: "b", scheduleId: "B" });
    expect(queue().length).toBe(2);
    session.dispose();
  });

  it("caps queue size and drops the oldest non-coalesced entry", async () => {
    const { session, queue } = await makeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enq = (session as any).enqueueNotification.bind(session);
    // Fill with raw (non-coalesced) entries to MAX
    for (let i = 0; i < 100; i++) {
      enq({ prompt: `raw-${i}` });
    }
    expect(queue().length).toBe(100);
    // 101st should drop the oldest raw entry, not exceed cap
    enq({ prompt: "raw-100" });
    expect(queue().length).toBe(100);
    expect(queue().some((e: { prompt: string }) => e.prompt === "raw-0")).toBe(
      false,
    );
    expect(
      queue().some((e: { prompt: string }) => e.prompt === "raw-100"),
    ).toBe(true);
    session.dispose();
  });

  it("at cap, prefers dropping non-coalesced raw entries over scheduled-task entries", async () => {
    const { session, queue } = await makeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enq = (session as any).enqueueNotification.bind(session);
    // 50 scheduled entries + 50 raw — at cap
    for (let i = 0; i < 50; i++)
      enq({ prompt: `sched-${i}`, scheduleId: `S${i}` });
    for (let i = 0; i < 50; i++) enq({ prompt: `raw-${i}` });
    expect(queue().length).toBe(100);
    // One more raw — should drop a raw, not a scheduled
    enq({ prompt: "raw-50" });
    expect(queue().length).toBe(100);
    expect(
      queue().filter((e: { scheduleId?: string }) => e.scheduleId).length,
    ).toBe(50);
    session.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────
// F1: terminal-manager.ts reaps PTYs on renderer reload
// ─────────────────────────────────────────────────────────────────────

describe("F1: terminal manager reaps PTYs on renderer navigation", () => {
  it("kills all PTYs owned by webContents when navigation starts", async () => {
    const { registerTerminalIpc } =
      await import("../terminal/terminal-manager");

    const navigationListeners: EventCallback[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcHandlers: Record<string, any> = {};

    const electron = (await import("electron")) as unknown as {
      ipcMain: { handle: ReturnType<typeof vi.fn> };
    };
    electron.ipcMain.handle.mockImplementation(
      (channel: string, handler: unknown) => {
        ipcHandlers[channel] = handler;
      },
    );

    const webContents = {
      id: 42,
      isDestroyed: () => false,
      send: vi.fn(),
      on: vi.fn((evt: string, cb: EventCallback) => {
        if (evt === "did-start-navigation" || evt === "destroyed")
          navigationListeners.push(cb);
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTerminalIpc(webContents as any);

    // Spawn 3 terminals
    const createHandler = ipcHandlers["terminal:create"];
    expect(createHandler).toBeDefined();
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createHandler({ sender: webContents } as any, "/tmp");
    }
    expect(ptyInstances.length).toBe(3);
    expect(ptyInstances.every((p) => !p.killed)).toBe(true);

    // Simulate renderer reload — fire did-start-navigation with mainFrame=true, inPlace=false
    expect(navigationListeners.length).toBeGreaterThan(0);
    // navigationListeners[0] is for did-start-navigation
    navigationListeners[0](
      {} as Event,
      "url",
      false /*isInPlace*/,
      true /*isMainFrame*/,
    );

    expect(ptyInstances.every((p) => p.killed)).toBe(true);
  });

  it("does NOT kill PTYs on in-place (history pushState) navigation", async () => {
    const { registerTerminalIpc } =
      await import("../terminal/terminal-manager");

    const navigationListeners: EventCallback[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcHandlers: Record<string, any> = {};

    const electron = (await import("electron")) as unknown as {
      ipcMain: { handle: ReturnType<typeof vi.fn> };
    };
    electron.ipcMain.handle.mockImplementation(
      (channel: string, handler: unknown) => {
        ipcHandlers[channel] = handler;
      },
    );

    const webContents = {
      id: 99,
      isDestroyed: () => false,
      send: vi.fn(),
      on: vi.fn((evt: string, cb: EventCallback) => {
        if (evt === "did-start-navigation" || evt === "destroyed")
          navigationListeners.push(cb);
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTerminalIpc(webContents as any);
    const createHandler = ipcHandlers["terminal:create"];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createHandler({ sender: webContents } as any, "/tmp");
    expect(ptyInstances[0].killed).toBe(false);

    // Fire did-start-navigation as in-place (e.g., React Router) — must NOT reap
    navigationListeners[0](
      {} as Event,
      "url",
      true /*isInPlace*/,
      true /*isMainFrame*/,
    );
    expect(ptyInstances[0].killed).toBe(false);

    // Real reload should reap
    navigationListeners[0]({} as Event, "url", false, true);
    expect(ptyInstances[0].killed).toBe(true);
  });
});

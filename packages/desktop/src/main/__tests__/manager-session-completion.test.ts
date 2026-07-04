/**
 * Focused unit tests for ManagerSession.handleChildCompletion — specifically
 * the run-origin branch added so that user-direct followups on a manager-
 * spawned thread do NOT enqueue a Manager notification (which would otherwise
 * cause the Manager to confusedly summarize and forward to WhatsApp).
 *
 * We construct ManagerSession via `new (ManagerSession as any)(...)` to bypass
 * the private constructor and skip setup() — the test only exercises the
 * private completion handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock("@stratosapp/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stratosapp/core")>();
  return {
    ...original,
    createProvider: vi.fn(),
    FileStorageAdapter: vi.fn(),
    appendTraceEntry: vi.fn(),
    appendScheduleRun: vi.fn(),
  };
});

vi.mock("../settings/settings.store", () => ({
  loadSettings: vi.fn().mockReturnValue({}),
  getOpencodeProviderKeys: vi.fn().mockReturnValue({}),
  isManagerEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../mcp/handlers", () => ({
  createStratosHandlers: vi.fn().mockReturnValue([]),
}));

vi.mock("../mcp/sdk-adapter", () => ({
  handlersToSdkMcp: vi.fn().mockReturnValue({}),
}));

vi.mock("../mcp/stdio-proxy", () => ({
  getStratosMcpPath: vi.fn().mockReturnValue("/tmp/stratos-mcp"),
  getStratosMcpSocketPath: vi.fn().mockReturnValue("/tmp/stratos.sock"),
}));

vi.mock("../integrations/claude-path", () => ({
  resolveClaudePathOrUndefined: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./manager-ref", () => ({
  setManagerRef: vi.fn(),
}));

vi.mock("./turn-state", () => ({
  clearManagerTurnImages: vi.fn(),
  setManagerTurnImages: vi.fn(),
}));

interface FakeThread {
  id: string;
  spawnedBy?: string;
  scheduledPromptId?: string;
  lastReportedRunId?: string;
  reportedToManager?: boolean;
  title?: string;
  provider?: string;
}

function makeStorage(threads: Record<string, FakeThread>) {
  return {
    getThread: vi.fn((id: string) => threads[id] ?? null),
    updateThread: vi.fn((id: string, updates: Record<string, unknown>) => {
      if (threads[id]) Object.assign(threads[id], updates);
      return threads[id] ?? null;
    }),
    listThreads: vi.fn(() => Object.values(threads)),
  };
}

async function makeSession(storage: ReturnType<typeof makeStorage>) {
  const mod = await import("../manager/manager-session");
  const ManagerSession = (mod as unknown as { ManagerSession: unknown })
    .ManagerSession;
  // Bypass the private constructor; we only test handleChildCompletion which
  // touches storage + private queue state.
  const session = new (ManagerSession as unknown as new (
    ...args: unknown[]
  ) => unknown)(
    /* agentManager */ {},
    storage,
    /* window */ {},
  ) as unknown as Record<string, unknown>;

  // Ensure the private state used by handleChildCompletion exists.
  session.notificationQueue = [];
  session.schedulerCallbacks = new Map();
  session.activeStream = false;
  session.isNotificationInFlight = false;
  session.notificationBackoffUntil = 0;
  return session;
}

describe("ManagerSession.handleChildCompletion — run origin behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("user-direct origin: persists ack but does NOT enqueue a notification", async () => {
    const threads: Record<string, FakeThread> = {
      t1: { id: "t1", spawnedBy: "manager", title: "child" },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);

    (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "user",
    });

    // Ack persisted so we don't reprocess on reconcile.
    expect(storage.updateThread).toHaveBeenCalledWith("t1", {
      lastReportedRunId: "r1",
      reportedToManager: true,
    });
    // No notification enqueued — Manager stays silent.
    expect((session.notificationQueue as unknown[]).length).toBe(0);
  });

  it("manager origin: enqueues the standard completion directive", async () => {
    const threads: Record<string, FakeThread> = {
      t1: {
        id: "t1",
        spawnedBy: "manager",
        title: "child",
        provider: "claude-code",
      },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);
    // Stub drainNotificationQueue so we don't try to actually start an LLM turn.
    (session as Record<string, unknown>).drainNotificationQueue = vi.fn();

    (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "manager",
    });

    const queue = session.notificationQueue as Array<{
      prompt: string;
      threadId?: string;
    }>;
    expect(queue.length).toBe(1);
    expect(queue[0].threadId).toBe("t1");
    expect(queue[0].prompt).toContain("[stratos-notification]");
    expect(queue[0].prompt).toContain('session="t1"');
    // Drain attempted.
    expect(
      (session as { drainNotificationQueue: { mock: { calls: unknown[] } } })
        .drainNotificationQueue.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("user-direct origin is dedup-checked: same runId twice → only first ack", async () => {
    const threads: Record<string, FakeThread> = {
      t1: { id: "t1", spawnedBy: "manager" },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);

    const handle = (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion.bind(session);
    handle({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "user",
    });
    handle({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "user",
    });

    // First call writes the ack; second call is deduped before reaching the
    // user-origin branch (lastReportedRunId === runId).
    expect(storage.updateThread).toHaveBeenCalledTimes(1);
  });

  it("ignores completions for non-manager threads regardless of origin", async () => {
    const threads: Record<string, FakeThread> = {
      t1: { id: "t1" /* no spawnedBy */ },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);

    (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "manager",
    });

    expect(storage.updateThread).not.toHaveBeenCalled();
    expect((session.notificationQueue as unknown[]).length).toBe(0);
  });

  it("scheduler-routed thread (scheduledPromptId set) prefers scheduler callback over standard directive", async () => {
    const threads: Record<string, FakeThread> = {
      t1: {
        id: "t1",
        spawnedBy: "manager",
        scheduledPromptId: "sched-1",
      },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);
    const cb = vi.fn();
    (session.schedulerCallbacks as Map<string, unknown>).set("sched-1", cb);

    (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion({
      threadId: "t1",
      runId: "r1",
      status: "completed",
      origin: "manager",
    });

    expect(cb).toHaveBeenCalledWith("completed", undefined);
    // No standard directive enqueued.
    expect((session.notificationQueue as unknown[]).length).toBe(0);
    // Ack MUST be written so reconcileOnStartup doesn't re-process after restart.
    expect(storage.updateThread).toHaveBeenCalledWith("t1", {
      lastReportedRunId: "r1",
      reportedToManager: true,
    });
  });

  it("scheduler-routed thread with no callback (orphaned after restart) acks silently — never enqueues standard directive", async () => {
    // Scenario: process restarted after a routeToManager schedule ran.
    // schedulerCallbacks is empty (in-memory), but the thread still has
    // scheduledPromptId set. reconcileOnStartup calls handleChildCompletion.
    // Without the fix this fell through to the standard notification path,
    // the Manager learned about the old thread, and on the next tick called
    // send_message(old-thread) → "Thread not found".
    const threads: Record<string, FakeThread> = {
      t1: {
        id: "t1",
        spawnedBy: "manager",
        scheduledPromptId: "sched-orphan",
      },
    };
    const storage = makeStorage(threads);
    const session = await makeSession(storage);
    // No callback registered — simulates post-restart state.

    (
      session as { handleChildCompletion: (e: unknown) => void }
    ).handleChildCompletion({
      threadId: "t1",
      runId: "r2",
      status: "completed",
      origin: "manager",
    });

    // No notification enqueued — Manager must not learn about this thread.
    expect((session.notificationQueue as unknown[]).length).toBe(0);
    // Ack written so reconcileOnStartup doesn't re-process on next restart.
    expect(storage.updateThread).toHaveBeenCalledWith("t1", {
      lastReportedRunId: "r2",
      reportedToManager: true,
    });
  });
});

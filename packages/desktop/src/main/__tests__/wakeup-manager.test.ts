import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;

// Redirect homedir() so loop-wakeups.json lands in a per-test tmp dir.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

/** Build a stub AgentManager with the surface WakeupManager actually uses. */
function makeFakeAgentManager() {
  return {
    isStreaming: vi.fn<(threadId: string) => boolean>().mockReturnValue(false),
    startStream: vi
      .fn<
        (
          threadId: string,
          prompt: string,
          images?: unknown,
          origin?: string,
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined),
  };
}

type FakeAgent = ReturnType<typeof makeFakeAgentManager>;

describe("WakeupManager", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-wakeup-mgr-"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("schedules a wakeup and fires startStream after the delay", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    const rec = wm.scheduleWakeup({
      threadId: "t1",
      delaySeconds: 60,
      prompt: "ping",
    });
    expect(rec).not.toBeNull();
    expect(wm.getPendingCount()).toBe(1);

    expect(agent.startStream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000 + 5);
    // startStream is async; let pending microtasks settle
    await Promise.resolve();

    expect(agent.startStream).toHaveBeenCalledTimes(1);
    const args = (agent.startStream as MockedFunction<FakeAgent["startStream"]>)
      .mock.calls[0];
    expect(args[0]).toBe("t1");
    expect(args[1]).toBe("ping");
    expect(args[3]).toBe("scheduler");
    expect(wm.getPendingCount()).toBe(0);
  });

  it("rescheduling for the same thread cancels the previous wakeup", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    wm.scheduleWakeup({ threadId: "t1", delaySeconds: 60, prompt: "first" });
    wm.scheduleWakeup({ threadId: "t1", delaySeconds: 60, prompt: "second" });

    expect(wm.getPendingCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000 + 5);
    await Promise.resolve();
    expect(agent.startStream).toHaveBeenCalledTimes(1);
    expect(
      (agent.startStream as MockedFunction<FakeAgent["startStream"]>).mock
        .calls[0][1],
    ).toBe("second");
  });

  it("clamps below-min delay to MIN", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const { MIN_LOOP_DELAY_SECONDS } = await import("@stratosapp/core");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    const t0 = Date.now();
    const rec = wm.scheduleWakeup({
      threadId: "t1",
      delaySeconds: 1,
      prompt: "p",
    });
    expect(rec!.fireAt - t0).toBeGreaterThanOrEqual(
      MIN_LOOP_DELAY_SECONDS * 1000 - 50,
    );
    expect(rec!.fireAt - t0).toBeLessThanOrEqual(
      MIN_LOOP_DELAY_SECONDS * 1000 + 50,
    );
  });

  it("defers fire when the thread is mid-stream and retries later", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const agent = makeFakeAgentManager();
    (agent.isStreaming as MockedFunction<FakeAgent["isStreaming"]>)
      .mockReturnValueOnce(true) // first fire: still streaming
      .mockReturnValueOnce(false); // second attempt: clear
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    wm.scheduleWakeup({ threadId: "t1", delaySeconds: 60, prompt: "p" });
    await vi.advanceTimersByTimeAsync(60_000 + 5);
    await Promise.resolve();
    expect(agent.startStream).not.toHaveBeenCalled();
    // Deferred by 10s
    await vi.advanceTimersByTimeAsync(10_000 + 5);
    await Promise.resolve();
    expect(agent.startStream).toHaveBeenCalledTimes(1);
  });

  it("cancelForThread clears in-memory + on-disk records", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const { loadLoopWakeups } = await import("@stratosapp/core");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    wm.scheduleWakeup({ threadId: "tA", delaySeconds: 60, prompt: "a" });
    expect(loadLoopWakeups()).toHaveLength(1);
    expect(wm.cancelForThread("tA")).toBe(1);
    expect(wm.getPendingCount()).toBe(0);
    expect(loadLoopWakeups()).toHaveLength(0);

    // Firing should never happen
    await vi.advanceTimersByTimeAsync(60_000 + 5);
    await Promise.resolve();
    expect(agent.startStream).not.toHaveBeenCalled();
  });

  it("recovers persisted wakeups on initialize() and past-due fire immediately", async () => {
    const { addLoopWakeup } = await import("@stratosapp/core");
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const agent = makeFakeAgentManager();

    // Persist a past-due wakeup before constructing the manager.
    addLoopWakeup({
      threadId: "tX",
      prompt: "stale",
      fireAt: Date.now() - 30_000,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    // setTimeout(0) — flush
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(agent.startStream).toHaveBeenCalledWith(
      "tX",
      "stale",
      undefined,
      "scheduler",
    );
  });

  it("scheduleWakeup before initialize() is a no-op", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);

    expect(
      wm.scheduleWakeup({ threadId: "t", delaySeconds: 60, prompt: "p" }),
    ).toBeNull();
  });

  it("dispose clears all timers but keeps the on-disk record for recovery", async () => {
    const { WakeupManager } = await import("../scheduler/wakeup-manager");
    const { loadLoopWakeups } = await import("@stratosapp/core");
    const agent = makeFakeAgentManager();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wm = new WakeupManager(agent as any);
    wm.initialize();

    wm.scheduleWakeup({ threadId: "t1", delaySeconds: 60, prompt: "p" });
    expect(loadLoopWakeups()).toHaveLength(1);
    wm.dispose();
    expect(wm.getPendingCount()).toBe(0);
    // On-disk record survives so app restart can resume it
    expect(loadLoopWakeups()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000 + 5);
    await Promise.resolve();
    expect(agent.startStream).not.toHaveBeenCalled();
  });
});

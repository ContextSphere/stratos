import {
  type LoopWakeup,
  addLoopWakeup,
  clampLoopDelaySeconds,
  deleteLoopWakeup,
  deleteLoopWakeupsForThread,
  loadLoopWakeups,
} from "@stratosapp/core";
import type { AgentManager } from "../agent-manager";

/**
 * Host-side equivalent of the bundled Claude Code CLI's in-memory cron-task
 * poller for the `ScheduleWakeup` tool. See `docs/learnings/` (or the
 * investigation report) for the full root-cause analysis — in short, the CLI's
 * poller lives in its interactive Ink/React TUI, which Stratos never mounts
 * (SDK streaming mode). We re-implement the firing in the Electron main
 * process so wakeups survive the subprocess lifecycle.
 *
 * Semantics mirrored from the CLI:
 *   - delaySeconds is clamped to [60, 3600]
 *   - one wakeup at a time per thread (rescheduling cancels the prior one)
 *   - on app restart, recover persisted wakeups; past-due fire immediately
 *
 * NOT mirrored (intentionally): the `<<autonomous-loop-dynamic>>` sentinel.
 * The CLI's slash-command resolver expands it on submit; in SDK mode there is
 * no resolver. If the model passes the sentinel we submit it verbatim and the
 * model will see literal text. Real callers pass a regular prompt.
 */
interface ArmedTimer {
  timer: ReturnType<typeof setTimeout>;
  threadId: string;
}

export class WakeupManager {
  private agentManager: AgentManager;
  private timers = new Map<string, ArmedTimer>();
  /** True after initialize() so we know it's safe to schedule. */
  private started = false;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /** Reload persisted wakeups from disk and arm timers for each. Past-due
   *  entries fire immediately (preserving the contract that a wakeup *will*
   *  eventually fire, even if the host was offline). */
  initialize(): void {
    this.started = true;
    const wakeups = loadLoopWakeups();
    for (const w of wakeups) {
      this.armTimer(w);
    }
  }

  /** Cancel all pending timers (call on app shutdown). The on-disk records are
   *  left intact so a restart can resume them. */
  dispose(): void {
    for (const [, armed] of this.timers) clearTimeout(armed.timer);
    this.timers.clear();
    this.started = false;
  }

  /** Register a new wakeup. If a wakeup already exists for `threadId`, it is
   *  cancelled first — the model is supposed to call `ScheduleWakeup` at most
   *  once per turn, and the latest call wins. */
  scheduleWakeup(params: {
    threadId: string;
    delaySeconds: number;
    prompt: string;
    reason?: string;
  }): LoopWakeup | null {
    if (!this.started) {
      console.warn(
        "[wakeup] scheduleWakeup called before initialize(); ignoring",
      );
      return null;
    }
    if (!params.prompt || typeof params.prompt !== "string") {
      console.warn(
        "[wakeup] scheduleWakeup ignored: missing/invalid prompt",
        params,
      );
      return null;
    }

    // The CLI dedupes by prompt within a thread; we dedupe by thread because
    // there is one "active" loop per thread in our model.
    this.cancelForThread(params.threadId);

    const { clamped } = clampLoopDelaySeconds(params.delaySeconds);
    const fireAt = Date.now() + clamped * 1000;
    const record = addLoopWakeup({
      threadId: params.threadId,
      prompt: params.prompt,
      ...(params.reason ? { reason: params.reason } : {}),
      fireAt,
    });
    this.armTimer(record);
    return record;
  }

  /** Drop all timers + on-disk records for a thread. Called on thread delete,
   *  thread-level interrupt, or when a new ScheduleWakeup replaces a prior one.
   *  Returns the count of wakeups removed. */
  cancelForThread(threadId: string): number {
    let cleared = 0;
    for (const [id, armed] of this.timers) {
      if (armed.threadId === threadId) {
        clearTimeout(armed.timer);
        this.timers.delete(id);
        cleared++;
      }
    }
    const removed = deleteLoopWakeupsForThread(threadId);
    return Math.max(cleared, removed);
  }

  /** Number of pending wakeups currently armed in memory. Useful for tests
   *  and diagnostics. */
  getPendingCount(): number {
    return this.timers.size;
  }

  private armTimer(wakeup: LoopWakeup): void {
    // Avoid double-arming if recovery + re-add collide.
    const existing = this.timers.get(wakeup.id);
    if (existing) clearTimeout(existing.timer);

    const delay = Math.max(0, wakeup.fireAt - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(wakeup.id);
      void this.fire(wakeup);
    }, delay);
    timer.unref?.();
    this.timers.set(wakeup.id, { timer, threadId: wakeup.threadId });
  }

  private async fire(wakeup: LoopWakeup): Promise<void> {
    // If the thread is mid-stream (user typed during the wait, or the prior
    // turn is still draining), reschedule a few seconds out. Don't touch the
    // on-disk record so app restart still recovers the intent.
    if (this.agentManager.isStreaming(wakeup.threadId)) {
      console.log(
        `[wakeup] thread ${wakeup.threadId} is streaming; deferring fire by 10s`,
      );
      this.armTimer({ ...wakeup, fireAt: Date.now() + 10_000 });
      return;
    }

    // Remove the on-disk record before firing so a crash mid-stream doesn't
    // resurrect the wakeup on next launch. The model is expected to call
    // ScheduleWakeup again in the next turn if it wants to keep looping.
    deleteLoopWakeup(wakeup.id);

    try {
      await this.agentManager.startStream(
        wakeup.threadId,
        wakeup.prompt,
        undefined,
        "scheduler",
      );
    } catch (err) {
      console.error(
        `[wakeup] failed to fire wakeup ${wakeup.id} for thread ${wakeup.threadId}:`,
        err,
      );
    }
  }
}

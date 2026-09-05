import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("isolated desktop preview profile", () => {
  let profile: string;
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (profile) rmSync(profile, { recursive: true, force: true });
  });

  it("stores sessions, wakeups, schedules, run reports and traces in the selected data directory", async () => {
    profile = mkdtempSync(join(tmpdir(), "stratos-profile-"));
    vi.stubEnv("STRATOS_DATA_DIR", profile);
    vi.resetModules();
    const { FileStorageAdapter } = await import("../storage/file-adapter");
    const { addLoopWakeup, loadLoopWakeups } =
      await import("../storage/loop-wakeups.store");
    const { addScheduledPrompt, loadScheduledPrompts } =
      await import("../storage/scheduled-prompts.store");
    const { appendScheduleRun, loadScheduleRuns } =
      await import("../storage/schedule-runs.store");
    const { appendTraceEntry, flushTraceQueue, readTraceEntries } =
      await import("../storage/trace.store");

    const storage = new FileStorageAdapter();
    expect(storage.listThreads()).toEqual([]);
    expect(loadLoopWakeups()).toEqual([]);
    expect(loadScheduledPrompts()).toEqual([]);
    expect(loadScheduleRuns()).toEqual([]);
    const thread = storage.createThread(
      "Preview bot",
      undefined,
      profile,
      "codex",
    );
    const wakeup = addLoopWakeup({
      threadId: thread.id,
      prompt: "test",
      fireAt: Date.now() + 60_000,
    });
    const schedule = addScheduledPrompt({
      name: "Preview",
      prompt: "test",
      provider: "codex",
      folderId: "preview",
      schedule: { type: "once", runAt: new Date().toISOString() },
      enabled: false,
    });
    appendScheduleRun({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      threadId: thread.id,
      workspace: profile,
      provider: "codex",
      status: "completed",
      durationMs: 1,
      startedAt: 1,
      completedAt: 2,
    });
    appendTraceEntry(thread.id, {
      timestamp: 1,
      messageType: "preview",
      data: {},
    });
    await flushTraceQueue();

    expect(new FileStorageAdapter().getThread(thread.id)?.title).toBe(
      "Preview bot",
    );
    expect(loadLoopWakeups().map((w) => w.id)).toEqual([wakeup.id]);
    expect(loadScheduledPrompts().map((s) => s.id)).toEqual([schedule.id]);
    expect(loadScheduleRuns()[0].threadId).toBe(thread.id);
    expect(readTraceEntries(thread.id)).toHaveLength(1);
    for (const path of [
      "threads/threads.json",
      "loop-wakeups.json",
      "scheduled-prompts.json",
      "manager/schedule-runs.json",
    ]) {
      expect(existsSync(join(profile, path))).toBe(true);
    }
    // An explicit constructor directory still takes precedence.
    expect(
      new FileStorageAdapter(join(profile, "other")).listThreads(),
    ).toEqual([]);
  });
});

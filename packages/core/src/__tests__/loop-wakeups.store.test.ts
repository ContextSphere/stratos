import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  clampLoopDelaySeconds,
  MAX_LOOP_DELAY_SECONDS,
  MIN_LOOP_DELAY_SECONDS,
} from "../types/loop-wakeup";

describe("clampLoopDelaySeconds", () => {
  it("passes through values inside the range", () => {
    expect(clampLoopDelaySeconds(120)).toEqual({
      clamped: 120,
      wasClamped: false,
    });
  });

  it("clamps below-min to MIN", () => {
    expect(clampLoopDelaySeconds(10)).toEqual({
      clamped: MIN_LOOP_DELAY_SECONDS,
      wasClamped: true,
    });
  });

  it("clamps above-max to MAX", () => {
    expect(clampLoopDelaySeconds(10_000)).toEqual({
      clamped: MAX_LOOP_DELAY_SECONDS,
      wasClamped: true,
    });
  });

  it("rounds fractional inputs", () => {
    expect(clampLoopDelaySeconds(120.7)).toEqual({
      clamped: 121,
      wasClamped: false,
    });
  });

  it("treats NaN as MIN", () => {
    expect(clampLoopDelaySeconds(NaN)).toEqual({
      clamped: MIN_LOOP_DELAY_SECONDS,
      wasClamped: true,
    });
  });

  it("treats +Infinity as MAX", () => {
    expect(clampLoopDelaySeconds(Infinity)).toEqual({
      clamped: MAX_LOOP_DELAY_SECONDS,
      wasClamped: true,
    });
  });

  it("treats -Infinity as MIN", () => {
    expect(clampLoopDelaySeconds(-Infinity)).toEqual({
      clamped: MIN_LOOP_DELAY_SECONDS,
      wasClamped: true,
    });
  });
});

let tmpDir: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

describe("loop-wakeups store", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-wakeup-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no file exists", async () => {
    const { loadLoopWakeups } = await import("../storage/loop-wakeups.store");
    expect(loadLoopWakeups()).toEqual([]);
  });

  it("adds and retrieves a wakeup", async () => {
    const { addLoopWakeup, loadLoopWakeups } =
      await import("../storage/loop-wakeups.store");
    const w = addLoopWakeup({
      threadId: "t1",
      prompt: "ping",
      fireAt: Date.now() + 60_000,
    });
    expect(w.id).toMatch(/^wake_/);
    expect(loadLoopWakeups()).toHaveLength(1);
    expect(loadLoopWakeups()[0].prompt).toBe("ping");
  });

  it("deletes a wakeup by id", async () => {
    const { addLoopWakeup, deleteLoopWakeup, loadLoopWakeups } =
      await import("../storage/loop-wakeups.store");
    const w = addLoopWakeup({
      threadId: "t1",
      prompt: "p",
      fireAt: Date.now() + 60_000,
    });
    expect(deleteLoopWakeup(w.id)).toBe(true);
    expect(loadLoopWakeups()).toHaveLength(0);
    expect(deleteLoopWakeup(w.id)).toBe(false);
  });

  it("deletes all wakeups for a thread", async () => {
    const { addLoopWakeup, deleteLoopWakeupsForThread, loadLoopWakeups } =
      await import("../storage/loop-wakeups.store");
    addLoopWakeup({ threadId: "tA", prompt: "1", fireAt: 1 });
    addLoopWakeup({ threadId: "tA", prompt: "2", fireAt: 2 });
    addLoopWakeup({ threadId: "tB", prompt: "3", fireAt: 3 });
    expect(deleteLoopWakeupsForThread("tA")).toBe(2);
    const remaining = loadLoopWakeups();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].threadId).toBe("tB");
  });

  it("ignores malformed JSON on disk", async () => {
    const { writeFileSync, mkdirSync } = await import("fs");
    const { join } = await import("path");
    mkdirSync(join(tmpDir, ".stratos"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".stratos", "loop-wakeups.json"),
      "not-json",
      "utf-8",
    );
    const { loadLoopWakeups } = await import("../storage/loop-wakeups.store");
    expect(loadLoopWakeups()).toEqual([]);
  });
});

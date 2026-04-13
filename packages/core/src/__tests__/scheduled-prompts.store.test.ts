import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scheduleToCron, scheduleToHuman } from "../types/scheduled-prompt";

describe("scheduleToCron", () => {
  it("converts every-hour", () => {
    expect(scheduleToCron({ type: "recurring", interval: "every-hour" })).toBe(
      "0 * * * *",
    );
  });

  it("converts every-6-hours", () => {
    expect(
      scheduleToCron({ type: "recurring", interval: "every-6-hours" }),
    ).toBe("0 */6 * * *");
  });

  it("converts every-12-hours", () => {
    expect(
      scheduleToCron({ type: "recurring", interval: "every-12-hours" }),
    ).toBe("0 */12 * * *");
  });

  it("converts every-day with time", () => {
    expect(
      scheduleToCron({
        type: "recurring",
        interval: "every-day",
        timeOfDay: "14:30",
      }),
    ).toBe("30 14 * * *");
  });

  it("converts every-day defaults to 09:00", () => {
    expect(scheduleToCron({ type: "recurring", interval: "every-day" })).toBe(
      "0 9 * * *",
    );
  });

  it("converts every-week with day and time", () => {
    expect(
      scheduleToCron({
        type: "recurring",
        interval: "every-week",
        timeOfDay: "10:00",
        dayOfWeek: 3,
      }),
    ).toBe("0 10 * * 3");
  });

  it("converts every-week defaults to Monday 09:00", () => {
    expect(scheduleToCron({ type: "recurring", interval: "every-week" })).toBe(
      "0 9 * * 1",
    );
  });

  it("passes through custom cron", () => {
    expect(
      scheduleToCron({
        type: "recurring",
        interval: "custom",
        customCron: "*/5 * * * *",
      }),
    ).toBe("*/5 * * * *");
  });

  it("throws for custom without expression", () => {
    expect(() =>
      scheduleToCron({ type: "recurring", interval: "custom" }),
    ).toThrow("Custom cron expression required");
  });

  it("throws for once type", () => {
    expect(() => scheduleToCron({ type: "once" })).toThrow(
      "Cannot convert one-time schedule to cron",
    );
  });
});

describe("scheduleToHuman", () => {
  it("describes recurring every-hour", () => {
    expect(scheduleToHuman({ type: "recurring", interval: "every-hour" })).toBe(
      "Every hour",
    );
  });

  it("describes recurring every-day with time", () => {
    expect(
      scheduleToHuman({
        type: "recurring",
        interval: "every-day",
        timeOfDay: "14:30",
      }),
    ).toBe("Every day at 14:30");
  });

  it("describes recurring every-week", () => {
    expect(
      scheduleToHuman({
        type: "recurring",
        interval: "every-week",
        dayOfWeek: 5,
        timeOfDay: "08:00",
      }),
    ).toBe("Every Friday at 08:00");
  });

  it("describes custom cron", () => {
    expect(
      scheduleToHuman({
        type: "recurring",
        interval: "custom",
        customCron: "*/5 * * * *",
      }),
    ).toBe("Custom: */5 * * * *");
  });

  it("describes once with date", () => {
    const result = scheduleToHuman({
      type: "once",
      runAt: "2026-04-15T09:00",
    });
    expect(result).toContain("Once on");
  });

  it("describes once without date", () => {
    expect(scheduleToHuman({ type: "once" })).toBe("Once (no date set)");
  });
});

// CRUD store tests using vi.mock to control the config directory
let tmpDir: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

describe("scheduled-prompts store", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-sched-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no file exists", async () => {
    const { loadScheduledPrompts } =
      await import("../storage/scheduled-prompts.store");
    expect(loadScheduledPrompts()).toEqual([]);
  });

  it("adds and retrieves a scheduled prompt", async () => {
    const { addScheduledPrompt, loadScheduledPrompts, getScheduledPrompt } =
      await import("../storage/scheduled-prompts.store");
    const prompt = addScheduledPrompt({
      name: "Test",
      prompt: "Do something",
      provider: "claude-code",
      folderId: "folder-1",
      schedule: { type: "recurring", interval: "every-hour" },
      enabled: true,
    });
    expect(prompt.id).toMatch(/^sched_/);
    expect(prompt.name).toBe("Test");
    expect(prompt.createdAt).toBeTypeOf("number");

    const all = loadScheduledPrompts();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(prompt.id);

    const found = getScheduledPrompt(prompt.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test");
  });

  it("updates a scheduled prompt", async () => {
    const { addScheduledPrompt, updateScheduledPrompt, getScheduledPrompt } =
      await import("../storage/scheduled-prompts.store");
    const prompt = addScheduledPrompt({
      name: "Original",
      prompt: "Do something",
      provider: "claude-code",
      folderId: "folder-1",
      schedule: { type: "recurring", interval: "every-hour" },
      enabled: true,
    });

    const updated = updateScheduledPrompt(prompt.id, { name: "Updated" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");

    const found = getScheduledPrompt(prompt.id);
    expect(found!.name).toBe("Updated");
  });

  it("returns null when updating non-existent prompt", async () => {
    const { updateScheduledPrompt } =
      await import("../storage/scheduled-prompts.store");
    expect(updateScheduledPrompt("nonexistent", { name: "x" })).toBeNull();
  });

  it("deletes a scheduled prompt", async () => {
    const { addScheduledPrompt, deleteScheduledPrompt, loadScheduledPrompts } =
      await import("../storage/scheduled-prompts.store");
    const prompt = addScheduledPrompt({
      name: "ToDelete",
      prompt: "Do something",
      provider: "claude-code",
      folderId: "folder-1",
      schedule: { type: "recurring", interval: "every-hour" },
      enabled: true,
    });

    expect(deleteScheduledPrompt(prompt.id)).toBe(true);
    expect(loadScheduledPrompts()).toHaveLength(0);
  });

  it("returns false when deleting non-existent prompt", async () => {
    const { deleteScheduledPrompt } =
      await import("../storage/scheduled-prompts.store");
    expect(deleteScheduledPrompt("nonexistent")).toBe(false);
  });
});

/**
 * Transport-agnostic tests for the scheduler handlers.
 * Exercises the handler functions directly — no MCP transport involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSchedulerHandlers } from "../mcp/handlers/scheduler";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: () => tmpdir() },
}));

function makeStorage(folders: { id: string; name: string; path: string }[]) {
  return {
    listFolders: vi.fn().mockReturnValue(folders),
  } as unknown as Parameters<typeof createSchedulerHandlers>[0]["storage"];
}

function byName(
  defs: ReturnType<typeof createSchedulerHandlers>,
  name: string,
) {
  const d = defs.find((h) => h.name === name);
  if (!d) throw new Error(`missing tool: ${name}`);
  return d;
}

describe("scheduler handlers", () => {
  let tmp: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "stratos-handlers-sched-"));
    origHome = process.env.HOME;
    process.env.HOME = tmp;
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("produces exactly 8 tools with the expected names", () => {
    const defs = createSchedulerHandlers({ storage: makeStorage([]) });
    expect(defs.map((d) => d.name).sort()).toEqual([
      "schedule_create",
      "schedule_delete",
      "schedule_disable",
      "schedule_enable",
      "schedule_folders",
      "schedule_list",
      "schedule_report",
      "schedule_runs",
    ]);
  });

  it("schedule_folders returns storage folders as JSON", async () => {
    const defs = createSchedulerHandlers({
      storage: makeStorage([{ id: "f1", name: "proj", path: "/tmp/proj" }]),
    });
    const res = await byName(defs, "schedule_folders").handler({});
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("proj");
    expect(res.content[0].text).toContain("/tmp/proj");
  });

  it("schedule_create rejects when no folder matches cwd", async () => {
    const defs = createSchedulerHandlers({
      storage: makeStorage([{ id: "f1", name: "proj", path: "/tmp/proj" }]),
    });
    const res = await byName(defs, "schedule_create").handler({
      name: "n",
      prompt: "p",
      cwd: "/tmp/nowhere",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/No folder found/);
  });

  it("schedule_create → list → disable → enable → delete roundtrip", async () => {
    const defs = createSchedulerHandlers({
      storage: makeStorage([{ id: "f1", name: "proj", path: "/tmp/proj" }]),
    });

    const created = await byName(defs, "schedule_create").handler({
      name: "nightly",
      prompt: "run",
      folder: "proj",
      interval: "every-day",
      time: "02:00",
    });
    expect(created.isError).toBeFalsy();
    const entry = JSON.parse(created.content[0].text);
    expect(entry.name).toBe("nightly");
    expect(entry.enabled).toBe(true);

    const listed = await byName(defs, "schedule_list").handler({});
    expect(listed.content[0].text).toContain("nightly");

    const disabled = await byName(defs, "schedule_disable").handler({
      id: entry.id,
    });
    expect(disabled.content[0].text).toContain("Disabled");

    const enabled = await byName(defs, "schedule_enable").handler({
      id: entry.id,
    });
    expect(enabled.content[0].text).toContain("Enabled");

    const deleted = await byName(defs, "schedule_delete").handler({
      id: entry.id,
    });
    expect(deleted.content[0].text).toContain("Deleted");
  });

  it("returns error on disable/enable/delete of unknown id", async () => {
    const defs = createSchedulerHandlers({ storage: makeStorage([]) });
    for (const tool of [
      "schedule_disable",
      "schedule_enable",
      "schedule_delete",
    ]) {
      const res = await byName(defs, tool).handler({ id: "does-not-exist" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/Not found/);
    }
  });
});

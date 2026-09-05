/**
 * Persistent log of scheduled-prompt run completions. Used by the Manager as
 * a lightweight situational-awareness record — entries do NOT trigger Manager
 * LLM turns, so successful runs accumulate here without polluting Manager's
 * conversation history. Failures still trigger a real LLM turn (separate
 * mechanism in ManagerSession) but a record is appended here too.
 *
 * The file is capped at MAX_RECORDS to bound disk and read costs. Oldest
 * entries are dropped first.
 */
import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { ScheduleRunRecord } from "../types/scheduled-prompt";

const STORE_FILE = "schedule-runs.json";
const MAX_RECORDS = 500;

function getStorePath(): string {
  const dir = join(
    process.env.STRATOS_DATA_DIR || join(homedir(), ".stratos"),
    "manager",
  );
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, STORE_FILE);
}

export function loadScheduleRuns(): ScheduleRunRecord[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ScheduleRunRecord[];
  } catch {
    return [];
  }
}

export function appendScheduleRun(record: ScheduleRunRecord): void {
  const records = loadScheduleRuns();
  records.push(record);
  // Keep newest MAX_RECORDS.
  const trimmed =
    records.length > MAX_RECORDS
      ? records.slice(records.length - MAX_RECORDS)
      : records;
  writeFileSync(getStorePath(), JSON.stringify(trimmed, null, 2), "utf-8");
}

/**
 * Read recent schedule runs, newest first, capped at limit.
 * Optionally filter to a single scheduleId.
 */
export function listScheduleRuns(opts?: {
  limit?: number;
  scheduleId?: string;
}): ScheduleRunRecord[] {
  const records = loadScheduleRuns();
  let filtered = opts?.scheduleId
    ? records.filter((r) => r.scheduleId === opts.scheduleId)
    : records;
  filtered = filtered.slice().reverse();
  if (opts?.limit && opts.limit > 0) filtered = filtered.slice(0, opts.limit);
  return filtered;
}

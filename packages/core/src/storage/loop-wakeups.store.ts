import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { LoopWakeup } from "../types/loop-wakeup";

const STORE_FILE = "loop-wakeups.json";

function getConfigDir(): string {
  return join(homedir(), ".stratos");
}

function getStorePath(): string {
  return join(getConfigDir(), STORE_FILE);
}

export function loadLoopWakeups(): LoopWakeup[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LoopWakeup[]) : [];
  } catch {
    return [];
  }
}

export function saveLoopWakeups(wakeups: LoopWakeup[]): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(getStorePath(), JSON.stringify(wakeups, null, 2), "utf-8");
}

export function addLoopWakeup(
  data: Omit<LoopWakeup, "id" | "createdAt">,
): LoopWakeup {
  const wakeups = loadLoopWakeups();
  const id = `wake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wakeup: LoopWakeup = { ...data, id, createdAt: Date.now() };
  wakeups.push(wakeup);
  saveLoopWakeups(wakeups);
  return wakeup;
}

export function deleteLoopWakeup(id: string): boolean {
  const wakeups = loadLoopWakeups();
  const filtered = wakeups.filter((w) => w.id !== id);
  if (filtered.length === wakeups.length) return false;
  saveLoopWakeups(filtered);
  return true;
}

/** Drop every pending wakeup for a thread (used on thread delete, interrupt,
 *  or when a fresh ScheduleWakeup replaces the prior one). Returns the number
 *  of records removed. */
export function deleteLoopWakeupsForThread(threadId: string): number {
  const wakeups = loadLoopWakeups();
  const filtered = wakeups.filter((w) => w.threadId !== threadId);
  const removed = wakeups.length - filtered.length;
  if (removed > 0) saveLoopWakeups(filtered);
  return removed;
}

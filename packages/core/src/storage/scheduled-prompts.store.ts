import { join } from "path";
import { homedir } from "os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { ScheduledPrompt } from "../types/scheduled-prompt";

const STORE_FILE = "scheduled-prompts.json";

function getConfigDir(): string {
  return process.env.STRATOS_DATA_DIR || join(homedir(), ".stratos");
}

function getStorePath(): string {
  return join(getConfigDir(), STORE_FILE);
}

export function loadScheduledPrompts(): ScheduledPrompt[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ScheduledPrompt[];
  } catch {
    return [];
  }
}

export function saveScheduledPrompts(prompts: ScheduledPrompt[]): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(getStorePath(), JSON.stringify(prompts, null, 2), "utf-8");
}

export function addScheduledPrompt(
  data: Omit<ScheduledPrompt, "id" | "createdAt">,
): ScheduledPrompt {
  const prompts = loadScheduledPrompts();
  const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const prompt: ScheduledPrompt = { ...data, id, createdAt: Date.now() };
  prompts.push(prompt);
  saveScheduledPrompts(prompts);
  return prompt;
}

export function updateScheduledPrompt(
  id: string,
  updates: Partial<ScheduledPrompt>,
): ScheduledPrompt | null {
  const prompts = loadScheduledPrompts();
  const idx = prompts.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  prompts[idx] = { ...prompts[idx], ...updates };
  saveScheduledPrompts(prompts);
  return prompts[idx];
}

export function deleteScheduledPrompt(id: string): boolean {
  const prompts = loadScheduledPrompts();
  const filtered = prompts.filter((p) => p.id !== id);
  if (filtered.length === prompts.length) return false;
  saveScheduledPrompts(filtered);
  return true;
}

export function getScheduledPrompt(id: string): ScheduledPrompt | null {
  const prompts = loadScheduledPrompts();
  return prompts.find((p) => p.id === id) ?? null;
}

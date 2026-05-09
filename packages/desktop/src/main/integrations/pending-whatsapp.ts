/**
 * Persistent FIFO queue for WhatsApp messages that could not be delivered
 * (gateway disconnected, send failed, etc.). Drained on the next reconnect.
 *
 * Bounded at MAX_ENTRIES — the oldest entry is dropped on overflow rather
 * than blocking. Schedule notifications are time-sensitive enough that a
 * stale 24-hour-old "X completed" message is worse than no message; the
 * cap keeps disk usage and drain latency predictable.
 *
 * Persisted at `~/.stratos/manager/pending-whatsapp.json` so the queue
 * survives an app restart. Atomic writes via temp-file + rename so a crash
 * mid-write cannot corrupt the file.
 */
import { join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "fs";

const MAX_ENTRIES = 20;

interface PendingEntry {
  text: string;
  enqueuedAt: number;
}

function storeDir(): string {
  const dir = join(homedir(), ".stratos", "manager");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath(): string {
  return join(storeDir(), "pending-whatsapp.json");
}

function loadEntries(): PendingEntry[] {
  const path = storePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.text === "string" &&
        typeof e.enqueuedAt === "number",
    );
  } catch {
    return [];
  }
}

function writeEntries(entries: PendingEntry[]): void {
  const path = storePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function enqueuePendingWhatsApp(text: string): void {
  const entries = loadEntries();
  entries.push({ text, enqueuedAt: Date.now() });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  writeEntries(entries);
}

export function pendingWhatsAppSize(): number {
  return loadEntries().length;
}

/**
 * Drain in FIFO order. Calls `send` for each entry; on the first failure the
 * exception propagates and the remaining entries are kept in the queue so
 * they're retried on the next drain. Successfully sent entries are removed
 * atomically after each one — a crash mid-drain replays the not-yet-sent
 * tail, never the already-sent head.
 */
export async function drainPendingWhatsApp(
  send: (text: string) => Promise<void>,
): Promise<void> {
  let entries = loadEntries();
  while (entries.length > 0) {
    const head = entries[0];
    // If send throws, leave the queue alone (next drain retries).
    await send(head.text);
    entries = entries.slice(1);
    writeEntries(entries);
  }
}

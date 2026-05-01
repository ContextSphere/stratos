import { basename, join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "fs";
import type { Thread, Folder, StoredMessage } from "../types/thread";
import type { StorageAdapter } from "./types";
import { clearTraceFile } from "./trace.store";
import { generateReadableId } from "../utils/readable-id";
import { sdkMessagesToStored } from "./sdk-transcript";

const DEFAULT_BASE_DIR = join(homedir(), ".stratos");

interface ThreadsFile {
  folders?: Folder[];
  threads: Thread[];
  activeThreadId: string | null;
}

export class FileStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
  }

  private getThreadsDir(): string {
    const dir = join(this.baseDir, "threads");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getThreadsPath(): string {
    return join(this.getThreadsDir(), "threads.json");
  }

  private getMessagesPath(threadId: string): string {
    return join(this.getThreadsDir(), "messages", `${threadId}.json`);
  }

  private loadMessagesFromDisk(threadId: string): StoredMessage[] {
    const path = this.getMessagesPath(threadId);
    if (!existsSync(path)) return [];
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as StoredMessage[];
    } catch {
      return [];
    }
  }

  private tryParseThreadsFile(path: string): ThreadsFile | null {
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf-8");
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw) as ThreadsFile;
      if (!parsed || !Array.isArray(parsed.threads)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private loadThreadsFile(): ThreadsFile {
    const path = this.getThreadsPath();
    const primary = this.tryParseThreadsFile(path);
    if (primary) return primary;

    // Primary missing or corrupt. Before falling back to empty defaults —
    // which would permanently erase the thread registry on the next save —
    // try the prior-version backup we keep on every write.
    const backup = this.tryParseThreadsFile(`${path}.bak`);
    if (backup) {
      // Quarantine the corrupt file so the next save does not overwrite a
      // possibly-valid payload the kernel hasn't flushed yet.
      if (existsSync(path)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        try {
          renameSync(path, `${path}.corrupt.${stamp}`);
        } catch {
          // best-effort — if rename fails, we still return the backup
        }
      }
      return backup;
    }

    return { threads: [], activeThreadId: null };
  }

  private saveThreadsFile(data: ThreadsFile): void {
    const path = this.getThreadsPath();
    const payload = JSON.stringify(data, null, 2);

    // Keep a rolling single-version backup so a torn write never leaves us
    // with zero readable copies.
    if (existsSync(path)) {
      try {
        copyFileSync(path, `${path}.bak`);
      } catch {
        // non-fatal — continue with the atomic write
      }
    }

    // Atomic write: write to a pid-scoped temp file, fsync it, then rename.
    // `rename` is atomic on the same filesystem, so readers never see a
    // partially-written file.
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, payload, "utf-8");
    try {
      const fd = openSync(tmp, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch {
      // fsync failures are non-fatal; the rename below still publishes the
      // new bytes to readers.
    }
    renameSync(tmp, path);
  }

  listThreads(): Thread[] {
    const { threads } = this.loadThreadsFile();
    return [...threads].sort((a, b) => b.createdAt - a.createdAt);
  }

  getThread(threadId: string): Thread | null {
    const { threads } = this.loadThreadsFile();
    return threads.find((t) => t.id === threadId) ?? null;
  }

  createThread(
    title = "New chat",
    model?: string,
    cwd?: string,
    provider?: string,
  ): Thread {
    const existingIds = new Set(
      this.loadThreadsFile().threads.map((t) => t.id),
    );
    const id = generateReadableId(existingIds);
    const now = Date.now();
    const thread: Thread = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      ...(provider ? { provider: provider as Thread["provider"] } : {}),
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
    };

    const data = this.loadThreadsFile();
    data.threads.push(thread);
    data.activeThreadId = id;
    this.saveThreadsFile(data);

    return thread;
  }

  updateThread(threadId: string, updates: Partial<Thread>): Thread | null {
    const data = this.loadThreadsFile();
    const idx = data.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return null;

    const thread = { ...data.threads[idx], ...updates, updatedAt: Date.now() };
    data.threads[idx] = thread;
    this.saveThreadsFile(data);
    return thread;
  }

  deleteThread(threadId: string): boolean {
    const data = this.loadThreadsFile();
    const idx = data.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return false;

    data.threads.splice(idx, 1);
    if (data.activeThreadId === threadId) {
      data.activeThreadId = data.threads.length > 0 ? data.threads[0].id : null;
    }
    this.saveThreadsFile(data);

    const msgPath = this.getMessagesPath(threadId);
    if (existsSync(msgPath)) {
      unlinkSync(msgPath);
    }

    clearTraceFile(threadId, this.baseDir);

    return true;
  }

  getActiveThreadId(): string | null {
    return this.loadThreadsFile().activeThreadId;
  }

  setActiveThreadId(threadId: string | null): void {
    const data = this.loadThreadsFile();
    data.activeThreadId = threadId;
    this.saveThreadsFile(data);
  }

  clearThreadMessages(threadId: string): void {
    const msgPath = this.getMessagesPath(threadId);
    if (existsSync(msgPath)) {
      unlinkSync(msgPath);
    }
  }

  clearPersistedSessionId(threadId: string): void {
    const data = this.loadThreadsFile();
    const idx = data.threads.findIndex((t) => t.id === threadId);
    if (idx === -1) return;
    delete data.threads[idx].sessionId;
    data.threads[idx].updatedAt = Date.now();
    this.saveThreadsFile(data);
  }

  async loadMessages(threadId: string): Promise<StoredMessage[]> {
    const thread = this.getThread(threadId);
    if (!thread) return [];

    const diskMessages = this.loadMessagesFromDisk(threadId);

    // Non-claude-code providers (e.g. codex) persist messages to disk.
    // Prefer the disk file when it exists so legacy threads with missing
    // provider metadata can still recover persisted Codex history.
    if (thread.provider !== "claude-code" && diskMessages.length > 0) {
      return diskMessages;
    }
    if (thread.provider && thread.provider !== "claude-code") {
      return diskMessages;
    }

    if (!thread.sessionId) return diskMessages;
    try {
      const sdkMessages = await sdkMessagesToStored(
        thread.sessionId,
        thread.createdAt,
        thread.cwd,
      );
      // If the current session is empty (e.g. after a stale-session retry created
      // a new session) but we have a disk backup from the previous session, prefer
      // the disk backup so history stays visible.
      if (sdkMessages.length === 0 && diskMessages.length > 0) {
        return diskMessages;
      }
      return sdkMessages;
    } catch {
      // SDK transcript unavailable — fall back to any disk backup
      return diskMessages;
    }
  }

  saveMessages(threadId: string, messages: StoredMessage[]): void {
    const thread = this.getThread(threadId);
    const hasExistingDiskMessages = existsSync(this.getMessagesPath(threadId));
    // Only persist to disk for non-claude-code providers; claude-code uses SDK as source of truth.
    if (
      !thread ||
      (thread.provider === "claude-code" && !hasExistingDiskMessages)
    ) {
      return;
    }
    if (!thread.provider && !hasExistingDiskMessages) return;

    const dir = join(this.getThreadsDir(), "messages");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      this.getMessagesPath(threadId),
      JSON.stringify(messages, null, 2),
      "utf-8",
    );
  }

  listFolders(): Folder[] {
    const data = this.loadThreadsFile();
    return [...(data.folders ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  }

  addFolder(path: string, name?: string): Folder {
    const data = this.loadThreadsFile();
    if (!data.folders) data.folders = [];

    // Don't add duplicate paths
    const existing = data.folders.find((f) => f.path === path);
    if (existing) return existing;

    const folder: Folder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: name ?? basename(path),
      path,
      createdAt: Date.now(),
    };
    data.folders.push(folder);
    this.saveThreadsFile(data);
    return folder;
  }

  removeFolder(folderId: string): void {
    const data = this.loadThreadsFile();
    if (!data.folders) return;
    const folder = data.folders.find((f) => f.id === folderId);
    if (!folder) return;

    // Remove all threads belonging to this folder
    const removedThreadIds = new Set(
      data.threads
        .filter((t) => (t.worktree?.sourceRepoPath ?? t.cwd) === folder.path)
        .map((t) => t.id),
    );
    data.threads = data.threads.filter((t) => !removedThreadIds.has(t.id));

    // Update activeThreadId if it was in the removed folder
    if (data.activeThreadId && removedThreadIds.has(data.activeThreadId)) {
      data.activeThreadId = data.threads.length > 0 ? data.threads[0].id : null;
    }

    data.folders = data.folders.filter((f) => f.id !== folderId);
    this.saveThreadsFile(data);

    // Clean up message and trace files for removed threads
    for (const threadId of removedThreadIds) {
      const msgPath = this.getMessagesPath(threadId);
      if (existsSync(msgPath)) {
        unlinkSync(msgPath);
      }
      clearTraceFile(threadId, this.baseDir);
    }
  }

  updateFolder(folderId: string, updates: Partial<Folder>): Folder | null {
    const data = this.loadThreadsFile();
    if (!data.folders) return null;
    const idx = data.folders.findIndex((f) => f.id === folderId);
    if (idx === -1) return null;
    data.folders[idx] = { ...data.folders[idx], ...updates };
    this.saveThreadsFile(data);
    return data.folders[idx];
  }
}

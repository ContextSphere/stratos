import { basename, join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
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

  private loadThreadsFile(): ThreadsFile {
    const path = this.getThreadsPath();
    if (!existsSync(path)) {
      return { threads: [], activeThreadId: null };
    }
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as ThreadsFile;
    } catch {
      return { threads: [], activeThreadId: null };
    }
  }

  private saveThreadsFile(data: ThreadsFile): void {
    writeFileSync(
      this.getThreadsPath(),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
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
    if (!thread?.sessionId) return [];
    try {
      return await sdkMessagesToStored(thread.sessionId, thread.createdAt);
    } catch {
      return [];
    }
  }

  // No-op: messages are persisted by the Claude Code SDK, not Stratos.
  saveMessages(_threadId: string, _messages: StoredMessage[]): void {}

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

import type { Thread, Folder, StoredMessage } from "../types/thread";

/**
 * Storage adapter interface for thread persistence.
 * Implement this to customize where threads and messages are stored.
 * The default FileStorageAdapter stores them as JSON on disk.
 */
export interface StorageAdapter {
  listThreads(): Thread[];
  getThread(threadId: string): Thread | null;
  createThread(
    title?: string,
    model?: string,
    cwd?: string,
    provider?: string,
  ): Thread;
  updateThread(threadId: string, updates: Partial<Thread>): Thread | null;
  deleteThread(threadId: string): boolean;
  getActiveThreadId(): string | null;
  setActiveThreadId(threadId: string | null): void;
  clearPersistedSessionId(threadId: string): void;
  loadMessages(threadId: string): Promise<StoredMessage[]>;
  saveMessages(threadId: string, messages: StoredMessage[]): void;
  /** Wipe the disk-backed messages file for a thread (codex/opencode path).
   *  No-op if the file doesn't exist. Harmless for claude-code threads,
   *  which don't write this file. Used when resetting state on provider
   *  switch. */
  clearThreadMessages(threadId: string): void;

  // Folders
  listFolders(): Folder[];
  addFolder(path: string, name?: string): Folder;
  removeFolder(folderId: string): void;
  updateFolder(folderId: string, updates: Partial<Folder>): Folder | null;
}

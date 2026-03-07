import type { Thread, Folder, StoredMessage } from "../types/thread";

/**
 * Storage adapter interface for thread persistence.
 * Implement this to customize where threads and messages are stored.
 * The default FileStorageAdapter stores them as JSON on disk.
 */
export interface StorageAdapter {
  listThreads(): Thread[];
  getThread(threadId: string): Thread | null;
  createThread(title?: string, model?: string, cwd?: string, provider?: string): Thread;
  updateThread(threadId: string, updates: Partial<Thread>): Thread | null;
  deleteThread(threadId: string): boolean;
  getActiveThreadId(): string | null;
  setActiveThreadId(threadId: string | null): void;
  clearPersistedSessionId(threadId: string): void;
  loadMessages(threadId: string): StoredMessage[];
  saveMessages(threadId: string, messages: StoredMessage[]): void;

  // Folders
  listFolders(): Folder[];
  addFolder(path: string, name?: string): Folder;
  removeFolder(folderId: string): void;
  updateFolder(folderId: string, updates: Partial<Folder>): Folder | null;
}

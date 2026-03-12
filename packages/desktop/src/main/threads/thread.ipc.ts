import { ipcMain } from "electron";
import { execSync } from "child_process";
import { join } from "path";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import {
  FileStorageAdapter,
  readTraceEntries,
  clearTraceFile,
} from "@stratosapp/core";
import type {
  StoredMessage,
  AgentMode,
  ThreadWorktree,
  Folder,
  ProviderType,
} from "@stratosapp/core";

const storage = new FileStorageAdapter();

// Reference to clearThreadSession — set by main/index.ts
let clearSessionFn: ((threadId: string) => void) | null = null;
let getRunningIdsFn: (() => string[]) | null = null;

export function setThreadSessionClearer(fn: (threadId: string) => void): void {
  clearSessionFn = fn;
}

export function setRunningThreadsGetter(fn: () => string[]): void {
  getRunningIdsFn = fn;
}

export function registerThreadIpc(): void {
  ipcMain.handle(IPC_CHANNELS.THREADS_LIST, async () => {
    return storage.listThreads();
  });

  ipcMain.handle(IPC_CHANNELS.THREADS_GET_ACTIVE, async () => {
    return storage.getActiveThreadId();
  });

  ipcMain.handle(
    IPC_CHANNELS.THREADS_SET_ACTIVE,
    async (_event, threadId: string | null) => {
      return storage.setActiveThreadId(threadId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_CREATE,
    async (
      _event,
      title?: string,
      model?: string,
      cwd?: string,
      provider?: string,
    ) => {
      const thread = await storage.createThread(title, model, cwd, provider);
      return thread;
    },
  );

  ipcMain.handle(IPC_CHANNELS.THREADS_GET, async (_event, threadId: string) => {
    return storage.getThread(threadId);
  });

  // Git repo detection
  ipcMain.handle(
    IPC_CHANNELS.CHECK_IS_GIT_REPO,
    async (_event, dirPath: string) => {
      try {
        execSync("git rev-parse --is-inside-work-tree", {
          cwd: dirPath,
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return true;
      } catch {
        return false;
      }
    },
  );

  // Thread worktree creation
  ipcMain.handle(
    IPC_CHANNELS.THREADS_CREATE_WORKTREE,
    async (_event, params: { threadId: string; sourceRepoPath: string }) => {
      const { threadId, sourceRepoPath } = params;
      const branchName = `stratos/${threadId}`;
      const worktreeDir = join(homedir(), ".stratos", "worktrees", threadId);

      mkdirSync(worktreeDir, { recursive: true });

      execSync(`git worktree add -b "${branchName}" "${worktreeDir}"`, {
        cwd: sourceRepoPath,
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const worktreeData: ThreadWorktree = {
        path: worktreeDir,
        branch: branchName,
        sourceRepoPath,
      };

      await storage.updateThread(threadId, {
        worktree: worktreeData,
        cwd: worktreeDir,
      });
      return worktreeData;
    },
  );

  // Thread worktree cleanup
  ipcMain.handle(
    IPC_CHANNELS.THREADS_CLEANUP_WORKTREE,
    async (_event, threadId: string) => {
      const thread = await storage.getThread(threadId);
      if (!thread?.worktree) return;

      const { sourceRepoPath, path: worktreePath } = thread.worktree;

      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: sourceRepoPath,
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Worktree may already be removed
      }

      await storage.updateThread(threadId, { worktree: undefined });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_UPDATE,
    async (
      _event,
      threadId: string,
      updates: {
        title?: string;
        model?: string;
        cwd?: string;
        thinkingEffort?: "low" | "medium" | "high" | "max";
        mode?: AgentMode;
        additionalCwds?: string[];
        isGitRepo?: boolean;
        worktreeMode?: "local" | "worktree";
        provider?: ProviderType;
      },
    ) => {
      // Only clear the backend session when the underlying execution context
      // changes. Mode changes are applied per turn and should preserve memory.
      const sessionRequiresReset =
        updates.cwd !== undefined || updates.provider !== undefined;

      if (sessionRequiresReset) {
        clearSessionFn?.(threadId);
        storage.clearPersistedSessionId(threadId);
      }
      return storage.updateThread(threadId, updates);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_DELETE,
    async (_event, threadId: string) => {
      // Clean up worktree if one exists
      const thread = await storage.getThread(threadId);
      if (thread?.worktree) {
        try {
          execSync(`git worktree remove "${thread.worktree.path}" --force`, {
            cwd: thread.worktree.sourceRepoPath,
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          // Worktree may already be removed
        }
      }

      clearSessionFn?.(threadId);
      return storage.deleteThread(threadId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_LOAD_MESSAGES,
    async (_event, threadId: string) => {
      return storage.loadMessages(threadId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_SAVE_MESSAGES,
    async (_event, threadId: string, messages: StoredMessage[]) => {
      return storage.saveMessages(threadId, messages);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_READ_TRACE,
    (_event, threadId: string) => {
      return readTraceEntries(threadId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_CLEAR_TRACE,
    (_event, threadId: string) => {
      clearTraceFile(threadId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.THREADS_RUNNING, () => {
    return getRunningIdsFn?.() ?? [];
  });

  // Folders
  ipcMain.handle(IPC_CHANNELS.FOLDERS_LIST, async () => {
    return storage.listFolders();
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_ADD,
    async (_event, path: string, name?: string) => {
      return storage.addFolder(path, name);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_REMOVE,
    async (_event, folderId: string) => {
      // Clean up worktrees and sessions for threads in this folder
      const folder = storage.listFolders().find((f) => f.id === folderId);
      if (folder) {
        const threads = storage
          .listThreads()
          .filter((t) => t.cwd === folder.path);
        for (const thread of threads) {
          if (thread.worktree) {
            try {
              execSync(
                `git worktree remove "${thread.worktree.path}" --force`,
                {
                  cwd: thread.worktree.sourceRepoPath,
                  encoding: "utf-8",
                  timeout: 10000,
                  stdio: ["pipe", "pipe", "pipe"],
                },
              );
            } catch {
              // Worktree may already be removed
            }
          }
          clearSessionFn?.(thread.id);
        }
      }
      return storage.removeFolder(folderId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDERS_UPDATE,
    async (_event, folderId: string, updates: Partial<Folder>) => {
      return storage.updateFolder(folderId, updates);
    },
  );
}

export function unregisterThreadIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_GET_ACTIVE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_SET_ACTIVE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CREATE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_GET);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_UPDATE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_DELETE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_LOAD_MESSAGES);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_SAVE_MESSAGES);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_READ_TRACE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CLEAR_TRACE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_RUNNING);
  ipcMain.removeHandler(IPC_CHANNELS.CHECK_IS_GIT_REPO);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CREATE_WORKTREE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CLEANUP_WORKTREE);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_ADD);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_REMOVE);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_UPDATE);
}

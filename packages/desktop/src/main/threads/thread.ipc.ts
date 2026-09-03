import { app, ipcMain, BrowserWindow } from "electron";
import { execFile } from "child_process";
import { promisify } from "util";
import { join, isAbsolute } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import { getProviderSettings } from "../settings/settings.store";
import {
  FileStorageAdapter,
  readTraceEntries,
  clearTraceFile,
  isSdkSessionMissing,
  DEFAULT_PROVIDER,
} from "@stratosapp/core";
import type {
  StoredMessage,
  AgentMode,
  ThreadWorktree,
  Folder,
  ProviderType,
} from "@stratosapp/core";

const execFileAsync = promisify(execFile);

// Reference to clearThreadSession — set by main/index.ts
let clearSessionFn: ((threadId: string) => void) | null = null;
let getRunningIdsFn: (() => string[]) | null = null;
let onThreadDeletedFn: ((threadId: string) => void) | null = null;

export function setThreadSessionClearer(fn: (threadId: string) => void): void {
  clearSessionFn = fn;
}

export function setRunningThreadsGetter(fn: () => string[]): void {
  getRunningIdsFn = fn;
}

/** Register a hook that fires when a thread is fully deleted (not session
 *  reset / eviction). Used to drop ScheduleWakeup timers tied to dead threads
 *  so they don't fire later and resurrect the conversation. */
export function setThreadDeletedHook(fn: (threadId: string) => void): void {
  onThreadDeletedFn = fn;
}

/**
 * Emits a diagnostic error to all renderer windows so a toast is shown.
 */
function emitDiagnostic(
  title: string,
  message: string,
  context?: Record<string, unknown>,
  stack?: string,
): void {
  const payload = {
    title,
    message,
    context,
    stack,
    severity: "error" as const,
  };
  console.error(`[diagnostic] ${title}: ${message}`, context ?? "");
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.DIAGNOSTIC_ERROR, payload);
    }
  }
}

export function registerThreadIpc(storage = new FileStorageAdapter()): void {
  // Track threads whose slow worktree cleanup is already queued so we don't
  // pile up duplicate `git worktree remove` calls when THREADS_LIST is
  // called repeatedly before the deferred cleanup lands.
  const worktreeCleanupPending = new Set<string>();

  async function reapStaleClaudeCodeThreads(
    threads: Array<ReturnType<typeof storage.listThreads>[number]>,
  ): Promise<{
    kept: typeof threads;
    stale: typeof threads;
  }> {
    const runningIds = new Set(getRunningIdsFn?.() ?? []);
    // Parallel existsSync-backed check. `isSdkSessionMissing` is synchronous
    // when cwd is provided (the common case), so this fans out cheaply.
    const staleFlags = await Promise.all(
      threads.map((t) => {
        if (
          t.provider !== "claude-code" ||
          !t.sessionId ||
          runningIds.has(t.id)
        ) {
          return Promise.resolve(false);
        }
        return isSdkSessionMissing(t.sessionId, t.cwd);
      }),
    );
    const kept: typeof threads = [];
    const stale: typeof threads = [];
    for (let i = 0; i < threads.length; i++) {
      if (staleFlags[i]) stale.push(threads[i]);
      else kept.push(threads[i]);
    }
    return { kept, stale };
  }

  ipcMain.handle(IPC_CHANNELS.THREADS_LIST, async () => {
    const all = storage.listThreads();
    const { kept, stale } = await reapStaleClaudeCodeThreads(all);
    if (stale.length === 0) return kept;

    // Fast synchronous cleanup so subsequent LIST calls see the reaped
    // threads gone from storage. This also drops any active session and
    // fires the delete hook (loop-wakeup timers etc.) immediately.
    for (const t of stale) {
      clearSessionFn?.(t.id);
      onThreadDeletedFn?.(t.id);
      storage.deleteThread(t.id);
    }
    console.log(
      `[thread-reaper] deleted ${stale.length} stale claude-code thread(s): ${stale
        .map((t) => t.id)
        .join(", ")}`,
    );

    // Defer git worktree removal — it can take multiple seconds per worktree
    // and shouldn't block the sidebar render.
    const worktreesToClean = stale.filter(
      (t) => t.worktree && !worktreeCleanupPending.has(t.id),
    );
    if (worktreesToClean.length > 0) {
      for (const t of worktreesToClean) worktreeCleanupPending.add(t.id);
      setImmediate(async () => {
        for (const t of worktreesToClean) {
          try {
            await execFileAsync(
              "git",
              ["worktree", "remove", t.worktree!.path, "--force"],
              {
                cwd: t.worktree!.sourceRepoPath,
                encoding: "utf-8",
                timeout: 10000,
              },
            );
          } catch {
            // Worktree may already be removed
          } finally {
            worktreeCleanupPending.delete(t.id);
          }
        }
      });
    }

    return kept;
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
      // Every new session defaults to the standard provider unless the caller
      // explicitly picks another one.
      const resolvedProvider = provider ?? DEFAULT_PROVIDER;
      // Pre-populate model and effort from last-used provider settings
      const providerPrefs = getProviderSettings(resolvedProvider);
      const resolvedModel = model ?? providerPrefs.lastUsedModel;

      const thread = await storage.createThread(
        title,
        resolvedModel,
        cwd,
        resolvedProvider,
      );

      const isDev = !!process.defaultApp || !app.isPackaged;
      const updates: Record<string, unknown> = {};
      if (providerPrefs.lastUsedEffort) {
        updates.thinkingEffort = providerPrefs.lastUsedEffort;
      }
      if (isDev) {
        updates.mode = "bypassPermissions";
      }
      if (Object.keys(updates).length > 0) {
        await storage.updateThread(thread.id, updates);
      }

      return isDev ? { ...thread, mode: "bypassPermissions" } : thread;
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
        await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: dirPath,
          encoding: "utf-8",
          timeout: 3000,
        });
        return true;
      } catch {
        return false;
      }
    },
  );

  // Git status (branch + per-file staged/unstaged/mixed/untracked state)
  // Uses async execFile so git commands never block the main-process event loop.
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, cwd: string) => {
    try {
      const { stdout: rootRaw } = await execFileAsync(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd, encoding: "utf-8", timeout: 3000 },
      );
      const root = rootRaw.trim();

      const [{ stdout: branchRaw }, { stdout: statusOutput }] =
        await Promise.all([
          execFileAsync("git", ["branch", "--show-current"], {
            cwd: root,
            encoding: "utf-8",
            timeout: 3000,
          }),
          execFileAsync("git", ["status", "--porcelain=v1"], {
            cwd: root,
            encoding: "utf-8",
            timeout: 3000,
          }),
        ]);
      const branch = branchRaw.trim() || null;

      const files: Record<string, string> = {};
      for (const line of statusOutput.split("\n")) {
        if (line.length < 3) continue;
        const x = line[0];
        const y = line[1];
        let filePath = line.slice(3);
        // Renames: "old -> new" — take the new name
        const arrowIdx = filePath.indexOf(" -> ");
        if (arrowIdx !== -1) filePath = filePath.slice(arrowIdx + 4);
        filePath = filePath.trim();
        if (!filePath) continue;

        let state: string;
        if (x === "?" && y === "?") {
          state = "untracked";
        } else if (x !== " " && y === " ") {
          state = "staged";
        } else if (x === " " && y !== " ") {
          state = "unstaged";
        } else {
          state = "mixed";
        }
        files[filePath] = state;
      }

      return { branch, files, root };
    } catch {
      return { branch: null, files: {}, root: cwd };
    }
  });

  // Thread worktree creation
  ipcMain.handle(
    IPC_CHANNELS.THREADS_CREATE_WORKTREE,
    async (_event, params: { threadId: string; sourceRepoPath: string }) => {
      const { threadId, sourceRepoPath } = params;

      if (!isAbsolute(sourceRepoPath) || !existsSync(sourceRepoPath)) {
        throw new Error(`Invalid sourceRepoPath: ${sourceRepoPath}`);
      }

      const branchName = `stratos/${threadId}`;
      const worktreeDir = join(homedir(), ".stratos", "worktrees", threadId);

      mkdirSync(worktreeDir, { recursive: true });

      await execFileAsync(
        "git",
        ["worktree", "add", "-b", branchName, worktreeDir],
        {
          cwd: sourceRepoPath,
          encoding: "utf-8",
          timeout: 30000,
        },
      );

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
        await execFileAsync(
          "git",
          ["worktree", "remove", worktreePath, "--force"],
          {
            cwd: sourceRepoPath,
            encoding: "utf-8",
            timeout: 10000,
          },
        );
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

  async function performThreadDelete(threadId: string): Promise<boolean> {
    const thread = await storage.getThread(threadId);
    if (thread?.worktree) {
      try {
        await execFileAsync(
          "git",
          ["worktree", "remove", thread.worktree.path, "--force"],
          {
            cwd: thread.worktree.sourceRepoPath,
            encoding: "utf-8",
            timeout: 10000,
          },
        );
      } catch {
        // Worktree may already be removed
      }
    }

    clearSessionFn?.(threadId);
    onThreadDeletedFn?.(threadId);
    return storage.deleteThread(threadId);
  }

  function broadcastThreadsChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.THREADS_CHANGED);
      }
    }
  }

  ipcMain.handle(
    IPC_CHANNELS.THREADS_DELETE,
    async (_event, threadId: string) => {
      return performThreadDelete(threadId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.THREADS_LOAD_MESSAGES,
    async (_event, threadId: string) => {
      // Auto-cleanup: if this is a claude-code thread whose SDK JSONL has
      // been pruned by Claude Code, delete the thread. Skip the check for
      // running threads to avoid a race with in-flight SDK writes.
      const thread = storage.getThread(threadId);
      const runningIds = getRunningIdsFn?.() ?? [];
      if (
        thread?.provider === "claude-code" &&
        thread.sessionId &&
        !runningIds.includes(threadId)
      ) {
        const missing = await isSdkSessionMissing(thread.sessionId, thread.cwd);
        if (missing) {
          await performThreadDelete(threadId);
          broadcastThreadsChanged();
          return [];
        }
      }

      try {
        return await storage.loadMessages(threadId);
      } catch (err) {
        emitDiagnostic(
          "Failed to load thread messages",
          err instanceof Error ? err.message : String(err),
          {
            threadId,
            sessionId: thread?.sessionId ?? "unknown",
            provider: thread?.provider ?? "unknown",
            cwd: thread?.cwd ?? "unknown",
          },
          err instanceof Error ? err.stack : undefined,
        );
        return [];
      }
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
              await execFileAsync(
                "git",
                ["worktree", "remove", thread.worktree.path, "--force"],
                {
                  cwd: thread.worktree.sourceRepoPath,
                  encoding: "utf-8",
                  timeout: 10000,
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
  ipcMain.removeHandler(IPC_CHANNELS.GIT_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CREATE_WORKTREE);
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CLEANUP_WORKTREE);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_LIST);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_ADD);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_REMOVE);
  ipcMain.removeHandler(IPC_CHANNELS.FOLDERS_UPDATE);
}

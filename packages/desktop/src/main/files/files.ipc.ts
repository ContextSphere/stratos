import { ipcMain } from "electron";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { watch as fsWatch } from "fs";
import type { FSWatcher } from "fs";
import { join, resolve, dirname } from "path";
import { IPC_CHANNELS } from "../../common/ipc-channels";

// Watcher state — one watcher per process
let activeWatcher: FSWatcher | null = null;
let activeCwd: string | null = null;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

function isPathWithin(child: string, parent: string): boolean {
  const resolved = resolve(child);
  const resolvedParent = resolve(parent);
  return (
    resolved === resolvedParent || resolved.startsWith(resolvedParent + "/")
  );
}

function hasBinaryBytes(buffer: Buffer, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function registerFilesIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.FILES_LIST_DIR,
    async (_event, dirPath: string, rootPath: string): Promise<DirEntry[]> => {
      if (!isPathWithin(dirPath, rootPath)) {
        throw new Error("Path outside allowed directory");
      }
      const entries = await readdir(dirPath, { withFileTypes: true });
      const settled = await Promise.allSettled(
        entries.map(async (entry) => {
          const fullPath = join(dirPath, entry.name);
          const s = await stat(fullPath);
          return {
            name: entry.name,
            type: (entry.isDirectory() ? "directory" : "file") as
              | "file"
              | "directory",
            size: s.size,
          };
        }),
      );
      const results: DirEntry[] = settled
        .filter(
          (r): r is PromiseFulfilledResult<DirEntry> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return results;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES_READ_FILE,
    async (
      _event,
      filePath: string,
      rootPath: string,
    ): Promise<{ content: string; isBinary: boolean }> => {
      if (!isPathWithin(filePath, rootPath)) {
        throw new Error("Path outside allowed directory");
      }
      const s = await stat(filePath);
      if (s.size > MAX_FILE_SIZE) {
        return { content: "", isBinary: false };
      }
      const buffer = await readFile(filePath);
      const checkLength = Math.min(buffer.length, 8192);
      if (hasBinaryBytes(buffer, checkLength)) {
        return { content: "", isBinary: true };
      }
      return { content: buffer.toString("utf-8"), isBinary: false };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES_WRITE_FILE,
    async (
      _event,
      {
        filePath,
        content,
        rootPath,
      }: { filePath: string; content: string; rootPath: string },
    ): Promise<void> => {
      if (!isPathWithin(filePath, rootPath)) {
        throw new Error("Path outside allowed directory");
      }
      await writeFile(filePath, content, "utf-8");
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES_WATCH_START,
    (_event, cwd: string): void => {
      const webContents = _event.sender;
      // Close any existing watcher first
      if (activeWatcher) {
        activeWatcher.close();
        activeWatcher = null;
      }
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      activeCwd = cwd;


      const watcher = fsWatch(cwd, { recursive: true }, (_, filename) => {
        const changedDir =
          filename == null ? cwd : join(cwd, dirname(filename));

        const existing = debounceTimers.get(changedDir);
        if (existing) clearTimeout(existing);

        debounceTimers.set(
          changedDir,
          setTimeout(() => {
            debounceTimers.delete(changedDir);
            if (!webContents.isDestroyed()) {
              webContents.send(IPC_CHANNELS.FILES_DIR_CHANGED, changedDir);
            }
          }, 100),
        );
      });

      watcher.on("error", () => {
        watcher.close();
        if (activeWatcher === watcher) {
          activeWatcher = null;
          activeCwd = null;
        }
      });

      activeWatcher = watcher;
    },
  );

  ipcMain.handle(IPC_CHANNELS.FILES_WATCH_STOP, (): void => {
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    activeCwd = null;
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
  });
}

export function unregisterFilesIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_DIR);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_READ_FILE);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WRITE_FILE);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_START);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_STOP);
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  activeCwd = null;
}

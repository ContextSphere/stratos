import { ipcMain } from "electron";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { watch as fsWatch, watchFile, unwatchFile } from "fs";
import type { FSWatcher } from "fs";
import { extname, join, resolve, dirname, relative } from "path";
import { IPC_CHANNELS } from "../../common/ipc-channels";

// Directory watcher state — one watcher per process
let activeWatcher: FSWatcher | null = null;
let activeCwd: string | null = null;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Per-file watcher state — keyed by absolute file path. Each entry tracks
// the listener so we can unwatchFile cleanly. fs.watchFile uses mtime
// polling under the hood and is bulletproof on macOS where fs.watch's
// recursive option produces unreliable filename arguments.
interface FileWatchEntry {
  listener: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void;
}
const fileWatchers = new Map<string, FileWatchEntry>();
// 5 s polling is fine for "preview after agent writes a file" — agent
// writes don't happen every second, and the 1 s default added measurable
// per-watcher CPU pressure during streams.
const FILE_WATCH_INTERVAL_MS = 5000;

/** Number of active per-file watchers (fs.watchFile-backed). Exposed for
 *  diagnostic state in agent-manager — without this, the count was a blind
 *  spot in heap-dump correlation. */
export function getFileWatcherCount(): number {
  return fileWatchers.size;
}

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB — base64-encoded over IPC

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
};

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
    ): Promise<{ content: string; isBinary: boolean; isImage?: boolean }> => {
      if (!isPathWithin(filePath, rootPath)) {
        throw new Error("Path outside allowed directory");
      }
      const s = await stat(filePath);
      const ext = extname(filePath).toLowerCase();
      const imageMime = IMAGE_MIME_BY_EXT[ext];
      if (imageMime) {
        if (s.size > MAX_IMAGE_SIZE) {
          return { content: "", isBinary: true, isImage: true };
        }
        const buffer = await readFile(filePath);
        return {
          content: `data:${imageMime};base64,${buffer.toString("base64")}`,
          isBinary: true,
          isImage: true,
        };
      }
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
        // Pending debounce timers each capture a `webContents` reference
        // and the changed-dir string. Without this clear, they stay rooted
        // until each timer ticks (100 ms) — fine in steady state but a
        // burst of fs events at watcher-error time can leave thousands of
        // pending timers all retaining stale state.
        for (const t of debounceTimers.values()) clearTimeout(t);
        debounceTimers.clear();
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

  ipcMain.handle(
    IPC_CHANNELS.FILES_FILE_WATCH_START,
    (
      _event,
      { filePath, rootPath }: { filePath: string; rootPath: string },
    ): void => {
      if (!isPathWithin(filePath, rootPath)) {
        throw new Error("Path outside allowed directory");
      }
      const webContents = _event.sender;

      // Idempotent: if already watching this file, do nothing.
      if (fileWatchers.has(filePath)) return;

      const listener = (
        curr: { mtimeMs: number },
        prev: { mtimeMs: number },
      ): void => {
        // mtimeMs === 0 means the file no longer exists (deleted). Notify
        // the renderer with isDeleted so it can show a friendly message.
        if (curr.mtimeMs === 0 && prev.mtimeMs !== 0) {
          if (!webContents.isDestroyed()) {
            webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
              filePath,
              isDeleted: true,
            });
          }
          return;
        }
        if (curr.mtimeMs === prev.mtimeMs) return;
        // Re-read the file and ship the new content along with the event.
        // Doing it main-side avoids a renderer→main roundtrip per change.
        readFile(filePath)
          .then((buffer) => {
            if (webContents.isDestroyed()) return;
            const ext = extname(filePath).toLowerCase();
            const imageMime = IMAGE_MIME_BY_EXT[ext];
            if (imageMime) {
              if (buffer.byteLength > MAX_IMAGE_SIZE) {
                webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
                  filePath,
                  content: "",
                  isBinary: true,
                  isImage: true,
                  tooLarge: true,
                });
                return;
              }
              webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
                filePath,
                content: `data:${imageMime};base64,${buffer.toString("base64")}`,
                isBinary: true,
                isImage: true,
              });
              return;
            }
            if (buffer.byteLength > MAX_FILE_SIZE) {
              webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
                filePath,
                content: "",
                isBinary: false,
                tooLarge: true,
              });
              return;
            }
            const checkLength = Math.min(buffer.length, 8192);
            if (hasBinaryBytes(buffer, checkLength)) {
              webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
                filePath,
                content: "",
                isBinary: true,
              });
              return;
            }
            webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
              filePath,
              content: buffer.toString("utf-8"),
              isBinary: false,
            });
          })
          .catch(() => {
            // Read failed — file likely deleted/inaccessible between events.
            if (webContents.isDestroyed()) return;
            webContents.send(IPC_CHANNELS.FILES_FILE_CHANGED, {
              filePath,
              isDeleted: true,
            });
          });
      };

      watchFile(filePath, { interval: FILE_WATCH_INTERVAL_MS }, listener);
      fileWatchers.set(filePath, { listener });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES_FILE_WATCH_STOP,
    (_event, { filePath }: { filePath: string }): void => {
      const entry = fileWatchers.get(filePath);
      if (!entry) return;
      unwatchFile(filePath, entry.listener);
      fileWatchers.delete(filePath);
    },
  );

  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    ".turbo",
  ]);

  ipcMain.handle(
    IPC_CHANNELS.FILES_LIST_ALL,
    async (_event, cwd: string): Promise<string[]> => {
      // Basic security: ensure cwd resolves to an absolute path
      const resolvedCwd = resolve(cwd);
      if (!resolvedCwd.startsWith("/")) return [];

      const results: string[] = [];

      async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        const subdirs: string[] = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
              subdirs.push(join(dir, entry.name));
            }
          } else {
            results.push(relative(resolvedCwd, join(dir, entry.name)));
          }
        }
        for (const subdir of subdirs) {
          await walk(subdir);
        }
      }

      try {
        await walk(resolvedCwd);
      } catch {
        return [];
      }

      return results;
    },
  );
}

export function unregisterFilesIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_DIR);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_READ_FILE);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WRITE_FILE);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_START);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_STOP);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_FILE_WATCH_START);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_FILE_WATCH_STOP);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_ALL);
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
  }
  activeCwd = null;
  for (const [filePath, entry] of fileWatchers) {
    unwatchFile(filePath, entry.listener);
  }
  fileWatchers.clear();
}

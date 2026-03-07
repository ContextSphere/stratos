import { ipcMain } from "electron";
import { readdir, readFile, stat } from "fs/promises";
import { join, resolve } from "path";
import { IPC_CHANNELS } from "../../common/ipc-channels";

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
      const results: DirEntry[] = [];
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        try {
          const s = await stat(fullPath);
          results.push({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: s.size,
          });
        } catch {
          // Skip entries we can't stat (permission errors, etc.)
        }
      }
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
}

export function unregisterFilesIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_DIR);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_READ_FILE);
}

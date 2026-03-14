import { ipcMain, WebContents } from "electron";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { IPC_CHANNELS } from "../../common/ipc-channels";

interface TerminalEntry {
  pty: pty.IPty;
  webContentsId: number;
}

const terminals = new Map<string, TerminalEntry>();

export function registerTerminalIpc(webContents: WebContents): void {
  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_CREATE,
    (_event, cwd: string): string => {
      const shell =
        process.env.SHELL ||
        (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
      const id = randomUUID();
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: cwd || process.env.HOME || "/",
        env: {
          ...(process.env as Record<string, string>),
          PROMPT_EOL_MARK: "",
        },
      });

      ptyProcess.onData((data) => {
        if (webContents.isDestroyed()) return;
        webContents.send(IPC_CHANNELS.TERMINAL_DATA, { id, data });
      });

      ptyProcess.onExit(() => {
        terminals.delete(id);
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_CHANNELS.TERMINAL_DATA, {
            id,
            data: "\r\n[Process exited]\r\n",
          });
        }
      });

      terminals.set(id, { pty: ptyProcess, webContentsId: webContents.id });
      return id;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_WRITE,
    (_event, id: string, data: string): void => {
      terminals.get(id)?.pty.write(data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TERMINAL_RESIZE,
    (_event, id: string, cols: number, rows: number): void => {
      terminals.get(id)?.pty.resize(cols, rows);
    },
  );

  ipcMain.handle(IPC_CHANNELS.TERMINAL_DESTROY, (_event, id: string): void => {
    const entry = terminals.get(id);
    if (entry) {
      try {
        entry.pty.kill();
      } catch {}
      terminals.delete(id);
    }
  });
}

export function unregisterTerminalIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_CREATE);
  ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_WRITE);
  ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_RESIZE);
  ipcMain.removeHandler(IPC_CHANNELS.TERMINAL_DESTROY);
  for (const { pty: ptyProcess } of terminals.values()) {
    try {
      ptyProcess.kill();
    } catch {}
  }
  terminals.clear();
}

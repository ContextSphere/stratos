import { ipcMain, WebContents } from "electron";
import * as pty from "node-pty";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { IPC_CHANNELS } from "../../common/ipc-channels";

interface TerminalEntry {
  pty: pty.IPty;
  webContentsId: number;
}

const terminals = new Map<string, TerminalEntry>();

/**
 * Reap every PTY owned by a given webContents. Called when the renderer
 * navigates away (HMR reload, F5, devtools refresh) or the window is
 * destroyed — without this, the renderer drops its terminal IDs but the
 * PTY child shells keep running, holding kernel fds + RAM.
 */
function killTerminalsForWebContents(
  webContentsId: number,
  reason: string,
): void {
  let killed = 0;
  for (const [id, entry] of terminals) {
    if (entry.webContentsId !== webContentsId) continue;
    try {
      entry.pty.kill();
    } catch {}
    terminals.delete(id);
    killed++;
  }
  if (killed > 0) {
    console.log(
      `[terminal] reaped ${killed} terminal(s) for webContents=${webContentsId} (${reason})`,
    );
  }
}

export function registerTerminalIpc(webContents: WebContents): void {
  // Reap all of this webContents' terminals when its renderer navigates
  // away (HMR/F5/devtools-refresh) or when the window is destroyed. We
  // only react to main-frame, non-in-place navigations — in-place
  // (history pushState / hash) are routing changes that keep terminals valid.
  webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        killTerminalsForWebContents(webContents.id, "did-start-navigation");
      }
    },
  );
  webContents.on("destroyed", () => {
    killTerminalsForWebContents(webContents.id, "destroyed");
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, (event, cwd: string): string => {
    // Derive the owning webContents from the IPC event so each terminal
    // is tied to whichever renderer asked for it. Falls back to the one
    // passed at register time (single-window case).
    const owner = event.sender ?? webContents;
    const candidates = [
      process.env.SHELL,
      "/bin/zsh",
      "/bin/bash",
      "/bin/sh",
    ].filter((s): s is string => !!s);
    const shell =
      process.platform === "win32"
        ? "powershell.exe"
        : candidates.find((s) => existsSync(s)) || "/bin/sh";
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
      if (owner.isDestroyed()) return;
      owner.send(IPC_CHANNELS.TERMINAL_DATA, { id, data });
    });

    ptyProcess.onExit(() => {
      terminals.delete(id);
      if (!owner.isDestroyed()) {
        owner.send(IPC_CHANNELS.TERMINAL_DATA, {
          id,
          data: "\r\n[Process exited]\r\n",
        });
      }
    });

    terminals.set(id, { pty: ptyProcess, webContentsId: owner.id });
    return id;
  });

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

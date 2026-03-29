import { execFileSync } from "child_process";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";

// Fix PATH for packaged macOS apps
// Always strip CLAUDECODE to prevent nested-session detection by the SDK
delete process.env.CLAUDECODE;

// `process.defaultApp` stays true for the renamed dev Electron binary, while
// packaged builds should ignore any inherited ELECTRON_RENDERER_URL from the shell.
const isDev = !!process.defaultApp || !app.isPackaged;
if (!isDev && process.platform === "darwin") {
  try {
    const userShell = process.env.SHELL || "/bin/zsh";
    const result = execFileSync(userShell, ["-ilc", 'echo -n "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
    });
    if (result.trim()) process.env.PATH = result.trim();
  } catch {}
}

import { IPC_CHANNELS } from "../common/ipc-channels";
import { AgentManager } from "./agent-manager";
import {
  registerThreadIpc,
  unregisterThreadIpc,
  setThreadSessionClearer,
  setRunningThreadsGetter,
} from "./threads/thread.ipc";
import {
  registerGitHubIpc,
  unregisterGitHubIpc,
} from "./integrations/github.ipc";
import {
  registerClaudeIpc,
  unregisterClaudeIpc,
} from "./integrations/claude.ipc";
import { registerCodexIpc, unregisterCodexIpc } from "./integrations/codex.ipc";
import {
  registerDirectoryIpc,
  unregisterDirectoryIpc,
} from "./settings/directory.ipc";
import {
  registerSettingsIpc,
  unregisterSettingsIpc,
} from "./settings/settings.ipc";
import {
  registerSkillsIpc,
  unregisterSkillsIpc,
  setSlashCommandsGetter,
} from "./skills/skills.ipc";
import { registerFilesIpc, unregisterFilesIpc } from "./files/files.ipc";
import {
  registerTerminalIpc,
  unregisterTerminalIpc,
} from "./terminal/terminal-manager";
import { statSync } from "fs";
import { FileStorageAdapter, getWorktreeInfo } from "@stratosapp/core";
import { generateDockIcon } from "./dock-icon";

// Worktree instance isolation (automatic in dev mode, like ContextSphere)
const worktree = isDev ? getWorktreeInfo() : null;
if (worktree) {
  app.setPath("userData", worktree.userDataPath);
  app.name = `stratos-${worktree.hash}`;
  app.setName(`${worktree.name} — Stratos`);
} else {
  app.name = "stratos";
  app.setName("Stratos");
}

// Single instance per worktree
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // CDP support
  const cdpPort = process.env.CDP_PORT
    ? parseInt(process.env.CDP_PORT, 10)
    : process.env.ENABLE_CDP && worktree
      ? worktree.cdpPort
      : null;

  if (cdpPort && !process.env.REMOTE_DEBUGGING_PORT) {
    app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
  }

  // Increase renderer V8 heap limit to reduce OOM risk on long conversations
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096");

  // GPU acceleration
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.disableDomainBlockingFor3DAPIs();

  let mainWindow: BrowserWindow | null = null;
  let agentManager: AgentManager | null = null;

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 600,
      minHeight: 400,
      show: false,
      ...(process.env.FULLSCREEN === "1" && { fullscreen: true }),
      title: worktree ? `Stratos — ${worktree.name}` : "Stratos",
      titleBarStyle: "hiddenInset",
      transparent: true,
      backgroundColor: "#00000000",
      ...(process.platform === "darwin" && { vibrancy: "sidebar" as const }),
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });

    mainWindow.on("ready-to-show", () => {
      mainWindow!.show();
      if (isDev) {
        mainWindow!.webContents.openDevTools({ mode: "detach" });
        if (worktree) {
          console.log(`[worktree] name=${worktree.name} hash=${worktree.hash}`);
          console.log(`[worktree] userData=${worktree.userDataPath}`);
        }
        if (cdpPort) {
          console.log(`[worktree] CDP port=${cdpPort}`);
          console.log(
            `[worktree] chrome-devtools-mcp: npx chrome-devtools-mcp --browser-url=http://127.0.0.1:${cdpPort}`,
          );
        }
      }
    });

    // Cmd+P → model picker
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (
        input.type === "keyDown" &&
        (input.meta || input.control) &&
        input.key === "p"
      ) {
        event.preventDefault();
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          !mainWindow.webContents.isDestroyed()
        ) {
          mainWindow.webContents.send(IPC_CHANNELS.OPEN_MODEL_PICKER);
        }
      }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
      // Open external links in system browser
      shell.openExternal(details.url);
      return { action: "deny" };
    });

    if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
      mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    } else {
      mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    }

    const storage = new FileStorageAdapter();
    agentManager = new AgentManager(mainWindow, storage);
    agentManager.discoverSlashCommands();

    // Wire up thread session clearing
    setThreadSessionClearer((threadId: string) =>
      agentManager?.clearSession(threadId),
    );
    setRunningThreadsGetter(() => agentManager?.getRunningThreadIds() ?? []);

    // App info (worktree, CDP port)
    ipcMain.handle(IPC_CHANNELS.APP_INFO, () => ({
      isWorktree: !!worktree,
      worktreeName: worktree?.name ?? null,
      cdpPort,
    }));

    registerThreadIpc(storage);
    registerGitHubIpc(mainWindow);
    registerClaudeIpc(mainWindow);
    registerCodexIpc(mainWindow);
    registerDirectoryIpc(mainWindow);
    registerSettingsIpc(mainWindow);
    setSlashCommandsGetter(() => agentManager?.getSlashCommands() ?? []);
    registerSkillsIpc();
    registerFilesIpc();
    registerTerminalIpc(mainWindow.webContents);
  }

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: "deny" };
      });
    }
  });

  app.whenReady().then(() => {
    if (process.platform === "darwin" && worktree) {
      const isLinked = !statSync(join(worktree.root, ".git")).isDirectory();
      app.dock?.setIcon(generateDockIcon(worktree.hash, isLinked));
    }
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    agentManager?.dispose();
    ipcMain.removeHandler(IPC_CHANNELS.APP_INFO);
    unregisterThreadIpc();
    unregisterGitHubIpc();
    unregisterClaudeIpc();
    unregisterCodexIpc();
    unregisterDirectoryIpc();
    unregisterSettingsIpc();
    unregisterSkillsIpc();
    unregisterFilesIpc();
    unregisterTerminalIpc();
    if (process.platform !== "darwin") app.quit();
  });
}

import { execFileSync } from "child_process";
import { app, BrowserWindow, globalShortcut, ipcMain, shell } from "electron";
import { join } from "path";
import * as v8 from "v8";

// Fix PATH and environment for packaged macOS apps
// Always strip CLAUDECODE to prevent nested-session detection by the SDK
delete process.env.CLAUDECODE;

// Expose `globalThis.gc()` in the main process so AgentManager can nudge V8
// to reclaim short-lived streaming allocations after each turn ends. Without
// this, V8 sits at the post-stream high-water mark and the next stream
// starts with little headroom. Best-effort: not all V8 builds honor a
// runtime --expose-gc, but on macOS Electron 40 it does.
try {
  v8.setFlagsFromString("--expose-gc");
} catch {
  // best-effort
}

// `process.defaultApp` stays true for the renamed dev Electron binary, while
// packaged builds should ignore any inherited ELECTRON_RENDERER_URL from the shell.
const isDev = !!process.defaultApp || !app.isPackaged;
if (!isDev && process.platform === "darwin") {
  try {
    const userShell = process.env.SHELL || "/bin/zsh";
    // Get PATH and other important env vars from the user's shell
    const envScript = `echo "PATH=$PATH"; echo "HOME=$HOME"; echo "GOOGLE_APPLICATION_CREDENTIALS=$GOOGLE_APPLICATION_CREDENTIALS"; echo "CLOUDSDK_PYTHON=$CLOUDSDK_PYTHON"; echo "CLOUDSDK_CONFIG=$CLOUDSDK_CONFIG"`;
    const result = execFileSync(userShell, ["-ilc", envScript], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
    });
    // Parse and apply environment variables
    for (const line of result.trim().split("\n")) {
      const eqIndex = line.indexOf("=");
      if (eqIndex > 0) {
        const key = line.slice(0, eqIndex);
        const value = line.slice(eqIndex + 1);
        if (value && value !== "undefined" && value !== "null") {
          process.env[key] = value;
        }
      }
    }
  } catch {}
}

import { IPC_CHANNELS } from "../common/ipc-channels";
import { AgentManager } from "./agent-manager";
import {
  registerThreadIpc,
  unregisterThreadIpc,
  setThreadSessionClearer,
  setRunningThreadsGetter,
  setThreadDeletedHook,
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
  registerCopilotIpc,
  unregisterCopilotIpc,
} from "./integrations/copilot.ipc";
import {
  getEnabledProviders,
  isProviderEnabled,
} from "./config/stratos-config";
import {
  registerWhatsAppIpc,
  unregisterWhatsAppIpc,
  getWhatsAppStatus,
  onWhatsAppStatusChange,
  connectGateway,
} from "./integrations/whatsapp.ipc";
import { isWhatsAppEnabled } from "./integrations/whatsapp-flag";
import {
  registerTelegramIpc,
  unregisterTelegramIpc,
  getTelegramStatus,
  onTelegramStatusChange,
  connectTelegram,
} from "./integrations/telegram.ipc";
import { isTelegramEnabled } from "./integrations/telegram-flag";
import {
  registerDirectoryIpc,
  unregisterDirectoryIpc,
} from "./settings/directory.ipc";
import {
  registerSettingsIpc,
  unregisterSettingsIpc,
} from "./settings/settings.ipc";
import { isManagerEnabled } from "./settings/settings.store";
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
import { SchedulerManager } from "./scheduler/scheduler";
import { WakeupManager } from "./scheduler/wakeup-manager";
import {
  registerSchedulerIpc,
  unregisterSchedulerIpc,
} from "./scheduler/scheduler.ipc";
import { ManagerSession } from "./manager/manager-session";
import {
  registerManagerIpc,
  unregisterManagerIpc,
} from "./manager/manager.ipc";
import { statSync } from "fs";
import { FileStorageAdapter, getWorktreeInfo } from "@stratosapp/core";
import { generateDockIcon } from "./dock-icon";
import { ensureClaudeCodeThinkingSummaries } from "./claude-settings";
import {
  startCrashCapture,
  type CrashCaptureHandle,
} from "./diagnostics/crash-capture";

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

// Crash-capture telemetry: rotating memory log + threshold heap dumps +
// near-OOM auto-snapshot. **Dev builds only** — packaged DMG/zip releases
// don't enable it (heap snapshots can be 30–500 MB and we don't want to
// surprise users with disk usage in their Application Support dir).
// Override with STRATOS_FORCE_CRASH_CAPTURE=1 to enable it on a packaged
// build for one-off production debugging.
let collectAppState: () => Record<string, unknown> = () => ({});
// Wired below once AgentManager exists. The forwarders let crash-capture
// trigger eviction without holding a strong reference to AgentManager
// itself, and stay no-ops until AgentManager has been initialized.
let isUnderPressureNow: () => boolean = () => false;
let onRssPressure: () => void = () => {};
const crashCaptureEnabled =
  isDev || process.env.STRATOS_FORCE_CRASH_CAPTURE === "1";
const crashCapture: CrashCaptureHandle = crashCaptureEnabled
  ? startCrashCapture({
      baseDir: app.getPath("userData"),
      collectAppState: () => collectAppState(),
      isUnderPressureNow: () => isUnderPressureNow(),
      onRssPressure: () => onRssPressure(),
    })
  : {
      dispose() {},
      forceSnapshot() {
        return null;
      },
      dumpDir() {
        return "";
      },
      memLogPath() {
        return "";
      },
    };

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

  // Increase renderer V8 heap limit to reduce OOM risk on long conversations.
  // --expose-gc lets the main process call globalThis.gc() after stream
  // completion (see AgentManager.maybeRunPostStreamGc).
  app.commandLine.appendSwitch(
    "js-flags",
    "--max-old-space-size=4096 --expose-gc",
  );

  // GPU acceleration
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.disableDomainBlockingFor3DAPIs();

  let mainWindow: BrowserWindow | null = null;
  let agentManager: AgentManager | null = null;
  let schedulerManager: SchedulerManager | null = null;
  let wakeupManager: WakeupManager | null = null;
  let managerSession: ManagerSession | null = null;

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

    mainWindow.on("close", () => {
      mainWindow = null;
    });

    mainWindow.on("ready-to-show", () => {
      mainWindow!.show();
      if (isDev) {
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
      try {
        const { protocol } = new URL(details.url);
        if (protocol === "https:" || protocol === "http:") {
          shell.openExternal(details.url);
        }
      } catch {
        // invalid URL — ignore
      }
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

    // App info (worktree, CDP port, enabled providers)
    ipcMain.handle(IPC_CHANNELS.APP_INFO, () => ({
      isWorktree: !!worktree,
      worktreeName: worktree?.name ?? null,
      cdpPort,
      enabledProviders: getEnabledProviders(),
    }));

    ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
      if (typeof url !== "string") return;
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return;
      shell.openExternal(url);
    });

    registerThreadIpc(storage);
    registerGitHubIpc(mainWindow);
    registerClaudeIpc(mainWindow);
    if (isProviderEnabled("codex")) {
      registerCodexIpc(mainWindow);
    } else {
      console.log(
        "[stratos] Codex provider disabled via ~/.stratos/config.json",
      );
    }
    if (isProviderEnabled("copilot")) {
      registerCopilotIpc(mainWindow);
    } else {
      console.log(
        "[stratos] Copilot provider disabled via ~/.stratos/config.json",
      );
    }
    ipcMain.handle(IPC_CHANNELS.WHATSAPP_IS_ENABLED, () => isWhatsAppEnabled());
    if (isWhatsAppEnabled()) {
      registerWhatsAppIpc(mainWindow);
    }
    ipcMain.handle(IPC_CHANNELS.TELEGRAM_IS_ENABLED, () => isTelegramEnabled());
    if (isTelegramEnabled()) {
      registerTelegramIpc(mainWindow);
    }
    registerDirectoryIpc(mainWindow);
    registerSettingsIpc(mainWindow);
    setSlashCommandsGetter(() => agentManager?.getSlashCommands() ?? []);
    registerSkillsIpc();
    registerFilesIpc();
    registerTerminalIpc(mainWindow.webContents);

    // Scheduled prompts
    schedulerManager = new SchedulerManager(agentManager, storage, mainWindow);
    registerSchedulerIpc(schedulerManager);
    schedulerManager.initialize();

    // ScheduleWakeup support (host-side equivalent of the bundled CLI's
    // in-memory cron-task poller for /loop dynamic pacing). See
    // scheduler/wakeup-manager.ts.
    wakeupManager = new WakeupManager(agentManager);
    agentManager.setWakeupHandler(wakeupManager);
    wakeupManager.initialize();
    setThreadDeletedHook((threadId: string) => {
      wakeupManager?.cancelForThread(threadId);
    });

    // Manager Agent (opt-in — off by default). When disabled, still expose the
    // is-enabled IPC handler so the renderer can hide manager UI and skip its
    // status IPC calls. Enabling requires an app restart because AgentManager
    // wires the manager MCP handlers into the socket server at construction.
    ipcMain.handle(IPC_CHANNELS.MANAGER_IS_ENABLED, () => isManagerEnabled());
    if (isManagerEnabled()) {
      managerSession = ManagerSession.initialize(
        agentManager,
        storage,
        mainWindow,
      );
      registerManagerIpc(managerSession);
      agentManager.setManagerMcpStatusProvider(() =>
        managerSession!.getMcpServerStatus(),
      );

      // Cross-wire scheduler ↔ manager. SchedulerManager needs ManagerSession to
      // forward run notifications and to dispatch routeToManager schedules. The
      // wiring is post-construction since ManagerSession is a singleton
      // initialized after SchedulerManager.
      schedulerManager.setManagerSession(managerSession);
    } else {
      console.log(
        "[stratos] Manager Agent disabled (enable via Settings → Manager Agent)",
      );
    }

    // Wire app-state collector for crash-capture telemetry. Each periodic
    // memory log line + each threshold heap dump records this snapshot so
    // we know what the app was doing when memory was at each threshold.
    collectAppState = () => agentManager?.getDiagnosticState() ?? {};
    // Wire RSS safety valve: when native memory stays elevated past the
    // configured ceiling AND no streams are running, force-evict idle
    // sessions and run GC. This breaks the "RSS stuck high after a single
    // spike" cycle observed in May 2026 OOM crashes.
    isUnderPressureNow = () => {
      if (!agentManager) return false;
      return agentManager.getRunningThreadIds().length === 0;
    };
    onRssPressure = () => {
      if (!agentManager) return;
      // Always nudge GC first — this is cheap and is the only mitigation
      // available when streams are running (we can't evict an active
      // subprocess). When there ARE no active streams, also evict idle
      // subprocesses so their native heap is reclaimed.
      const gc = (globalThis as { gc?: () => void }).gc;
      if (typeof gc === "function") {
        try {
          gc();
          console.log("[index] safety valve: ran globalThis.gc()");
        } catch {
          // best-effort
        }
      }
      const evicted = agentManager.forceEvictAllIdleSessions();
      if (evicted > 0) {
        console.log(`[index] safety valve: evicted ${evicted} idle session(s)`);
      }
    };
  }

  // M7: dump heap on child-process death (renderer / utility / GPU). When
  // any of these die, Electron's parent often follows with SIGKILL (exit
  // 137) before the next memory-log poll fires — without an immediate dump
  // we lose the only evidence of what state the main process was in.
  // We log + dump regardless of exit reason so we have a snapshot at the
  // moment the cascade starts. Each unique reason fires at most once per
  // process to avoid a flood when something flaps.
  const childCrashReasonsSeen = new Set<string>();
  app.on("child-process-gone", (_event, details) => {
    const key = `${details.type}:${details.reason}`;
    console.warn(
      `[crash-capture] child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? ""}`,
    );
    if (childCrashReasonsSeen.has(key)) return;
    childCrashReasonsSeen.add(key);
    crashCapture.forceSnapshot(`child-${details.type}-${details.reason}`);
  });
  app.on("render-process-gone", (_event, _wc, details) => {
    const key = `renderer:${details.reason}`;
    console.warn(
      `[crash-capture] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
    );
    if (childCrashReasonsSeen.has(key)) return;
    childCrashReasonsSeen.add(key);
    crashCapture.forceSnapshot(`renderer-${details.reason}`);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setWindowOpenHandler((details) => {
        try {
          const { protocol } = new URL(details.url);
          if (protocol === "https:" || protocol === "http:") {
            shell.openExternal(details.url);
          }
        } catch {
          // invalid URL — ignore
        }
        return { action: "deny" };
      });
    }
  });

  app.whenReady().then(() => {
    ensureClaudeCodeThinkingSummaries();

    // Enable auto-launch at login (packaged builds only — dev shouldn't pollute
    // login items). Idempotent: Electron skips the write if already set.
    if (!isDev) {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    if (process.platform === "darwin" && worktree) {
      const isLinked = !statSync(join(worktree.root, ".git")).isDirectory();
      app.dock?.setIcon(generateDockIcon(worktree.hash, isLinked));
    }

    createWindow();

    // F12 → toggle DevTools docked to the right (globalShortcut works even
    // when DevTools has focus, unlike before-input-event on webContents)
    globalShortcut.register("F12", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools({ mode: "right" });
        }
      }
    });

    app.on("activate", () => {
      // Re-show the window when the dock icon is clicked
      if (process.platform === "darwin") app.dock?.show();
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    wakeupManager?.dispose();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

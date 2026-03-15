import { ipcMain, type BrowserWindow } from "electron";
import { execFile } from "child_process";
import { IPC_CHANNELS } from "../../common/ipc-channels";

// ── Types ───────────────────────────────────────────────────────────────────

interface OpenCodeConnectionInfo {
  connected: boolean;
  cliInstalled: boolean;
  version: string | null;
  serverRunning: boolean;
}

// ── Cached state ────────────────────────────────────────────────────────────

let cachedInfo: OpenCodeConnectionInfo = {
  connected: false,
  cliInstalled: false,
  version: null,
  serverRunning: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function runOpenCode(
  args: string[],
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "opencode",
      args,
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          reject(Object.assign(err, { stdout, stderr }));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

function checkCliInstalled(): Promise<boolean> {
  return runOpenCode(["--version"], 5000)
    .then(() => true)
    .catch(() => false);
}

function getVersion(): Promise<string | null> {
  return runOpenCode(["--version"], 5000)
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

/**
 * Check if an OpenCode server is running by trying to reach its API.
 * Checks the default port and common alternatives.
 */
async function checkServerRunning(): Promise<boolean> {
  const ports = [13749, 4096, 3000];
  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}/session`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // Try next port
    }
  }
  return false;
}

async function refreshCachedInfo(): Promise<OpenCodeConnectionInfo> {
  const installed = await checkCliInstalled();
  if (!installed) {
    cachedInfo = {
      connected: false,
      cliInstalled: false,
      version: null,
      serverRunning: false,
    };
    return cachedInfo;
  }

  const version = await getVersion();
  const serverRunning = await checkServerRunning();

  cachedInfo = {
    connected: serverRunning,
    cliInstalled: true,
    version,
    serverRunning,
  };

  return cachedInfo;
}

function tryRestoreConnection(): void {
  refreshCachedInfo().catch(() => {});
}

// ── Public getter ───────────────────────────────────────────────────────────

export function getOpenCodeConnectionInfo(): OpenCodeConnectionInfo {
  return cachedInfo;
}

// ── IPC Registration ────────────────────────────────────────────────────────

export function registerOpenCodeIpc(_window: BrowserWindow): void {
  tryRestoreConnection();

  ipcMain.handle(IPC_CHANNELS.OPENCODE_CHECK_CLI, async () => {
    const installed = await checkCliInstalled();
    return { installed };
  });

  ipcMain.handle(IPC_CHANNELS.OPENCODE_CONNECT, async () => {
    try {
      const installed = await checkCliInstalled();
      if (!installed) {
        return { ok: false, error: "OpenCode CLI is not installed" };
      }

      const serverRunning = await checkServerRunning();
      if (!serverRunning) {
        return {
          ok: false,
          error:
            "OpenCode server is not running. Start it with: opencode serve",
        };
      }

      const info = await refreshCachedInfo();
      return {
        ok: true,
        version: info.version,
        serverRunning: info.serverRunning,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPENCODE_DISCONNECT, async () => {
    cachedInfo = {
      connected: false,
      cliInstalled: cachedInfo.cliInstalled,
      version: cachedInfo.version,
      serverRunning: false,
    };
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.OPENCODE_GET_CONNECTION, async () => {
    await refreshCachedInfo();
    return cachedInfo;
  });
}

export function unregisterOpenCodeIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.OPENCODE_CHECK_CLI);
  ipcMain.removeHandler(IPC_CHANNELS.OPENCODE_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.OPENCODE_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.OPENCODE_GET_CONNECTION);
}

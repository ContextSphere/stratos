import { BrowserWindow, ipcMain } from "electron";
import { execFile, spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";
import { IPC_CHANNELS } from "../../common/ipc-channels";

// ── Types ───────────────────────────────────────────────────────────────────

interface CopilotConnectionInfo {
  connected: boolean;
  cliInstalled: boolean;
  login: string | null;
  host: string | null;
  authType: string | null;
  statusMessage: string | null;
  cliPath: string | null;
}

// ── Cached state ────────────────────────────────────────────────────────────

let cachedInfo: CopilotConnectionInfo = {
  connected: false,
  cliInstalled: false,
  login: null,
  host: null,
  authType: null,
  statusMessage: null,
  cliPath: null,
};

let cachedCliPath: string | null = null;
let cliPathCheckedAt = 0;
const CLI_PATH_TTL_MS = 60_000;

// ── CLI detection ───────────────────────────────────────────────────────────

const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/copilot",
  "/usr/local/bin/copilot",
  "/usr/bin/copilot",
  // Common Linux paths
  "/home/linuxbrew/.linuxbrew/bin/copilot",
];

async function resolveCopilotPath(): Promise<string | null> {
  const now = Date.now();
  if (cachedCliPath && now - cliPathCheckedAt < CLI_PATH_TTL_MS) {
    return cachedCliPath;
  }

  // Try `which copilot` first (respects user PATH).
  const which = await new Promise<string | null>((resolve) => {
    execFile(
      "/usr/bin/which",
      ["copilot"],
      { timeout: 3000 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const trimmed = stdout.trim();
        resolve(trimmed || null);
      },
    );
  });

  let candidate = which;
  if (!candidate) {
    for (const p of CANDIDATE_PATHS) {
      try {
        await fs.access(p);
        candidate = p;
        break;
      } catch {
        /* not found */
      }
    }
  }

  cachedCliPath = candidate;
  cliPathCheckedAt = now;
  return candidate;
}

function execCopilot(
  args: string[],
  cliPath: string,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cliPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function checkCliInstalled(): Promise<{
  installed: boolean;
  path: string | null;
  version: string | null;
}> {
  const cliPath = await resolveCopilotPath();
  if (!cliPath) return { installed: false, path: null, version: null };
  try {
    const { stdout } = await execCopilot(["--version"], cliPath, 5000);
    const version = stdout.trim().split("\n")[0] ?? null;
    return { installed: true, path: cliPath, version };
  } catch {
    return { installed: false, path: null, version: null };
  }
}

// ── Auth status via SDK ─────────────────────────────────────────────────────

// Lazy SDK module (mirrors copilot.provider.ts pattern — keep CJS-friendly).
let _sdkModule: typeof import("@github/copilot-sdk") | undefined;
function getSdk(): typeof import("@github/copilot-sdk") {
  if (!_sdkModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sdkModule = require("@github/copilot-sdk");
  }
  return _sdkModule!;
}

async function probeAuthStatus(): Promise<{
  authenticated: boolean;
  login: string | null;
  host: string | null;
  authType: string | null;
  statusMessage: string | null;
}> {
  const sdk = getSdk();
  const cliPath = await resolveCopilotPath();
  const client = new sdk.CopilotClient({
    workingDirectory: homedir(),
    mode: "copilot-cli",
    logLevel: "none",
    ...(cliPath
      ? { connection: sdk.RuntimeConnection.forStdio({ path: cliPath }) }
      : {}),
  });
  try {
    await client.start();
    const status = await client.getAuthStatus();
    return {
      authenticated: !!status.isAuthenticated,
      login: status.login ?? null,
      host: status.host ?? null,
      authType: status.authType ?? null,
      statusMessage: status.statusMessage ?? null,
    };
  } catch (err) {
    return {
      authenticated: false,
      login: null,
      host: null,
      authType: null,
      statusMessage: (err as Error)?.message ?? null,
    };
  } finally {
    try {
      await client.stop();
    } catch {
      /* best-effort */
    }
  }
}

async function refreshCachedInfo(): Promise<CopilotConnectionInfo> {
  const cliCheck = await checkCliInstalled();
  if (!cliCheck.installed) {
    cachedInfo = {
      connected: false,
      cliInstalled: false,
      login: null,
      host: null,
      authType: null,
      statusMessage: null,
      cliPath: null,
    };
    return cachedInfo;
  }

  const authStatus = await probeAuthStatus();
  cachedInfo = {
    connected: authStatus.authenticated,
    cliInstalled: true,
    login: authStatus.login,
    host: authStatus.host,
    authType: authStatus.authType,
    statusMessage: authStatus.statusMessage,
    cliPath: cliCheck.path,
  };
  return cachedInfo;
}

function tryRestoreConnection(): void {
  refreshCachedInfo().catch(() => {});
}

// ── Login flow ──────────────────────────────────────────────────────────────
//
// `copilot login` opens a browser to GitHub's device flow. We spawn it as a
// subprocess so the user sees the device code (also logged by the CLI) and
// poll auth status until success or timeout.

let activeLogin: ChildProcess | undefined;

async function startCopilotLogin(cliPath: string): Promise<{
  ok: boolean;
  error?: string;
  output?: string;
}> {
  return new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";

    activeLogin = spawn(cliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    activeLogin.stdout?.on("data", (d) => {
      stdoutBuf += d.toString();
    });
    activeLogin.stderr?.on("data", (d) => {
      stderrBuf += d.toString();
    });
    activeLogin.on("error", (err) => {
      activeLogin = undefined;
      resolve({ ok: false, error: err.message });
    });
    activeLogin.on("exit", (code) => {
      activeLogin = undefined;
      if (code === 0) {
        resolve({ ok: true, output: stdoutBuf });
      } else {
        resolve({
          ok: false,
          error: (stderrBuf || stdoutBuf || `exit ${code}`).trim(),
        });
      }
    });

    // Safety timeout: 5 minutes
    setTimeout(
      () => {
        if (activeLogin) {
          activeLogin.kill();
          activeLogin = undefined;
        }
      },
      5 * 60 * 1000,
    );
  });
}

// ── Disconnect ──────────────────────────────────────────────────────────────
//
// `copilot` has no `logout` subcommand. The OAuth token lives either in the
// OS credential store or in `~/.copilot/`. We clear the plaintext fallback
// and surface a message — full removal requires manual keychain editing.

async function disconnect(): Promise<void> {
  const dir = join(homedir(), ".copilot");
  try {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      if (
        name.startsWith("credentials") ||
        name === "auth.json" ||
        name === "token.json"
      ) {
        try {
          await fs.unlink(join(dir, name));
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* nothing to clean */
  }
}

// ── Public getter ───────────────────────────────────────────────────────────

export function getCopilotConnectionInfo(): CopilotConnectionInfo {
  return cachedInfo;
}

// ── IPC Registration ────────────────────────────────────────────────────────

export function registerCopilotIpc(_window: BrowserWindow): void {
  tryRestoreConnection();

  ipcMain.handle(IPC_CHANNELS.COPILOT_CHECK_CLI, async () => {
    const { installed, path, version } = await checkCliInstalled();
    return { installed, path, version };
  });

  ipcMain.handle(IPC_CHANNELS.COPILOT_CONNECT, async () => {
    try {
      const cliCheck = await checkCliInstalled();
      if (!cliCheck.installed || !cliCheck.path) {
        return {
          ok: false,
          error:
            "Copilot CLI is not installed. Install via 'brew install --cask github-copilot-cli' or visit https://docs.github.com/copilot/copilot-in-the-cli",
        };
      }
      const result = await startCopilotLogin(cliCheck.path);
      if (!result.ok) {
        return { ok: false, error: result.error ?? "Login failed" };
      }
      const info = await refreshCachedInfo();
      if (!info.connected) {
        return {
          ok: false,
          error: info.statusMessage ?? "Authentication did not complete",
        };
      }
      return {
        ok: true,
        login: info.login,
        host: info.host,
        authType: info.authType,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Authentication failed",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COPILOT_DISCONNECT, async () => {
    await disconnect();
    cachedInfo = {
      connected: false,
      cliInstalled: cachedInfo.cliInstalled,
      login: null,
      host: null,
      authType: null,
      statusMessage:
        "Plaintext credentials cleared. If you signed in via the system keychain, remove the 'github-copilot' entry manually.",
      cliPath: cachedInfo.cliPath,
    };
    return { ok: true, message: cachedInfo.statusMessage };
  });

  ipcMain.handle(IPC_CHANNELS.COPILOT_GET_CONNECTION, async () => {
    await refreshCachedInfo();
    return cachedInfo;
  });
}

export function unregisterCopilotIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.COPILOT_CHECK_CLI);
  ipcMain.removeHandler(IPC_CHANNELS.COPILOT_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.COPILOT_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.COPILOT_GET_CONNECTION);
  if (activeLogin) {
    activeLogin.kill();
    activeLogin = undefined;
  }
}

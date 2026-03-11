import { ipcMain, shell, type BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as readline from "readline";
import * as path from "path";
import * as fs from "fs";
import { IPC_CHANNELS } from "../../common/ipc-channels";

// ── Types ───────────────────────────────────────────────────────────────────

interface CodexConnectionInfo {
  connected: boolean;
  cliInstalled: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null; // "apikey" | "chatgpt" | "chatgptAuthTokens" | null
}

// ── Cached state ────────────────────────────────────────────────────────────

let cachedInfo: CodexConnectionInfo = {
  connected: false,
  cliInstalled: false,
  email: null,
  planType: null,
  authMode: null,
};

// ── Codex binary resolution ─────────────────────────────────────────────────

function findCodexBinary(): string {
  const { platform, arch } = process;
  let targetTriple: string | null = null;
  switch (platform) {
    case "linux":
    case "android":
      targetTriple =
        arch === "x64"
          ? "x86_64-unknown-linux-musl"
          : arch === "arm64"
            ? "aarch64-unknown-linux-musl"
            : null;
      break;
    case "darwin":
      targetTriple =
        arch === "x64"
          ? "x86_64-apple-darwin"
          : arch === "arm64"
            ? "aarch64-apple-darwin"
            : null;
      break;
    case "win32":
      targetTriple =
        arch === "x64"
          ? "x86_64-pc-windows-msvc"
          : arch === "arm64"
            ? "aarch64-pc-windows-msvc"
            : null;
      break;
  }
  if (!targetTriple)
    throw new Error(`Unsupported platform: ${platform} (${arch})`);

  const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const binaryRelPath = path.join("vendor", targetTriple, "codex", binaryName);

  // The native binary lives in the platform-specific optional package,
  // e.g. @openai/codex-darwin-arm64, not in @openai/codex itself.
  const platformPackageMap: Record<string, string> = {
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
    "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
  };
  const platformPackage = platformPackageMap[targetTriple];

  // app.asar.unpacked must come before __dirname: in a packaged app __dirname
  // is inside app.asar, and Electron's fs intercept makes existsSync return
  // true for asar-relative paths, but spawn() goes to the OS and fails with
  // ENOTDIR because app.asar is a file, not a directory.
  const resourcesPath: string | undefined = (process as any).resourcesPath;
  const startDirs = [
    ...(resourcesPath
      ? [path.join(resourcesPath, "app.asar.unpacked"), resourcesPath]
      : []),
    __dirname,
    process.cwd(),
  ].filter(Boolean);

  for (const startDir of startDirs) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      // Check platform-specific package (primary location)
      if (platformPackage) {
        const platformCandidate = path.join(
          dir,
          "node_modules",
          platformPackage,
          binaryRelPath,
        );
        if (fs.existsSync(platformCandidate)) return platformCandidate;
      }

      // pnpm hoisted layout
      const pnpmDir = path.join(dir, "node_modules", ".pnpm");
      try {
        const entries = fs.readdirSync(pnpmDir);
        for (const entry of entries) {
          if (
            entry.startsWith("@openai+codex@") &&
            entry.includes(`-${process.platform}-`)
          ) {
            const candidate = path.join(
              pnpmDir,
              entry,
              "node_modules",
              "@openai",
              "codex",
              binaryRelPath,
            );
            if (fs.existsSync(candidate)) return candidate;

            if (platformPackage) {
              const [, pkgName] = platformPackage.split("/");
              const pnpmPlatformCandidate = path.join(
                pnpmDir,
                entry,
                "node_modules",
                "@openai",
                pkgName,
                binaryRelPath,
              );
              if (fs.existsSync(pnpmPlatformCandidate))
                return pnpmPlatformCandidate;
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }

      // Direct node_modules layout
      const directCandidate = path.join(
        dir,
        "node_modules",
        "@openai",
        "codex",
        binaryRelPath,
      );
      if (fs.existsSync(directCandidate)) return directCandidate;

      // Via @openai/codex-sdk symlink
      const sdkCandidate = path.join(
        dir,
        "node_modules",
        "@openai",
        "codex-sdk",
        "node_modules",
        "@openai",
        "codex",
        binaryRelPath,
      );
      if (fs.existsSync(sdkCandidate)) return sdkCandidate;

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  throw new Error("Unable to locate Codex CLI binary");
}

// ── App-server JSON-RPC client ──────────────────────────────────────────────

let appServer: ChildProcess | undefined;
let rl: readline.Interface | undefined;
let rpcId = 0;
let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingRpc = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const notificationQueue: Array<{ method: string; params: any }> = [];
let notificationResolve: (() => void) | undefined;

function sendRpc(
  method: string,
  params: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!appServer?.stdin)
    return Promise.reject(new Error("App server not running"));
  const id = ++rpcId;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  appServer.stdin.write(msg + "\n");
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, { resolve, reject });
  });
}

function sendNotification(
  method: string,
  params: Record<string, unknown> = {},
): void {
  if (!appServer?.stdin) return;
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  appServer.stdin.write(msg + "\n");
}

function waitForNotification(
  methodName: string,
  timeoutMs = 120_000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function check(): void {
      const idx = notificationQueue.findIndex((n) => n.method === methodName);
      if (idx >= 0) {
        const [notification] = notificationQueue.splice(idx, 1);
        resolve(notification.params);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${methodName}`));
        return;
      }
      // Wait for next notification
      notificationResolve = () => check();
      // Also set a fallback timer
      setTimeout(check, 1000);
    }
    check();
  });
}

async function ensureAppServer(): Promise<void> {
  if (appServer && !appServer.killed) return;

  const codexPath = findCodexBinary();
  appServer = spawn(codexPath, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  appServer.on("exit", () => {
    appServer = undefined;
    initialized = false;
  });

  appServer.stderr?.resume();

  rl = readline.createInterface({
    input: appServer.stdout!,
    crlfDelay: Infinity,
  });

  rl.on("line", (line: string) => {
    try {
      const msg = JSON.parse(line);

      // JSON-RPC response
      if (msg.id !== undefined && !msg.method) {
        const pending = pendingRpc.get(msg.id);
        if (pending) {
          pendingRpc.delete(msg.id);
          if (msg.error) {
            pending.reject(
              new Error(msg.error.message ?? JSON.stringify(msg.error)),
            );
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // Notification or server request
      if (msg.method) {
        notificationQueue.push({
          method: msg.method,
          params: msg.params ?? {},
        });
        if (notificationResolve) {
          notificationResolve();
          notificationResolve = undefined;
        }

        // Auto-update cached state on account/updated
        if (msg.method === "account/updated") {
          const authMode = msg.params?.authMode ?? null;
          if (authMode) {
            cachedInfo = { ...cachedInfo, connected: true, authMode };
          } else {
            cachedInfo = {
              ...cachedInfo,
              connected: false,
              email: null,
              planType: null,
              authMode: null,
            };
          }
        }
      }
    } catch {
      // Ignore unparseable lines
    }
  });

  if (!initialized) {
    await sendRpc("initialize", {
      clientInfo: { name: "stratos", title: "Stratos", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    sendNotification("initialized");
    initialized = true;
  }
}

function killAppServer(): void {
  if (appServer && !appServer.killed) {
    appServer.kill();
    appServer = undefined;
  }
  rl?.close();
  rl = undefined;
  initialized = false;
  pendingRpc.clear();
  notificationQueue.length = 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkCliInstalled(): boolean {
  try {
    findCodexBinary();
    return true;
  } catch {
    return false;
  }
}

async function checkAuthStatus(): Promise<{
  authenticated: boolean;
  email: string | null;
  planType: string | null;
  authMode: string | null;
}> {
  try {
    await ensureAppServer();
    const result = await sendRpc("account/read", { refreshToken: false });
    const account = result?.account;
    if (account) {
      return {
        authenticated: true,
        email: account.email ?? null,
        planType: account.planType ?? null,
        authMode: account.type ?? null,
      };
    }
    return {
      authenticated: false,
      email: null,
      planType: null,
      authMode: null,
    };
  } catch {
    return {
      authenticated: false,
      email: null,
      planType: null,
      authMode: null,
    };
  }
}

async function refreshCachedInfo(): Promise<CodexConnectionInfo> {
  const installed = checkCliInstalled();
  if (!installed) {
    cachedInfo = {
      connected: false,
      cliInstalled: false,
      email: null,
      planType: null,
      authMode: null,
    };
    return cachedInfo;
  }

  const authStatus = await checkAuthStatus();
  cachedInfo = {
    connected: authStatus.authenticated,
    cliInstalled: true,
    email: authStatus.email,
    planType: authStatus.planType,
    authMode: authStatus.authMode,
  };
  return cachedInfo;
}

function tryRestoreConnection(): void {
  refreshCachedInfo().catch(() => {});
}

// ── Public getter ───────────────────────────────────────────────────────────

export function getCodexConnectionInfo(): CodexConnectionInfo {
  return cachedInfo;
}

// ── IPC Registration ────────────────────────────────────────────────────────

export function registerCodexIpc(_window: BrowserWindow): void {
  tryRestoreConnection();

  ipcMain.handle(IPC_CHANNELS.CODEX_CHECK_CLI, () => {
    return { installed: checkCliInstalled() };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_CONNECT, async () => {
    try {
      if (!checkCliInstalled()) {
        return { ok: false, error: "Codex CLI is not installed" };
      }

      await ensureAppServer();

      // Start ChatGPT OAuth flow
      const loginResult = await sendRpc("account/login/start", {
        type: "chatgpt",
      });

      if (loginResult?.authUrl) {
        await shell.openExternal(loginResult.authUrl);
      }

      // Wait for login completion notification
      const completion = await waitForNotification(
        "account/login/completed",
        120_000,
      );

      if (!completion?.success) {
        return { ok: false, error: completion?.error ?? "Login failed" };
      }

      const info = await refreshCachedInfo();
      return {
        ok: true,
        email: info.email,
        planType: info.planType,
        authMode: info.authMode,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Authentication failed",
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_DISCONNECT, async () => {
    try {
      await ensureAppServer();
      await sendRpc("account/logout");
    } catch {
      // Best-effort
    }
    cachedInfo = {
      connected: false,
      cliInstalled: cachedInfo.cliInstalled,
      email: null,
      planType: null,
      authMode: null,
    };
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.CODEX_GET_CONNECTION, async () => {
    await refreshCachedInfo();
    return cachedInfo;
  });
}

export function unregisterCodexIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CODEX_CHECK_CLI);
  ipcMain.removeHandler(IPC_CHANNELS.CODEX_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.CODEX_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.CODEX_GET_CONNECTION);
  killAppServer();
}

import { BrowserWindow, ipcMain, app } from "electron";
import { join } from "path";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  renameSync,
  appendFileSync,
} from "fs";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import {
  startGateway,
  stopGateway,
  updateGatewayTrustedPhone,
  sendProactiveWhatsApp,
} from "@stratosapp/gateway";
import { getManagerRef } from "../manager/manager-ref";

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface WhatsAppSettings {
  trustedPhone: string;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "whatsapp-settings.json");
}

function loadSettings(): WhatsAppSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<
      string,
      unknown
    >;
    // Migrate old allowList format → trustedPhone
    if (
      !raw.trustedPhone &&
      Array.isArray(raw.allowList) &&
      raw.allowList.length > 0
    ) {
      return { trustedPhone: String(raw.allowList[0]) };
    }
    return { trustedPhone: (raw.trustedPhone as string) ?? "" };
  } catch {
    return { trustedPhone: "" };
  }
}

function saveSettings(s: WhatsAppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

function authDir(): string {
  const dir = join(app.getPath("userData"), "whatsapp-auth");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// File-based gateway log with rotation (max 2 × 5 MB)
// ---------------------------------------------------------------------------

const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function gatewayLogPath(): string {
  const dir = join(app.getPath("userData"), "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "gateway.log");
}

function writeGatewayLog(line: string): void {
  const filePath = gatewayLogPath();
  try {
    if (existsSync(filePath) && statSync(filePath).size > LOG_MAX_BYTES) {
      renameSync(filePath, filePath + ".1");
    }
    appendFileSync(
      filePath,
      `[${new Date().toISOString()}] ${line}\n`,
      "utf-8",
    );
  } catch {
    // Non-fatal — never crash the gateway over logging
  }
}

function hasAuthCredentials(): boolean {
  const dir = authDir();
  try {
    const files = require("fs").readdirSync(dir) as string[];
    return files.some((f: string) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

type WaStatus = "connected" | "disconnected" | "qr";

let status: WaStatus = "disconnected";
let currentQr: string | null = null;
let win: BrowserWindow | null = null;
let lastGatewayJid: string | null = null;
const statusListeners: Array<(s: WaStatus) => void> = [];
// In-flight connect promise — coalesces concurrent connectGateway() calls so
// only one Baileys socket is ever created at a time.
let connectingPromise: Promise<{ ok: boolean; error?: string }> | null = null;

export function getWhatsAppStatus(): WaStatus {
  return status;
}

export function onWhatsAppStatusChange(cb: (s: WaStatus) => void): () => void {
  statusListeners.push(cb);
  return () => {
    const i = statusListeners.indexOf(cb);
    if (i >= 0) statusListeners.splice(i, 1);
  };
}

function emit(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Core connect logic (shared by auto-connect and manual IPC)
// ---------------------------------------------------------------------------

export function connectGateway(): Promise<{ ok: boolean; error?: string }> {
  if (status === "connected") return Promise.resolve({ ok: true });
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const settings = loadSettings();
    try {
      await startGateway(
        {
          trustedPhone: settings.trustedPhone,
          authDir: authDir(),
        },
        {
          onQr(qr) {
            status = "qr";
            currentQr = qr;
            emit(IPC_CHANNELS.WHATSAPP_STATUS, "qr");
            emit(IPC_CHANNELS.WHATSAPP_QR, qr);
          },
          onStatus(s) {
            status = s;
            if (s !== "qr") currentQr = null;
            emit(IPC_CHANNELS.WHATSAPP_STATUS, s);
            statusListeners.forEach((cb) => cb(s));
          },
          onLog(line) {
            writeGatewayLog(line);
          },
          async onMessage(from, text) {
            writeGatewayLog(`[ipc] message from ${from}: ${text.slice(0, 60)}`);
            const manager = getManagerRef();
            if (!manager) {
              writeGatewayLog("[ipc] manager ref not ready");
              throw new Error("Manager not ready");
            }
            if (manager.isActive) {
              writeGatewayLog("[ipc] manager is busy");
              throw new Error("Manager is busy");
            }
            writeGatewayLog("[ipc] forwarding to manager");
            lastGatewayJid = from;
            // Register a forward function so async child-completion
            // notifications are also delivered to this sender's JID.
            manager.setNotificationForward((replyText) =>
              sendProactiveWhatsApp(from, replyText),
            );
            return new Promise<string>((resolve, reject) => {
              manager
                .sendFromGateway(text, (reply) => {
                  writeGatewayLog(
                    `[ipc] manager replied: ${reply.slice(0, 60)}`,
                  );
                  resolve(reply);
                })
                .catch(reject);
            });
          },
        },
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

export function registerWhatsAppIpc(window: BrowserWindow): void {
  win = window;

  ipcMain.handle(IPC_CHANNELS.WHATSAPP_GET_STATE, () => {
    const settings = loadSettings();
    return {
      status,
      qr: currentQr,
      trustedPhone: settings.trustedPhone,
    };
  });

  ipcMain.handle(IPC_CHANNELS.WHATSAPP_CONNECT, () => connectGateway());

  ipcMain.handle(IPC_CHANNELS.WHATSAPP_DISCONNECT, () => {
    stopGateway();
    connectingPromise = null;
    status = "disconnected";
    currentQr = null;
    lastGatewayJid = null;
    getManagerRef()?.setNotificationForward(null);
    emit(IPC_CHANNELS.WHATSAPP_STATUS, "disconnected");
    statusListeners.forEach((cb) => cb("disconnected"));
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_SAVE_SETTINGS,
    (_e, settings: WhatsAppSettings) => {
      saveSettings(settings);
      updateGatewayTrustedPhone(settings.trustedPhone);
      return { ok: true };
    },
  );

  // Auto-connect if we have saved auth credentials and a trusted phone set.
  // Runs after a short delay to let the Manager session initialise first.
  if (hasAuthCredentials() && loadSettings().trustedPhone) {
    setTimeout(() => {
      connectGateway().catch((err) =>
        console.error("[whatsapp] auto-connect failed:", err),
      );
    }, 3000);
  }
}

export function unregisterWhatsAppIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_GET_STATE);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_SAVE_SETTINGS);
  stopGateway();
  win = null;
}

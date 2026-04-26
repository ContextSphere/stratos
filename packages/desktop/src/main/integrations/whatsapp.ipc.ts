import { BrowserWindow, ipcMain, app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
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

function emit(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Core connect logic (shared by auto-connect and manual IPC)
// ---------------------------------------------------------------------------

async function connectGateway(): Promise<{ ok: boolean; error?: string }> {
  if (status === "connected") return { ok: true };
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
        },
        onLog(line) {
          emit(IPC_CHANNELS.WHATSAPP_LOG, line);
        },
        async onMessage(from, text) {
          emit(
            IPC_CHANNELS.WHATSAPP_LOG,
            `[ipc] message from ${from}: ${text.slice(0, 60)}`,
          );
          const manager = getManagerRef();
          if (!manager) {
            emit(IPC_CHANNELS.WHATSAPP_LOG, "[ipc] manager ref not ready");
            throw new Error("Manager not ready");
          }
          if (manager.isActive) {
            emit(IPC_CHANNELS.WHATSAPP_LOG, "[ipc] manager is busy");
            throw new Error("Manager is busy");
          }
          emit(IPC_CHANNELS.WHATSAPP_LOG, "[ipc] forwarding to manager");
          lastGatewayJid = from;
          // Register a forward function so async child-completion
          // notifications are also delivered to this sender's JID.
          manager.setNotificationForward((replyText) =>
            sendProactiveWhatsApp(from, replyText),
          );
          return new Promise<string>((resolve, reject) => {
            manager
              .sendFromGateway(text, (reply) => {
                emit(
                  IPC_CHANNELS.WHATSAPP_LOG,
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
  }
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
    status = "disconnected";
    currentQr = null;
    lastGatewayJid = null;
    getManagerRef()?.setNotificationForward(null);
    emit(IPC_CHANNELS.WHATSAPP_STATUS, "disconnected");
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

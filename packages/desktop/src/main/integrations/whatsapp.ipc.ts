import { BrowserWindow, ipcMain, app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import { startGateway, stopGateway } from "@stratosapp/gateway";
import { getManagerRef } from "../manager/manager-ref";

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface WhatsAppSettings {
  allowList: string[];
}

function settingsPath(): string {
  return join(app.getPath("userData"), "whatsapp-settings.json");
}

function loadSettings(): WhatsAppSettings {
  try {
    return JSON.parse(
      readFileSync(settingsPath(), "utf-8"),
    ) as WhatsAppSettings;
  } catch {
    return { allowList: [] };
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
// Runtime state
// ---------------------------------------------------------------------------

type WaStatus = "connected" | "disconnected" | "qr";

let status: WaStatus = "disconnected";
let currentQr: string | null = null;
let win: BrowserWindow | null = null;

function emit(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload);
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
      allowList: settings.allowList,
    };
  });

  ipcMain.handle(IPC_CHANNELS.WHATSAPP_CONNECT, async () => {
    if (status === "connected") return { ok: true };
    const settings = loadSettings();
    try {
      await startGateway(
        {
          allowList: settings.allowList,
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
          async onMessage(_from, text) {
            const manager = getManagerRef();
            if (!manager) throw new Error("Manager not ready");
            if (manager.isActive) throw new Error("Manager is busy");
            return new Promise<string>((resolve, reject) => {
              manager.sendFromGateway(text, resolve).catch(reject);
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
  });

  ipcMain.handle(IPC_CHANNELS.WHATSAPP_DISCONNECT, () => {
    stopGateway();
    status = "disconnected";
    currentQr = null;
    emit(IPC_CHANNELS.WHATSAPP_STATUS, "disconnected");
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_SAVE_SETTINGS,
    (_e, settings: WhatsAppSettings) => {
      saveSettings(settings);
      return { ok: true };
    },
  );
}

export function unregisterWhatsAppIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_GET_STATE);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.WHATSAPP_SAVE_SETTINGS);
  stopGateway();
  win = null;
}

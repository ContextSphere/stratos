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
  startTelegramGateway,
  stopTelegramGateway,
  updateGatewayTrustedChatId,
  sendProactiveTelegram,
} from "@stratosapp/gateway";
import { getManagerRef } from "../manager/manager-ref";

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface TelegramSettings {
  botToken: string;
  trustedChatId: string;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "telegram-settings.json");
}

function loadSettings(): TelegramSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<
      string,
      unknown
    >;
    return {
      botToken: (raw.botToken as string) ?? "",
      trustedChatId: (raw.trustedChatId as string) ?? "",
    };
  } catch {
    return { botToken: "", trustedChatId: "" };
  }
}

function saveSettings(s: TelegramSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

// ---------------------------------------------------------------------------
// Shared gateway log (same file as WhatsApp — both are messaging gateways)
// ---------------------------------------------------------------------------

const LOG_MAX_BYTES = 5 * 1024 * 1024;

function gatewayLogPath(): string {
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

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

type TgStatus = "connected" | "disconnected" | "connecting" | "error";

let status: TgStatus = "disconnected";
let win: BrowserWindow | null = null;
let lastChatId: string | null = null;
let lastThreadId: number | undefined = undefined;
const statusListeners: Array<(s: TgStatus) => void> = [];

export function getTelegramStatus(): TgStatus {
  return status;
}

export function onTelegramStatusChange(cb: (s: TgStatus) => void): () => void {
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

export async function connectTelegram(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (status === "connected" || status === "connecting") return { ok: true };
  const settings = loadSettings();
  if (!settings.botToken) {
    return { ok: false, error: "Bot token not configured" };
  }
  status = "connecting";
  emit(IPC_CHANNELS.TELEGRAM_STATUS, status);
  try {
    await startTelegramGateway(
      {
        botToken: settings.botToken,
        trustedChatId: settings.trustedChatId,
      },
      {
        onStatus(s) {
          status = s;
          emit(IPC_CHANNELS.TELEGRAM_STATUS, s);
          statusListeners.forEach((cb) => cb(s));
        },
        onLog(line) {
          writeGatewayLog(line);
        },
        async onMessage(from, text, threadId) {
          const tag = threadId ? ` (topic ${threadId})` : "";
          writeGatewayLog(
            `[telegram-ipc] message from ${from}${tag}: ${text.slice(0, 60)}`,
          );
          const manager = getManagerRef();
          if (!manager) {
            writeGatewayLog("[telegram-ipc] manager ref not ready");
            throw new Error("Manager not ready");
          }
          if (manager.isActive) {
            writeGatewayLog("[telegram-ipc] manager is busy");
            throw new Error("Manager is busy");
          }
          writeGatewayLog("[telegram-ipc] forwarding to manager");
          lastChatId = from;
          lastThreadId = threadId;
          // Register a forward function so async child-completion
          // notifications also land in the same chat (and topic) the user
          // last sent from.
          manager.setNotificationForward((replyText: string) =>
            sendProactiveTelegram(from, replyText, threadId),
          );
          return new Promise<string>((resolve, reject) => {
            manager
              .sendFromGateway(text, (reply) => {
                writeGatewayLog(
                  `[telegram-ipc] manager replied: ${reply.slice(0, 60)}`,
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
    status = "error";
    emit(IPC_CHANNELS.TELEGRAM_STATUS, status);
    statusListeners.forEach((cb) => cb(status));
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

export function registerTelegramIpc(window: BrowserWindow): void {
  win = window;

  ipcMain.handle(IPC_CHANNELS.TELEGRAM_GET_STATE, () => {
    const settings = loadSettings();
    return {
      status,
      botTokenSet: Boolean(settings.botToken),
      trustedChatId: settings.trustedChatId,
    };
  });

  ipcMain.handle(IPC_CHANNELS.TELEGRAM_CONNECT, () => connectTelegram());

  ipcMain.handle(IPC_CHANNELS.TELEGRAM_DISCONNECT, async () => {
    await stopTelegramGateway();
    status = "disconnected";
    lastChatId = null;
    lastThreadId = undefined;
    getManagerRef()?.setNotificationForward(null);
    emit(IPC_CHANNELS.TELEGRAM_STATUS, "disconnected");
    statusListeners.forEach((cb) => cb("disconnected"));
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_SAVE_SETTINGS,
    (_e, settings: Partial<TelegramSettings>) => {
      const current = loadSettings();
      const merged: TelegramSettings = {
        botToken: settings.botToken ?? current.botToken,
        trustedChatId: settings.trustedChatId ?? current.trustedChatId,
      };
      saveSettings(merged);
      // The trusted chat id can be updated live; bot token requires reconnect.
      updateGatewayTrustedChatId(merged.trustedChatId);
      return { ok: true };
    },
  );

  // Auto-connect if we have both a bot token and a trusted chat id.
  if (loadSettings().botToken && loadSettings().trustedChatId) {
    setTimeout(() => {
      connectTelegram().catch((err) =>
        console.error("[telegram] auto-connect failed:", err),
      );
    }, 3000);
  }
}

export function unregisterTelegramIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.TELEGRAM_GET_STATE);
  ipcMain.removeHandler(IPC_CHANNELS.TELEGRAM_CONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.TELEGRAM_DISCONNECT);
  ipcMain.removeHandler(IPC_CHANNELS.TELEGRAM_SAVE_SETTINGS);
  stopTelegramGateway().catch(() => {});
  win = null;
}

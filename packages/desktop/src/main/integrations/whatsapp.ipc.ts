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
  readdirSync,
} from "fs";
import { IPC_CHANNELS } from "../../common/ipc-channels";
import {
  startGateway,
  stopGateway,
  updateGatewayTrustedPhone,
  sendProactiveWhatsApp,
} from "@stratosapp/gateway";
import type { ScheduleNotifyMode } from "@stratosapp/core";
import { getManagerRef } from "../manager/manager-ref";
import { phoneToJid } from "./jid";
import {
  enqueuePendingWhatsApp,
  drainPendingWhatsApp,
} from "./pending-whatsapp";

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

interface WhatsAppSettings {
  trustedPhone: string;
  /** Global default for per-schedule WhatsApp notifications. Per-schedule
   *  `notify` overrides this. Default "errors-only" preserves prior behavior. */
  notifySchedules?: ScheduleNotifyMode;
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
    const notifySchedules = raw.notifySchedules as
      | ScheduleNotifyMode
      | undefined;
    return {
      trustedPhone: (raw.trustedPhone as string) ?? "",
      ...(notifySchedules ? { notifySchedules } : {}),
    };
  } catch {
    return { trustedPhone: "" };
  }
}

function saveSettings(s: WhatsAppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

/** Public read-only accessor for the global notify default. Used by the
 *  scheduler when a schedule's per-prompt `notify` is unset. */
export function getGlobalNotifyDefault(): ScheduleNotifyMode {
  return loadSettings().notifySchedules ?? "errors-only";
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
    const files = readdirSync(dir) as string[];
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
// Forward function wiring
// ---------------------------------------------------------------------------
//
// The Manager calls notificationForwardFn whenever a turn that started as a
// notification finishes. For the schedule → WhatsApp flow we need this fn to
// be set even when the user has never sent an inbound WhatsApp message, so
// the scheduler-triggered Manager turn has somewhere to forward its reply.
//
// Resolution order: lastGatewayJid (set on each inbound) wins because it is
// the canonical multi-device JID Baileys gave us; phoneToJid(trustedPhone) is
// the fallback before any inbound has occurred.
//
// On disconnect or on a send failure we fall back to the persistent pending
// queue (drained on the next reconnect) so schedule notifications are never
// silently dropped.

function resolveForwardJid(): string | null {
  if (lastGatewayJid) return lastGatewayJid;
  return phoneToJid(loadSettings().trustedPhone);
}

async function forwardOrQueue(text: string): Promise<void> {
  const jid = resolveForwardJid();
  if (!jid) {
    writeGatewayLog("[forward] no JID available — dropping notification");
    return;
  }
  if (status !== "connected") {
    enqueuePendingWhatsApp(text);
    writeGatewayLog(
      `[forward] gateway not connected — queued (status=${status})`,
    );
    return;
  }
  try {
    await sendProactiveWhatsApp(jid, text);
    writeGatewayLog(`[forward] sent ${text.length} chars to ${jid}`);
  } catch (err) {
    enqueuePendingWhatsApp(text);
    writeGatewayLog(
      `[forward] send failed, queued: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function installForwardFn(): void {
  const manager = getManagerRef();
  if (!manager) return;
  manager.setNotificationForward((replyText: string) =>
    forwardOrQueue(replyText),
  );
}

// ---------------------------------------------------------------------------
// Core connect logic (shared by auto-connect and manual IPC)
// ---------------------------------------------------------------------------

export async function connectGateway(): Promise<{
  ok: boolean;
  error?: string;
}> {
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
          const wasDisconnected = status !== "connected";
          status = s;
          currentQr = null;
          emit(IPC_CHANNELS.WHATSAPP_STATUS, s);
          statusListeners.forEach((cb) => cb(s));
          if (s === "connected") {
            // Make the forward fn available before any inbound message —
            // this is what unblocks schedule → WhatsApp.
            installForwardFn();
            if (wasDisconnected) {
              drainPendingWhatsApp(async (text) => {
                const jid = resolveForwardJid();
                if (!jid) throw new Error("no JID available");
                await sendProactiveWhatsApp(jid, text);
              }).catch((err) =>
                writeGatewayLog(
                  `[forward] drain failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
            }
          }
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
          // Refresh the cached JID — Baileys may give us a more canonical
          // form on this delivery than what we built from trustedPhone.
          lastGatewayJid = from;
          installForwardFn();
          return new Promise<string>((resolve, reject) => {
            manager
              .sendFromGateway(text, (reply) => {
                writeGatewayLog(`[ipc] manager replied: ${reply.slice(0, 60)}`);
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
      notifySchedules: settings.notifySchedules ?? "errors-only",
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
    statusListeners.forEach((cb) => cb("disconnected"));
    return { ok: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_SAVE_SETTINGS,
    (_e, incoming: Partial<WhatsAppSettings>) => {
      const current = loadSettings();
      const merged: WhatsAppSettings = {
        trustedPhone: incoming.trustedPhone ?? current.trustedPhone,
        ...((incoming.notifySchedules ?? current.notifySchedules)
          ? {
              notifySchedules:
                incoming.notifySchedules ?? current.notifySchedules,
            }
          : {}),
      };
      saveSettings(merged);
      updateGatewayTrustedPhone(merged.trustedPhone);
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

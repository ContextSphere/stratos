import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";

const logger = pino({ level: "silent" });

export type ResolveJid = (jid: string) => string;
export type OnReady = (sock: WASocket, resolveJid: ResolveJid) => void;

export interface WhatsAppCallbacks {
  onQr(qr: string): void;
  onStatus(status: "connected" | "disconnected"): void;
  onLog(line: string): void;
}

let currentSock: WASocket | null = null;

export async function startWhatsApp(
  authDir: string,
  onReady: OnReady,
  callbacks: WhatsAppCallbacks,
  stopped: () => boolean,
): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const lidToPhone = new Map<string, string>();

  function resolveJid(jid: string): string {
    if (!jid.endsWith("@lid")) return jid;
    return lidToPhone.get(jid) ?? jid;
  }

  function indexContact(c: Record<string, unknown>) {
    const id = c["id"] as string | undefined;
    const lid = c["lid"] as string | undefined;
    if (!id || !lid) return;
    const normalizedLid = lid.endsWith("@lid") ? lid : `${lid}@lid`;
    const normalizedPhone = !id.endsWith("@lid") ? id : undefined;
    if (normalizedPhone) lidToPhone.set(normalizedLid, normalizedPhone);
  }

  async function connect(): Promise<void> {
    if (stopped()) return;

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      keepAliveIntervalMs: 30_000,
      markOnlineOnConnect: false,
    });
    currentSock = sock;

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("contacts.upsert", (cs) =>
      cs.forEach((c) => indexContact(c as unknown as Record<string, unknown>)),
    );
    sock.ev.on("contacts.update", (cs) =>
      cs.forEach((c) => indexContact(c as unknown as Record<string, unknown>)),
    );

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) callbacks.onQr(qr);

      if (connection === "open") {
        callbacks.onStatus("connected");
        callbacks.onLog("[whatsapp] connected");
        onReady(sock, resolveJid);
      }

      if (connection === "close") {
        callbacks.onStatus("disconnected");
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          callbacks.onLog(
            "[whatsapp] logged out — delete auth and reconnect to re-pair",
          );
        } else if (!stopped()) {
          callbacks.onLog(
            `[whatsapp] disconnected (${code}), reconnecting in 5s…`,
          );
          setTimeout(connect, 5000);
        }
      }
    });
  }

  await connect();
}

export function stopWhatsAppClient(): void {
  currentSock?.end(undefined);
  currentSock = null;
}

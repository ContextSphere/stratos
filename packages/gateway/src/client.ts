import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type Contact,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";

const logger = pino({ level: "silent" });

export type ResolveJid = (jid: string) => Promise<string>;
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

  // Cache lid → phoneNumber JID from contacts events.
  const lidToPhone = new Map<string, string>();

  function indexContacts(cs: Contact[]) {
    for (const c of cs) {
      // v7 Contact has explicit phoneNumber field alongside lid
      const lid = c.lid;
      const phone = c.phoneNumber;
      if (lid && phone) {
        const normalizedLid = lid.endsWith("@lid") ? lid : `${lid}@lid`;
        lidToPhone.set(normalizedLid, phone);
      }
    }
  }

  async function resolveJid(sock: WASocket, jid: string): Promise<string> {
    if (!jid.endsWith("@lid")) return jid;

    // Tier 1: fast map from contacts events
    const cached = lidToPhone.get(jid);
    if (cached) return cached;

    // Tier 2: Baileys v7 built-in signal repository LID resolver
    try {
      const pnJid = await sock.signalRepository.lidMapping.getPNForLID(jid);
      if (pnJid) {
        lidToPhone.set(jid, pnJid);
        return pnJid;
      }
    } catch {
      // fall through
    }

    return jid;
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
    sock.ev.on("contacts.upsert", (cs) => indexContacts(cs));
    sock.ev.on("contacts.update", (cs) =>
      indexContacts(
        cs.filter((c): c is Contact => Boolean(c.lid && c.phoneNumber)),
      ),
    );

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) callbacks.onQr(qr);

      if (connection === "open") {
        callbacks.onStatus("connected");
        callbacks.onLog("[whatsapp] connected");
        onReady(sock, (jid) => resolveJid(sock, jid));
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

/**
 * Proactively send a WhatsApp message to a JID without an incoming trigger.
 * Used to forward async Manager notifications back to the last known sender.
 */
export async function sendProactiveWhatsApp(
  jid: string,
  text: string,
): Promise<void> {
  if (!currentSock) throw new Error("WhatsApp not connected");
  const { sendReply } = await import("./sender.js");
  await sendReply(currentSock, jid, text);
}

import type { WASocket, BaileysEventMap } from "@whiskeysockets/baileys";
import { getCurrentSock, type ResolveJid } from "./client.js";
import { sendReply, startTyping, stopTyping } from "./sender.js";

type MessageUpsert = BaileysEventMap["messages.upsert"];

function extractText(msg: MessageUpsert["messages"][0]): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""
  ).trim();
}

function isTrusted(jid: string, trustedPhone: string): boolean {
  if (!trustedPhone) return false;
  const digits = jid.split("@")[0].split(":")[0]; // strip multi-device suffix (:0, :1…)
  const e164 = digits.startsWith("+") ? digits : "+" + digits;
  const trusted = trustedPhone.trim();
  return e164 === trusted || jid === trusted;
}

// Wait briefly for the WhatsApp socket to come back after a reconnect.
// Returns the live sock or null if it never reappeared in time.
async function waitForLiveSock(timeoutMs = 8000): Promise<WASocket | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sock = getCurrentSock();
    if (sock?.user) return sock;
    await new Promise((r) => setTimeout(r, 250));
  }
  return getCurrentSock();
}

export function createMessageHandler(
  getTrustedPhone: () => string,
  resolveJid: ResolveJid,
  onMessage: (from: string, text: string) => Promise<string>,
  onLog: (line: string) => void,
) {
  return async ({ messages, type }: MessageUpsert) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      const rawJid = msg.key.remoteJid;
      if (!rawJid || msg.key.fromMe) continue;
      if (rawJid.endsWith("@g.us") || rawJid === "status@broadcast") continue;

      const jid = await resolveJid(rawJid);
      const text = extractText(msg);
      if (!text) continue;

      if (!isTrusted(jid, getTrustedPhone())) {
        onLog(`[handler] blocked: ${jid}`);
        continue;
      }

      onLog(`[handler] message from ${jid}: ${text.slice(0, 80)}`);

      if (text === "/help") {
        const sock = getCurrentSock();
        if (sock) {
          await sendReply(
            sock,
            jid,
            "Anything you send here is forwarded to your Stratos Manager.",
          );
        }
        continue;
      }

      const startSock = getCurrentSock();
      if (startSock) await startTyping(startSock, jid);

      try {
        const reply = await onMessage(jid, text);
        const sock = getCurrentSock() ?? (await waitForLiveSock());
        if (!sock) {
          onLog(
            `[handler] socket lost; could not deliver reply to ${jid}: ${reply.slice(0, 60)}`,
          );
          continue;
        }
        await stopTyping(sock, jid);
        try {
          await sendReply(sock, jid, reply);
        } catch (sendErr) {
          // Connection may have just dropped; wait for reconnect and try once more.
          const retrySock = await waitForLiveSock();
          if (retrySock) {
            await sendReply(retrySock, jid, reply);
          } else {
            const m =
              sendErr instanceof Error ? sendErr.message : String(sendErr);
            onLog(`[handler] reply send failed (no live socket): ${m}`);
          }
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        onLog(`[handler] error: ${m}`);
        const errReply =
          m.includes("socket") || m.includes("connect")
            ? "Stratos appears to be offline. Start it and try again."
            : `Error: ${m}`;
        const sock = getCurrentSock() ?? (await waitForLiveSock());
        if (sock) {
          await stopTyping(sock, jid);
          try {
            await sendReply(sock, jid, errReply);
          } catch {
            /* swallow — already in error path */
          }
        }
      }
    }
  };
}

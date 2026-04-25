import type { WASocket, BaileysEventMap } from "@whiskeysockets/baileys";
import type { ResolveJid } from "./client.js";
import type { GatewayConfig } from "./index.js";
import { sendReply, startTyping } from "./sender.js";
import { setActiveSender, markTyping } from "./callback.js";
import { StratosSocket } from "./stratos-socket.js";

type MessageUpsert = BaileysEventMap["messages.upsert"];

function extractText(msg: MessageUpsert["messages"][0]): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""
  ).trim();
}

function isAllowed(jid: string, allowList: string[]): boolean {
  if (allowList.includes("*")) return true;
  const digits = jid.split("@")[0];
  const e164 = digits.startsWith("+") ? digits : "+" + digits;
  return allowList.includes(e164) || allowList.includes(jid);
}

export function createMessageHandler(
  sock: WASocket,
  stratos: StratosSocket,
  config: GatewayConfig,
  resolveJid: ResolveJid,
  onLog: (line: string) => void,
) {
  return async ({ messages, type }: MessageUpsert) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      const rawJid = msg.key.remoteJid;
      if (!rawJid || msg.key.fromMe) continue;
      if (rawJid.endsWith("@g.us") || rawJid === "status@broadcast") continue;

      const jid = resolveJid(rawJid);
      const text = extractText(msg);
      if (!text) continue;

      if (!isAllowed(jid, config.allowList)) {
        onLog(`[handler] blocked: ${jid}`);
        continue;
      }

      onLog(`[handler] message from ${jid}: ${text.slice(0, 80)}`);

      if (text === "/help") {
        await sendReply(
          sock,
          jid,
          "Anything you send here is forwarded to your Stratos Manager.",
        );
        continue;
      }

      setActiveSender(jid, sock);
      const replyUrl = `http://127.0.0.1:${config.callbackPort}/reply`;

      try {
        await stratos.ensureConnected();
        await stratos.managerPost(text, replyUrl);
        await startTyping(sock, jid);
        markTyping(jid);
      } catch (err) {
        const msg2 = err instanceof Error ? err.message : String(err);
        onLog(`[handler] error: ${msg2}`);
        const reply =
          msg2.includes("socket") || msg2.includes("connect")
            ? "Stratos appears to be offline. Start it and try again."
            : `Error: ${msg2}`;
        await sendReply(sock, jid, reply);
      }
    }
  };
}

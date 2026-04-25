import http from "http";
import type { WASocket } from "@whiskeysockets/baileys";
import { sendReply, stopTyping } from "./sender.js";

interface ActiveSender {
  jid: string;
  sock: WASocket;
  typing: boolean;
}

let activeSender: ActiveSender | null = null;
let server: http.Server | null = null;

export function setActiveSender(jid: string, sock: WASocket): void {
  if (activeSender) {
    activeSender.jid = jid;
    activeSender.sock = sock;
  } else {
    activeSender = { jid, sock, typing: false };
  }
}

export function markTyping(jid: string): void {
  if (activeSender?.jid === jid) activeSender.typing = true;
}

export function startCallbackServer(
  port: number,
  onLog: (line: string) => void,
): void {
  server = http.createServer((req, res) => {
    if (req.url !== "/reply" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      res.writeHead(200).end();
      if (!activeSender) {
        onLog("[callback] reply received but no active sender");
        return;
      }
      const sender = activeSender;
      try {
        const { reply } = JSON.parse(body) as { reply: string };
        if (sender.typing) {
          sender.typing = false;
          await stopTyping(sender.sock, sender.jid);
        }
        await sendReply(sender.sock, sender.jid, reply ?? "(no response)");
      } catch (err) {
        onLog(`[callback] failed to send reply: ${err}`);
      }
    });
  });
  server.listen(port, "127.0.0.1", () => {
    onLog(`[callback] HTTP server listening on 127.0.0.1:${port}`);
  });
}

export function stopCallbackServer(): void {
  server?.close();
  server = null;
  activeSender = null;
}

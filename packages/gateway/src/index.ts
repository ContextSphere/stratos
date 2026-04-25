import { resolve } from "path";
import { startWhatsApp, stopWhatsAppClient } from "./client.js";
import { createMessageHandler } from "./handler.js";
import { startCallbackServer, stopCallbackServer } from "./callback.js";
import { StratosSocket } from "./stratos-socket.js";

export interface GatewayConfig {
  allowList: string[];
  callbackPort: number;
  authDir: string; // absolute path
  stratosSocketPath?: string;
}

export interface GatewayCallbacks {
  onQr(qr: string): void;
  onStatus(status: "connected" | "disconnected"): void;
  onLog(line: string): void;
}

let stopped = false;
let stratosSocket: StratosSocket | null = null;

export async function startGateway(
  config: GatewayConfig,
  callbacks: GatewayCallbacks,
): Promise<void> {
  stopped = false;
  const authDir = resolve(config.authDir);

  stratosSocket = new StratosSocket(config.stratosSocketPath);

  startCallbackServer(config.callbackPort, callbacks.onLog);

  await startWhatsApp(
    authDir,
    (sock, resolveJid) => {
      const handler = createMessageHandler(
        sock,
        stratosSocket!,
        config,
        resolveJid,
        callbacks.onLog,
      );
      sock.ev.on("messages.upsert", handler);
      callbacks.onLog("[gateway] ready — waiting for WhatsApp messages");
    },
    {
      onQr: callbacks.onQr,
      onStatus: callbacks.onStatus,
      onLog: callbacks.onLog,
    },
    () => stopped,
  );
}

export function stopGateway(): void {
  stopped = true;
  stopWhatsAppClient();
  stopCallbackServer();
  stratosSocket?.close();
  stratosSocket = null;
}

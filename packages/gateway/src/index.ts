import { resolve } from "path";
import {
  startWhatsApp,
  stopWhatsAppClient,
  sendProactiveWhatsApp,
} from "./client.js";
import { createMessageHandler } from "./handler.js";

export interface GatewayConfig {
  trustedPhone: string;
  authDir: string; // absolute path
}

export interface GatewayCallbacks {
  onQr(qr: string): void;
  onStatus(status: "connected" | "disconnected"): void;
  onLog(line: string): void;
  onMessage(from: string, text: string): Promise<string>;
}

let stopped = false;
let liveConfig: GatewayConfig | null = null;

/** Update the trusted phone in the running gateway without reconnecting. */
export function updateGatewayTrustedPhone(trustedPhone: string): void {
  if (liveConfig) liveConfig.trustedPhone = trustedPhone;
}

export async function startGateway(
  config: GatewayConfig,
  callbacks: GatewayCallbacks,
): Promise<void> {
  stopped = false;
  liveConfig = config;
  const authDir = resolve(config.authDir);

  await startWhatsApp(
    authDir,
    (sock, resolveJid) => {
      const handler = createMessageHandler(
        sock,
        () => liveConfig?.trustedPhone ?? config.trustedPhone,
        resolveJid,
        callbacks.onMessage,
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
  liveConfig = null;
  stopWhatsAppClient();
}

export { sendProactiveWhatsApp };

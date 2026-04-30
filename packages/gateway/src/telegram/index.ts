import {
  startTelegramBot,
  stopTelegramClient,
  sendProactiveTelegram,
} from "./client.js";
import { createMessageHandler } from "./handler.js";

export interface TelegramGatewayConfig {
  botToken: string;
  trustedChatId: string;
}

export interface TelegramGatewayCallbacks {
  onStatus(status: "connected" | "disconnected" | "error"): void;
  onLog(line: string): void;
  onMessage(
    from: string,
    text: string,
    messageThreadId?: number,
  ): Promise<string>;
}

let stopped = false;
let liveConfig: TelegramGatewayConfig | null = null;

/** Update the trusted chat id in the running gateway without reconnecting. */
export function updateGatewayTrustedChatId(trustedChatId: string): void {
  if (liveConfig) liveConfig.trustedChatId = trustedChatId;
}

export async function startTelegramGateway(
  config: TelegramGatewayConfig,
  callbacks: TelegramGatewayCallbacks,
): Promise<void> {
  stopped = false;
  liveConfig = config;

  await startTelegramBot(
    config.botToken,
    (bot) => {
      const handler = createMessageHandler(
        bot,
        () => liveConfig?.trustedChatId ?? config.trustedChatId,
        callbacks.onMessage,
        callbacks.onLog,
      );
      bot.on("message", handler);
      callbacks.onLog("[telegram] ready — waiting for messages");
    },
    {
      onStatus: callbacks.onStatus,
      onLog: callbacks.onLog,
    },
    () => stopped,
  );
}

export async function stopTelegramGateway(): Promise<void> {
  stopped = true;
  liveConfig = null;
  await stopTelegramClient();
}

export { sendProactiveTelegram };

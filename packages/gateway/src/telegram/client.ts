import TelegramBot from "node-telegram-bot-api";

export interface TelegramCallbacks {
  onStatus(status: "connected" | "disconnected" | "error"): void;
  onLog(line: string): void;
}

export type OnReady = (bot: TelegramBot) => void;

let currentBot: TelegramBot | null = null;

export async function startTelegramBot(
  token: string,
  onReady: OnReady,
  callbacks: TelegramCallbacks,
  stopped: () => boolean,
): Promise<void> {
  if (stopped()) return;

  const bot = new TelegramBot(token, { polling: true });
  currentBot = bot;

  // Verify the token by fetching bot identity. If it fails, surface the error
  // and tear down — node-telegram-bot-api otherwise spins forever on 401s.
  try {
    const me = await bot.getMe();
    callbacks.onLog(`[telegram] connected as @${me.username}`);
    callbacks.onStatus("connected");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onLog(`[telegram] auth failed: ${msg}`);
    callbacks.onStatus("error");
    try {
      await bot.stopPolling();
    } catch {
      /* ignore */
    }
    currentBot = null;
    throw err;
  }

  bot.on("polling_error", (err) => {
    callbacks.onLog(`[telegram] polling error: ${err.message}`);
  });

  onReady(bot);
}

export async function stopTelegramClient(): Promise<void> {
  if (!currentBot) return;
  try {
    await currentBot.stopPolling({ cancel: true });
  } catch {
    /* ignore */
  }
  currentBot = null;
}

/**
 * Proactively send a Telegram message without an incoming trigger.
 * Used to forward async Manager notifications back to the trusted chat.
 */
export async function sendProactiveTelegram(
  chatId: string | number,
  text: string,
  messageThreadId?: number,
): Promise<void> {
  if (!currentBot) throw new Error("Telegram not connected");
  const { sendReply } = await import("./sender.js");
  await sendReply(currentBot, Number(chatId), text, messageThreadId);
}

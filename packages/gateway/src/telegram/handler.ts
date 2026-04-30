import type TelegramBot from "node-telegram-bot-api";
import { sendReply, startTyping } from "./sender.js";

function isTrusted(chatId: number, trustedChatId: string): boolean {
  if (!trustedChatId) return false;
  return String(chatId) === trustedChatId.trim();
}

export function createMessageHandler(
  bot: TelegramBot,
  getTrustedChatId: () => string,
  onMessage: (
    from: string,
    text: string,
    messageThreadId?: number,
  ) => Promise<string>,
  onLog: (line: string) => void,
) {
  return async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const threadId = msg.message_thread_id;
    const text = (msg.text ?? "").trim();
    if (!text) return;

    if (!isTrusted(chatId, getTrustedChatId())) {
      onLog(`[telegram] blocked: chat ${chatId}`);
      return;
    }

    const threadTag = threadId ? ` (topic ${threadId})` : "";
    onLog(
      `[telegram] message from ${chatId}${threadTag}: ${text.slice(0, 80)}`,
    );

    if (text === "/help" || text === "/start") {
      await sendReply(
        bot,
        chatId,
        "Anything you send here is forwarded to your Stratos Manager.",
        threadId,
      );
      return;
    }

    await startTyping(bot, chatId, threadId);
    try {
      const reply = await onMessage(String(chatId), text, threadId);
      await sendReply(bot, chatId, reply, threadId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onLog(`[telegram] error: ${errMsg}`);
      const errReply =
        errMsg.includes("socket") || errMsg.includes("connect")
          ? "Stratos appears to be offline. Start it and try again."
          : `Error: ${errMsg}`;
      await sendReply(bot, chatId, errReply, threadId);
    }
  };
}

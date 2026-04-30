import type TelegramBot from "node-telegram-bot-api";

const MAX_CHUNK = 4000;

function chunk(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_CHUNK) {
    let cut = remaining.lastIndexOf("\n", MAX_CHUNK);
    if (cut < MAX_CHUNK * 0.5) cut = MAX_CHUNK;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendReply(
  bot: TelegramBot,
  chatId: number,
  text: string,
  messageThreadId?: number,
): Promise<void> {
  const parts = chunk(text);
  const opts: TelegramBot.SendMessageOptions | undefined = messageThreadId
    ? { message_thread_id: messageThreadId }
    : undefined;
  for (let i = 0; i < parts.length; i++) {
    const msg =
      parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];
    await bot.sendMessage(chatId, msg, opts);
  }
}

export async function startTyping(
  bot: TelegramBot,
  chatId: number,
  messageThreadId?: number,
): Promise<void> {
  try {
    await bot.sendChatAction(
      chatId,
      "typing",
      messageThreadId ? { message_thread_id: messageThreadId } : undefined,
    );
  } catch {
    /* non-fatal */
  }
}

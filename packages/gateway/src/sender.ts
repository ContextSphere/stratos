import type { WASocket } from "@whiskeysockets/baileys";

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
  sock: WASocket,
  jid: string,
  text: string,
): Promise<void> {
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i++) {
    const msg =
      parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];
    await sock.sendMessage(jid, { text: msg });
  }
}

export async function startTyping(sock: WASocket, jid: string): Promise<void> {
  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {
    /* non-fatal */
  }
}

export async function stopTyping(sock: WASocket, jid: string): Promise<void> {
  try {
    await sock.sendPresenceUpdate("paused", jid);
  } catch {
    /* non-fatal */
  }
}

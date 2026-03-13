import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { StoredMessage, StoredToolCall } from "../types/thread";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | { type: "text"; text: string }[];
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

function getToolResultText(
  content: string | { type: "text"; text: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

const SKIP_TEXT = new Set([
  "[Request interrupted by user for tool use]",
  "[Request interrupted by user]",
  "No response requested.",
]);

/**
 * Loads messages for a session from the Claude Code SDK and maps them to
 * StoredMessage format for use in the Stratos UI.
 *
 * Messages are returned by the SDK in chronological order. Timestamps are
 * approximated from array index since the SDK does not expose per-message
 * timestamps.
 */
export async function sdkMessagesToStored(
  sessionId: string,
  threadCreatedAt: number,
): Promise<StoredMessage[]> {
  const sdkMessages = await getSessionMessages(sessionId);

  // We process the full list in two passes:
  // 1. Build a map of tool_use_id → output from tool_result user messages
  // 2. Build StoredMessages, merging consecutive assistant entries per turn

  // Pass 1: collect all tool results keyed by tool_use_id
  const toolResults = new Map<string, string>();
  for (const msg of sdkMessages) {
    if (msg.type !== "user") continue;
    const m = msg.message as { role: string; content: ContentBlock[] } | null;
    if (!m?.content || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "tool_result") {
        toolResults.set(block.tool_use_id, getToolResultText(block.content));
      }
    }
  }

  // Pass 2: build StoredMessages
  const result: StoredMessage[] = [];
  let msgIndex = 0;

  // We iterate and group consecutive assistant messages into one StoredMessage
  let i = 0;
  while (i < sdkMessages.length) {
    const msg = sdkMessages[i];

    if (msg.type === "user") {
      const m = msg.message as { role: string; content: ContentBlock[] } | null;
      if (!m?.content || !Array.isArray(m.content)) {
        i++;
        continue;
      }

      // Skip pure tool_result messages (already folded into assistant toolCalls)
      const nonToolResultBlocks = m.content.filter(
        (b) => b.type !== "tool_result",
      );
      if (nonToolResultBlocks.length === 0) {
        i++;
        continue;
      }

      // Extract text content, skip interrupt markers
      const textBlocks = nonToolResultBlocks.filter(
        (b) => b.type === "text",
      ) as { type: "text"; text: string }[];
      const imageBlocks = nonToolResultBlocks.filter(
        (b) => b.type === "image",
      ) as {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }[];

      const text = textBlocks
        .map((b) => b.text)
        .filter((t) => !SKIP_TEXT.has(t.trim()))
        .join("\n")
        .trim();

      if (!text && imageBlocks.length === 0) {
        i++;
        continue;
      }

      const storedMsg: StoredMessage = {
        id: msg.uuid,
        role: "user",
        content: text,
        timestamp: threadCreatedAt + msgIndex++,
      };

      if (imageBlocks.length > 0) {
        storedMsg.images = imageBlocks.map((b, idx) => ({
          id: `img_${msg.uuid}_${idx}`,
          name: `image_${idx}.${b.source.media_type.split("/")[1] ?? "png"}`,
          dataUrl: `data:${b.source.media_type};base64,${b.source.data}`,
          mimeType: b.source.media_type,
        }));
      }

      result.push(storedMsg);
      i++;
    } else if (msg.type === "assistant") {
      // Merge consecutive assistant messages into one StoredMessage
      let thinking = "";
      const textParts: string[] = [];
      const toolCalls: StoredToolCall[] = [];

      while (i < sdkMessages.length && sdkMessages[i].type === "assistant") {
        const aMsg = sdkMessages[i];
        const m = aMsg.message as {
          role: string;
          content: ContentBlock[];
          stop_reason?: string;
        } | null;
        if (m?.content && Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block.type === "thinking") {
              thinking = thinking
                ? `${thinking}\n${block.thinking}`
                : block.thinking;
            } else if (block.type === "text") {
              const t = block.text.trim();
              if (t && !SKIP_TEXT.has(t)) textParts.push(t);
            } else if (block.type === "tool_use") {
              toolCalls.push({
                toolCallId: block.id,
                toolName: block.name,
                input: block.input as Record<string, unknown>,
                output: toolResults.get(block.id),
                status: toolResults.has(block.id) ? "completed" : "pending",
              });
            }
          }
        }
        i++;
      }

      const content = textParts.join("\n\n");

      // Skip no-op assistant turns (e.g. pure "No response requested")
      if (!content && !thinking && toolCalls.length === 0) continue;

      const storedMsg: StoredMessage = {
        id: msg.uuid,
        role: "assistant",
        content,
        timestamp: threadCreatedAt + msgIndex++,
        ...(thinking ? { thinking } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };

      // Detect special tool patterns
      const askQuestion = toolCalls.find(
        (tc) => tc.toolName === "AskUserQuestion",
      );
      if (askQuestion) {
        storedMsg.questionData = askQuestion.input;
        storedMsg.questionAnswered = askQuestion.output !== undefined;
      }

      const todoWrite = toolCalls.find((tc) => tc.toolName === "TodoWrite");
      if (todoWrite) {
        const inp = todoWrite.input as { todos?: unknown };
        // Always store as { todos: [...] } — inp.todos is the array when the
        // tool input is { todos: [...] }, so we must wrap it.
        storedMsg.todoData = Array.isArray(inp.todos)
          ? { todos: inp.todos }
          : todoWrite.input;
      }

      result.push(storedMsg);
    } else {
      i++;
    }
  }

  return result;
}

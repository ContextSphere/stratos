import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type {
  SessionCompleteNotification,
  StoredMessage,
  StoredToolCall,
  TaskNotification,
} from "../types/thread";

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

const TOOL_OUTPUT_STORAGE_LIMIT = 50_000; // 50KB — match renderer truncation limit
function truncateToolOutput(output: string | undefined): string | undefined {
  if (!output || output.length <= TOOL_OUTPUT_STORAGE_LIMIT) return output;
  return (
    output.slice(0, TOOL_OUTPUT_STORAGE_LIMIT) +
    `\n\n[… truncated ${output.length - TOOL_OUTPUT_STORAGE_LIMIT} characters]`
  );
}

const SKIP_TEXT = new Set(["No response requested."]);
const SKIP_TEXT_PREFIXES = ["[Request interrupted by user"];

function shouldSkip(text: string): boolean {
  const t = text.trim();
  return SKIP_TEXT.has(t) || SKIP_TEXT_PREFIXES.some((p) => t.startsWith(p));
}

// MessageParam.content may be either a string (typed user input) or an array of
// content blocks. Normalize string → single text block so downstream code can
// always iterate blocks.
function normalizeContent(content: unknown): ContentBlock[] | null {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return null;
}

/**
 * Parse the `[stratos-notification]` prefix that ManagerSession injects as a
 * user message when a manager-spawned child session finishes. The first line
 * looks like:
 *   [stratos-notification] session="abc" title="foo" provider="claude-code" status="completed"
 * Returns null if the text is not a recognizable session-complete notification.
 */
export function parseSessionCompleteNotification(
  text: string,
): SessionCompleteNotification | null {
  const firstLine = text.split("\n", 1)[0];
  if (!firstLine.startsWith("[stratos-notification]")) return null;
  const read = (key: string): string | undefined => {
    const m = firstLine.match(new RegExp(`${key}="([^"]*)"`));
    return m ? m[1] : undefined;
  };
  const threadId = read("session");
  const title = read("title");
  const provider = read("provider");
  const rawStatus = read("status");
  if (!threadId || !rawStatus) return null;
  const status: SessionCompleteNotification["status"] =
    rawStatus === "error" || rawStatus === "interrupted"
      ? rawStatus
      : "completed";
  return {
    threadId,
    title: title ?? threadId,
    provider: provider ?? "claude-code",
    status,
  };
}

// Parse the <task-notification>...</task-notification> XML the SDK injects
// as a user message when a background Task or Monitor tool fires. Returns null
// if the text is not a recognizable task notification.
//
// Two variants exist:
//  - Final task/Monitor completion: has <status> field
//  - Monitor intermediate event: has <event> field (no <status>)
export function parseTaskNotification(text: string): TaskNotification | null {
  if (!text.includes("<task-notification>")) return null;
  const read = (tag: string): string | undefined => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : undefined;
  };
  const taskId = read("task-id");
  const summary = read("summary");
  const rawStatus = read("status");
  const rawEvent = read("event");
  if (!taskId || !summary) return null;

  // Monitor intermediate event (stdout line) — no <status> but has <event>
  if (!rawStatus && rawEvent !== undefined) {
    return {
      taskId,
      summary,
      status: "event",
      event: rawEvent,
      toolUseId: read("tool-use-id"),
    };
  }

  if (!rawStatus) return null;
  const status: TaskNotification["status"] =
    rawStatus === "failed" || rawStatus === "stopped" ? rawStatus : "completed";
  return {
    taskId,
    summary,
    status,
    toolUseId: read("tool-use-id"),
    outputFile: read("output-file"),
  };
}

/**
 * Loads messages for a session from the Claude Code SDK and maps them to
 * StoredMessage format for use in the Stratos UI.
 *
 * Messages are returned by the SDK in chronological order. Timestamps are
 * approximated from array index since the SDK does not expose per-message
 * timestamps.
 */
/**
 * Maximum number of raw SDK messages to process. Long-lived threads can
 * accumulate tens of thousands of SDK messages; loading all of them at once
 * spikes memory and contributes to OOM crashes. We cap the window and only
 * process the most recent messages. The limit is on raw SDK entries (each
 * API turn may produce multiple entries), not on the final StoredMessage count.
 */
const MAX_SDK_MESSAGES = 2000;

export async function sdkMessagesToStored(
  sessionId: string,
  threadCreatedAt: number,
): Promise<StoredMessage[]> {
  const allSdkMessages = await getSessionMessages(sessionId);

  // Cap to the most recent messages to prevent OOM on long threads
  const sdkMessages =
    allSdkMessages.length > MAX_SDK_MESSAGES
      ? allSdkMessages.slice(-MAX_SDK_MESSAGES)
      : allSdkMessages;

  // We process the full list in two passes:
  // 1. Build a map of tool_use_id → output from tool_result user messages
  // 2. Build StoredMessages, merging consecutive assistant entries per turn

  // Pass 1: collect all tool results keyed by tool_use_id
  const toolResults = new Map<string, string>();
  for (const msg of sdkMessages) {
    if (msg.type !== "user") continue;
    const m = msg.message as { role: string; content: unknown } | null;
    const blocks = m ? normalizeContent(m.content) : null;
    if (!blocks) continue;
    for (const block of blocks) {
      if (block.type === "tool_result") {
        toolResults.set(block.tool_use_id, getToolResultText(block.content));
      }
    }
  }

  // Pass 2: build StoredMessages
  const result: StoredMessage[] = [];
  let msgIndex = 0;
  // Maps Monitor task-id → { result index, toolCallId } so Monitor events
  // can be folded into the originating tool call instead of becoming pills.
  const monitorTaskMap = new Map<
    string,
    { resultIdx: number; toolCallId: string }
  >();

  // We iterate and group consecutive assistant messages into one StoredMessage
  let i = 0;
  while (i < sdkMessages.length) {
    const msg = sdkMessages[i];

    if (msg.type === "user") {
      const m = msg.message as { role: string; content: unknown } | null;
      const blocks = m ? normalizeContent(m.content) : null;
      if (!blocks) {
        i++;
        continue;
      }

      // Skip pure tool_result messages (already folded into assistant toolCalls)
      const nonToolResultBlocks = blocks.filter(
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

      const rawText = textBlocks.map((b) => b.text).join("\n");
      const taskNotif =
        (msg as { origin?: { kind?: string } }).origin?.kind ===
          "task-notification" || rawText.includes("<task-notification>")
          ? parseTaskNotification(rawText)
          : null;

      if (taskNotif) {
        // Monitor intermediate event — fold into the originating tool call
        if (taskNotif.status === "event") {
          const mapping = monitorTaskMap.get(taskNotif.taskId);
          if (mapping) {
            const targetMsg = result[mapping.resultIdx];
            const tc = targetMsg.toolCalls?.find(
              (c) => c.toolCallId === mapping.toolCallId,
            );
            if (tc) {
              tc.monitorEvents = [
                ...(tc.monitorEvents ?? []),
                taskNotif.event ?? taskNotif.summary,
              ];
            }
            i++;
            continue;
          }
          // Orphaned event with no known monitor: fall through to standalone pill
        }

        // Monitor final status — clean up the map, tool call is already "completed"
        if (taskNotif.status !== "event") {
          monitorTaskMap.delete(taskNotif.taskId);
        }

        result.push({
          id: msg.uuid,
          role: "user",
          content: "",
          timestamp: threadCreatedAt + msgIndex++,
          taskNotification: taskNotif,
        });
        i++;
        continue;
      }

      const sessionNotif = parseSessionCompleteNotification(rawText);
      if (sessionNotif) {
        result.push({
          id: msg.uuid,
          role: "user",
          content: "",
          timestamp: threadCreatedAt + msgIndex++,
          sessionCompleteNotification: sessionNotif,
        });
        i++;
        continue;
      }

      const text = textBlocks
        .map((b) => b.text)
        .filter((t) => !shouldSkip(t))
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
          content: unknown;
          stop_reason?: string;
        } | null;
        const blocks = m ? normalizeContent(m.content) : null;
        if (blocks) {
          for (const block of blocks) {
            if (block.type === "thinking") {
              thinking = thinking
                ? `${thinking}\n${block.thinking}`
                : block.thinking;
            } else if (block.type === "text") {
              const t = block.text.trim();
              if (t && !shouldSkip(t)) textParts.push(t);
            } else if (block.type === "tool_use") {
              toolCalls.push({
                toolCallId: block.id,
                toolName: block.name,
                input: block.input as Record<string, unknown>,
                output: truncateToolOutput(toolResults.get(block.id)),
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

      // Extract Monitor task-ids from tool results so future Monitor events
      // can be folded into this message's tool calls.
      for (const tc of toolCalls) {
        if (tc.toolName === "Monitor" && tc.output) {
          const match = tc.output.match(/\(task ([a-zA-Z0-9_-]+)[,)]/);
          if (match) {
            tc.monitorTaskId = match[1];
            monitorTaskMap.set(match[1], {
              resultIdx: result.length,
              toolCallId: tc.toolCallId,
            });
          }
        }
      }

      result.push(storedMsg);
    } else {
      i++;
    }
  }

  return result;
}

import { useMemo } from "react";
import type { ChatMessage, ToolCall } from "../types";

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "Delete"]);

function extractFilePath(input: Record<string, unknown>): string {
  return (
    (input.file_path as string | undefined) ??
    (input.filePath as string | undefined) ??
    (input.path as string | undefined) ??
    (input.file as string | undefined) ??
    ""
  );
}

function calcLineStats(
  oldText: string,
  newText: string,
): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of oldText.split("\n"))
    counts.set(line, (counts.get(line) ?? 0) - 1);
  for (const line of newText.split("\n"))
    counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  let removed = 0;
  for (const delta of counts.values()) {
    if (delta > 0) added += delta;
    else if (delta < 0) removed -= delta;
  }
  return { added, removed };
}

function toolCallStats(tc: ToolCall): { added: number; removed: number } {
  if (tc.toolName === "Edit") {
    const old = (tc.input.old_string as string | undefined) ?? "";
    const next = (tc.input.new_string as string | undefined) ?? "";
    return calcLineStats(old, next);
  }
  if (tc.toolName === "Write") {
    const content = (tc.input.content as string | undefined) ?? "";
    return { added: content ? content.split("\n").length : 0, removed: 0 };
  }
  return { added: 0, removed: 0 };
}

export interface SessionFileChange {
  filePath: string;
  toolCalls: ToolCall[];
  latestToolCall: ToolCall;
  added: number;
  removed: number;
  hasRunning: boolean;
}

export interface SessionChanges {
  files: SessionFileChange[];
  totalAdded: number;
  totalRemoved: number;
  hasRunning: boolean;
}

export function useSessionChanges(messages: ChatMessage[]): SessionChanges {
  return useMemo(() => {
    const fileMap = new Map<string, ToolCall[]>();

    for (const msg of messages) {
      if (!msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        if (!FILE_CHANGE_TOOLS.has(tc.toolName)) continue;
        const fp = extractFilePath(tc.input);
        if (!fp) continue;
        const existing = fileMap.get(fp);
        if (existing) {
          existing.push(tc);
        } else {
          fileMap.set(fp, [tc]);
        }
      }
    }

    const files: SessionFileChange[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    let sessionHasRunning = false;

    for (const [filePath, toolCalls] of fileMap) {
      const latestToolCall = toolCalls[toolCalls.length - 1];
      const hasRunning = latestToolCall.status === "running";

      const { added, removed } =
        latestToolCall.status === "completed"
          ? toolCallStats(latestToolCall)
          : { added: 0, removed: 0 };

      totalAdded += added;
      totalRemoved += removed;
      if (hasRunning) sessionHasRunning = true;

      files.push({
        filePath,
        toolCalls,
        latestToolCall,
        added,
        removed,
        hasRunning,
      });
    }

    return { files, totalAdded, totalRemoved, hasRunning: sessionHasRunning };
  }, [messages]);
}

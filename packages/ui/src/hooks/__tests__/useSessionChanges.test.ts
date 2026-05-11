import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionChanges } from "../useSessionChanges";
import type { ChatMessage } from "../../types";

function makeEditMsg(
  id: string,
  filePath: string,
  oldStr: string,
  newStr: string,
  status: "completed" | "running" = "completed",
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: 0,
    toolCalls: [
      {
        toolCallId: id,
        toolName: "Edit",
        input: { file_path: filePath, old_string: oldStr, new_string: newStr },
        status,
      },
    ],
  };
}

function makeWriteMsg(
  id: string,
  filePath: string,
  content: string,
  status: "completed" | "running" = "completed",
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: 0,
    toolCalls: [
      {
        toolCallId: id,
        toolName: "Write",
        input: { file_path: filePath, content },
        status,
      },
    ],
  };
}

describe("useSessionChanges", () => {
  it("counts per-latest-tool-call, not cumulative — fixes count vs viewer mismatch", () => {
    // File had Write (+3 lines) then Edit (+1 -1). Should show Edit's stats (+1 -1),
    // not cumulative (+4 -1), so stats match what the viewer renders.
    const messages: ChatMessage[] = [
      makeWriteMsg("w1", "/app/foo.ts", "line1\nline2\nline3"),
      makeEditMsg("e1", "/app/foo.ts", "line2", "newline2"),
    ];
    const { result } = renderHook(() => useSessionChanges(messages));
    const file = result.current.files.find((f) => f.filePath === "/app/foo.ts");
    expect(file?.added).toBe(1);
    expect(file?.removed).toBe(1);
    // totalAdded/totalRemoved also reflect latest-op stats, not accumulated
    expect(result.current.totalAdded).toBe(1);
    expect(result.current.totalRemoved).toBe(1);
  });

  it("handles duplicate lines correctly — fixes Set-based undercounting", () => {
    // old has two blank lines; new has one. Set-based would say removed=0,
    // Map-based correctly says removed=1.
    const messages: ChatMessage[] = [
      makeEditMsg("e1", "/app/dup.ts", "a\na\nb", "a\nb\nb"),
    ];
    const { result } = renderHook(() => useSessionChanges(messages));
    const file = result.current.files.find((f) => f.filePath === "/app/dup.ts");
    // Net: one "a" removed, one "b" added
    expect(file?.added).toBe(1);
    expect(file?.removed).toBe(1);
  });

  it("shows Write stats (all additions) when Write is the latest op", () => {
    const messages: ChatMessage[] = [
      makeWriteMsg("w1", "/app/new.ts", "line1\nline2\nline3"),
    ];
    const { result } = renderHook(() => useSessionChanges(messages));
    const file = result.current.files.find((f) => f.filePath === "/app/new.ts");
    expect(file?.added).toBe(3);
    expect(file?.removed).toBe(0);
  });

  it("running tool call shows zero stats (not yet complete)", () => {
    const messages: ChatMessage[] = [
      makeEditMsg("e1", "/app/run.ts", "old", "new", "running"),
    ];
    const { result } = renderHook(() => useSessionChanges(messages));
    const file = result.current.files.find((f) => f.filePath === "/app/run.ts");
    expect(file?.added).toBe(0);
    expect(file?.removed).toBe(0);
    expect(file?.hasRunning).toBe(true);
  });

  it("uses the LATEST tool call stats when there are multiple edits on one file", () => {
    const messages: ChatMessage[] = [
      makeEditMsg(
        "e1",
        "/app/multi.ts",
        "alpha\nbeta\ngamma",
        "alpha\ndelta\ngamma",
      ),
      makeEditMsg("e2", "/app/multi.ts", "delta", "epsilon\nzeta"),
    ];
    const { result } = renderHook(() => useSessionChanges(messages));
    const file = result.current.files.find(
      (f) => f.filePath === "/app/multi.ts",
    );
    // Only e2 stats: old="delta" (1 line), new="epsilon\nzeta" (2 lines) → +2 -1
    expect(file?.added).toBe(2);
    expect(file?.removed).toBe(1);
  });
});

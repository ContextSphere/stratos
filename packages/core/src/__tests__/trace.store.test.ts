import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  appendTraceEntry,
  readTraceEntries,
  clearTraceFile,
  flushTraceQueue,
  type TraceEntry,
} from "../storage/trace.store";

describe("trace.store", () => {
  let tmpDir: string;
  const threadId = "test-thread-1";

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-trace-test-"));
  });

  afterEach(async () => {
    await flushTraceQueue();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no trace file exists", () => {
    expect(readTraceEntries(threadId, tmpDir)).toEqual([]);
  });

  it("appends and reads trace entries", async () => {
    const entry: TraceEntry = {
      timestamp: Date.now(),
      messageType: "assistant",
      data: { text: "hello" },
    };
    appendTraceEntry(threadId, entry, tmpDir);
    appendTraceEntry(threadId, { ...entry, messageType: "user" }, tmpDir);

    await flushTraceQueue();
    const entries = readTraceEntries(threadId, tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].messageType).toBe("assistant");
    expect(entries[1].messageType).toBe("user");
  });

  it("clears the trace file", async () => {
    appendTraceEntry(
      threadId,
      { timestamp: 1, messageType: "test", data: {} },
      tmpDir,
    );
    await flushTraceQueue();
    expect(readTraceEntries(threadId, tmpDir)).toHaveLength(1);

    clearTraceFile(threadId, tmpDir);
    expect(readTraceEntries(threadId, tmpDir)).toEqual([]);
  });

  it("clearTraceFile is a no-op when file does not exist", () => {
    expect(() => clearTraceFile("nonexistent", tmpDir)).not.toThrow();
  });

  it("preserves optional TraceEntry fields on round-trip", async () => {
    const entry: TraceEntry = {
      timestamp: 12345,
      sessionId: "sess-001",
      messageUuid: "uuid-abc",
      parentToolUseId: "tool-xyz",
      messageType: "tool_result",
      data: { output: 42 },
    };
    appendTraceEntry(threadId, entry, tmpDir);
    await flushTraceQueue();

    const entries = readTraceEntries(threadId, tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe("sess-001");
    expect(entries[0].messageUuid).toBe("uuid-abc");
    expect(entries[0].parentToolUseId).toBe("tool-xyz");
    expect(entries[0].data).toEqual({ output: 42 });
  });

  it("parentToolUseId can be null", async () => {
    const entry: TraceEntry = {
      timestamp: 1,
      messageType: "tool_use",
      parentToolUseId: null,
      data: {},
    };
    appendTraceEntry(threadId, entry, tmpDir);
    await flushTraceQueue();
    const entries = readTraceEntries(threadId, tmpDir);
    expect(entries[0].parentToolUseId).toBeNull();
  });

  it("returns empty array when trace file contains only whitespace", () => {
    const tracePath = join(tmpDir, "threads", "traces", `${threadId}.jsonl`);
    mkdirSync(join(tmpDir, "threads", "traces"), { recursive: true });
    writeFileSync(tracePath, "   \n  \n", "utf-8");
    expect(readTraceEntries(threadId, tmpDir)).toEqual([]);
  });

  it("clearTraceFile drops pending writes before they hit disk", async () => {
    appendTraceEntry(
      threadId,
      { timestamp: 1, messageType: "test", data: {} },
      tmpDir,
    );
    // Note: NOT awaiting flushTraceQueue — we want to ensure clearTraceFile
    // drops the in-memory queue before any flush runs.
    clearTraceFile(threadId, tmpDir);
    await flushTraceQueue();
    expect(readTraceEntries(threadId, tmpDir)).toEqual([]);
    const tracePath = join(tmpDir, "threads", "traces", `${threadId}.jsonl`);
    expect(existsSync(tracePath)).toBe(false);
  });

  it("rotates the trace file once it exceeds the size cap", async () => {
    // 5 MB cap; write a large line in a single batch flush so we cross the
    // threshold deterministically.
    const big = "x".repeat(64 * 1024); // 64 KB body per entry
    for (let i = 0; i < 100; i++) {
      appendTraceEntry(
        threadId,
        { timestamp: i, messageType: "fill", data: { body: big } },
        tmpDir,
      );
    }
    await flushTraceQueue();
    const tracePath = join(tmpDir, "threads", "traces", `${threadId}.jsonl`);
    const backupPath = tracePath + ".1";
    expect(existsSync(backupPath)).toBe(true);
    // Current file should exist (post-rotation it may be empty until the
    // next append, which is fine).
    const currentSize = existsSync(tracePath) ? statSync(tracePath).size : 0;
    expect(currentSize).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(statSync(backupPath).size).toBeGreaterThan(0);
  });

  it("clearTraceFile also removes the rotated backup", async () => {
    const big = "x".repeat(64 * 1024);
    for (let i = 0; i < 100; i++) {
      appendTraceEntry(
        threadId,
        { timestamp: i, messageType: "fill", data: { body: big } },
        tmpDir,
      );
    }
    await flushTraceQueue();
    const tracePath = join(tmpDir, "threads", "traces", `${threadId}.jsonl`);
    expect(existsSync(tracePath + ".1")).toBe(true);
    clearTraceFile(threadId, tmpDir);
    expect(existsSync(tracePath)).toBe(false);
    expect(existsSync(tracePath + ".1")).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  CopilotProvider,
  extractCopilotPatchChanges,
  extractTaskCompleteSummary,
  imagesToAttachments,
  isTaskCompleteTool,
  makeBridgeContext,
  mapEvent,
  normalizeCopilotToolInput,
  normalizeCopilotToolName,
} from "../providers/copilot.provider";
import type { AgentMessage } from "../providers/types";

describe("CopilotProvider", () => {
  it("instantiates with correct name", () => {
    const p = new CopilotProvider();
    expect(p.name).toBe("copilot");
  });

  it("canResume returns true for any non-empty id (optimistic check)", () => {
    const p = new CopilotProvider();
    expect(p.canResume("any-id")).toBe(true);
    expect(p.canResume("")).toBe(false);
  });

  it("dispose is idempotent on an unstarted provider", async () => {
    const p = new CopilotProvider();
    await expect(p.dispose()).resolves.toBeUndefined();
    await expect(p.dispose()).resolves.toBeUndefined();
  });

  it("interrupt is a no-op when no session has been created", async () => {
    const p = new CopilotProvider();
    await expect(p.interrupt()).resolves.toBeUndefined();
  });

  it("shares a single CopilotClient across providers with different cwds (does not stop the shared client on cwd change)", async () => {
    // Regression: previously, when a second thread with a different cwd
    // called getClient(), the provider would call sharedClient.stop() —
    // which closes ALL active sessions on that client, killing any
    // in-flight streams on other threads. The client hosts multiple
    // concurrent sessions with per-session workingDirectory; its
    // constructor cwd is only the spawned runtime's cwd.
    const stopSpy = vi.fn(async () => []);
    const startSpy = vi.fn(async () => {});
    const listModelsSpy = vi.fn(async () => [] as any[]);
    let ctorCalls = 0;

    class FakeCopilotClient {
      constructor(_opts: unknown) {
        ctorCalls += 1;
      }
      start = startSpy;
      stop = stopSpy;
      listModels = listModelsSpy;
    }

    // Inject the mock SDK via the module-level require cache.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cache = require.cache;
    const sdkKey = Object.keys(cache).find((k) =>
      k.includes("@github/copilot-sdk"),
    );
    // If the SDK isn't loaded yet, prime it and re-look.
    let restore: (() => void) | undefined;
    try {
      if (!sdkKey) {
        // Force-load once so a cache entry exists.
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("@github/copilot-sdk");
        } catch {
          /* ok if not installed in this env */
        }
      }
      const key = Object.keys(cache).find((k) =>
        k.includes("@github/copilot-sdk"),
      );
      if (key && cache[key]) {
        const original = cache[key]!.exports;
        cache[key]!.exports = {
          ...original,
          CopilotClient: FakeCopilotClient,
          RuntimeConnection: {
            forStdio: () => ({}),
          },
        };
        restore = () => {
          if (cache[key]) cache[key]!.exports = original;
        };
      } else {
        // SDK not installed — nothing to test against here.
        return;
      }

      // Reset the static shared client between test runs.
      (CopilotProvider as any).sharedClient = undefined;
      (CopilotProvider as any).sharedClientCwd = undefined;

      const providerA = new CopilotProvider();
      await providerA.initialize({ cwd: "/tmp/project-a" });
      const providerB = new CopilotProvider();
      await providerB.initialize({ cwd: "/tmp/project-b" });

      // getAvailableModels() drives getClient() through the public API.
      await providerA.getAvailableModels();
      await providerB.getAvailableModels();

      expect(ctorCalls).toBe(1);
      expect(stopSpy).not.toHaveBeenCalled();
    } finally {
      restore?.();
      (CopilotProvider as any).sharedClient = undefined;
      (CopilotProvider as any).sharedClientCwd = undefined;
    }
  });
});

describe("normalizeCopilotToolName", () => {
  const cases: Array<[string, string]> = [
    // Filesystem
    ["read", "Read"],
    ["view", "Read"],
    ["open_file", "Read"],
    ["write", "Write"],
    ["create", "Write"],
    ["create_file", "Write"],
    ["edit", "Edit"],
    ["str_replace", "Edit"],
    ["str_replace_editor", "Edit"],
    ["multi_edit", "Edit"],
    // Search
    ["glob", "Glob"],
    ["find", "Glob"],
    ["grep", "Grep"],
    ["ripgrep", "Grep"],
    // Shell
    ["shell", "Bash"],
    ["bash", "Bash"],
    ["exec", "Bash"],
    ["run_command", "Bash"],
    ["terminal", "Bash"],
    // Web
    ["fetch", "WebFetch"],
    ["fetch_url", "WebFetch"],
    ["web_fetch", "WebFetch"],
    ["web_search", "WebSearch"],
    ["search_web", "WebSearch"],
    // TODOs
    ["todo", "TodoWrite"],
    ["update_plan", "TodoWrite"],
    ["plan", "TodoWrite"],
    // Notebook
    ["notebook_edit", "NotebookEdit"],
    // Ask
    ["ask_user", "AskUserQuestion"],
  ];

  for (const [input, expected] of cases) {
    it(`normalizes "${input}" → "${expected}"`, () => {
      expect(normalizeCopilotToolName(input)).toBe(expected);
    });
  }

  it("preserves unknown tool names verbatim", () => {
    expect(normalizeCopilotToolName("report_intent")).toBe("report_intent");
    expect(normalizeCopilotToolName("mcp__stratos__schedule_list")).toBe(
      "mcp__stratos__schedule_list",
    );
  });

  it("is case-insensitive and dash-insensitive for known names", () => {
    expect(normalizeCopilotToolName("READ")).toBe("Read");
    expect(normalizeCopilotToolName("Web-Fetch")).toBe("WebFetch");
    expect(normalizeCopilotToolName("str-replace")).toBe("Edit");
  });
});

describe("normalizeCopilotToolInput", () => {
  it("maps Copilot edit arguments to the canonical diff fields", () => {
    expect(
      normalizeCopilotToolInput("Edit", {
        path: "/app/example.ts",
        old_str: "const before = true;",
        new_str: "const after = true;",
      }),
    ).toEqual({
      path: "/app/example.ts",
      old_str: "const before = true;",
      new_str: "const after = true;",
      old_string: "const before = true;",
      new_string: "const after = true;",
    });
  });

  it("maps Copilot create content to the canonical Write field", () => {
    expect(
      normalizeCopilotToolInput("Write", {
        path: "/app/new.ts",
        file_text: "export const created = true;",
      }),
    ).toEqual({
      path: "/app/new.ts",
      file_text: "export const created = true;",
      content: "export const created = true;",
    });
  });

  it("does not overwrite canonical fields", () => {
    expect(
      normalizeCopilotToolInput("Edit", {
        old_str: "copilot old",
        new_str: "copilot new",
        old_string: "canonical old",
        new_string: "canonical new",
      }),
    ).toMatchObject({
      old_string: "canonical old",
      new_string: "canonical new",
    });
  });
});

describe("extractCopilotPatchChanges", () => {
  it("extracts update content for the diff viewer", () => {
    expect(
      extractCopilotPatchChanges(`*** Begin Patch
*** Update File: src/example.ts
@@
-const before = true;
+const after = true;
*** End Patch`),
    ).toEqual([
      {
        toolName: "Edit",
        input: {
          file_path: "src/example.ts",
          old_string: "const before = true;",
          new_string: "const after = true;",
        },
      },
    ]);
  });

  it("extracts every file operation from a multi-file patch", () => {
    expect(
      extractCopilotPatchChanges(`*** Begin Patch
*** Add File: src/new.ts
+export const created = true;
*** Update File: src/old.ts
@@
-old
+new
*** Delete File: src/deleted.ts
*** End Patch`),
    ).toEqual([
      {
        toolName: "Write",
        input: {
          file_path: "src/new.ts",
          content: "export const created = true;",
        },
      },
      {
        toolName: "Edit",
        input: {
          file_path: "src/old.ts",
          old_string: "old",
          new_string: "new",
        },
      },
      {
        toolName: "Delete",
        input: { file_path: "src/deleted.ts" },
      },
    ]);
  });
});

describe("imagesToAttachments", () => {
  it("returns undefined for empty or missing inputs", () => {
    expect(imagesToAttachments(undefined)).toBeUndefined();
    expect(imagesToAttachments([])).toBeUndefined();
  });

  it("strips the data-url prefix and preserves the base64 payload", () => {
    const data = "iVBORw0KGgo=";
    const out = imagesToAttachments([
      { dataUrl: `data:image/png;base64,${data}`, mimeType: "image/png" },
    ]);
    expect(out).toEqual([{ type: "blob", mimeType: "image/png", data }]);
  });

  it("passes large images through without dropping them", () => {
    // Simulate a JPEG larger than the old 1 MB cap that used to silently drop
    // attachments. Users regularly attach phone photos in that size range.
    const bigData = "A".repeat(3_000_000);
    const out = imagesToAttachments([
      {
        dataUrl: `data:image/jpeg;base64,${bigData}`,
        mimeType: "image/jpeg",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({
      type: "blob",
      mimeType: "image/jpeg",
      data: bigData,
    });
  });

  it("preserves the order of multiple attachments", () => {
    const out = imagesToAttachments([
      { dataUrl: "data:image/png;base64,AAA", mimeType: "image/png" },
      { dataUrl: "data:image/jpeg;base64,BBB", mimeType: "image/jpeg" },
    ]);
    expect(out).toEqual([
      { type: "blob", mimeType: "image/png", data: "AAA" },
      { type: "blob", mimeType: "image/jpeg", data: "BBB" },
    ]);
  });
});

// Helper: turn a sequence of Copilot SessionEvents into the AgentMessage
// stream that the renderer would consume, and pull out just the `text` /
// `thinking` entries — the ones the concatenating renderer would splice
// together into the visible assistant bubble.
function runBridge(
  events: Array<{ type: string; data?: Record<string, unknown> }>,
): AgentMessage[] {
  const ctx = makeBridgeContext();
  const out: AgentMessage[] = [];
  for (const ev of events) {
    for (const m of mapEvent(ev as never, ctx)) out.push(m);
  }
  return out;
}

describe("copilot mapEvent — file changes", () => {
  it("emits canonical edit content for the changes sidebar", () => {
    const [message] = runBridge([
      {
        type: "tool.execution_start",
        data: {
          toolCallId: "edit_1",
          toolName: "edit",
          arguments: {
            path: "/app/example.ts",
            old_str: "const before = true;",
            new_str: "const after = true;",
          },
        },
      },
    ]);

    expect(message).toMatchObject({
      type: "tool_use",
      toolName: "Edit",
      input: {
        path: "/app/example.ts",
        old_string: "const before = true;",
        new_string: "const after = true;",
      },
    });
  });

  it("emits Copilot create calls as canonical Write changes", () => {
    const [message] = runBridge([
      {
        type: "tool.execution_start",
        data: {
          toolCallId: "create_1",
          toolName: "create",
          arguments: {
            path: "/app/new.ts",
            file_text: "export const created = true;",
          },
        },
      },
    ]);

    expect(message).toMatchObject({
      type: "tool_use",
      toolName: "Write",
      input: {
        path: "/app/new.ts",
        content: "export const created = true;",
      },
    });
  });

  it("emits freeform apply_patch calls as resolvable file changes", () => {
    const messages = runBridge([
      {
        type: "tool.execution_start",
        data: {
          toolCallId: "patch_1",
          toolName: "apply_patch",
          arguments: `*** Begin Patch
*** Update File: src/one.ts
@@
-before
+after
*** Add File: src/two.ts
+created
*** End Patch`,
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "patch_1",
          success: true,
          result: { detailedContent: "diff output" },
        },
      },
    ]);

    expect(messages.filter((message) => message.type === "tool_use")).toEqual([
      expect.objectContaining({
        toolName: "Edit",
        toolCallId: "patch_1",
        input: {
          file_path: "src/one.ts",
          old_string: "before",
          new_string: "after",
        },
      }),
      expect.objectContaining({
        toolName: "Write",
        toolCallId: "patch_1:1",
        input: { file_path: "src/two.ts", content: "created" },
      }),
    ]);
    expect(
      messages
        .filter((message) => message.type === "tool_result")
        .map((message) => message.toolCallId),
    ).toEqual(["patch_1", "patch_1:1"]);
  });
});

describe("copilot mapEvent — streaming vs terminal message", () => {
  it("does not re-emit text from assistant.message when deltas already streamed it (regression: duplicated responses)", () => {
    const messages = runBridge([
      { type: "assistant.message_start" },
      { type: "assistant.message_delta", data: { deltaContent: "Hello" } },
      { type: "assistant.message_delta", data: { deltaContent: "! 👋" } },
      { type: "assistant.message", data: { content: "Hello! 👋" } },
      { type: "session.idle" },
    ]);
    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    // Streaming delivered "Hello" + "! 👋"; the terminal event must NOT
    // re-yield "Hello! 👋" or the renderer would concatenate a second copy.
    expect(textPieces).toEqual(["Hello", "! 👋"]);
    // The `result` synthesis on session.idle should still carry the full text.
    const result = messages.find((m) => m.type === "result") as
      | { content: string }
      | undefined;
    expect(result?.content).toBe("Hello! 👋");
  });

  it("does emit text from assistant.message when no deltas streamed (non-streaming providers)", () => {
    const messages = runBridge([
      { type: "assistant.message_start" },
      { type: "assistant.message", data: { content: "Just say hello" } },
      { type: "session.idle" },
    ]);
    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    expect(textPieces).toEqual(["Just say hello"]);
  });

  it("does not re-emit reasoning from assistant.reasoning when deltas already streamed it", () => {
    const messages = runBridge([
      { type: "assistant.message_start" },
      { type: "assistant.reasoning_delta", data: { deltaContent: "Think" } },
      { type: "assistant.reasoning_delta", data: { deltaContent: "ing…" } },
      { type: "assistant.reasoning", data: { content: "Thinking…" } },
    ]);
    const thinkingPieces = messages
      .filter((m) => m.type === "thinking")
      .map((m) => (m as { content: string }).content);
    expect(thinkingPieces).toEqual(["Think", "ing…"]);
  });

  it("resets streaming guards between messages so a fresh non-streamed reply is emitted", () => {
    const messages = runBridge([
      { type: "assistant.message_start" },
      { type: "assistant.message_delta", data: { deltaContent: "First" } },
      { type: "assistant.message", data: { content: "First" } },
      { type: "assistant.message_start" },
      { type: "assistant.message", data: { content: "Second" } },
    ]);
    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    // First message streamed → terminal suppressed. Second message did not
    // stream → terminal must be emitted.
    expect(textPieces).toEqual(["First", "Second"]);
  });
});

describe("copilot mapEvent — task_complete", () => {
  const startEv = (
    summary: unknown,
    toolCallId = "call_1",
    extra: Record<string, unknown> = {},
  ) => ({
    type: "tool.execution_start",
    data: {
      toolCallId,
      toolName: "task_complete",
      arguments: summary === undefined ? {} : { summary },
    },
    ...extra,
  });

  it("renders the summary as assistant text instead of a tool card", () => {
    const messages = runBridge([
      startEv("All done — I fixed the bug."),
      {
        type: "session.task_complete",
        data: { summary: "All done — I fixed the bug.", success: true },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call_1",
          success: true,
          result: { content: "✓ Task completed: All done — I fixed the bug." },
        },
      },
      { type: "session.idle" },
    ]);

    expect(messages.filter((m) => m.type === "tool_use")).toHaveLength(0);
    expect(messages.filter((m) => m.type === "tool_result")).toHaveLength(0);

    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    expect(textPieces).toEqual(["All done — I fixed the bug."]);

    // The synthesized `result` must carry the summary as the turn's reply.
    const result = messages.find((m) => m.type === "result") as
      | { content: string }
      | undefined;
    expect(result?.content).toBe("All done — I fixed the bug.");
  });

  it("does not duplicate the summary when session.task_complete repeats it", () => {
    const messages = runBridge([
      startEv("Summary text"),
      { type: "session.task_complete", data: { summary: "Summary text" } },
    ]);
    expect(messages.filter((m) => m.type === "text")).toHaveLength(1);
  });

  it("falls back to session.task_complete when no tool call was observed", () => {
    const messages = runBridge([
      { type: "session.task_complete", data: { summary: "Only on the event" } },
    ]);
    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    expect(textPieces).toEqual(["Only on the event"]);
  });

  it("emits a fresh summary on each turn (per-turn flag resets on idle)", () => {
    const messages = runBridge([
      startEv("First turn", "call_1"),
      { type: "session.idle" },
      { type: "session.task_complete", data: { summary: "Second turn" } },
    ]);
    const textPieces = messages
      .filter((m) => m.type === "text")
      .map((m) => (m as { content: string }).content);
    expect(textPieces).toEqual(["First turn", "Second turn"]);
  });

  it("keeps the tool card when the call carries no usable summary", () => {
    const messages = runBridge([
      startEv(undefined),
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call_1",
          success: false,
          error: { message: "summary is required" },
        },
      },
    ]);
    expect(messages.filter((m) => m.type === "text")).toHaveLength(0);
    const toolUse = messages.find((m) => m.type === "tool_use") as
      | { toolName: string }
      | undefined;
    expect(toolUse?.toolName).toBe("task_complete");
    expect(messages.filter((m) => m.type === "tool_result")).toHaveLength(1);
  });

  it("keeps the tool card for sub-agent task_complete calls", () => {
    const messages = runBridge([
      startEv("Sub-agent done", "call_sub", { agentId: "agent-7" }),
    ]);
    expect(messages.filter((m) => m.type === "text")).toHaveLength(0);
    expect(messages.filter((m) => m.type === "tool_use")).toHaveLength(1);
  });

  it("surfaces an error when a rendered task_complete call ends up failing", () => {
    const messages = runBridge([
      startEv("Rendered summary"),
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call_1",
          success: false,
          error: { message: "rejected by policy" },
        },
      },
    ]);
    const err = messages.find((m) => m.type === "error") as
      | { message: string }
      | undefined;
    expect(err?.message).toBe("rejected by policy");
    expect(messages.filter((m) => m.type === "tool_result")).toHaveLength(0);
  });

  it("ignores a failed session.task_complete event", () => {
    const messages = runBridge([
      {
        type: "session.task_complete",
        data: { summary: "not accepted", success: false },
      },
    ]);
    expect(messages.filter((m) => m.type === "text")).toHaveLength(0);
  });
});

describe("isTaskCompleteTool / extractTaskCompleteSummary", () => {
  it("matches the task_complete tool across naming variants", () => {
    expect(isTaskCompleteTool("task_complete")).toBe(true);
    expect(isTaskCompleteTool("Task-Complete")).toBe(true);
    expect(isTaskCompleteTool("task complete")).toBe(true);
    expect(isTaskCompleteTool("task_completed")).toBe(false);
    expect(isTaskCompleteTool(undefined)).toBe(false);
  });

  it("extracts the first non-empty string field", () => {
    expect(extractTaskCompleteSummary({ summary: " done " })).toBe("done");
    expect(extractTaskCompleteSummary({ summary: "  ", message: "m" })).toBe(
      "m",
    );
    expect(extractTaskCompleteSummary({})).toBe("");
    expect(extractTaskCompleteSummary(null)).toBe("");
  });
});

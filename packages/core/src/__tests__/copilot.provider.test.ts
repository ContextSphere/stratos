import { describe, it, expect } from "vitest";
import {
  CopilotProvider,
  normalizeCopilotToolName,
} from "../providers/copilot.provider";

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
});

describe("normalizeCopilotToolName", () => {
  const cases: Array<[string, string]> = [
    // Filesystem
    ["read", "Read"],
    ["view", "Read"],
    ["open_file", "Read"],
    ["write", "Write"],
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

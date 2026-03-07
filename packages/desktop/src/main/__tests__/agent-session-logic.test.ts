import { describe, it, expect } from "vitest";
import {
  resolveToolBehavior,
  isReadOnlyTool,
  isFileEditTool,
  ACCEPT_EDITS_AUTO_APPROVE,
} from "../agent-session-logic";

describe("resolveToolBehavior", () => {
  describe("special tools (mode-independent)", () => {
    it("always approves EnterPlanMode", () => {
      for (const mode of [
        "plan",
        "default",
        "acceptEdits",
        "bypassPermissions",
      ] as const) {
        expect(resolveToolBehavior(mode, "EnterPlanMode")).toBe(
          "always_approve",
        );
      }
    });

    it("always triggers plan_review for ExitPlanMode", () => {
      for (const mode of [
        "plan",
        "default",
        "acceptEdits",
        "bypassPermissions",
      ] as const) {
        expect(resolveToolBehavior(mode, "ExitPlanMode")).toBe("plan_review");
      }
    });

    it("always triggers ask_user for AskUserQuestion", () => {
      for (const mode of [
        "plan",
        "default",
        "acceptEdits",
        "bypassPermissions",
      ] as const) {
        expect(resolveToolBehavior(mode, "AskUserQuestion")).toBe("ask_user");
      }
    });
  });

  describe("bypassPermissions mode", () => {
    it("approves all regular tools", () => {
      expect(resolveToolBehavior("bypassPermissions", "Bash")).toBe(
        "always_approve",
      );
      expect(resolveToolBehavior("bypassPermissions", "Write")).toBe(
        "always_approve",
      );
      expect(
        resolveToolBehavior("bypassPermissions", "mcp__chrome-devtools__click"),
      ).toBe("always_approve");
      expect(
        resolveToolBehavior("bypassPermissions", "some-unknown-tool"),
      ).toBe("always_approve");
    });
  });

  describe("acceptEdits mode", () => {
    it("auto-approves all tools in ACCEPT_EDITS_AUTO_APPROVE set", () => {
      for (const tool of ACCEPT_EDITS_AUTO_APPROVE) {
        expect(resolveToolBehavior("acceptEdits", tool)).toBe("always_approve");
      }
    });

    it("auto-approves MCP tools", () => {
      expect(resolveToolBehavior("acceptEdits", "mcp__github__list_prs")).toBe(
        "always_approve",
      );
      expect(
        resolveToolBehavior("acceptEdits", "mcp__chrome-devtools__click"),
      ).toBe("always_approve");
    });

    it("prompts for unknown tools", () => {
      expect(resolveToolBehavior("acceptEdits", "SomeUnknownTool")).toBe(false);
    });
  });

  describe("default mode", () => {
    it("prompts for all regular tools", () => {
      expect(resolveToolBehavior("default", "Bash")).toBe(false);
      expect(resolveToolBehavior("default", "Read")).toBe(false);
      expect(resolveToolBehavior("default", "Write")).toBe(false);
      expect(resolveToolBehavior("default", "mcp__github__list_prs")).toBe(
        false,
      );
    });
  });

  describe("plan mode", () => {
    it("prompts for all regular tools (SDK handles read-only enforcement)", () => {
      expect(resolveToolBehavior("plan", "Read")).toBe(false);
      expect(resolveToolBehavior("plan", "Bash")).toBe(false);
    });
  });
});

describe("isReadOnlyTool", () => {
  it("returns true for read-only tools", () => {
    expect(isReadOnlyTool("Read")).toBe(true);
    expect(isReadOnlyTool("Glob")).toBe(true);
    expect(isReadOnlyTool("Grep")).toBe(true);
    expect(isReadOnlyTool("WebSearch")).toBe(true);
    expect(isReadOnlyTool("WebFetch")).toBe(true);
  });

  it("returns false for write tools", () => {
    expect(isReadOnlyTool("Write")).toBe(false);
    expect(isReadOnlyTool("Bash")).toBe(false);
  });
});

describe("isFileEditTool", () => {
  it("returns true for file editing tools", () => {
    expect(isFileEditTool("Write")).toBe(true);
    expect(isFileEditTool("Edit")).toBe(true);
    expect(isFileEditTool("NotebookEdit")).toBe(true);
  });

  it("returns false for non-editing tools", () => {
    expect(isFileEditTool("Read")).toBe(false);
    expect(isFileEditTool("Bash")).toBe(false);
    expect(isFileEditTool("mcp__github__list_prs")).toBe(false);
  });
});

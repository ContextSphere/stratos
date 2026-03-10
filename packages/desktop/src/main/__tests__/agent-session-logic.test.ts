import { describe, it, expect } from "vitest";
import {
  resolveToolBehavior,
  effectiveToolName,
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
        "fullAccess",
      ] as const) {
        expect(resolveToolBehavior(mode, "EnterPlanMode")).toBe(
          "always_approve",
        );
      }
    });

    it("triggers plan_review for ExitPlanMode only in plan mode", () => {
      expect(resolveToolBehavior("plan", "ExitPlanMode")).toBe("plan_review");
      expect(resolveToolBehavior("default", "ExitPlanMode")).toBe(
        "always_approve",
      );
      expect(resolveToolBehavior("acceptEdits", "ExitPlanMode")).toBe(
        "always_approve",
      );
      expect(resolveToolBehavior("bypassPermissions", "ExitPlanMode")).toBe(
        "always_approve",
      );
      expect(resolveToolBehavior("fullAccess", "ExitPlanMode", "codex")).toBe(
        "always_approve",
      );
    });

    it("always triggers ask_user for AskUserQuestion", () => {
      for (const mode of [
        "plan",
        "default",
        "acceptEdits",
        "bypassPermissions",
        "fullAccess",
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

  describe("Codex fullAccess mode", () => {
    it("auto-approves all regular tools", () => {
      expect(resolveToolBehavior("fullAccess", "Bash", "codex")).toBe(
        "always_approve",
      );
      expect(resolveToolBehavior("fullAccess", "Write", "codex")).toBe(
        "always_approve",
      );
      expect(
        resolveToolBehavior(
          "fullAccess",
          "mcp__chrome-devtools__click",
          "codex",
        ),
      ).toBe("always_approve");
    });

    it("does not treat Codex default like acceptEdits", () => {
      expect(resolveToolBehavior("default", "Bash", "codex")).toBe(false);
      expect(
        resolveToolBehavior("default", "mcp__github__list_prs", "codex"),
      ).toBe(false);
    });
  });
});

describe("effectiveToolName", () => {
  it("unwraps Skill-wrapped interactive tools", () => {
    expect(effectiveToolName("Skill", { skill: "ExitPlanMode" })).toBe(
      "ExitPlanMode",
    );
    expect(effectiveToolName("Skill", { skill: "EnterPlanMode" })).toBe(
      "EnterPlanMode",
    );
    expect(effectiveToolName("Skill", { skill: "AskUserQuestion" })).toBe(
      "AskUserQuestion",
    );
  });

  it("does not unwrap non-interactive Skill calls", () => {
    expect(effectiveToolName("Skill", { skill: "SomeOtherSkill" })).toBe(
      "Skill",
    );
  });

  it("passes through non-Skill tool names", () => {
    expect(effectiveToolName("ExitPlanMode", {})).toBe("ExitPlanMode");
    expect(effectiveToolName("Bash", {})).toBe("Bash");
  });

  it("handles name field as fallback", () => {
    expect(effectiveToolName("Skill", { name: "ExitPlanMode" })).toBe(
      "ExitPlanMode",
    );
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

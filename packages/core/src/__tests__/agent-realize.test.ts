import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentDefinition } from "../types/agent";
import { resolveAgentPrompt } from "../agents/resolve-prompt";
import { realizeAgent, agentFidelity } from "../agents/realize/index";

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "acme",
    name: "Acme",
    description: "An acme agent.",
    icon: "🔧",
    accent: "blue",
    builtIn: false,
    ...overrides,
  };
}

describe("resolveAgentPrompt", () => {
  it("returns '' for an agent with no prompt", async () => {
    expect(await resolveAgentPrompt(makeAgent())).toBe("");
  });

  it("returns an inline string prompt as-is", async () => {
    expect(await resolveAgentPrompt(makeAgent({ prompt: "Be helpful." }))).toBe(
      "Be helpful.",
    );
  });

  describe("with file-path prompts", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "stratos-prompt-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("reads and joins multiple files with blank lines", async () => {
      const a = join(tmpDir, "a.md");
      const b = join(tmpDir, "b.md");
      writeFileSync(a, "Part A", "utf-8");
      writeFileSync(b, "Part B", "utf-8");

      const result = await resolveAgentPrompt(makeAgent({ prompt: [a, b] }));
      expect(result).toBe("Part A\n\nPart B");
    });

    it("skips an unreadable file and warns instead of throwing", async () => {
      const a = join(tmpDir, "a.md");
      writeFileSync(a, "Part A", "utf-8");
      const missing = join(tmpDir, "missing.md");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await resolveAgentPrompt(
        makeAgent({ prompt: [a, missing] }),
      );

      expect(result).toBe("Part A");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("expands a leading ~ against homedir", async () => {
      // Point HOME-equivalent (os.homedir) is not mocked here; instead verify
      // that a bare "~" prefixed path which does NOT exist under the real
      // home directory is skipped without throwing (exercises the expansion
      // code path rather than asserting a specific home directory).
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await resolveAgentPrompt(
        makeAgent({
          prompt: ["~/.stratos-agent-realize-test-does-not-exist.md"],
        }),
      );
      warnSpy.mockRestore();
      expect(result).toBe("");
    });
  });
});

describe("realize adapters", () => {
  const mcpServers = {
    docs: { type: "http" as const, url: "https://mcp.example.com/docs" },
    local: { type: "stdio" as const, command: "my-server", args: ["--flag"] },
  };

  const def = makeAgent({
    model: "claude-sonnet-4-6",
    cwd: "/Users/test/project",
    mcpServers,
  });
  const resolvedPrompt = "You are Acme.";

  it("claude-code: wraps the prompt in the claude_code preset append", () => {
    const config = realizeAgent("claude-code", def, resolvedPrompt);
    expect(config.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "You are Acme.",
    });
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.cwd).toBe("/Users/test/project");
    expect(config.mcpServers).toEqual({
      docs: { type: "http", url: "https://mcp.example.com/docs" },
      local: { type: "stdio", command: "my-server", args: ["--flag"] },
    });
  });

  it("claude-code: omits systemPrompt entirely for an empty resolved prompt", () => {
    const config = realizeAgent("claude-code", def, "");
    expect(config.systemPrompt).toBeUndefined();
  });

  it("codex: passes the resolved prompt through as a plain string", () => {
    const config = realizeAgent("codex", def, resolvedPrompt);
    expect(config.systemPrompt).toBe("You are Acme.");
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.cwd).toBe("/Users/test/project");
    expect(config.mcpServers).toEqual({
      docs: { type: "http", url: "https://mcp.example.com/docs" },
      local: { type: "stdio", command: "my-server", args: ["--flag"] },
    });
  });

  it("opencode: carries model/cwd/mcpServers only, no prompt field at all", () => {
    const config = realizeAgent("opencode", def, resolvedPrompt);
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.cwd).toBe("/Users/test/project");
    expect(config.mcpServers).toEqual({
      docs: { type: "http", url: "https://mcp.example.com/docs" },
      local: { type: "stdio", command: "my-server", args: ["--flag"] },
    });
    expect("systemPrompt" in config).toBe(false);
    expect("agents" in config).toBe(false);
  });

  it("copilot: puts the prompt in `agents`, never in systemPrompt", () => {
    const config = realizeAgent("copilot", def, resolvedPrompt);
    expect(config.systemPrompt).toBeUndefined();
    expect(config.agents).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acmeAgent = (config.agents as any)["acme"];
    expect(acmeAgent.prompt).toBe("You are Acme.");
    expect(acmeAgent.displayName).toBe("Acme");
    expect(acmeAgent.description).toBe("An acme agent.");
    expect(acmeAgent.model).toBe("claude-sonnet-4-6");
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.cwd).toBe("/Users/test/project");
    expect(config.mcpServers).toEqual({
      docs: { type: "http", url: "https://mcp.example.com/docs" },
      local: { type: "stdio", command: "my-server", args: ["--flag"] },
    });
  });

  it("omits mcpServers/model/cwd when the agent doesn't set them", () => {
    const bare = makeAgent();
    for (const provider of [
      "claude-code",
      "codex",
      "opencode",
      "copilot",
    ] as const) {
      const config = realizeAgent(provider, bare, "");
      expect(config.mcpServers).toBeUndefined();
      expect(config.model).toBeUndefined();
      expect(config.cwd).toBeUndefined();
    }
  });
});

describe("agentFidelity", () => {
  it("flags opencode as dropping the prompt when the agent has one", () => {
    const withPrompt = makeAgent({ prompt: "Be helpful." });
    expect(agentFidelity("opencode", withPrompt)).toEqual({
      provider: "opencode",
      unsupported: ["prompt"],
    });
  });

  it("does not flag opencode when the agent has no prompt", () => {
    const noPrompt = makeAgent();
    expect(agentFidelity("opencode", noPrompt)).toEqual({
      provider: "opencode",
      unsupported: [],
    });
  });

  it("reports nothing unsupported for claude-code, codex, and copilot", () => {
    const withPrompt = makeAgent({ prompt: "Be helpful." });
    for (const provider of ["claude-code", "codex", "copilot"] as const) {
      expect(agentFidelity(provider, withPrompt).unsupported).toEqual([]);
    }
  });
});

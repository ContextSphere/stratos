import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AgentService } from "../agents/agent-service";

describe("AgentService", () => {
  let dir: string;
  let previousDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stratos-agent-service-"));
    previousDir = process.env.STRATOS_AGENTS_DIR;
    process.env.STRATOS_AGENTS_DIR = join(dir, "agents");
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.STRATOS_AGENTS_DIR;
    else process.env.STRATOS_AGENTS_DIR = previousDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a host-identified agent with advanced configuration", () => {
    const changed: string[] = [];
    const service = new AgentService({ onChanged: (id) => changed.push(id) });
    const created = service.create({
      name: "Release Reviewer",
      description: "Reviews every release candidate.",
      prompt: ["./prompts/reviewer.md"],
      provider: "codex",
      mode: "plan",
      mcpServers: {
        evidence: { type: "http", url: "https://example.test/mcp" },
      },
    });

    expect(created).toMatchObject({
      id: "release-reviewer",
      builtIn: false,
      prompt: ["./prompts/reviewer.md"],
    });
    expect(changed).toEqual(["release-reviewer"]);
    expect(service.get(created.id)?.mcpServers).toHaveProperty("evidence");
  });

  it("rejects duplicate names instead of overwriting", () => {
    const service = new AgentService();
    const input = {
      name: "Researcher",
      description: "Finds evidence.",
      prompt: "Use primary sources.",
    };
    const first = service.create(input);
    expect(() => service.create(input)).toThrow(/already exists.*reuse/i);
    expect(service.get(first.id)).toEqual(first);
  });
});

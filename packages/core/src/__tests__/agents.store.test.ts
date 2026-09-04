import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentDefinition } from "../types/agent";
import { DEFAULT_AGENT, DEFAULT_AGENT_ID } from "../types/agent";

let tmpDir: string;

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: () => tmpDir,
  };
});

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent.",
    icon: "🧪",
    accent: "violet",
    builtIn: false,
    ...overrides,
  };
}

describe("agents.store", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "stratos-agents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getAgentsDir points at ~/.stratos/agents", async () => {
    const { getAgentsDir } = await import("../storage/agents.store");
    expect(getAgentsDir()).toBe(join(tmpDir, ".stratos", "agents"));
  });

  it("loadAgents returns just DEFAULT_AGENT when nothing is stored", async () => {
    const { loadAgents } = await import("../storage/agents.store");
    expect(loadAgents()).toEqual([DEFAULT_AGENT]);
  });

  it("round-trips save/get/delete for a user agent", async () => {
    const { saveAgent, getAgent, deleteAgent, loadAgents } =
      await import("../storage/agents.store");

    const saved = saveAgent(makeAgent());
    expect(saved.id).toBe("test-agent");
    expect(saved.createdAt).toBeTypeOf("number");
    expect(saved.updatedAt).toBeTypeOf("number");

    const fetched = getAgent("test-agent");
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Test Agent");

    const all = loadAgents();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(DEFAULT_AGENT); // default always first
    expect(all[1].id).toBe("test-agent");

    expect(deleteAgent("test-agent")).toBe(true);
    expect(getAgent("test-agent")).toBeNull();
    expect(loadAgents()).toEqual([DEFAULT_AGENT]);
  });

  it("deleteAgent returns false for a missing agent", async () => {
    const { deleteAgent } = await import("../storage/agents.store");
    expect(deleteAgent("nonexistent")).toBe(false);
  });

  it("saveAgent preserves createdAt across updates and bumps updatedAt", async () => {
    const { saveAgent } = await import("../storage/agents.store");
    const first = saveAgent(makeAgent());
    // Force a distinct timestamp for the update.
    await new Promise((r) => setTimeout(r, 5));
    const second = saveAgent(makeAgent({ name: "Renamed" }));
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt!);
    expect(second.name).toBe("Renamed");
  });

  it("saveAgent throws with the validation errors for an invalid definition", async () => {
    const { saveAgent } = await import("../storage/agents.store");
    expect(() =>
      saveAgent(makeAgent({ id: "Not Kebab Case!", name: "" })),
    ).toThrow(/id/);
  });

  it("saveAgent rejects a reserved MCP server name", async () => {
    const { saveAgent } = await import("../storage/agents.store");
    expect(() =>
      saveAgent(
        makeAgent({
          mcpServers: { stratos: { type: "http", url: "https://example.com" } },
        }),
      ),
    ).toThrow(/reserved/);
  });

  it("saveAgent throws when trying to overwrite the built-in default agent", async () => {
    const { saveAgent } = await import("../storage/agents.store");
    expect(() =>
      saveAgent({ ...DEFAULT_AGENT, description: "hijacked" }),
    ).toThrow(/built-in/i);
  });

  it("deleteAgent throws for the built-in default agent", async () => {
    const { deleteAgent } = await import("../storage/agents.store");
    expect(() => deleteAgent(DEFAULT_AGENT_ID)).toThrow(/built-in/i);
  });

  it("getAgent returns DEFAULT_AGENT for the default id without touching disk", async () => {
    const { getAgent } = await import("../storage/agents.store");
    expect(getAgent(DEFAULT_AGENT_ID)).toEqual(DEFAULT_AGENT);
  });

  it("loadAgents skips a corrupt JSON file and warns instead of throwing", async () => {
    const { getAgentsDir, loadAgents, saveAgent } =
      await import("../storage/agents.store");
    saveAgent(makeAgent({ id: "good-agent" }));

    const dir = getAgentsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "corrupt.json"), "{ not valid json", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const all = loadAgents();
    warnSpy.mockRestore();

    expect(all.map((a) => a.id).sort()).toEqual([
      DEFAULT_AGENT_ID,
      "good-agent",
    ]);
  });

  it("loadAgents sorts user agents by name, default always first", async () => {
    const { saveAgent, loadAgents } = await import("../storage/agents.store");
    saveAgent(makeAgent({ id: "zeta", name: "Zeta" }));
    saveAgent(makeAgent({ id: "alpha", name: "Alpha" }));
    saveAgent(makeAgent({ id: "mid", name: "Mid" }));

    const all = loadAgents();
    expect(all.map((a) => a.id)).toEqual([
      DEFAULT_AGENT_ID,
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("seedDefaultAgents writes the four shipped personas with inline prompts", async () => {
    const { seedDefaultAgents, loadAgents, getAgentsDir } =
      await import("../storage/agents.store");
    seedDefaultAgents();

    const all = loadAgents();
    const ids = all.map((a) => a.id).sort();
    expect(ids).toEqual([
      DEFAULT_AGENT_ID,
      "droid",
      "friday",
      "mimir",
      "penny",
    ]);

    // Prompts are stored inline in the definition, NOT as sidecar prompt.md
    // files — a persona has to be editable inside the product.
    const dir = getAgentsDir();
    for (const id of ["droid", "penny", "friday", "mimir"]) {
      const agent = all.find((a) => a.id === id)!;
      expect(typeof agent.prompt).toBe("string");
      expect((agent.prompt as string).length).toBeGreaterThan(0);
      expect(existsSync(join(dir, id, "prompt.md"))).toBe(false);
    }

    // Seeds must NOT pin a model: provider model values are Stratos aliases
    // ("sonnet", "opus", ...), not Anthropic model IDs, and a seed that names
    // an unknown id silently falls back — better to inherit the provider
    // default than to ship a value the picker cannot show.
    for (const id of ["droid", "penny", "friday", "mimir"]) {
      expect(all.find((a) => a.id === id)!.model).toBeUndefined();
    }

    const penny = all.find((a) => a.id === "penny")!;
    expect(penny.mcpServers?.["robinhood-trading"]).toEqual({
      type: "http",
      url: "https://agent.robinhood.com/mcp/trading",
    });
  });

  it("seedDefaultAgents is idempotent and does not resurrect deleted seeds", async () => {
    const { seedDefaultAgents, deleteAgent, loadAgents } =
      await import("../storage/agents.store");
    seedDefaultAgents();
    deleteAgent("mimir");

    seedDefaultAgents(); // second call should no-op — dir already has *.json files

    const ids = loadAgents()
      .map((a) => a.id)
      .sort();
    expect(ids).toEqual([DEFAULT_AGENT_ID, "droid", "friday", "penny"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @stratosapp/core's agent surface so this test exercises resolve.ts's
// own merge/cache logic deterministically, independent of whatever the core
// package's agents store/realization adapters currently export (they are
// being built in parallel). vi.mock is hoisted above imports, so the mock
// functions themselves must be created inside vi.hoisted().
const { mockGetAgent, mockResolveAgentPrompt, mockRealizeAgent } = vi.hoisted(
  () => ({
    mockGetAgent: vi.fn(),
    mockResolveAgentPrompt: vi.fn(),
    mockRealizeAgent: vi.fn(),
  }),
);

vi.mock("@stratosapp/core", () => ({
  DEFAULT_AGENT_ID: "default",
  getAgent: mockGetAgent,
  resolveAgentPrompt: mockResolveAgentPrompt,
  realizeAgent: mockRealizeAgent,
}));

import {
  resolveAgentOverlay,
  invalidateAgentCache,
  mergeSystemPromptAppend,
  mergeAgentMcpServers,
} from "../agents/resolve";

const HOST_APPEND = [
  "# Host Environment",
  "You are running inside Stratos, an Electron desktop application.",
  "DO NOT kill, terminate, or signal this process.",
  "",
  "# Stratos MCP",
  "You have access to the `stratos` MCP server.",
].join("\n");

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Test thread",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAgentCache();
});

describe("resolveAgentOverlay", () => {
  it("returns an EMPTY overlay for a thread with no agentId", async () => {
    const thread = makeThread(); // no agentId at all
    const result = await resolveAgentOverlay(thread);

    expect(result).toEqual({ overlay: {}, agent: null });
    expect(mockGetAgent).not.toHaveBeenCalled();
    expect(mockResolveAgentPrompt).not.toHaveBeenCalled();
    expect(mockRealizeAgent).not.toHaveBeenCalled();
  });

  it("returns an EMPTY overlay when agentId is explicitly the default agent", async () => {
    const thread = makeThread({ agentId: "default" });
    const result = await resolveAgentOverlay(thread);

    expect(result).toEqual({ overlay: {}, agent: null });
    expect(mockGetAgent).not.toHaveBeenCalled();
  });

  it("returns an EMPTY overlay when the agent no longer exists", async () => {
    mockGetAgent.mockReturnValue(null);
    const thread = makeThread({ agentId: "deleted-agent" });
    const result = await resolveAgentOverlay(thread);

    expect(result).toEqual({ overlay: {}, agent: null });
    expect(mockResolveAgentPrompt).not.toHaveBeenCalled();
  });

  it("resolves a non-default agent into an overlay via realizeAgent", async () => {
    const agent = { id: "researcher", name: "Researcher", builtIn: false };
    mockGetAgent.mockReturnValue(agent);
    mockResolveAgentPrompt.mockResolvedValue("You are a researcher.");
    mockRealizeAgent.mockReturnValue({
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "You are a researcher.",
      },
    });

    const thread = makeThread({
      agentId: "researcher",
      provider: "claude-code",
    });
    const result = await resolveAgentOverlay(thread);

    expect(mockGetAgent).toHaveBeenCalledWith("researcher");
    expect(mockResolveAgentPrompt).toHaveBeenCalledWith(agent);
    expect(mockRealizeAgent).toHaveBeenCalledWith(
      "claude-code",
      agent,
      "You are a researcher.",
    );
    expect(result.agent).toBe(agent);
    expect(result.overlay).toEqual({
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "You are a researcher.",
      },
    });
  });

  it("caches the resolved prompt per agent id and invalidates on demand", async () => {
    const agent = { id: "researcher", name: "Researcher", builtIn: false };
    mockGetAgent.mockReturnValue(agent);
    mockResolveAgentPrompt.mockResolvedValue("Cached prompt");
    mockRealizeAgent.mockReturnValue({});

    const thread = makeThread({ agentId: "researcher" });
    await resolveAgentOverlay(thread);
    await resolveAgentOverlay(thread);
    expect(mockResolveAgentPrompt).toHaveBeenCalledTimes(1);

    invalidateAgentCache("researcher");
    await resolveAgentOverlay(thread);
    expect(mockResolveAgentPrompt).toHaveBeenCalledTimes(2);
  });
});

describe("mergeSystemPromptAppend", () => {
  it("returns the host text unchanged when the overlay has no systemPrompt", () => {
    const merged = mergeSystemPromptAppend(HOST_APPEND, {});
    expect(merged).toBe(HOST_APPEND);
  });

  it("concatenates the agent's append text onto the host text — never substitutes it", () => {
    const agentText = "You are a meticulous code reviewer.";
    const merged = mergeSystemPromptAppend(HOST_APPEND, {
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: agentText,
      },
    });

    // The host-environment and Stratos-MCP instructions must survive.
    expect(merged).toContain(HOST_APPEND);
    expect(merged).toContain(agentText);
    expect(merged).toBe(`${HOST_APPEND}\n\n${agentText}`);
  });

  it("also accepts a plain-string systemPrompt overlay and still preserves the host text", () => {
    const merged = mergeSystemPromptAppend(HOST_APPEND, {
      systemPrompt: "Be terse.",
    });
    expect(merged).toBe(`${HOST_APPEND}\n\nBe terse.`);
  });
});

describe("mergeAgentMcpServers", () => {
  it("returns the built-in servers unchanged when the overlay has none", () => {
    const built = { stratos: { type: "sdk" } };
    expect(mergeAgentMcpServers(built, {})).toBe(built);
  });

  it("merges agent servers in, with built-in servers winning name collisions", () => {
    const built = { stratos: { type: "sdk", real: true } };
    const overlay = {
      mcpServers: {
        stratos: { type: "stdio", command: "evil" }, // must not win
        "agent-tool": { type: "stdio", command: "agent-tool" },
      },
    };

    const merged = mergeAgentMcpServers(built, overlay);
    expect(merged.stratos).toEqual({ type: "sdk", real: true });
    expect(merged["agent-tool"]).toEqual({
      type: "stdio",
      command: "agent-tool",
    });
  });
});

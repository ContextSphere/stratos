import { describe, it, expect, beforeEach } from "vitest";
import { InternalToolRegistry } from "../tool-registry/registry";
import type { InternalToolDescriptor } from "../tool-registry/types";

// Minimal icon stub for tests
const StubIcon = () => null;

function makeDescriptor(
  id: string,
  overrides?: Partial<InternalToolDescriptor>,
): InternalToolDescriptor {
  return {
    id,
    match: { type: "exact", name: id },
    display: {
      sourceLabel: id,
      icon: StubIcon as never,
      accentColor: "#000",
    },
    ...overrides,
  };
}

describe("InternalToolRegistry", () => {
  let registry: InternalToolRegistry;

  beforeEach(() => {
    registry = new InternalToolRegistry();
  });

  it("resolves exact match", () => {
    const d = makeDescriptor("Monitor");
    registry.register(d);
    expect(registry.resolve("Monitor")).toBe(d);
    expect(registry.resolve("OtherTool")).toBeNull();
  });

  it("resolves mcp-server match", () => {
    const d = makeDescriptor("sched", {
      match: { type: "mcp-server", server: "stratos-scheduler" },
    });
    registry.register(d);
    expect(registry.resolve("mcp__stratos-scheduler__schedule_create")).toBe(d);
    expect(registry.resolve("mcp__other__tool")).toBeNull();
    expect(registry.resolve("stratos-scheduler__schedule_create")).toBeNull();
  });

  it("resolves prefix match", () => {
    const d = makeDescriptor("myprefix", {
      match: { type: "prefix", prefix: "mcp__stratos-" },
    });
    registry.register(d);
    expect(registry.resolve("mcp__stratos-foo__bar")).toBe(d);
    expect(registry.resolve("mcp__other__bar")).toBeNull();
  });

  it("resolves predicate match", () => {
    const d = makeDescriptor("pred", {
      match: { type: "predicate", fn: (name) => name.includes("memory") },
    });
    registry.register(d);
    expect(registry.resolve("write-to-memory")).toBe(d);
    expect(registry.resolve("read-file")).toBeNull();
  });

  it("first registered wins for overlapping patterns", () => {
    const first = makeDescriptor("first", {
      match: { type: "prefix", prefix: "mcp__" },
    });
    const second = makeDescriptor("second", {
      match: { type: "prefix", prefix: "mcp__stratos" },
    });
    registry.register(first);
    registry.register(second);
    expect(registry.resolve("mcp__stratos-scheduler__x")).toBe(first);
  });

  it("last write wins on same id", () => {
    const v1 = makeDescriptor("dup");
    const v2 = {
      ...makeDescriptor("dup"),
      display: { ...makeDescriptor("dup").display, accentColor: "#fff" },
    };
    registry.register(v1);
    registry.register(v2);
    expect(registry.resolve("dup")?.display.accentColor).toBe("#fff");
  });

  it("isInternal returns correct value", () => {
    registry.register(makeDescriptor("KnownTool"));
    expect(registry.isInternal("KnownTool")).toBe(true);
    expect(registry.isInternal("UnknownTool")).toBe(false);
  });

  it("getByServerName finds mcp-server descriptor", () => {
    const d = makeDescriptor("mgr", {
      match: { type: "mcp-server", server: "stratos-manager" },
    });
    registry.register(d);
    expect(registry.getByServerName("stratos-manager")).toBe(d);
    expect(registry.getByServerName("stratos-other")).toBeNull();
  });

  it("getByServerName ignores non-mcp-server patterns", () => {
    const d = makeDescriptor("exact-thing", {
      match: { type: "exact", name: "something" },
    });
    registry.register(d);
    expect(registry.getByServerName("something")).toBeNull();
  });

  it("supports array of patterns", () => {
    const d = makeDescriptor("multi", {
      match: [
        { type: "exact", name: "ToolA" },
        { type: "exact", name: "ToolB" },
      ],
    });
    registry.register(d);
    expect(registry.resolve("ToolA")).toBe(d);
    expect(registry.resolve("ToolB")).toBe(d);
    expect(registry.resolve("ToolC")).toBeNull();
  });
});

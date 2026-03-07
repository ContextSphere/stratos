import { describe, it, expect } from "vitest";
import { deriveHash, derivePort, getWorktreeInfo } from "../utils/worktree";

describe("deriveHash", () => {
  it("returns an 8-character hex string", () => {
    const hash = deriveHash("/some/path");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic for the same input", () => {
    expect(deriveHash("/foo/bar")).toBe(deriveHash("/foo/bar"));
  });

  it("produces different hashes for different inputs", () => {
    expect(deriveHash("/foo")).not.toBe(deriveHash("/bar"));
  });
});

describe("derivePort", () => {
  it("returns a port within [rangeStart, rangeEnd)", () => {
    const hash = deriveHash("/test/path");
    const port = derivePort(hash, 9200, 9999);
    expect(port).toBeGreaterThanOrEqual(9200);
    expect(port).toBeLessThan(9999);
  });

  it("is deterministic", () => {
    const hash = deriveHash("/test");
    expect(derivePort(hash, 9200, 9999)).toBe(derivePort(hash, 9200, 9999));
  });
});

describe("getWorktreeInfo", () => {
  it("returns proper structure when given a rootOverride", () => {
    const info = getWorktreeInfo("/tmp/test-worktree-root");
    expect(info.root).toBe("/tmp/test-worktree-root");
    expect(info.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(info.name).toBe("test-worktree-root");
    expect(info.userDataPath).toContain(".agentpanel/instances/");
    expect(info.userDataPath).toContain(info.hash);
    expect(info.cdpPort).toBeGreaterThanOrEqual(9200);
    expect(info.cdpPort).toBeLessThan(9999);
  });
});

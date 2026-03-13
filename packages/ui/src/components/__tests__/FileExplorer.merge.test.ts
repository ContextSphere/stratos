import { describe, expect, it } from "vitest";
import { mergeTreeNodes } from "../FileExplorer";
import type { TreeNode } from "../FileExplorer";
import type { DirEntry } from "../../bridges/types";

function file(name: string): DirEntry {
  return { name, type: "file", size: 100 };
}
function dir(name: string): DirEntry {
  return { name, type: "directory", size: 0 };
}
function node(
  name: string,
  path: string,
  overrides: Partial<TreeNode> = {},
): TreeNode {
  return {
    entry: file(name),
    path,
    loaded: false,
    expanded: false,
    ...overrides,
  };
}

describe("mergeTreeNodes", () => {
  it("adds new entries from fresh listing", () => {
    const existing = [node("a.ts", "/cwd/a.ts")];
    const fresh = [file("a.ts"), file("b.ts")];
    const result = mergeTreeNodes(existing, fresh, "/cwd");
    expect(result.map((n) => n.entry.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("drops entries absent from the fresh listing (deleted files)", () => {
    const existing = [
      node("a.ts", "/cwd/a.ts"),
      node("gone.ts", "/cwd/gone.ts"),
    ];
    const fresh = [file("a.ts")];
    const result = mergeTreeNodes(existing, fresh, "/cwd");
    expect(result.map((n) => n.entry.name)).toEqual(["a.ts"]);
  });

  it("preserves expanded/loaded/children state for existing entries", () => {
    const child = node("child.ts", "/cwd/src/child.ts");
    const existing = [
      node("src", "/cwd/src", {
        entry: dir("src"),
        loaded: true,
        expanded: true,
        children: [child],
      }),
    ];
    const fresh = [dir("src"), file("new.ts")];
    const result = mergeTreeNodes(existing, fresh, "/cwd");
    const srcNode = result.find((n) => n.entry.name === "src")!;
    expect(srcNode.expanded).toBe(true);
    expect(srcNode.loaded).toBe(true);
    expect(srcNode.children).toEqual([child]);
  });

  it("new entries start unloaded and unexpanded", () => {
    const result = mergeTreeNodes([], [dir("newdir")], "/cwd");
    expect(result[0].loaded).toBe(false);
    expect(result[0].expanded).toBe(false);
    expect(result[0].children).toBeUndefined();
  });

  it("updates entry metadata (size) for existing entries", () => {
    const existing = [node("a.ts", "/cwd/a.ts")]; // size: 100
    const fresh = [{ name: "a.ts", type: "file" as const, size: 999 }];
    const result = mergeTreeNodes(existing, fresh, "/cwd");
    expect(result[0].entry.size).toBe(999);
  });
});

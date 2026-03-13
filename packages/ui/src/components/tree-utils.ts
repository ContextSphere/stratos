import type { DirEntry } from "../bridges/types";

export interface TreeNode {
  entry: DirEntry;
  path: string;
  children?: TreeNode[];
  loaded: boolean;
  expanded: boolean;
}

export function mergeTreeNodes(
  existing: TreeNode[],
  fresh: DirEntry[],
  parentPath: string,
): TreeNode[] {
  const existingByName = new Map(existing.map((n) => [n.entry.name, n]));
  return fresh.map((entry) => {
    const prev = existingByName.get(entry.name);
    if (prev) {
      return { ...prev, entry }; // update size/type, preserve tree state
    }
    return {
      entry,
      path: `${parentPath}/${entry.name}`,
      loaded: false,
      expanded: false,
    };
  });
}

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";

// Re-implement the same regex and helpers from MarkdownContent to test them in isolation.
const FILE_LINK_RE =
  /([a-zA-Z0-9_.\-/]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|cs|rb|cpp|cc|c|h|hpp|kt|swift|md|json|yaml|yml|toml|sh|bash|zsh|txt|css|scss|sass|html|vue|svelte|ex|exs|php|dart|lua|r)):(\d+(?:,\d+)*)/g;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function splitIntoFileLinkNodes(text: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];
  let lastIndex = 0;
  FILE_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const firstLine = match[2].split(",")[0];
    nodes.push({
      type: "link",
      url: `${match[1]}:${firstLine}`,
      title: null,
      children: [{ type: "text", value: match[0] }],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: "text", value: text.slice(lastIndex) });
  }
  return nodes.length > 0 ? nodes : [{ type: "text", value: text }];
}

describe("remarkFileLinks — splitIntoFileLinkNodes", () => {
  it("converts a simple file:line pattern to a link node", () => {
    const nodes = splitIntoFileLinkNodes("See reply_tool.py:90 for details");
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: "text", value: "See " });
    expect(nodes[1]).toMatchObject({
      type: "link",
      url: "reply_tool.py:90",
      children: [{ type: "text", value: "reply_tool.py:90" }],
    });
    expect(nodes[2]).toEqual({ type: "text", value: " for details" });
  });

  it("uses only the first line when multiple comma-separated lines are given", () => {
    const nodes = splitIntoFileLinkNodes("memory_tools.py:149,200,267,318");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: "link",
      url: "memory_tools.py:149",
      children: [{ type: "text", value: "memory_tools.py:149,200,267,318" }],
    });
  });

  it("handles paths with subdirectories", () => {
    const nodes = splitIntoFileLinkNodes(
      "src/components/FileExplorer.tsx:42 line",
    );
    expect(nodes[0]).toMatchObject({
      type: "link",
      url: "src/components/FileExplorer.tsx:42",
    });
  });

  it("handles multiple file references in one string", () => {
    const nodes = splitIntoFileLinkNodes(
      "test_tool_interception.py:14, test_external_tool_host.py:439",
    );
    const links = nodes.filter((n) => n.type === "link");
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("test_tool_interception.py:14");
    expect(links[1].url).toBe("test_external_tool_host.py:439");
  });

  it("does not linkify plain text without a known extension", () => {
    const nodes = splitIntoFileLinkNodes("no-extension:42 or 1.0.0:5173");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("text");
  });

  it("returns original text node when there are no matches", () => {
    const nodes = splitIntoFileLinkNodes("no file references here");
    expect(nodes).toEqual([{ type: "text", value: "no file references here" }]);
  });
});

describe("FILE_LINK_RE — regex correctness", () => {
  const match = (text: string) => {
    FILE_LINK_RE.lastIndex = 0;
    return [...text.matchAll(FILE_LINK_RE)].map((m) => m[0]);
  };

  it("matches py, ts, tsx, go, rs, java", () => {
    expect(match("a.py:1 b.ts:2 c.tsx:3 d.go:4 e.rs:5 f.java:6")).toEqual([
      "a.py:1",
      "b.ts:2",
      "c.tsx:3",
      "d.go:4",
      "e.rs:5",
      "f.java:6",
    ]);
  });

  it("does not match URLs", () => {
    expect(match("https://example.com")).toHaveLength(0);
  });

  it("does not match bare version numbers like 1.0.0:80", () => {
    expect(match("1.0.0:80")).toHaveLength(0);
  });

  it("matches dw_framework/tools/reply_tool.py:90 with full path", () => {
    expect(match("dw_framework/tools/reply_tool.py:90")).toEqual([
      "dw_framework/tools/reply_tool.py:90",
    ]);
  });
});

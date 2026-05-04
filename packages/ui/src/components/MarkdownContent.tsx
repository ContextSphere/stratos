import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { MermaidDiagram } from "./MermaidDiagram";

// Matches file paths like `src/foo/bar.ts:42` or `script.py:10,20,30`
const FILE_LINK_RE =
  /([a-zA-Z0-9_.\-/]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|cs|rb|cpp|cc|c|h|hpp|kt|swift|md|json|yaml|yml|toml|sh|bash|zsh|txt|css|scss|sass|html|vue|svelte|ex|exs|php|dart|lua|r)):(\d+(?:,\d+)*)/g;

/** Remark plugin: converts bare `file.ext:line` text into clickable links. */
function remarkFileLinks() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    visitForFileLinks(tree);
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function visitForFileLinks(node: any) {
  if (!node.children) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const next: any[] = [];
  for (const child of node.children) {
    // Don't linkify inside code blocks, inline code, or existing links
    if (
      child.type === "code" ||
      child.type === "inlineCode" ||
      child.type === "link"
    ) {
      next.push(child);
      continue;
    }
    if (child.type === "text") {
      const parts = splitIntoFileLinkNodes(child.value);
      next.push(...parts);
    } else {
      visitForFileLinks(child);
      next.push(child);
    }
  }
  node.children = next;
}

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

/** Recursively extract plain text from React children. */
function extractTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractTextContent(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props
        .children,
    );
  }
  return "";
}

export function buildMarkdownComponents(onLinkClick?: (url: string) => void) {
  return {
    pre({ children }: { children?: React.ReactNode }) {
      return <>{children}</>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ node, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";
      const isBlock = node?.position && String(children).includes("\n");

      if ((isBlock || language) && language === "mermaid") {
        return <MermaidDiagram chart={String(children).replace(/\n$/, "")} />;
      }

      return isBlock || language ? (
        <SyntaxHighlighter
          style={vscDarkPlus as Record<string, React.CSSProperties>}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: "0.5rem 0",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
          }}
        >
          {String(children).replace(/\n$/, "")}
        </SyntaxHighlighter>
      ) : (
        <code
          className={`${className ?? ""} bg-[var(--bg-overlay)] px-1.5 py-0.5 rounded text-xs`}
          {...props}
        >
          {children}
        </code>
      );
    },
    p({ children }: { children?: React.ReactNode }) {
      return <p className="mb-2 last:mb-0">{children}</p>;
    },
    ul({ children }: { children?: React.ReactNode }) {
      return (
        <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
      );
    },
    ol({ children }: { children?: React.ReactNode }) {
      return (
        <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
      );
    },
    li({ children }: { children?: React.ReactNode }) {
      return <li className="ml-2">{children}</li>;
    },
    h1({ children }: { children?: React.ReactNode }) {
      return (
        <h1 className="text-xl font-bold mb-2 mt-3 first:mt-0">{children}</h1>
      );
    },
    h2({ children }: { children?: React.ReactNode }) {
      return (
        <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h2>
      );
    },
    h3({ children }: { children?: React.ReactNode }) {
      return (
        <h3 className="text-base font-bold mb-2 mt-2 first:mt-0">{children}</h3>
      );
    },
    blockquote({ children }: { children?: React.ReactNode }) {
      return (
        <blockquote className="border-l-4 border-[var(--border-mid)] pl-4 italic my-2">
          {children}
        </blockquote>
      );
    },
    table({ children }: { children?: React.ReactNode }) {
      return (
        <table className="border-collapse border border-[var(--border-mid)] my-2 w-full">
          {children}
        </table>
      );
    },
    thead({ children }: { children?: React.ReactNode }) {
      return <thead className="bg-[var(--bg-overlay)]">{children}</thead>;
    },
    th({ children }: { children?: React.ReactNode }) {
      return (
        <th className="border border-[var(--border-mid)] px-3 py-2 text-left font-semibold">
          {children}
        </th>
      );
    },
    td({ children }: { children?: React.ReactNode }) {
      return (
        <td className="border border-[var(--border-mid)] px-3 py-2">
          {children}
        </td>
      );
    },
    a({ children, href }: { children?: React.ReactNode; href?: string }) {
      return (
        <a
          href={href}
          className="text-blue-400 hover:underline cursor-pointer"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (onLinkClick && href) {
              e.preventDefault();
              // When href has no line (e.g. `file.py`) but text says `file.py:90`,
              // forward the line so the file explorer can jump to it.
              const hasLine = /:(\d+)$/.test(href) || /#L\d+/i.test(href);
              if (!hasLine) {
                const text = extractTextContent(children);
                const m = text.match(/:(\d+(?:,\d+)*)$/);
                if (m) {
                  const firstLine = m[1].split(",")[0];
                  onLinkClick(`${href}:${firstLine}`);
                  return;
                }
              }
              onLinkClick(href);
            }
          }}
        >
          {children}
        </a>
      );
    },
  };
}

export function MarkdownContent({
  content,
  onLinkClick,
}: {
  content: string;
  onLinkClick?: (url: string) => void;
}): React.ReactElement {
  const components = useMemo(
    () => buildMarkdownComponents(onLinkClick),
    [onLinkClick],
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkFileLinks]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

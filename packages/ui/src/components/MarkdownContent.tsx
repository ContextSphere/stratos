import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { MermaidDiagram } from "./MermaidDiagram";

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
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  content: string;
}

export function MarkdownPreview({ content }: Props): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-none text-gray-200 text-sm leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-2xl font-bold text-gray-100 mt-6 mb-3 first:mt-0">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-xl font-semibold text-gray-100 mt-5 mb-2">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-semibold text-gray-200 mt-4 mb-2">
                {children}
              </h3>
            ),
            h4: ({ children }) => (
              <h4 className="text-base font-semibold text-gray-200 mt-3 mb-1">
                {children}
              </h4>
            ),
            p: ({ children }) => <p className="mb-3">{children}</p>,
            ul: ({ children }) => (
              <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
            ),
            li: ({ children }) => <li className="text-gray-300">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-gray-600 pl-4 my-3 text-gray-400 italic">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto mb-3">
                <table className="min-w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-gray-700 px-3 py-1.5 bg-[var(--bg-surface)] text-left font-semibold text-gray-200">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-gray-700 px-3 py-1.5 text-gray-300">
                {children}
              </td>
            ),
            hr: () => <hr className="border-gray-700 my-4" />,
            a: ({ href, children }) => (
              <a
                href={href}
                className="text-blue-400 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-gray-100">
                {children}
              </strong>
            ),
            pre({ children }) {
              return <>{children}</>;
            },
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "");
              const language = match ? match[1] : "";
              const isBlock = node?.position && String(children).includes("\n");

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
                  className={`${className ?? ""} bg-gray-800 px-1.5 py-0.5 rounded text-xs`}
                  {...props}
                >
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

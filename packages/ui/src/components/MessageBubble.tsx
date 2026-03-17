import { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ToolCallCard } from "./ToolCallCard";
import { TaskCard } from "./TaskCard";
import { QuestionSequence } from "./QuestionSequence";
import { PlanReviewBlock } from "./PlanReviewBlock";
import { TodoList } from "./TodoList";
import { WorktreeProgress } from "./WorktreeProgress";
import type { ChatMessage } from "../types";
import type { AgentMode, ProviderType } from "../utils/modes";
import { getModeConfig } from "../utils/modes";

// Static Tailwind class map for mode-change pills
const PILL_COLOR_MAP: Record<
  string,
  { border: string; bg: string; text: string; dot: string }
> = {
  amber: {
    border: "border-amber-700/50",
    bg: "bg-amber-900/20",
    text: "text-amber-400",
    dot: "bg-amber-500",
  },
  blue: {
    border: "border-blue-700/50",
    bg: "bg-blue-900/20",
    text: "text-blue-400",
    dot: "bg-blue-500",
  },
  green: {
    border: "border-green-700/50",
    bg: "bg-green-900/20",
    text: "text-green-400",
    dot: "bg-green-500",
  },
  red: {
    border: "border-red-700/50",
    bg: "bg-red-900/20",
    text: "text-red-400",
    dot: "bg-red-500",
  },
};

function ThinkingBlock({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(!!isStreaming);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled) {
      setExpanded(!!isStreaming);
    }
  }, [isStreaming, userToggled]);

  useEffect(() => {
    if (isStreaming) setUserToggled(false);
  }, [isStreaming]);

  const handleToggle = () => {
    setUserToggled(true);
    setExpanded((v) => !v);
  };

  return (
    <div className="mb-1">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
        {expanded ? "Hide reasoning" : "Reasoning"}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words pl-3 border-l-2 border-[var(--border)] font-sans text-xs leading-relaxed text-[var(--text-muted)]">
          {content}
        </pre>
      )}
    </div>
  );
}

function buildMarkdownComponents(onLinkClick?: (url: string) => void) {
  return {
    pre({ children }: { children?: React.ReactNode }) {
      return <>{children}</>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ node, className, children, ...props }: any) {
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

function MarkdownContent({
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

interface Props {
  provider?: ProviderType;
  message: ChatMessage;
  onLinkClick?: (url: string) => void;
  onSendMessage?: (message: string) => void;
  onQuestionAnswer?: (
    requestId: string,
    answers: Record<string, string>,
  ) => void;
  onPlanReviewDecision?: (
    requestId: string,
    decision: { type: string; feedback?: string },
  ) => void;
  onViewPlan?: (content: string, title: string) => void;
  onUpdateTaskExpanded?: (messageId: string, expanded: boolean) => void;
  isStreaming?: boolean;
}

interface ParsedAttachment {
  type: string;
  title: string;
  url?: string;
}

function parseAttachments(content: string): {
  attachments: ParsedAttachment[];
  cleanContent: string;
} {
  const lines = content.split("\n");
  const attachments: ParsedAttachment[] = [];
  const remaining: string[] = [];

  for (const line of lines) {
    // Match: [Attached: TYPE "TITLE" (id: ID)] or [Attached: TYPE "TITLE" (id: ID, url: URL)]
    const m = line.match(
      /^\[Attached: (.+?) "(.+)" \(id: [^,)]+(?:, url: ([^)]+))?\)\]$/,
    );
    if (m) {
      attachments.push({ type: m[1], title: m[2], url: m[3] });
    } else {
      remaining.push(line);
    }
  }

  // Strip leading blank lines left behind by removed attachment lines
  while (remaining.length > 0 && remaining[0].trim() === "") remaining.shift();

  return { attachments, cleanContent: remaining.join("\n") };
}

function highlightMentions(content: string): string {
  // Wrap @mentions with bold markers for the markdown renderer
  return content.replace(/@(\w[\w\s]*?)(?=\s|$|[.,!?;:])/g, "**@$1**");
}

export function MessageBubble({
  provider = "claude-code",
  message,
  onLinkClick,
  onSendMessage,
  onQuestionAnswer,
  onPlanReviewDecision,
  onViewPlan,
  onUpdateTaskExpanded,
  isStreaming,
}: Props): React.ReactElement {
  const isUser = message.role === "user";

  const { attachments, cleanContent } = useMemo(() => {
    if (!isUser || !message.content)
      return { attachments: [], cleanContent: message.content ?? "" };
    const parsed = parseAttachments(message.content);
    return { ...parsed, cleanContent: highlightMentions(parsed.cleanContent) };
  }, [isUser, message.content]);

  // Mode change indicator — renders as a centered pill, not a message bubble
  if (message.modeChange) {
    const modeKey = message.modeChange as AgentMode;
    const config = getModeConfig(provider, modeKey);
    const colors = PILL_COLOR_MAP[config.color] ?? PILL_COLOR_MAP.blue;
    return (
      <div className="flex justify-center my-2">
        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${colors.border} ${colors.bg} ${colors.text}`}
        >
          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
          Switched to {config.label} mode
        </div>
      </div>
    );
  }

  const hasTextContent = !!(
    cleanContent ||
    message.thinking ||
    message.questionData ||
    message.planReviewData ||
    message.todoData ||
    message.worktreeProgress
  );
  const regularToolCalls = !message.taskInfo
    ? (message.toolCalls ?? []).filter((tc) => tc.toolName !== "Task")
    : [];
  const hasToolCalls = regularToolCalls.length > 0 || !!message.taskInfo;

  return (
    <div className="space-y-2">
      {/* Message content — user gets a bubble, assistant flows full-width */}
      {(isUser || hasTextContent) && (
        <div className={isUser ? "flex justify-end" : ""}>
          <div
            className={
              isUser
                ? "max-w-[85%] rounded-2xl px-4 py-3 break-words bg-blue-600 text-white"
                : "w-full break-words text-[var(--text-primary)] py-1"
            }
          >
            {/* Thinking block */}
            {message.thinking && (
              <ThinkingBlock
                content={message.thinking}
                isStreaming={isStreaming && !message.content}
              />
            )}

            {/* Document attachment chips (user messages only) */}
            {isUser && attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attachments.map((att, i) => (
                  <a
                    key={i}
                    href={att.url}
                    onClick={
                      att.url
                        ? (e) => {
                            e.preventDefault();
                            onLinkClick?.(att.url!);
                          }
                        : undefined
                    }
                    className="flex items-center gap-1.5 bg-blue-500/20 border border-blue-400/30 rounded-lg px-2 py-1 text-xs text-blue-100 hover:bg-blue-500/30 transition-colors no-underline cursor-pointer"
                    title={att.url}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3 h-3 flex-shrink-0"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="truncate max-w-[200px]">{att.title}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Image attachments (user messages only) */}
            {isUser && message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.images.map((img) => (
                  <img
                    key={img.id}
                    src={img.dataUrl}
                    alt={img.name}
                    title={img.name}
                    className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-blue-500/30"
                  />
                ))}
              </div>
            )}

            {/* Message text */}
            {cleanContent && (
              <div className="text-sm leading-relaxed prose prose-sm max-w-none">
                <MarkdownContent
                  content={cleanContent}
                  onLinkClick={onLinkClick}
                />
              </div>
            )}

            {/* Inline question from AskUserQuestion SDK tool */}
            {message.questionData && (
              <QuestionSequence
                questionData={message.questionData}
                onComplete={(requestId, answers) => {
                  if (onQuestionAnswer) {
                    onQuestionAnswer(requestId, answers);
                  }
                }}
                disabled={!onQuestionAnswer || !!message.questionAnswered}
                initiallyAnswered={message.questionAnswered}
              />
            )}

            {/* Inline plan review from ExitPlanMode SDK tool */}
            {message.planReviewData && onPlanReviewDecision && (
              <div className="mt-3">
                <PlanReviewBlock
                  provider={provider}
                  data={message.planReviewData}
                  onDecision={onPlanReviewDecision}
                  onViewPlan={onViewPlan}
                />
              </div>
            )}

            {/* Inline TODO list */}
            {message.todoData && <TodoList todoData={message.todoData} />}

            {/* Worktree progress */}
            {message.worktreeProgress && (
              <WorktreeProgress progressData={message.worktreeProgress} />
            )}
          </div>
        </div>
      )}

      {/* Tool calls — full-width block outside the bubble */}
      {message.taskInfo && (
        <div className="w-full">
          <TaskCard
            taskInfo={message.taskInfo}
            childToolCalls={
              message.toolCalls?.filter((tc) =>
                message.taskInfo!.childToolCalls.includes(tc.toolCallId),
              ) ?? []
            }
            onToggleToolCalls={(expanded) => {
              onUpdateTaskExpanded?.(message.id, expanded);
            }}
          />
        </div>
      )}

      {regularToolCalls.length > 0 && (
        <div className="w-full space-y-2">
          {regularToolCalls.map((tc) => (
            <ToolCallCard
              key={tc.toolCallId}
              toolCall={tc}
              isHistorical={!isStreaming}
            />
          ))}
        </div>
      )}
    </div>
  );
}

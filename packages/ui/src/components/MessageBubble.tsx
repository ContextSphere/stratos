import { useState, useEffect, useMemo } from "react";
import { ToolCallCard } from "./ToolCallCard";
import { TaskCard } from "./TaskCard";
import { QuestionSequence } from "./QuestionSequence";
import { PlanReviewBlock } from "./PlanReviewBlock";
import { TodoList } from "./TodoList";
import { WorktreeProgress } from "./WorktreeProgress";
import { MarkdownContent } from "./MarkdownContent";
import { InsightCard } from "./InsightCard";
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

type ContentSegment =
  | { type: "text"; content: string }
  | { type: "insight"; content: string };

export function parseContentSegments(content: string): ContentSegment[] {
  const pattern = /`?★\s*Insight\s*─+([\s\S]+?)─{3,}`?/g;
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: "text", content: text });
    }
    segments.push({ type: "insight", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const tail = content.slice(lastIndex).trim();
    if (tail) segments.push({ type: "text", content: tail });
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
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
  onViewFile?: (filePath: string) => void;
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
  onViewFile,
  isStreaming,
}: Props): React.ReactElement {
  const isUser = message.role === "user";

  const { attachments, cleanContent } = useMemo(() => {
    if (!isUser || !message.content)
      return { attachments: [], cleanContent: message.content ?? "" };
    const parsed = parseAttachments(message.content);
    return { ...parsed, cleanContent: highlightMentions(parsed.cleanContent) };
  }, [isUser, message.content]);

  const contentSegments = useMemo(
    () => (cleanContent && !isUser ? parseContentSegments(cleanContent) : null),
    [cleanContent, isUser],
  );

  // Mode change indicator — renders as a centered pill, not a message bubble
  if (message.modeChange) {
    const modeKey = message.modeChange as AgentMode;
    const config = getModeConfig(provider, modeKey);
    const colors = PILL_COLOR_MAP[config.color] ?? PILL_COLOR_MAP.blue;
    return (
      <div
        id={`msg-${message.id}`}
        data-message-id={message.id}
        className="flex justify-center my-2"
      >
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
  const INTERACTIVE_TOOLS = new Set([
    "AskUserQuestion",
    "EnterPlanMode",
    "ExitPlanMode",
    "TodoWrite",
  ]);
  const regularToolCalls = !message.taskInfo
    ? (message.toolCalls ?? []).filter(
        (tc) => tc.toolName !== "Task" && !INTERACTIVE_TOOLS.has(tc.toolName),
      )
    : [];
  const hasToolCalls = regularToolCalls.length > 0 || !!message.taskInfo;

  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className="space-y-2"
    >
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

            {/* File attachments (user messages only) */}
            {isUser &&
              message.fileAttachments &&
              message.fileAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {message.fileAttachments.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-950/20 text-blue-300 text-xs max-w-[240px]"
                      title={file.path}
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
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              )}

            {/* Message text — insights rendered as cards, other text as markdown */}
            {contentSegments
              ? contentSegments.map((seg, i) =>
                  seg.type === "insight" ? (
                    <InsightCard
                      key={i}
                      content={seg.content}
                      onLinkClick={onLinkClick}
                    />
                  ) : (
                    seg.content && (
                      <div
                        key={i}
                        className="text-sm leading-relaxed prose prose-sm max-w-none"
                      >
                        <MarkdownContent
                          content={seg.content}
                          onLinkClick={onLinkClick}
                        />
                      </div>
                    )
                  ),
                )
              : cleanContent && (
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
              onViewFile={onViewFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import {
  forwardRef,
  useEffect,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./shared/StatusIndicator";
import type { ChatMessage, TodoData } from "../types";
import type { ProviderType } from "../utils/modes";
import type { NavAnchor } from "../types/nav";

export interface ChatViewHandle {
  scrollToMessage(messageId: string): void;
  scrollToBottom(): void;
}

interface Props {
  provider?: ProviderType;
  messages: ChatMessage[];
  isStreaming: boolean;
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
  /** Called (debounced 300ms) when the user's scroll position changes meaningfully */
  onAnchorChange?: (anchor: NavAnchor) => void;
  /** Custom inner content for the empty state. Defaults to the generic Stratos splash. */
  emptyState?: ReactNode;
  /** Completion status for manager-spawned sessions — shown as a status bar
   * at the bottom of the transcript after streaming finishes. */
  completionStatus?: "completed" | "error" | "interrupted";
  completionError?: string;
}

/** Pixel threshold: user is considered "at the bottom" if within this distance */
const SCROLL_THRESHOLD = 80;

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView(
  {
    provider = "claude-code",
    messages,
    isStreaming,
    onLinkClick,
    onSendMessage,
    onQuestionAnswer,
    onPlanReviewDecision,
    onViewPlan,
    onUpdateTaskExpanded,
    onViewFile,
    onAnchorChange,
    emptyState,
    completionStatus,
    completionError,
  }: Props,
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest callback in a ref to avoid stale closures in debounced handler
  const onAnchorChangeRef = useRef(onAnchorChange);
  useEffect(() => {
    onAnchorChangeRef.current = onAnchorChange;
  }, [onAnchorChange]);

  const checkIfNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  // Expose imperative API to parent (must be called unconditionally before early return)
  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage(messageId: string) {
        const el = scrollRef.current;
        if (!el) return;
        const target = el.querySelector(`[data-message-id="${messageId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
      scrollToBottom() {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        isNearBottomRef.current = true;
        setShowScrollButton(false);
      },
    }),
    [],
  );

  /** Find and report the top-visible message after scrolling stops */
  const detectAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = checkIfNearBottom(el);
    if (nearBottom) {
      onAnchorChangeRef.current?.({ type: "latest" });
      return;
    }

    // Find the message element whose top edge is closest to (but not past) the
    // top of the scroll container — i.e. the last message that scrolled off the top.
    const containerTop = el.getBoundingClientRect().top;
    const msgEls = el.querySelectorAll("[data-message-id]");

    let bestId: string | null = null;
    let bestTop = -Infinity; // closest-to-zero negative top

    for (const msgEl of msgEls) {
      const msgTop = msgEl.getBoundingClientRect().top - containerTop;
      if (msgTop <= 4 && msgTop > bestTop) {
        // at or just above the container top
        bestTop = msgTop;
        bestId = (msgEl as HTMLElement).dataset.messageId ?? null;
      }
    }

    // Fall back to first fully visible message if all are below the fold
    if (!bestId) {
      for (const msgEl of msgEls) {
        const msgTop = msgEl.getBoundingClientRect().top - containerTop;
        if (msgTop >= 0) {
          bestId = (msgEl as HTMLElement).dataset.messageId ?? null;
          break;
        }
      }
    }

    if (bestId) {
      onAnchorChangeRef.current?.({ type: "message", messageId: bestId });
    }
  }, [checkIfNearBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = checkIfNearBottom(el);
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);

    // Debounce anchor detection so we don't spam on every pixel
    if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    anchorTimerRef.current = setTimeout(detectAnchor, 300);
  }, [checkIfNearBottom, detectAnchor]);

  // Auto-scroll only when user is near the bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    };
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        {emptyState ?? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-gray-300 mb-2">
              Stratos
            </h1>
            <p className="text-xs text-gray-600 mt-4">
              Type a message to get started
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-2 relative"
    >
      <div className="space-y-4">
        {messages.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            provider={provider}
            message={msg}
            onLinkClick={onLinkClick}
            onSendMessage={onSendMessage}
            onQuestionAnswer={onQuestionAnswer}
            onPlanReviewDecision={onPlanReviewDecision}
            onViewPlan={onViewPlan}
            onUpdateTaskExpanded={onUpdateTaskExpanded}
            onViewFile={onViewFile}
            isStreaming={isStreaming && idx === messages.length - 1}
          />
        ))}
        {isStreaming && (
          <div className="flex items-center py-2">
            <TypingIndicator />
          </div>
        )}
        {!isStreaming &&
          completionStatus &&
          completionStatus !== "completed" && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mt-2 ${
                completionStatus === "interrupted"
                  ? "bg-yellow-950/50 text-yellow-400 border border-yellow-900/50"
                  : "bg-red-950/50 text-red-400 border border-red-900/50"
              }`}
            >
              <span>
                {completionStatus === "interrupted"
                  ? "Session interrupted."
                  : `Session ended with an error${completionError ? `: ${completionError}` : "."}`}
              </span>
            </div>
          )}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs shadow-lg border border-gray-600 transition-colors"
          title="Scroll to bottom"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 3v10m0 0l-4-4m4 4l4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          New messages
        </button>
      )}
    </div>
  );
});

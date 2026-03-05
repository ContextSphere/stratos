import { useEffect, useRef, useCallback, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './shared/StatusIndicator'
import { TaskPanel } from './TaskPanel'
import type { ChatMessage, TodoData } from '../types'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  onLinkClick?: (url: string) => void
  onSendMessage?: (message: string) => void
  onQuestionAnswer?: (requestId: string, answers: Record<string, string>) => void
  onPlanReviewDecision?: (requestId: string, decision: { type: string; feedback?: string }) => void
  onViewPlan?: (content: string, title: string) => void
  onUpdateTaskExpanded?: (messageId: string, expanded: boolean) => void
  todoData?: TodoData | null
  showTaskPanel?: boolean
  onToggleTaskPanel?: () => void
}

/** Pixel threshold: user is considered "at the bottom" if within this distance */
const SCROLL_THRESHOLD = 80

export function ChatView({ messages, isStreaming, onLinkClick, onSendMessage, onQuestionAnswer, onPlanReviewDecision, onViewPlan, onUpdateTaskExpanded, todoData, showTaskPanel, onToggleTaskPanel }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const checkIfNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = checkIfNearBottom(el)
    isNearBottomRef.current = nearBottom
    setShowScrollButton(!nearBottom)
  }, [checkIfNearBottom])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    isNearBottomRef.current = true
    setShowScrollButton(false)
  }, [])

  // Auto-scroll only when user is near the bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-300 mb-2">AgentPanel</h1>
          <p className="text-sm text-gray-500">Open Source AI Agent Desktop</p>
          <p className="text-xs text-gray-600 mt-4">Type a message to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-2 relative">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onLinkClick={onLinkClick} onSendMessage={onSendMessage} onQuestionAnswer={onQuestionAnswer} onPlanReviewDecision={onPlanReviewDecision} onViewPlan={onViewPlan} onUpdateTaskExpanded={onUpdateTaskExpanded} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
            <TypingIndicator />
          </div>
        )}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs shadow-lg border border-gray-600 transition-colors"
          title="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          New messages
        </button>
      )}

      {/* Persistent Task Panel */}
      {showTaskPanel && todoData && (
        <TaskPanel todoData={todoData} onClose={() => onToggleTaskPanel?.()} />
      )}
    </div>
  )
}

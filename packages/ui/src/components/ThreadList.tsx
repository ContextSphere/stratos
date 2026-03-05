import { useState } from 'react'
import type { Thread } from '@agentpanel/core'

interface Props {
  threads: Thread[]
  activeThreadId: string | null
  onThreadClick: (threadId: string) => void
  onCreateThread: () => void
  onDeleteThread: (threadId: string) => void
  runningThreadIds: string[]
  threadNotifications: Map<string, string>
}

export function ThreadList({
  threads,
  activeThreadId,
  onThreadClick,
  onCreateThread,
  onDeleteThread,
  runningThreadIds,
  threadNotifications
}: Props): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Threads</span>
        <button
          onClick={onCreateThread}
          className="no-drag p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] transition-colors"
          title="New thread"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto space-y-0.5 px-1">
        {threads.length === 0 ? (
          <p className="text-xs text-gray-600 py-4 px-3 text-center">No threads yet</p>
        ) : (
          threads.map((thread) => {
            const isActive = thread.id === activeThreadId
            const isRunning = runningThreadIds.includes(thread.id)
            const notification = threadNotifications.get(thread.id)
            const isDeleting = confirmDelete === thread.id

            return (
              <div
                key={thread.id}
                className={`group no-drag flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
                  isActive
                    ? 'bg-[#2a2a2a] text-gray-200'
                    : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200'
                }`}
                onClick={() => onThreadClick(thread.id)}
              >
                {/* Running indicator */}
                {isRunning && (
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                )}

                {/* Title */}
                <span className="flex-1 truncate">{thread.title}</span>

                {/* Notification badge */}
                {notification && !isActive && (
                  <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                )}

                {/* Delete */}
                {isDeleting ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { onDeleteThread(thread.id); setConfirmDelete(null) }}
                      className="text-xs text-red-400 hover:text-red-300 px-1"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-gray-500 hover:text-gray-300 px-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(thread.id) }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-600 hover:text-red-400 transition-all"
                    title="Delete thread"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

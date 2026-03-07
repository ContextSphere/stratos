import { useState, useEffect, useCallback } from 'react'
import type { Thread } from '@agentpanel/core'

interface UseThreadsReturn {
  threads: Thread[]
  activeThreadId: string | null
  activeThread: Thread | null
  setActiveThreadId: (id: string | null) => Promise<void>
  createThread: (title?: string, model?: string, cwd?: string, provider?: string) => Promise<Thread>
  deleteThread: (id: string) => Promise<boolean>
  refreshThreads: () => Promise<void>
  isCreatingThread: boolean
}

export function useThreads(): UseThreadsReturn {
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null)
  const [isCreatingThread, setIsCreatingThread] = useState(false)

  const refreshThreads = useCallback(async () => {
    const list = (await window.api.threadsList()) as Thread[]
    const active = (await window.api.threadsGetActive()) as string | null
    setThreads(list)
    setActiveThreadIdState(active)
  }, [])

  useEffect(() => { refreshThreads() }, [refreshThreads])

  const setActiveThreadId = useCallback(async (id: string | null) => {
    await window.api.threadsSetActive(id)
    setActiveThreadIdState(id)
  }, [])

  const createThread = useCallback(async (title?: string, model?: string, cwd?: string, provider?: string) => {
    setIsCreatingThread(true)
    try {
      const thread = (await window.api.threadsCreate(title, model, cwd, provider)) as Thread
      await refreshThreads()
      return thread
    } finally { setIsCreatingThread(false) }
  }, [refreshThreads])

  const deleteThread = useCallback(async (id: string) => {
    const ok = await window.api.threadsDelete(id)
    if (ok) await refreshThreads()
    return ok
  }, [refreshThreads])

  const activeThread = activeThreadId ? (threads.find(t => t.id === activeThreadId) ?? null) : null

  return { threads, activeThreadId, activeThread, setActiveThreadId, createThread, deleteThread, refreshThreads, isCreatingThread }
}

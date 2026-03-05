import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../common/ipc-channels'
import { FileStorageAdapter, readTraceEntries, clearTraceFile } from '@agentpanel/core'
import type { StoredMessage, AgentMode } from '@agentpanel/core'

const storage = new FileStorageAdapter()

// Reference to clearThreadSession — set by main/index.ts
let clearSessionFn: ((threadId: string) => void) | null = null
let getRunningIdsFn: (() => string[]) | null = null

export function setThreadSessionClearer(fn: (threadId: string) => void): void {
  clearSessionFn = fn
}

export function setRunningThreadsGetter(fn: () => string[]): void {
  getRunningIdsFn = fn
}

export function registerThreadIpc(): void {
  ipcMain.handle(IPC_CHANNELS.THREADS_LIST, async () => {
    return storage.listThreads()
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_GET_ACTIVE, async () => {
    return storage.getActiveThreadId()
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_SET_ACTIVE, async (_event, threadId: string | null) => {
    return storage.setActiveThreadId(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_CREATE, async (_event, title?: string, model?: string, cwd?: string) => {
    const thread = await storage.createThread(title, model, cwd)
    return thread
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_GET, async (_event, threadId: string) => {
    return storage.getThread(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_UPDATE, async (_event, threadId: string, updates: { title?: string; model?: string; cwd?: string; thinkingEffort?: 'low' | 'medium' | 'high' | 'max'; mode?: AgentMode; additionalCwds?: string[] }) => {
    // Clear session on cwd or mode change
    if (updates.cwd !== undefined || updates.mode !== undefined) {
      clearSessionFn?.(threadId)
    }
    return storage.updateThread(threadId, updates)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_DELETE, async (_event, threadId: string) => {
    clearSessionFn?.(threadId)
    return storage.deleteThread(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_LOAD_MESSAGES, async (_event, threadId: string) => {
    return storage.loadMessages(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_SAVE_MESSAGES, async (_event, threadId: string, messages: StoredMessage[]) => {
    return storage.saveMessages(threadId, messages)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_READ_TRACE, (_event, threadId: string) => {
    return readTraceEntries(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_CLEAR_TRACE, (_event, threadId: string) => {
    clearTraceFile(threadId)
  })

  ipcMain.handle(IPC_CHANNELS.THREADS_RUNNING, () => {
    return getRunningIdsFn?.() ?? []
  })
}

export function unregisterThreadIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_LIST)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_GET_ACTIVE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_SET_ACTIVE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CREATE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_GET)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_UPDATE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_DELETE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_LOAD_MESSAGES)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_SAVE_MESSAGES)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_READ_TRACE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_CLEAR_TRACE)
  ipcMain.removeHandler(IPC_CHANNELS.THREADS_RUNNING)
}

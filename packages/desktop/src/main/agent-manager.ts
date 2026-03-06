import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC_CHANNELS } from '../common/ipc-channels'
import {
  ClaudeCodeProvider,
  FileStorageAdapter,
  appendTraceEntry,
  normalizeMode
} from '@agentpanel/core'
import type {
  AgentProvider,
  AgentMessage,
  PermissionHandler,
  SendMessageParams
} from '@agentpanel/core'
import { loadSettings } from './settings/settings.store'

function safeLog(fn: (...args: unknown[]) => void, ...args: unknown[]) {
  try { fn(...args) } catch (e: any) { if (e?.code !== 'EPIPE') throw e }
}

interface ThreadSession {
  provider: AgentProvider
  sessionId?: string
  abortController?: AbortController
}

export class AgentManager {
  private window: BrowserWindow
  private sessions = new Map<string, ThreadSession>()
  private activeStreams = new Set<string>()
  private storage = new FileStorageAdapter()
  private pendingPermissions = new Map<string, { resolve: (result: { approved: boolean; modifiedInput?: Record<string, unknown>; denyMessage?: string }) => void }>()
  private pendingQuestions = new Map<
    string,
    { resolve: (result: { approved: boolean; modifiedInput?: Record<string, unknown> }) => void; input: Record<string, unknown> }
  >()
  private pendingPlanReviews = new Map<
    string,
    {
      resolve: (result: { approved: boolean; modifiedInput?: Record<string, unknown>; denyMessage?: string }) => void
      threadId: string | null
      input: Record<string, unknown>
    }
  >()
  private questionCounter = 0
  private planReviewCounter = 0
  private lastPlanMarkdown: { content: string; title: string } | null = null
  private cachedSlashCommands: { name: string; description?: string }[] = []

  constructor(window: BrowserWindow) {
    this.window = window
    this.registerIpc()
    this.detectOrphanedThreads().catch((err) => {
      safeLog(console.error, '[agent-manager] orphan detection failed:', err)
    })
  }

  private registerIpc(): void {
    ipcMain.handle(IPC_CHANNELS.SEND_MESSAGE, async (_event, prompt: string, threadId?: string, images?: { dataUrl: string; mimeType: string }[]) => {
      if (!threadId) return
      // Fire-and-forget: start streaming in background, return immediately
      this.runStream(threadId, prompt, images).catch((err) => {
        safeLog(console.error, `[agent-manager] stream error for thread ${threadId}:`, err)
      })
    })

    ipcMain.handle(IPC_CHANNELS.INTERRUPT, async (_event, threadId?: string) => {
      if (!threadId) return
      const session = this.sessions.get(threadId)
      if (session) {
        await session.provider.interrupt()
      }
    })

    ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_MODELS, async () => {
      const provider = new ClaudeCodeProvider()
      const settings = loadSettings()
      await provider.initialize({
        cliPath: settings.cliPath as string | undefined
      })
      try {
        return await provider.getAvailableModels()
      } finally {
        await provider.dispose()
      }
    })

    // Handle tool permission responses from the renderer
    ipcMain.on(IPC_CHANNELS.TOOL_RESPONSE, (_event, data: { requestId: string; approved: boolean }) => {
      const pending = this.pendingPermissions.get(data.requestId)
      if (pending) {
        pending.resolve({ approved: data.approved })
        this.pendingPermissions.delete(data.requestId)
      }
    })

    // Handle ask-user-question responses
    ipcMain.on(IPC_CHANNELS.ASK_USER_RESPONSE, (_event, data: { requestId: string; answers: Record<string, string> }) => {
      const pending = this.pendingQuestions.get(data.requestId)
      if (pending) {
        pending.resolve({
          approved: true,
          modifiedInput: {
            questions: pending.input.questions,
            answers: data.answers
          }
        })
        this.pendingQuestions.delete(data.requestId)
      }
    })

    // Handle plan review responses
    ipcMain.on(IPC_CHANNELS.PLAN_REVIEW_RESPONSE, async (_event, data: { requestId: string; decision: { type: string; feedback?: string } }) => {
      const pending = this.pendingPlanReviews.get(data.requestId)
      if (!pending) return
      const { resolve, threadId, input } = pending
      this.pendingPlanReviews.delete(data.requestId)

      switch (data.decision.type) {
        case 'clear-bypass':
        case 'bypass':
          if (threadId) {
            try { await this.storage.updateThread(threadId, { mode: 'bypassPermissions' }) } catch {}
            this.sendToRenderer(IPC_CHANNELS.MODE_CHANGED, { mode: 'bypassPermissions' }, threadId)
          }
          resolve({ approved: true })
          break
        case 'manual':
          if (threadId) {
            try { await this.storage.updateThread(threadId, { mode: 'default' }) } catch {}
            this.sendToRenderer(IPC_CHANNELS.MODE_CHANGED, { mode: 'default' }, threadId)
          }
          resolve({ approved: true, modifiedInput: { ...input, allowedPrompts: [] } })
          break
        case 'feedback':
        case 'deny':
        default:
          resolve({ approved: false, denyMessage: data.decision.feedback ?? 'User provided feedback' })
          break
      }
    })

    // Handle orphaned thread recovery
    ipcMain.handle(IPC_CHANNELS.THREADS_RECOVER_ORPHANED, async (_event, threadId: string) => {
      try {
        this.storage.clearPersistedSessionId(threadId)
        this.clearSession(threadId)
      } catch (err) {
        safeLog(console.error, `[agent-manager] failed to recover orphaned thread ${threadId}:`, err)
      }
    })
  }

  private async runStream(
    threadId: string,
    prompt: string,
    images?: { dataUrl: string; mimeType: string }[]
  ): Promise<void> {
    const thread = await this.storage.getThread(threadId)
    if (!thread) throw new Error(`Thread ${threadId} not found`)

    // Get or create a session for this thread
    let session = this.sessions.get(threadId)
    if (!session) {
      const provider = new ClaudeCodeProvider()
      const settings = loadSettings()
      await provider.initialize({
        cliPath: settings.cliPath as string | undefined,
        model: thread.model,
        cwd: thread.cwd ?? process.env.HOME,
        settingSources: ['project', 'user']
      })
      session = { provider }
      this.sessions.set(threadId, session)
    }

    // Track active stream
    this.activeStreams.add(threadId)

    // Notify renderer that streaming started
    this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, { threadId, isRunning: true })

    const permissionHandler: PermissionHandler = async (toolName, input) => {
      // Mode-aware permission logic (defense-in-depth)
      const currentThread = await this.storage.getThread(threadId)
      const currentMode = normalizeMode(currentThread?.mode)

      if (currentMode === 'bypassPermissions') {
        return { approved: true }
      }

      if (toolName === 'EnterPlanMode') {
        return { approved: true }
      }
      if (toolName === 'ExitPlanMode') {
        return this.requestPlanReview(threadId, input)
      }
      if (toolName === 'AskUserQuestion') {
        this.notifyIfBackground(threadId, 'question')
        return this.requestUserAnswer(threadId, input)
      }

      // Auto-approve file/shell tools in acceptEdits mode
      if (currentMode === 'acceptEdits') {
        const autoApprove = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'NotebookEdit'])
        if (autoApprove.has(toolName) || toolName.startsWith('mcp__')) {
          return { approved: true }
        }
      }

      // Default: generic tool permission
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      this.sendToRenderer(IPC_CHANNELS.TOOL_PERMISSION, { requestId, toolName, input }, threadId)
      this.notifyIfBackground(threadId, 'permission')
      return new Promise((resolve) => {
        this.pendingPermissions.set(requestId, { resolve })
      })
    }

    const mode = normalizeMode(thread.mode)
    const params: SendMessageParams = {
      prompt,
      sessionId: session.sessionId,
      model: thread.model,
      cwd: thread.cwd ?? process.env.HOME,
      additionalDirectories: thread.additionalCwds,
      thinkingEffort: thread.thinkingEffort,
      mode,
      images,
      permissionHandler,
      traceCallback: (entry) => {
        appendTraceEntry(threadId, entry)
      }
    }

    let specificErrorSent = false

    try {
      for await (const msg of session.provider.sendMessage(params)) {
        this.sendToRenderer(IPC_CHANNELS.STREAM_MESSAGE, msg, threadId)

        if (msg.type === 'error') {
          specificErrorSent = true
        }

        // Track plan markdown for artifact viewer
        if (
          msg.type === 'tool_use' &&
          msg.toolName === 'Write' &&
          typeof msg.input?.file_path === 'string' &&
          msg.input.file_path.endsWith('.md') &&
          typeof msg.input?.content === 'string'
        ) {
          const filePath = msg.input.file_path as string
          const content = msg.input.content as string
          const fileName = filePath.split('/').pop() ?? filePath
          this.lastPlanMarkdown = { content, title: fileName }
          this.sendToRenderer(IPC_CHANNELS.PREVIEW_OPEN_MARKDOWN, {
            content, title: fileName, filePath
          }, threadId)
        }

        // Track session ID from init message
        if (msg.type === 'session_init') {
          session.sessionId = msg.sessionId
          // Persist sessionId to thread for resume
          try { this.storage.updateThread(threadId, { sessionId: msg.sessionId }) } catch {}
          // Notify renderer of session readiness
          this.sendToRenderer(IPC_CHANNELS.SESSION_READY, {
            sessionId: msg.sessionId,
            tools: (msg as any).tools ?? []
          }, threadId)
        }
      }
    } catch (err: any) {
      if (!specificErrorSent) {
        this.sendToRenderer(IPC_CHANNELS.STREAM_MESSAGE, { type: 'error', message: err?.message ?? 'Unknown error', code: 'AGENT_ERROR' }, threadId)
      }
    } finally {
      this.activeStreams.delete(threadId)
      this.sendToRenderer(IPC_CHANNELS.THREAD_STREAM_STATE, { threadId, isRunning: false })
    }
  }

  private sendToRenderer(channel: string, data: unknown, threadId?: string): void {
    if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
    if (threadId) {
      this.window.webContents.send(channel, data, threadId)
    } else {
      this.window.webContents.send(channel, data)
    }
  }

  private notifyIfBackground(threadId: string, type: 'permission' | 'question' | 'plan_review'): void {
    if (this.window.isDestroyed() || this.window.isFocused()) return

    const titles: Record<string, string> = {
      permission: 'Permission Required',
      question: 'Question from Agent',
      plan_review: 'Plan Review Required'
    }
    const bodies: Record<string, string> = {
      permission: 'A tool needs your approval to proceed.',
      question: 'The agent has a question for you.',
      plan_review: 'A plan is ready for your review.'
    }

    const notification = new Notification({
      title: titles[type],
      body: bodies[type]
    })
    notification.on('click', () => {
      this.window.show()
      this.window.focus()
      this.sendToRenderer(IPC_CHANNELS.THREAD_ACTIVATE, { threadId })
    })
    notification.show()
  }

  private requestPlanReview(
    threadId: string | null,
    input: Record<string, unknown>
  ): Promise<{ approved: boolean; modifiedInput?: Record<string, unknown>; denyMessage?: string }> {
    const requestId = `plan_review_${++this.planReviewCounter}`
    this.notifyIfBackground(threadId ?? '', 'plan_review')
    return new Promise((resolve) => {
      this.pendingPlanReviews.set(requestId, { resolve, threadId, input })
      this.sendToRenderer(IPC_CHANNELS.PLAN_REVIEW, {
        requestId,
        input,
        ...(this.lastPlanMarkdown
          ? { planContent: this.lastPlanMarkdown.content, planTitle: this.lastPlanMarkdown.title }
          : {})
      }, threadId)
    })
  }

  private requestUserAnswer(
    threadId: string | null,
    input: Record<string, unknown>
  ): Promise<{ approved: boolean; modifiedInput?: Record<string, unknown> }> {
    const requestId = `question_${++this.questionCounter}`
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, { resolve, input })
      this.sendToRenderer(IPC_CHANNELS.ASK_USER_QUESTION, {
        requestId,
        input
      }, threadId)
    })
  }

  private async detectOrphanedThreads(): Promise<void> {
    try {
      const threads = this.storage.listThreads()
      const orphanedIds: string[] = []
      for (const thread of threads) {
        if (thread.sessionId && !this.activeStreams.has(thread.id)) {
          this.storage.clearPersistedSessionId(thread.id)
          orphanedIds.push(thread.id)
        }
      }
      if (orphanedIds.length > 0) {
        // Delay slightly so renderer has time to initialize
        setTimeout(() => {
          this.sendToRenderer(IPC_CHANNELS.THREADS_ORPHANED, { threadIds: orphanedIds })
        }, 2000)
      }
    } catch (err) {
      safeLog(console.error, '[agent-manager] orphan detection error:', err)
    }
  }

  clearSession(threadId: string): void {
    const session = this.sessions.get(threadId)
    if (session) {
      session.provider.dispose().catch(() => {})
      this.sessions.delete(threadId)
    }
  }

  getRunningThreadIds(): string[] {
    return Array.from(this.activeStreams)
  }

  getSlashCommands(): { name: string; description?: string }[] {
    return this.cachedSlashCommands
  }

  async discoverSlashCommands(): Promise<{ name: string; description?: string }[]> {
    const provider = new ClaudeCodeProvider()
    const settings = loadSettings()
    await provider.initialize({
      cliPath: settings.cliPath as string | undefined,
      settingSources: ['project', 'user']
    })
    try {
      const commands = await provider.discoverSlashCommands()
      this.cachedSlashCommands = commands
      // Broadcast to renderer
      this.sendToRenderer(IPC_CHANNELS.SLASH_COMMANDS_LIST, commands)
      return commands
    } catch (err) {
      safeLog(console.error, '[agent-manager] Failed to discover slash commands:', err)
      return []
    } finally {
      await provider.dispose()
    }
  }

  unregisterIpc(): void {
    ipcMain.removeHandler(IPC_CHANNELS.SEND_MESSAGE)
    ipcMain.removeHandler(IPC_CHANNELS.INTERRUPT)
    ipcMain.removeHandler(IPC_CHANNELS.GET_AVAILABLE_MODELS)
    ipcMain.removeHandler(IPC_CHANNELS.THREADS_RECOVER_ORPHANED)
    ipcMain.removeAllListeners(IPC_CHANNELS.TOOL_RESPONSE)
    ipcMain.removeAllListeners(IPC_CHANNELS.ASK_USER_RESPONSE)
    ipcMain.removeAllListeners(IPC_CHANNELS.PLAN_REVIEW_RESPONSE)
  }

  dispose(): void {
    // Reject pending promises before clearing
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ approved: false })
    }
    for (const [, pending] of this.pendingQuestions) {
      pending.resolve({ approved: false })
    }
    for (const [, pending] of this.pendingPlanReviews) {
      pending.resolve({ approved: false })
    }

    for (const [, session] of this.sessions) {
      session.provider.dispose().catch(() => {})
    }
    this.sessions.clear()
    this.activeStreams.clear()
    this.pendingPermissions.clear()
    this.pendingQuestions.clear()
    this.pendingPlanReviews.clear()
    this.unregisterIpc()
  }
}

import { useState, useCallback, useRef, useEffect } from 'react'
import { normalizeMode, AGENT_MODES, type AgentMode } from './utils/modes'
import type { ImageAttachment } from '@agentpanel/ui'
import {
  Sidebar,
  ChatView,
  InputBar,
  type InputBarRef,
  type InteractiveMode,
  PermissionDialog,
  PreviewPane,
  ChatInfoBar,
  type SessionStats,
  ToolsBadge,
  useTodoData,
  ModelSelector,
  ModeToggle,
  WorktreeToggle,
  ProviderToggle,
} from '@agentpanel/ui'

import { Group, Panel, Separator } from 'react-resizable-panels'
import { useChat } from './hooks/useChat'
import { useThreads } from './hooks/useThreads'
import { useGitHub } from './hooks/useGitHub'
import { useClaude } from './hooks/useClaude'
import { usePreview } from './hooks/usePreview'
import { ConnectGitHubDialog } from './components/ConnectGitHubDialog'
import { ConnectClaudeDialog } from './components/ConnectClaudeDialog'
import { SettingsDialog } from './components/SettingsDialog'

export default function App(): React.ReactElement {
  const {
    threads,
    activeThreadId,
    activeThread,
    setActiveThreadId,
    createThread,
    deleteThread,
    refreshThreads,
  } = useThreads()

  const {
    messages,
    isStreaming,
    permissionRequest,
    sessionStats,
    interactiveMode,
    sendMessage,
    interrupt,
    respondPermission,
    respondQuestion,
    respondPlanReview,
    handleInteractiveResponse,
    updateTaskExpanded,
    slashCommands,
    runningThreadIds,
    threadNotifications,
    sessionTools,
  } = useChat(activeThreadId, { onThreadUpdated: refreshThreads })

  const github = useGitHub()
  const claude = useClaude()
  const { preview, openUrl, openMarkdown, openArtifactEditor, close: closePreview } = usePreview()
  const { latestTodoData, showTaskPanel, setShowTaskPanel } = useTodoData(messages)

  const [showClaudeDialog, setShowClaudeDialog] = useState(false)
  const [showGitHubDialog, setShowGitHubDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [pendingMode, setPendingMode] = useState<AgentMode>()
  const [pendingProvider, setPendingProvider] = useState<'claude-code' | 'codex'>('claude-code')
  const [pendingAdditionalCwds, setPendingAdditionalCwds] = useState<string[]>([])
  const [homeDir, setHomeDir] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const inputRef = useRef<InputBarRef | null>(null)
  const draftsRef = useRef<Map<string, string>>(new Map())
  const prevActiveThreadIdRef = useRef<string | null>(null)

  // Fetch home directory
  useEffect(() => {
    window.api.getHomeDirectory().then(setHomeDir)
  }, [])

  // Save/restore draft input text when switching threads
  useEffect(() => {
    const prev = prevActiveThreadIdRef.current
    if (prev && prev !== activeThreadId) {
      const text = inputRef.current?.getText() ?? ''
      if (text) draftsRef.current.set(prev, text)
      else draftsRef.current.delete(prev)
    }
    prevActiveThreadIdRef.current = activeThreadId
    if (activeThreadId) {
      inputRef.current?.prefill(draftsRef.current.get(activeThreadId) ?? '')
    }
  }, [activeThreadId])

  const handleThreadClick = useCallback(
    async (threadId: string) => {
      closePreview()
      await setActiveThreadId(threadId)
    },
    [setActiveThreadId, closePreview],
  )

  const handleCreateThread = useCallback(async () => {
    const result = await window.api.selectDirectory()
    if (result.canceled || !result.path) return
    const thread = await createThread('New chat', undefined, result.path, pendingProvider)
    // Detect git repo and set default worktree mode
    const isGit = await window.api.checkIsGitRepo(result.path)
    if (isGit) {
      await window.api.threadsUpdate(thread.id, { isGitRepo: true, worktreeMode: 'local' })
      await refreshThreads()
    }
    await setActiveThreadId(thread.id)
    inputRef.current?.focus()
  }, [createThread, setActiveThreadId, refreshThreads, pendingProvider])

  const handleDeleteThread = useCallback(
    async (id: string) => {
      draftsRef.current.delete(id)
      await deleteThread(id)
    },
    [deleteThread],
  )

  const handleSend = useCallback(
    async (prompt: string, images?: ImageAttachment[]) => {
      let threadId = activeThreadId
      if (!threadId) {
        const result = await window.api.selectDirectory()
        if (result.canceled || !result.path) return
        const thread = await createThread('New chat', undefined, result.path, pendingProvider)
        threadId = thread.id
        const updates: Record<string, unknown> = {}
        if (pendingMode) {
          updates.mode = pendingMode
          setPendingMode(undefined)
        }
        if (pendingAdditionalCwds.length > 0) {
          updates.additionalCwds = pendingAdditionalCwds
          setPendingAdditionalCwds([])
        }
        // Detect git repo
        const isGit = await window.api.checkIsGitRepo(result.path)
        if (isGit) {
          updates.isGitRepo = true
          updates.worktreeMode = 'local'
        }
        if (Object.keys(updates).length > 0) {
          await window.api.threadsUpdate(
            threadId,
            updates as Parameters<typeof window.api.threadsUpdate>[1],
          )
        }
      }
      await sendMessage(prompt, threadId, images)
    },
    [activeThreadId, createThread, sendMessage, pendingMode, pendingAdditionalCwds, pendingProvider],
  )

  const handleModelChange = useCallback(
    async (model: string) => {
      if (!activeThreadId) return
      await window.api.threadsUpdate(activeThreadId, { model })
      await refreshThreads()
    },
    [activeThreadId, refreshThreads],
  )

  const handleThinkingEffortChange = useCallback(
    async (effort: string) => {
      if (!activeThreadId) return
      await window.api.threadsUpdate(activeThreadId, {
        thinkingEffort: effort as 'low' | 'medium' | 'high' | 'max',
      })
      await refreshThreads()
    },
    [activeThreadId, refreshThreads],
  )

  const handleAddDirectory = useCallback(async () => {
    const result = await window.api.selectDirectory()
    if (result.canceled || !result.path) return
    const newPath = result.path
    if (activeThreadId) {
      const currentCwds = activeThread?.additionalCwds ?? []
      if (currentCwds.includes(newPath) || activeThread?.cwd === newPath) return
      await window.api.threadsUpdate(activeThreadId, {
        additionalCwds: [...currentCwds, newPath],
      })
      await refreshThreads()
    } else {
      setPendingAdditionalCwds((prev) => (prev.includes(newPath) ? prev : [...prev, newPath]))
    }
  }, [activeThreadId, activeThread, refreshThreads])

  const handleRemoveDirectory = useCallback(
    async (path: string) => {
      if (activeThreadId) {
        const currentCwds = activeThread?.additionalCwds ?? []
        await window.api.threadsUpdate(activeThreadId, {
          additionalCwds: currentCwds.filter((d) => d !== path),
        })
        await refreshThreads()
      } else {
        setPendingAdditionalCwds((prev) => prev.filter((d) => d !== path))
      }
    },
    [activeThreadId, activeThread, refreshThreads],
  )

  const handleModeChange = useCallback(
    async (mode: AgentMode) => {
      if (!activeThreadId) {
        setPendingMode(mode)
        return
      }
      await window.api.threadsUpdate(activeThreadId, { mode })
      await refreshThreads()
    },
    [activeThreadId, refreshThreads],
  )

  const handleProviderChange = useCallback(
    async (provider: 'claude-code' | 'codex') => {
      if (!activeThreadId) {
        setPendingProvider(provider)
        return
      }
      await window.api.threadsUpdate(activeThreadId, { provider })
      await refreshThreads()
    },
    [activeThreadId, refreshThreads],
  )

  const handleWorktreeModeChange = useCallback(
    async (mode: 'local' | 'worktree') => {
      if (!activeThreadId) return
      await window.api.threadsUpdate(activeThreadId, { worktreeMode: mode })
      await refreshThreads()
    },
    [activeThreadId, refreshThreads],
  )

  // Ctrl+Tab to cycle modes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.shiftKey) && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (isStreaming) return
        const currentMode = activeThread?.mode
          ? normalizeMode(activeThread.mode)
          : (pendingMode ?? 'default')
        const currentIndex = AGENT_MODES.indexOf(currentMode)
        const nextIndex = (currentIndex + 1) % AGENT_MODES.length
        handleModeChange(AGENT_MODES[nextIndex])
      }
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [activeThread, pendingMode, isStreaming, handleModeChange])

  // Handle notification click -> activate thread
  useEffect(() => {
    window.api.onThreadActivate(({ threadId }: { threadId: string }) => {
      handleThreadClick(threadId)
    })
    return () => window.api.removeAllListeners('chat:thread-activate')
  }, [handleThreadClick])

  // Cmd+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarCollapsed((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Cmd+P to open model picker (via main process menu)
  useEffect(() => {
    window.api.onOpenModelPicker(() => setModelPickerOpen((v) => !v))
    return () => window.api.removeAllListeners('ui:open-model-picker')
  }, [])

  // Auto-open Claude auth dialog on auth failure
  useEffect(() => {
    const handler = () => setShowClaudeDialog(true)
    window.addEventListener('claude:auth-failed', handler)
    return () => window.removeEventListener('claude:auth-failed', handler)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarCollapsed((prev) => !prev), [])

  return (
    <div className="flex h-screen">
      <div
        className="overflow-hidden transition-[width] duration-200 ease-in-out flex-shrink-0"
        style={{ width: sidebarCollapsed ? 0 : 232 }}
      >
        <Sidebar
          threads={threads}
          activeThreadId={activeThreadId}
          onThreadClick={handleThreadClick}
          onCreateThread={handleCreateThread}
          onDeleteThread={handleDeleteThread}
          onToggleSidebar={toggleSidebar}
          onSettingsClick={() => setShowSettingsDialog(true)}
          runningThreadIds={runningThreadIds}
          threadNotifications={threadNotifications}

        />
      </div>

      <Group
        key={preview.isOpen ? 'split' : 'full'}
        orientation="horizontal"
        className="flex-1 min-h-0"
      >
        <Panel defaultSize={preview.isOpen ? 70 : 100} minSize={30}>
          <div className="flex flex-col h-full bg-[#0f0f0f] rounded-l-xl overflow-hidden">
            {sidebarCollapsed && <div className="drag-region h-7 flex-shrink-0" />}

            {/* Top bar */}
            <div
              className={`drag-region flex-shrink-0 flex items-end justify-between px-4 pb-1.5 ${sidebarCollapsed ? '' : 'h-11'}`}
            >
              <div className="flex items-center">
                {sidebarCollapsed && (
                  <button
                    onClick={toggleSidebar}
                    className="no-drag p-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a] transition-colors"
                    title="Expand sidebar"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowClaudeDialog(true)}
                  className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[#2a2a2a]"
                  title={claude.isConnected ? 'Claude connected' : 'Connect Claude'}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${claude.isConnected ? 'bg-green-500' : 'bg-gray-600'}`}
                  />
                  <span className={claude.isConnected ? 'text-gray-400' : 'text-gray-600'}>
                    Claude
                  </span>
                </button>
                <button
                  onClick={() => setShowGitHubDialog(true)}
                  className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors hover:bg-[#2a2a2a]"
                  title={github.isConnected ? 'GitHub connected' : 'Connect GitHub'}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${github.isConnected ? 'bg-green-500' : 'bg-gray-600'}`}
                  />
                  <span className={github.isConnected ? 'text-gray-400' : 'text-gray-600'}>
                    GitHub
                  </span>
                </button>
              </div>
            </div>

            {/* Chat info bar */}
            <ChatInfoBar
              primaryCwd={activeThread?.cwd}
              additionalCwds={activeThread?.additionalCwds ?? pendingAdditionalCwds}
              onAddDirectory={handleAddDirectory}
              onRemoveDirectory={handleRemoveDirectory}
              sessionStats={sessionStats}
              homeDir={homeDir}
              sessionTools={sessionTools ?? undefined}
              todoData={latestTodoData}
              onToggleTaskPanel={() => setShowTaskPanel((s) => !s)}
              worktreeMode={activeThread?.worktreeMode}
              isGitRepo={activeThread?.isGitRepo}
              hasMessages={messages.length > 0}
              onWorktreeModeChange={handleWorktreeModeChange}
            />

            {/* Chat messages */}
            <ChatView
              messages={messages}
              isStreaming={isStreaming}
              onLinkClick={openUrl}
              onSendMessage={(prompt) => handleSend(prompt)}
              onQuestionAnswer={respondQuestion}
              onPlanReviewDecision={respondPlanReview}
              onViewPlan={openMarkdown}
              onUpdateTaskExpanded={updateTaskExpanded}
              todoData={latestTodoData}
              showTaskPanel={showTaskPanel}
              onToggleTaskPanel={() => setShowTaskPanel((s) => !s)}
            />

            {/* Input */}
            <InputBar
              key={activeThreadId}
              ref={inputRef}
              onSend={handleSend}
              onInterrupt={interrupt}
              isStreaming={isStreaming}
              interactiveMode={interactiveMode}
              onInteractiveResponse={handleInteractiveResponse}
              slashCommands={slashCommands}
            />

            {/* Toolbar: provider + model + mode */}
            <div className="flex-shrink-0 bg-[#0f0f0f] px-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ProviderToggle
                    provider={(activeThread?.provider as 'claude-code' | 'codex') ?? pendingProvider}
                    onProviderChange={handleProviderChange}
                    disabled={isStreaming}
                  />
                  <span className="text-xs text-gray-700">|</span>
                  <ModelSelector
                    selectedModel={activeThread?.model}
                    onModelChange={handleModelChange}
                    thinkingEffort={activeThread?.thinkingEffort}
                    onThinkingEffortChange={handleThinkingEffortChange}
                    onFetchModels={() => window.api.getAvailableModels(
                      (activeThread?.provider as string) ?? pendingProvider
                    )}
                    isOpen={modelPickerOpen}
                    onOpenChange={setModelPickerOpen}
                  />
                </div>
                <ModeToggle
                  mode={activeThread?.mode ? normalizeMode(activeThread.mode) : pendingMode}
                  onModeChange={handleModeChange}
                  disabled={isStreaming}
                />
              </div>
            </div>
          </div>
        </Panel>

        {preview.isOpen && (
          <>
            <Separator className="w-1.5 bg-[#1a1a1a] hover:bg-blue-600 transition-colors cursor-col-resize" />
            <Panel defaultSize={30} minSize={20}>
              <PreviewPane preview={preview} onClose={closePreview} />
            </Panel>
          </>
        )}
      </Group>

      {/* Permission dialog */}
      {permissionRequest && (
        <PermissionDialog request={permissionRequest} onRespond={respondPermission} />
      )}

      {/* Claude connect dialog */}
      <ConnectClaudeDialog
        isOpen={showClaudeDialog}
        isConnected={claude.isConnected}
        cliInstalled={claude.cliInstalled}
        email={claude.email}
        subscriptionType={claude.subscriptionType}
        loading={claude.loading}
        error={claude.error}
        onClose={() => setShowClaudeDialog(false)}
        onConnect={claude.connect}
        onDisconnect={claude.disconnect}
      />

      {/* GitHub connect dialog */}
      <ConnectGitHubDialog
        isOpen={showGitHubDialog}
        isConnected={github.isConnected}
        cliInstalled={github.cliInstalled}
        username={github.username}
        displayName={github.displayName}
        organizations={github.organizations}
        loading={github.loading}
        error={github.error}
        onClose={() => setShowGitHubDialog(false)}
        onConnect={github.connect}
        onDisconnect={github.disconnect}
      />

      {/* Settings dialog */}
      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
      />
    </div>
  )
}

export type AgentMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

/** Normalize legacy 'execute' values from stored threads */
export function normalizeMode(mode: string | undefined): AgentMode {
  if (!mode || mode === 'execute') return 'default'
  if (['plan', 'default', 'acceptEdits', 'bypassPermissions'].includes(mode))
    return mode as AgentMode
  return 'default'
}

export interface StoredImageAttachment {
  id: string
  name: string
  dataUrl: string
  mimeType: string
}

export interface ThreadWorktree {
  path: string
  branch: string
  sourceRepoPath: string
}

export interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  model?: string
  cwd?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'max'
  mode?: AgentMode
  additionalCwds?: string[]
  sessionId?: string
  isGitRepo?: boolean
  worktreeMode?: 'local' | 'worktree'
  worktree?: ThreadWorktree
  sessionTools?: string[]
}

export interface WorktreeProgressStep {
  step: string
  status: 'running' | 'completed' | 'error'
}

export interface WorktreeProgressData {
  steps: WorktreeProgressStep[]
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  toolCalls?: StoredToolCall[]
  taskInfo?: unknown
  cost?: number
  usage?: { inputTokens: number; outputTokens: number }
  contextWindow?: number
  thinking?: string
  modeChange?: AgentMode
  questionData?: unknown
  questionAnswered?: boolean
  planReviewData?: unknown
  todoData?: unknown
  worktreeProgress?: WorktreeProgressData
  images?: StoredImageAttachment[]
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | null
}

export interface StoredToolCall {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'completed' | 'denied'
}

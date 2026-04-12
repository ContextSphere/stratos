export type AgentMode =
  | "plan"
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "fullAccess";

/** Normalize legacy and provider-specific stored mode values */
export function normalizeMode(
  mode: string | undefined,
  provider?: ProviderType,
): AgentMode {
  if (!mode || mode === "execute") return "default";
  if (provider === "codex") {
    if (mode === "acceptEdits") return "default";
    if (mode === "bypassPermissions") return "fullAccess";
  }
  if (
    [
      "plan",
      "default",
      "acceptEdits",
      "bypassPermissions",
      "fullAccess",
    ].includes(mode)
  ) {
    return mode as AgentMode;
  }
  return "default";
}

export interface StoredImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface StoredFileAttachment {
  id: string;
  name: string;
  path: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  isGitRepo?: boolean;
  collapsed?: boolean;
  createdAt: number;
}

export interface ThreadWorktree {
  path: string;
  branch: string;
  sourceRepoPath: string;
}

/** Supported provider identifiers */
export type ProviderType = "claude-code" | "codex" | "opencode";

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Provider backend for this thread (default: 'claude-code') */
  provider?: ProviderType;
  model?: string;
  cwd?: string;
  thinkingEffort?: "low" | "medium" | "high" | "max";
  mode?: AgentMode;
  additionalCwds?: string[];
  sessionId?: string;
  isGitRepo?: boolean;
  worktreeMode?: "local" | "worktree";
  worktree?: ThreadWorktree;
  sessionTools?: string[];
}

export interface WorktreeProgressStep {
  step: string;
  status: "running" | "completed" | "error";
}

export interface WorktreeProgressData {
  steps: WorktreeProgressStep[];
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: StoredToolCall[];
  taskInfo?: unknown;
  cost?: number;
  usage?: { inputTokens: number; outputTokens: number };
  contextWindow?: number;
  thinking?: string;
  modeChange?: AgentMode;
  questionData?: unknown;
  questionAnswered?: boolean;
  planReviewData?: unknown;
  todoData?: unknown;
  worktreeProgress?: WorktreeProgressData;
  images?: StoredImageAttachment[];
  fileAttachments?: StoredFileAttachment[];
  stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | null;
}

export interface StoredToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "completed" | "denied";
}

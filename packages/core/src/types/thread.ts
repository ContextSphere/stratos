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
  /** If this thread was created by a scheduled prompt, its ID */
  scheduledPromptId?: string;
  /** True if this is the Manager Agent's singleton thread (pinned, non-deletable) */
  isManagerThread?: boolean;
  /** Who created this thread. "manager" means it was spawned via the
   * Manager Agent's create_session MCP tool; used to auto-report completion
   * back to the manager. */
  spawnedBy?: "manager";
  /** True once a completion notification has been dispatched to the Manager
   * Agent for this thread. Prevents duplicate notifications on restart.
   * @deprecated Use lastReportedRunId for per-run deduplication instead. */
  reportedToManager?: boolean;
  /** Unique ID of the most recent stream run. Set at stream start so a crash
   * mid-run still leaves a lastRunId that differs from lastReportedRunId,
   * enabling reconcile-on-startup to re-queue the missed notification. */
  lastRunId?: string;
  /** The lastRunId whose completion notification was successfully enqueued.
   * When lastRunId === lastReportedRunId the notification was already sent. */
  lastReportedRunId?: string;
  /** Final status of the last completed stream — persisted so the UI can show
   * a completion indicator after reload without relying on transient state. */
  lastCompletionStatus?: "completed" | "error" | "interrupted";
  /** Error message from the last failed stream (only when lastCompletionStatus === "error"). */
  lastCompletionError?: string;
}

export interface WorktreeProgressStep {
  step: string;
  status: "running" | "completed" | "error";
}

export interface WorktreeProgressData {
  steps: WorktreeProgressStep[];
}

export interface TaskNotification {
  taskId: string;
  toolUseId?: string;
  /** "event" is used for Monitor intermediate stdout events (not a final status) */
  status: "completed" | "failed" | "stopped" | "event";
  summary: string;
  outputFile?: string;
  /** Stdout line emitted by a Monitor tool event (only present when status === "event") */
  event?: string;
}

/** Notification injected into the Manager chat when one of its spawned
 * sessions finishes. Rendered as a compact status card instead of a
 * plain user bubble. */
export interface SessionCompleteNotification {
  threadId: string;
  title: string;
  provider: string;
  status: "completed" | "error" | "interrupted";
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: StoredToolCall[];
  taskInfo?: unknown;
  taskNotification?: TaskNotification;
  sessionCompleteNotification?: SessionCompleteNotification;
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
  monitorTaskId?: string;
  monitorEvents?: string[];
}

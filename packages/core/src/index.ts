// Types
export type {
  Thread,
  Folder,
  StoredMessage,
  StoredToolCall,
  AgentMode,
  ProviderType,
  ThreadWorktree,
  WorktreeProgressStep,
  WorktreeProgressData,
  StoredImageAttachment,
  StoredFileAttachment,
  SessionCompleteNotification,
  TaskNotification,
} from "./types/thread";
export type {
  ScheduledPrompt,
  ScheduleConfig,
  ScheduleType,
  RecurringInterval,
  ScheduleRunRecord,
  ScheduleNotifyMode,
} from "./types/scheduled-prompt";
export { scheduleToCron, scheduleToHuman } from "./types/scheduled-prompt";
export { normalizeMode } from "./types/thread";
export type { ModeConfig } from "./types/mode";
export { MODE_CONFIGS, AGENT_MODES } from "./types/mode";

// Providers
export type {
  AgentProvider,
  AgentMessage,
  ProviderConfig,
  SendMessageParams,
  AgentDefinition,
  PermissionHandler,
  PermissionUpdate,
  TokenUsage,
  ModelInfo,
  TodoItem,
  McpServerInfo,
  McpElicitationRequest,
  OpencodeCustomProvider,
  ContextUsage,
  ContextUsageCategory,
} from "./providers/types";
export { READ_ONLY_TOOLS } from "./providers/types";
export { ClaudeCodeProvider } from "./providers/claude-code.provider";
export { CodexProvider } from "./providers/codex.provider";
export { OpencodeProvider } from "./providers/opencode.provider";
export { createProvider, getAvailableProviders } from "./providers/index";

// Storage
export type { StorageAdapter } from "./storage/types";
export { FileStorageAdapter } from "./storage/file-adapter";
export {
  parseSessionCompleteNotification,
  parseTaskNotification,
} from "./storage/sdk-transcript";
export type { TraceEntry } from "./storage/trace.store";
export {
  appendTraceEntry,
  readTraceEntries,
  clearTraceFile,
  flushTraceQueue,
  truncateForTrace,
} from "./storage/trace.store";

// Scheduled prompts
export {
  loadScheduledPrompts,
  saveScheduledPrompts,
  addScheduledPrompt,
  updateScheduledPrompt,
  deleteScheduledPrompt,
  getScheduledPrompt,
} from "./storage/scheduled-prompts.store";
export {
  loadScheduleRuns,
  appendScheduleRun,
  listScheduleRuns,
} from "./storage/schedule-runs.store";

// Loop wakeups (host-side equivalent of the bundled CLI's ScheduleWakeup
// in-memory poller — see WakeupManager in @stratosapp/desktop)
export type { LoopWakeup } from "./types/loop-wakeup";
export {
  MIN_LOOP_DELAY_SECONDS,
  MAX_LOOP_DELAY_SECONDS,
  clampLoopDelaySeconds,
} from "./types/loop-wakeup";
export {
  loadLoopWakeups,
  saveLoopWakeups,
  addLoopWakeup,
  deleteLoopWakeup,
  deleteLoopWakeupsForThread,
} from "./storage/loop-wakeups.store";

// Utils
export type { WorktreeInfo } from "./utils/worktree";
export {
  detectWorktreeRoot,
  deriveHash,
  derivePort,
  getWorktreeInfo,
} from "./utils/worktree";

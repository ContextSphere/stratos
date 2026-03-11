import type { AgentMode } from "@stratosapp/core";

export type {
  Thread,
  StoredMessage,
  StoredToolCall,
  StoredImageAttachment,
  AgentMode,
} from "@stratosapp/core";

export interface AskUserQuestionRequest {
  requestId: string;
  input: {
    questions: Array<{
      question: string;
      header?: string;
      options: Array<{ label: string; description?: string }>;
      multiSelect: boolean;
    }>;
  };
}

export interface PlanReviewRequest {
  requestId: string;
  input: { allowedPrompts?: Array<{ tool: string; prompt: string }> };
  planContent?: string;
  planTitle?: string;
  responded?: boolean;
}

export interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TodoData {
  todos: TodoItem[];
}

export interface WorktreeProgressStep {
  step: string;
  status: "running" | "completed" | "error";
}

export interface WorktreeProgressData {
  steps: WorktreeProgressStep[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  taskInfo?: TaskInfo;
  cost?: number;
  usage?: { inputTokens: number; outputTokens: number };
  contextWindow?: number;
  thinking?: string;
  questionData?: AskUserQuestionRequest;
  questionAnswered?: boolean;
  planReviewData?: PlanReviewRequest;
  todoData?: TodoData;
  worktreeProgress?: WorktreeProgressData;
  modeChange?: AgentMode;
  images?: ImageAttachment[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "completed" | "denied";
}

export interface TaskInfo {
  taskId: string;
  subagentType: string;
  description: string;
  prompt: string;
  status: "running" | "completed" | "error";
  childToolCalls: string[];
  startTime: number;
  endTime?: number;
  result?: string;
  toolCallsExpanded?: boolean;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  threadId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suggestions?: any[];
  decisionReason?: string;
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsReasoning?: boolean;
}

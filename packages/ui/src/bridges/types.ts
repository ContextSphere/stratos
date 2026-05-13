import type {
  Thread,
  StoredMessage,
  AgentMode,
  ContextUsage,
} from "@stratosapp/core";
import type { ModelInfo } from "../types";

export type { ContextUsage } from "@stratosapp/core";

export interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface McpServerInfo {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  scope?: string;
  configPath?: string;
  tools: string[];
  error?: string;
  configType?: string;
  configId?: string;
}

export interface ChatBridge {
  sendMessage(
    threadId: string,
    prompt: string,
    images?: ImageAttachment[],
    sessionId?: string,
  ): void;
  interrupt(threadId?: string): void;
  respondPermission(
    requestId: string,
    approved: boolean,
    updatedPermissions?: unknown[],
  ): void;
  respondQuestion(requestId: string, answers: Record<string, string>): void;
  respondPlanReview(
    requestId: string,
    decision: { type: string; feedback?: string },
  ): void;
  onStreamEvent(callback: (event: StreamEvent) => void): () => void;
  getSlashCommands(): Promise<{ name: string; description?: string }[]>;
  getSessionTools(threadId: string): Promise<string[] | null>;
  getMcpServerStatus?(threadId: string): Promise<McpServerInfo[]>;
  toggleMcpServer?(
    threadId: string,
    serverName: string,
    enabled: boolean,
  ): Promise<void>;
  openMcpConfig?(configPath: string): Promise<void>;
  reconnectMcpServer?(threadId: string, serverName: string): Promise<void>;
  getContextUsage?(threadId: string): Promise<ContextUsage | null>;
}

export interface StreamEvent {
  type:
    | "message"
    | "tool_call"
    | "tool_result"
    | "permission_request"
    | "session_init"
    | "result"
    | "error"
    | "thinking"
    | "todo_update"
    | "question"
    | "plan_review"
    | "thread_title"
    | "thread_running"
    | "thread_stopped"
    | "thread_notification";
  threadId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface ThreadBridge {
  list(): Promise<Thread[]>;
  create(
    title?: string,
    model?: string,
    cwd?: string,
    provider?: string,
  ): Promise<Thread>;
  update(threadId: string, updates: Partial<Thread>): Promise<Thread | null>;
  delete(threadId: string): Promise<boolean>;
  loadMessages(threadId: string): Promise<StoredMessage[]>;
  getActive(): Promise<string | null>;
  setActive(threadId: string | null): Promise<void>;
  onThreadActivate?(callback: (data: { threadId: string }) => void): () => void;
}

export interface SettingsBridge {
  getHomeDirectory(): Promise<string>;
  selectDirectory(
    defaultPath?: string,
  ): Promise<{ canceled: boolean; path?: string }>;
  checkIsGitRepo?(path: string): Promise<boolean>;
  getSettings?(): Promise<Record<string, unknown>>;
  updateSettings?(updates: Record<string, unknown>): Promise<void>;
  getAvailableModels?(provider?: string): Promise<ModelInfo[]>;
  onOpenModelPicker?(callback: () => void): () => void;
  onDiagnosticError?(
    callback: (data: {
      title: string;
      message: string;
      context?: Record<string, unknown>;
      stack?: string;
      severity?: "error" | "warning" | "info";
    }) => void,
  ): () => void;
}

export interface PreviewBridge {
  writeArtifactFile?(content: string, path: string): Promise<void>;
  readArtifactFile?(path: string): Promise<string>;
}

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

export type WhatsAppStatus = "connected" | "disconnected" | "qr";

export type ScheduleNotifyMode = "always" | "errors-only" | "never";

export interface WhatsAppBridge {
  getState(): Promise<{
    status: WhatsAppStatus;
    qr: string | null;
    trustedPhone: string;
    notifySchedules: ScheduleNotifyMode;
  }>;
  connect(): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<{ ok: boolean }>;
  saveSettings(s: {
    trustedPhone?: string;
    notifySchedules?: ScheduleNotifyMode;
  }): Promise<{ ok: boolean }>;
  onStatus(cb: (status: WhatsAppStatus) => void): () => void;
  onQr(cb: (qr: string) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
}

export type TelegramStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "error";

export interface TelegramBridge {
  getState(): Promise<{
    status: TelegramStatus;
    botTokenSet: boolean;
    trustedChatId: string;
  }>;
  connect(): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<{ ok: boolean }>;
  saveSettings(s: {
    botToken?: string;
    trustedChatId?: string;
  }): Promise<{ ok: boolean }>;
  onStatus(cb: (status: TelegramStatus) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
}

export interface FileChangeEvent {
  filePath: string;
  content?: string;
  isBinary?: boolean;
  isImage?: boolean;
  tooLarge?: boolean;
  isDeleted?: boolean;
}

export interface ExternalEditor {
  id: string;
  name: string;
}

export interface FilesBridge {
  listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
  readFile(
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean; isImage?: boolean }>;
  writeFile(filePath: string, content: string, rootPath: string): Promise<void>;
  listAllFiles?(cwd: string): Promise<string[]>;
  watchDirectory?(cwd: string): Promise<void>;
  unwatchDirectory?(): Promise<void>;
  onDirectoryChanged?(callback: (dirPath: string) => void): () => void;
  watchFile?(filePath: string, rootPath: string): Promise<void>;
  unwatchFile?(filePath: string): Promise<void>;
  onFileChanged?(callback: (event: FileChangeEvent) => void): () => void;
  getExternalEditors?(): Promise<ExternalEditor[]>;
  openInExternalEditor?(editorId: string, filePath: string): Promise<void>;
  showInFolder?(filePath: string): Promise<void>;
}

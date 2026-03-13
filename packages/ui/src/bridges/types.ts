import type { Thread, StoredMessage, AgentMode } from "@stratosapp/core";

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
  create(title?: string, model?: string, cwd?: string): Promise<Thread>;
  update(threadId: string, updates: Partial<Thread>): Promise<Thread | null>;
  delete(threadId: string): Promise<boolean>;
  loadMessages(threadId: string): Promise<StoredMessage[]>;
  getActive(): Promise<string | null>;
  setActive(threadId: string | null): Promise<void>;
}

export interface SettingsBridge {
  getHomeDirectory(): Promise<string>;
  selectDirectory(): Promise<{ canceled: boolean; path?: string }>;
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

export interface FilesBridge {
  listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
  readFile(
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean }>;
  writeFile(filePath: string, content: string, rootPath: string): Promise<void>;
  listAllFiles?(cwd: string): Promise<string[]>;
  watchDirectory?(cwd: string): Promise<void>;
  unwatchDirectory?(): Promise<void>;
  onDirectoryChanged?(callback: (dirPath: string) => void): () => void;
}

import type { AgentMode } from "../types/thread";
import type { AgentDefinition as SDKAgentDefinition } from "@anthropic-ai/claude-agent-sdk";

/** Read-only tools allowed in plan mode (provider-agnostic) */
export const READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
] as const;

/** Re-export SDK's AgentDefinition for type consistency */
export type AgentDefinition = SDKAgentDefinition;

/**
 * Provider abstraction for AI coding agents.
 * Implement this interface to add support for a new agent backend
 * (e.g., Codex SDK, Cursor CLI).
 */
export interface AgentProvider {
  readonly name: string;

  /** Initialize the provider (validate credentials, etc.) */
  initialize(config: ProviderConfig): Promise<void>;

  /** Send a message and stream normalized responses back */
  sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage>;

  /** Interrupt the current operation */
  interrupt(): Promise<void>;

  /** Check if a previous session can be resumed */
  canResume(sessionId: string): boolean;

  /** Get list of available models from the provider */
  getAvailableModels(): Promise<ModelInfo[]>;

  /** Discover available slash commands without starting a full session */
  discoverSlashCommands(): Promise<{ name: string; description?: string }[]>;

  /** Get MCP server status */
  getMcpServerStatus?(): Promise<McpServerInfo[]>;

  /** Toggle an MCP server on/off */
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;

  /** Reconnect a failed MCP server. Returns authUrl if OAuth is needed. */
  reconnectMcpServer?(serverName: string): Promise<{ authUrl?: string } | void>;

  /** Clean up resources */
  dispose(): Promise<void>;
}

/** Provider-agnostic message types emitted during streaming */
export type AgentMessage =
  | { type: "text"; content: string; isStreaming: boolean }
  | { type: "thinking"; content: string; isStreaming: boolean }
  | {
      type: "plan_update";
      content: string;
      isStreaming: boolean;
      title?: string;
    }
  | {
      type: "tool_use";
      toolName: string;
      input: Record<string, unknown>;
      toolCallId: string;
    }
  | { type: "tool_result"; toolCallId: string; output: string }
  | { type: "todo_update"; todos: TodoItem[] }
  | {
      type: "permission_request";
      toolName: string;
      input: Record<string, unknown>;
      requestId: string;
    }
  | {
      type: "session_init";
      sessionId: string;
      tools: string[];
      slashCommands?: { name: string; description?: string }[];
      mcpServers?: McpServerInfo[];
    }
  | {
      type: "result";
      content: string;
      cost?: number;
      usage?: TokenUsage;
      contextWindow?: number;
      stop_reason?: "end_turn" | "max_tokens" | "stop_sequence" | null;
    }
  | { type: "error"; message: string; code?: string };

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface McpElicitationRequest {
  serverName: string;
  message: string;
  mode?: "form" | "url";
  url?: string;
  elicitationId?: string;
  requestedSchema?: Record<string, unknown>;
}

export interface SendMessageParams {
  prompt: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  additionalDirectories?: string[];
  thinkingEffort?: "low" | "medium" | "high" | "max";
  mode?: AgentMode;
  images?: { dataUrl: string; mimeType: string }[];
  permissionHandler: PermissionHandler;
  /** Optional callback to capture raw SDK trace messages for debugging */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  traceCallback?: (entry: any) => void;
  /** Callback for MCP elicitation (auth/input) requests */
  onElicitation?: (request: McpElicitationRequest) => Promise<{
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  }>;
}

/** Opaque permission update passed through from the SDK */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PermissionUpdate = any;

export type PermissionHandler = (
  toolName: string,
  input: Record<string, unknown>,
  options?: {
    suggestions?: PermissionUpdate[];
    decisionReason?: string;
  },
) => Promise<{
  approved: boolean;
  modifiedInput?: Record<string, unknown>;
  denyMessage?: string;
  updatedPermissions?: PermissionUpdate[];
}>;

export interface ProviderConfig {
  model?: string;
  allowedTools?: string[];
  cwd?: string;
  maxBudgetUsd?: number;
  systemPrompt?:
    | string
    | { type: "preset"; preset: "claude_code"; append?: string };
  /** MCP servers to expose as custom tools to the AI agent. Keys are server names. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpServers?: Record<string, any>;
  /** Setting sources to load (e.g., CLAUDE.md files). */
  settingSources?: ("project" | "user" | "local")[];
  /** Local plugins to load into every agent session */
  plugins?: { type: "local"; path: string }[];
  /** Custom sub-agents that can be invoked via the Task tool */
  agents?: Record<string, AgentDefinition>;
  /** Path to the Claude Code CLI executable (for packaged Electron builds) */
  cliPath?: string;
  /** Codex sandbox policy (default: 'workspace-write') */
  sandboxPolicy?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
}

export interface McpServerInfo {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  scope?: string; // 'project' | 'user' | 'local' | 'claudeai' | 'managed'
  configPath?: string;
  tools: string[];
  error?: string;
  /** Server config type (stdio, sse, http, claudeai-proxy) */
  configType?: string;
  /** For claudeai-proxy servers: the server ID used for auth URL construction */
  configId?: string;
}

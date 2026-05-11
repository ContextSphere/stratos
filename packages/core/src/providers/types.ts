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

  /**
   * Get a breakdown of current context window usage. Returns null if not
   * supported by the underlying agent or if no session is active.
   *
   * Pass `options.sessionId` to probe a session that this provider instance
   * has never run a turn for in the current process — the provider spins up
   * a short-lived resumed query, reads usage, and tears it down. Without an
   * id, the provider uses its own live or parked query.
   */
  getContextUsage?(options?: {
    sessionId?: string;
  }): Promise<ContextUsage | null>;

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
      parentToolUseId?: string;
    }
  | { type: "tool_result"; toolCallId: string; output: string }
  | {
      type: "task_notification";
      taskId: string;
      toolUseId?: string;
      status: "completed" | "failed" | "stopped" | "event";
      summary: string;
      outputFile?: string;
      /** Stdout line from a Monitor event (only when status === "event") */
      event?: string;
    }
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
  /** Opencode-specific configuration */
  opencodeConfig?: {
    /** Per-sub-provider API keys injected via OPENCODE_CONFIG_CONTENT env var */
    providers?: Record<string, { apiKey: string; baseURL?: string }>;
    /** Custom provider definitions (e.g. Ollama) injected into OPENCODE_CONFIG_CONTENT */
    customProviders?: Record<string, OpencodeCustomProvider>;
    /** Port override (default: derived from cwd hash, range 8200–8998) */
    port?: number;
    /** Path to opencode binary (defaults to PATH lookup) */
    binaryPath?: string;
  };
}

/** Full provider definition for opencode providers not in the built-in registry (e.g. Ollama) */
export interface OpencodeCustomProvider {
  id: string;
  name: string;
  /** npm package for the AI SDK adapter (e.g. "@ai-sdk/openai-compatible") */
  npm: string;
  /** Base API URL (e.g. "http://localhost:11434/v1") */
  api: string;
  /** API key (dummy for local providers like Ollama) */
  apiKey?: string;
  /** Model definitions keyed by model ID */
  models: Record<
    string,
    {
      id: string;
      name: string;
      tool_call?: boolean;
      temperature?: boolean;
      reasoning?: boolean;
      /** Vision/image input support */
      attachment?: boolean;
      limit?: { context?: number; output?: number };
    }
  >;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Detailed context window usage breakdown — mirrors what the
 * Claude Code `/context` command displays. Returned by
 * `AgentProvider.getContextUsage()` when supported.
 */
export interface ContextUsageCategory {
  name: string;
  tokens: number;
  color: string;
  isDeferred?: boolean;
}

export interface ContextUsage {
  /** Token count breakdown by category (system prompt, tools, messages, …) */
  categories: ContextUsageCategory[];
  /** Sum of all category tokens currently occupying the window */
  totalTokens: number;
  /** Usable max tokens (e.g. after subtracting output budget) */
  maxTokens: number;
  /** Raw model context window size */
  rawMaxTokens: number;
  /** Current fill percentage (0–100) */
  percentage: number;
  /** Active model identifier */
  model: string;
  /** Auto-compaction threshold (0–1), or undefined if disabled */
  autoCompactThreshold?: number;
  isAutoCompactEnabled: boolean;
  memoryFiles: { path: string; type: string; tokens: number }[];
  mcpTools: {
    name: string;
    serverName: string;
    tokens: number;
    isLoaded?: boolean;
  }[];
  systemPromptSections?: { name: string; tokens: number }[];
  systemTools?: { name: string; tokens: number }[];
  agents: { agentType: string; source: string; tokens: number }[];
  slashCommands?: {
    totalCommands: number;
    includedCommands: number;
    tokens: number;
  };
  skills?: {
    totalSkills: number;
    includedSkills: number;
    tokens: number;
    skillFrontmatter: { name: string; source: string; tokens: number }[];
  };
  messageBreakdown?: {
    toolCallTokens: number;
    toolResultTokens: number;
    attachmentTokens: number;
    assistantMessageTokens: number;
    userMessageTokens: number;
    redirectedContextTokens: number;
    unattributedTokens: number;
  };
  apiUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  } | null;
}

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  /** SDK field (claude-code provider) */
  supportsEffort?: boolean;
  /** Legacy field (codex provider) */
  supportsReasoning?: boolean;
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

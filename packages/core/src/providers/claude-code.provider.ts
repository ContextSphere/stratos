import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  TokenUsage,
  ModelInfo,
  McpServerInfo,
  TodoItem,
} from "./types";
import { MODE_CONFIGS } from "../types/mode";
import { parseTaskNotification as parseTaskNotificationText } from "../storage/sdk-transcript";

/**
 * Use all default Claude Code tools (including deferred ones like
 * EnterPlanMode, ExitPlanMode, AskUserQuestion, NotebookEdit, etc.).
 * The SDK's deferred-tools system handles which tools are presented
 * to the model upfront vs discovered via ToolSearch at runtime.
 */
const DEFAULT_TOOLS: ToolsOption = { type: "preset", preset: "claude_code" };

type ToolsOption = string[] | { type: "preset"; preset: "claude_code" };

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = "claude-code";
  private config: ProviderConfig = {};
  private sessionId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private currentQuery?: any;
  // Background control query kept alive for MCP operations between turns
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private controlQuery?: any;
  private controlCleanup?: () => void;
  // Stored from the last sendMessage call so the control query can handle
  // MCP auth elicitations between turns
  private lastElicitationHandler?: SendMessageParams["onElicitation"];

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // Store elicitation handler for use by the control query between turns
    if (params.onElicitation) {
      this.lastElicitationHandler = params.onElicitation;
    }

    const hasMcpServers =
      this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0;
    const mode = params.mode ?? "default";
    const modeConfig = MODE_CONFIGS[mode];
    // Always use the full tool preset so tools remain available after
    // plan mode exits (the SDK continues the same session). The SDK's
    // permissionMode:'plan' blocks execution during planning; after
    // ExitPlanMode is approved the SDK switches out of plan mode internally.
    const tools: ToolsOption = this.config.allowedTools
      ? [...this.config.allowedTools]
      : DEFAULT_TOOLS;

    const isBypass = mode === "bypassPermissions";
    const cliPath = this.config.cliPath;

    const options = {
      tools,
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      ...((params.model ?? this.config.model)
        ? { model: params.model ?? this.config.model }
        : {}),
      cwd: params.cwd ?? this.config.cwd ?? process.env.HOME,
      ...(params.additionalDirectories?.length
        ? { additionalDirectories: params.additionalDirectories }
        : {}),
      // Opus 4.7 changed the default display to "omitted" (empty thinking field).
      // Explicitly request "summarized" so thinking blocks have content on all models.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: "adaptive", display: "summarized" } as any,
      ...(params.thinkingEffort ? { effort: params.thinkingEffort } : {}),
      includePartialMessages: true,
      ...(this.config.maxBudgetUsd
        ? { maxBudgetUsd: this.config.maxBudgetUsd }
        : {}),
      ...(this.config.systemPrompt
        ? { systemPrompt: this.config.systemPrompt }
        : {}),
      ...(this.config.settingSources
        ? { settingSources: this.config.settingSources }
        : {}),
      ...(params.sessionId ? { resume: params.sessionId } : {}),
      ...(hasMcpServers ? { mcpServers: this.config.mcpServers } : {}),
      ...(this.config.plugins?.length ? { plugins: this.config.plugins } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(this.config.agents ? { agents: this.config.agents as any } : {}),
      permissionMode: modeConfig.sdkPermissionMode as
        | "plan"
        | "default"
        | "acceptEdits"
        | "bypassPermissions",
      ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
      ...(params.onElicitation
        ? {
            onElicitation: (async (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              request: any,
            ) => {
              return params.onElicitation!({
                serverName: request.serverName,
                message: request.message,
                mode: request.mode,
                url: request.url,
                elicitationId: request.elicitationId,
                requestedSchema: request.requestedSchema,
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any,
          }
        : {}),
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        sdkOptions: {
          signal: AbortSignal;
          suggestions?: unknown[];
          decisionReason?: string;
          toolUseID: string;
          agentID?: string;
        },
      ) => {
        const result = await params.permissionHandler(toolName, input, {
          suggestions: sdkOptions.suggestions,
          decisionReason: sdkOptions.decisionReason,
        });
        if (result.approved) {
          return {
            behavior: "allow" as const,
            updatedInput: result.modifiedInput ?? input,
            ...(result.updatedPermissions
              ? { updatedPermissions: result.updatedPermissions }
              : {}),
          };
        }
        return {
          behavior: "deny" as const,
          message: result.denyMessage ?? "User denied tool execution",
        };
      },
    };

    const hasImages = params.images && params.images.length > 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messageContent: string | any[];
    if (hasImages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = [];
      if (params.prompt) {
        blocks.push({ type: "text", text: params.prompt });
      }
      for (const img of params.images!) {
        const base64 = img.dataUrl.replace(/^data:[^;]+;base64,/, "");
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: img.mimeType, data: base64 },
        });
      }
      messageContent = blocks;
    } else {
      messageContent = params.prompt;
    }

    // Close the background control query before starting a new turn
    this.closeControlQuery();

    if (hasMcpServers || hasImages) {
      async function* streamingPrompt() {
        yield {
          type: "user" as const,
          message: { role: "user" as const, content: messageContent },
          parent_tool_use_id: null,
          session_id: "",
        };
      }
      this.currentQuery = query({ prompt: streamingPrompt(), options });
    } else {
      this.currentQuery = query({ prompt: params.prompt, options });
    }

    // Per-stream tracking state — kept local so concurrent calls on the same
    // provider instance don't corrupt each other's streaming flags.
    const streamCtx = {
      textWasStreamed: false,
      thinkingWasStreamed: false,
      pendingToolIds: new Map<number, string>(),
    };

    for await (const msg of this.currentQuery) {
      if (params.traceCallback) {
        params.traceCallback({
          timestamp: Date.now(),
          sessionId: this.sessionId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messageUuid: (msg as any).uuid,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parentToolUseId: (msg as any).parent_tool_use_id,
          messageType: msg.type,
          data: msg,
        });
      }
      yield* this.transformMessage(msg, streamCtx);
    }

    // The turn is done — the query's transport is now closed.
    // Clear currentQuery so mcpQuery falls through to controlQuery.
    this.currentQuery = undefined;

    // Spin up a lightweight control query so that MCP operations (toggle,
    // reconnect, status) remain functional between turns.
    this.ensureControlQuery();
  }

  /**
   * Spin up a background control query that keeps the SDK transport alive
   * for MCP operations between conversation turns.
   */
  private ensureControlQuery(): void {
    // Close any prior control query
    this.closeControlQuery();

    if (!this.sessionId) return;

    const cliPath = this.config.cliPath;
    const hasMcpServers =
      this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0;

    let resolveParked: (() => void) | undefined;
    const cleanup = () => {
      resolveParked?.();
    };

    // eslint-disable-next-line require-yield
    async function* parkedPrompt() {
      // Never yield a real message — just park forever
      await new Promise<void>((resolve) => {
        resolveParked = resolve;
      });
    }

    // Build elicitation handler wrapper if we have one stored
    const elicitationHandler = this.lastElicitationHandler;

    const controlQ = query({
      prompt: parkedPrompt(),
      options: {
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        ...(this.config.model ? { model: this.config.model } : {}),
        cwd: this.config.cwd ?? process.env.HOME,
        resume: this.sessionId,
        permissionMode: "plan" as const,
        ...(hasMcpServers ? { mcpServers: this.config.mcpServers } : {}),
        ...(this.config.settingSources
          ? { settingSources: this.config.settingSources }
          : {}),
        ...(elicitationHandler
          ? {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onElicitation: (async (request: any) => {
                return elicitationHandler({
                  serverName: request.serverName,
                  message: request.message,
                  mode: request.mode,
                  url: request.url,
                  elicitationId: request.elicitationId,
                  requestedSchema: request.requestedSchema,
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              }) as any,
            }
          : {}),
      },
    });

    this.controlQuery = controlQ;
    this.controlCleanup = cleanup;

    // Drain the control query in the background (it should produce no
    // meaningful messages; we just need the transport alive).
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _msg of controlQ) {
          // discard
        }
      } catch {
        // control query closed, expected
      }
    })();
  }

  private closeControlQuery(): void {
    if (this.controlCleanup) {
      this.controlCleanup();
      this.controlCleanup = undefined;
    }
    if (this.controlQuery && typeof this.controlQuery.close === "function") {
      this.controlQuery.close();
    }
    this.controlQuery = undefined;
  }

  /**
   * Returns the best available query for MCP operations:
   * the active currentQuery during a turn, or the background controlQuery
   * between turns.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get mcpQuery(): any {
    return this.currentQuery ?? this.controlQuery;
  }

  async interrupt(): Promise<void> {
    if (
      this.currentQuery &&
      typeof this.currentQuery.interrupt === "function"
    ) {
      await this.currentQuery.interrupt();
    }
  }

  canResume(sessionId: string): boolean {
    return this.sessionId === sessionId;
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    const cliPath = this.config.cliPath;
    const q = query({
      prompt: "init",
      options: {
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        ...(this.config.model ? { model: this.config.model } : {}),
        permissionMode: "plan" as const,
      },
    });

    try {
      return await q.supportedModels();
    } finally {
      if (typeof q.close === "function") {
        q.close();
      }
    }
  }

  async discoverSlashCommands(): Promise<
    { name: string; description?: string }[]
  > {
    const cliPath = this.config.cliPath;
    const q = query({
      prompt: "init",
      options: {
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        model: "claude-haiku-4-5-20251001",
        permissionMode: "plan" as const,
        maxTurns: 0,
        ...(this.config.plugins?.length
          ? { plugins: this.config.plugins }
          : {}),
      },
    });

    const commands: { name: string; description?: string }[] = [];
    try {
      for await (const msg of q) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = msg as any;
        if (m.type === "system" && m.subtype === "init") {
          const slashCommands = m.slash_commands;
          if (Array.isArray(slashCommands)) {
            for (const cmd of slashCommands) {
              const name =
                typeof cmd === "string"
                  ? cmd.startsWith("/")
                    ? cmd
                    : `/${cmd}`
                  : String(cmd);
              commands.push({ name });
            }
          }
          break;
        }
      }
    } finally {
      if (
        typeof (q as ReturnType<typeof query> & { close?: () => void })
          .close === "function"
      ) {
        (q as ReturnType<typeof query> & { close: () => void }).close();
      }
    }
    return commands;
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    const q = this.mcpQuery;
    if (!q || typeof q.mcpServerStatus !== "function") {
      return [];
    }
    const statuses = await q.mcpServerStatus();
    return statuses.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        name: s.name,
        status: s.status as McpServerInfo["status"],
        scope: s.scope,
        tools: s.tools?.map((t: { name: string }) => t.name ?? t) ?? [],
        error: s.error,
        configType: s.config?.type,
        configId: s.config?.id,
      }),
    );
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    const q = this.mcpQuery;
    if (!q || typeof q.toggleMcpServer !== "function") {
      console.warn(
        `[MCP] toggleMcpServer: no query available for MCP operations`,
      );
      return;
    }
    await q.toggleMcpServer(serverName, enabled);
  }

  async reconnectMcpServer(
    serverName: string,
  ): Promise<{ authUrl?: string } | void> {
    const q = this.mcpQuery;
    if (!q) {
      console.warn(
        `[MCP] reconnectMcpServer: no query available for MCP operations`,
      );
      return;
    }

    // For claudeai-proxy servers, construct the auth URL directly.
    // The SDK's mcpAuthenticate doesn't support claudeai-proxy type.
    const statuses = await this.getMcpServerStatus();
    const server = statuses.find((s) => s.name === serverName);
    if (server?.configType === "claudeai-proxy") {
      // Try to get org info for direct auth URL
      if (server.configId && typeof q.accountInfo === "function") {
        try {
          const account = await q.accountInfo();
          if (account?.organizationUuid) {
            const id = server.configId.startsWith("mcprs")
              ? "mcpsrv" + server.configId.slice(5)
              : server.configId;
            return {
              authUrl: `https://claude.ai/api/organizations/${account.organizationUuid}/mcp/start-auth/${id}`,
            };
          }
        } catch {
          // Fall through to settings page
        }
      }
      return { authUrl: "https://claude.ai/settings/connectors" };
    }

    // For SSE/HTTP servers, use mcpAuthenticate (handles OAuth flows).
    if (typeof q.mcpAuthenticate === "function") {
      try {
        const result = await q.mcpAuthenticate(serverName);
        if (result?.authUrl) {
          return { authUrl: result.authUrl };
        }
        return;
      } catch (err) {
        console.warn(`[MCP] mcpAuthenticate failed, trying reconnect:`, err);
      }
    }

    // Fall back to reconnectMcpServer for failed/disconnected servers.
    if (typeof q.reconnectMcpServer === "function") {
      try {
        await q.reconnectMcpServer(serverName);
      } catch (err) {
        console.warn(`[MCP] reconnectMcpServer failed:`, err);
      }
    }
  }

  async dispose(): Promise<void> {
    await this.interrupt();
    this.closeControlQuery();
    this.sessionId = undefined;
    this.currentQuery = undefined;
  }

  private *transformMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    ctx: {
      textWasStreamed: boolean;
      thinkingWasStreamed: boolean;
      pendingToolIds: Map<number, string>;
    },
  ): Generator<AgentMessage> {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id;
          // Map init mcp_servers to McpServerInfo (basic info without scope)
          const initMcpServers: McpServerInfo[] | undefined =
            msg.mcp_servers?.map((s: { name: string; status: string }) => ({
              name: s.name,
              status: s.status as McpServerInfo["status"],
              tools: [],
            }));
          yield {
            type: "session_init",
            sessionId: msg.session_id,
            tools: msg.tools ?? [],
            slashCommands: msg.slash_commands?.map((cmd: string) => ({
              name: cmd.startsWith("/") ? cmd : `/${cmd}`,
              description: undefined,
            })),
            mcpServers: initMcpServers,
          };
        }
        break;

      case "stream_event": {
        const event = msg.event;
        if (!event) break;
        if (event.type === "message_start") {
          ctx.textWasStreamed = false;
          ctx.thinkingWasStreamed = false;
          ctx.pendingToolIds.clear();
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta?.type === "text_delta" && delta.text) {
            ctx.textWasStreamed = true;
            yield { type: "text", content: delta.text, isStreaming: true };
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            ctx.thinkingWasStreamed = true;
            yield {
              type: "thinking",
              content: delta.thinking,
              isStreaming: true,
            };
          }
        } else if (event.type === "content_block_stop") {
          const index = event.index;
          if (typeof index === "number") {
            const toolId = ctx.pendingToolIds.get(index);
            if (toolId) {
              yield { type: "tool_result", toolCallId: toolId, output: "" };
              ctx.pendingToolIds.delete(index);
            }
          }
        }
        break;
      }

      case "assistant":
        if (msg.error && msg.message?.content) {
          const errorText = msg.message.content
            .filter(
              (b: { type: string; text?: string }) =>
                b.type === "text" && b.text,
            )
            .map((b: { text: string }) => b.text)
            .join("\n");
          if (errorText) {
            yield { type: "error", message: errorText, code: msg.error };
          }
          break;
        }
        if (msg.message?.content) {
          for (
            let blockIndex = 0;
            blockIndex < msg.message.content.length;
            blockIndex++
          ) {
            const block = msg.message.content[blockIndex];
            if (block.type === "thinking" && block.thinking) {
              if (!ctx.thinkingWasStreamed) {
                yield {
                  type: "thinking",
                  content: block.thinking,
                  isStreaming: false,
                };
              }
            } else if ("text" in block && block.text) {
              if (!ctx.textWasStreamed) {
                yield { type: "text", content: block.text, isStreaming: false };
              }
            } else if ("name" in block && block.name === "TodoWrite") {
              const rawTodos = block.input?.todos;
              let todos: TodoItem[] = [];
              if (Array.isArray(rawTodos)) {
                todos = rawTodos;
              } else if (typeof rawTodos === "string") {
                try {
                  const parsed = JSON.parse(rawTodos);
                  if (Array.isArray(parsed)) todos = parsed;
                } catch {
                  // unparseable string — leave todos empty
                }
              }
              yield { type: "todo_update", todos };
            } else if ("name" in block && block.name) {
              const toolId = block.id ?? "";
              if (toolId) {
                ctx.pendingToolIds.set(blockIndex, toolId);
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const parentId = (msg as any).parent_tool_use_id as
                | string
                | undefined;
              yield {
                type: "tool_use",
                toolName: block.name,
                input: block.input ?? {},
                toolCallId: toolId,
                ...(parentId && { parentToolUseId: parentId }),
              };
            }
          }
          ctx.textWasStreamed = false;
          ctx.thinkingWasStreamed = false;
        }
        break;

      case "user": {
        const content = msg.message?.content;
        const isTaskNotificationOrigin =
          msg.origin?.kind === "task-notification";

        // Collect candidate text snippets that might contain task-notification XML
        const textSnippets: string[] = [];
        if (typeof content === "string") {
          textSnippets.push(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const output =
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content ?? "");
              yield {
                type: "tool_result",
                toolCallId: block.tool_use_id,
                output,
              };
            } else if (
              block.type === "text" &&
              typeof block.text === "string"
            ) {
              textSnippets.push(block.text);
            }
          }
        }

        for (const text of textSnippets) {
          if (
            !isTaskNotificationOrigin &&
            !text.includes("<task-notification>")
          )
            continue;
          const notif = parseTaskNotificationText(text);
          if (notif) {
            yield {
              type: "task_notification",
              taskId: notif.taskId,
              toolUseId: notif.toolUseId,
              status: notif.status,
              summary: notif.summary,
              outputFile: notif.outputFile,
            };
            break;
          }
        }
        break;
      }

      case "tool_use_summary":
        if (Array.isArray(msg.preceding_tool_use_ids)) {
          for (const toolId of msg.preceding_tool_use_ids) {
            yield { type: "tool_result", toolCallId: toolId, output: "" };
          }
        }
        break;

      case "result":
        if (msg.is_error || msg.subtype !== "success") {
          const errorMessages = msg.errors?.length
            ? msg.errors.join("\n")
            : (msg.result ?? msg.subtype ?? "Unknown error");
          yield {
            type: "error",
            message: errorMessages,
            code: msg.subtype ?? "AGENT_ERROR",
          };
        }
        {
          const modelUsageEntries = Object.values(msg.modelUsage ?? {});
          const contextWindow =
            modelUsageEntries.length > 0
              ? ((modelUsageEntries[0] as Record<string, unknown>)
                  ?.contextWindow as number | undefined)
              : undefined;
          yield {
            type: "result",
            content: msg.result ?? "",
            cost: msg.total_cost_usd,
            usage: msg.usage
              ? ({
                  inputTokens: msg.usage.input_tokens ?? 0,
                  outputTokens: msg.usage.output_tokens ?? 0,
                } satisfies TokenUsage)
              : undefined,
            contextWindow,
            stop_reason: msg.stop_reason ?? null,
          };
        }
        break;

      default:
        break;
    }
  }
}

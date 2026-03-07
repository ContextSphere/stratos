import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  TokenUsage,
  ModelInfo
} from './types'
import { READ_ONLY_TOOLS } from './types'
import { MODE_CONFIGS } from '../types/mode'

const DEFAULT_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill']

export class ClaudeCodeProvider implements AgentProvider {
  readonly name = 'claude-code'
  private config: ProviderConfig = {}
  private sessionId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private currentQuery?: any
  private textWasStreamed = false
  private thinkingWasStreamed = false
  private pendingToolIds: Map<number, string> = new Map()

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    const hasMcpServers = this.config.mcpServers && Object.keys(this.config.mcpServers).length > 0
    const mode = params.mode ?? 'default'
    const modeConfig = MODE_CONFIGS[mode]
    const isPlanMode = mode === 'plan'

    // `tools` controls built-in tools only. MCP tools from auto-discovered
    // servers (via settingSources) and explicit mcpServers are handled
    // separately by the SDK/CLI.
    const tools = isPlanMode
      ? [...READ_ONLY_TOOLS]
      : [...(this.config.allowedTools ?? DEFAULT_TOOLS)]

    const isBypass = mode === 'bypassPermissions'
    const cliPath = this.config.cliPath

    const options = {
      tools,
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
      ...(params.model ?? this.config.model ? { model: params.model ?? this.config.model } : {}),
      cwd: params.cwd ?? this.config.cwd ?? process.env.HOME,
      ...(params.additionalDirectories?.length ? { additionalDirectories: params.additionalDirectories } : {}),
      thinking: { type: 'adaptive' as const },
      ...(params.thinkingEffort ? { effort: params.thinkingEffort } : {}),
      includePartialMessages: true,
      ...(this.config.maxBudgetUsd ? { maxBudgetUsd: this.config.maxBudgetUsd } : {}),
      ...(this.config.systemPrompt ? { systemPrompt: this.config.systemPrompt } : {}),
      ...(this.config.settingSources ? { settingSources: this.config.settingSources } : {}),
      ...(params.sessionId ? { resume: params.sessionId } : {}),
      ...(hasMcpServers ? { mcpServers: this.config.mcpServers } : {}),
      ...(this.config.plugins?.length ? { plugins: this.config.plugins } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(this.config.agents ? { agents: this.config.agents as any } : {}),
      permissionMode: modeConfig.sdkPermissionMode as
        'plan' | 'default' | 'acceptEdits' | 'bypassPermissions',
      ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        const result = await params.permissionHandler(toolName, input)
        if (result.approved) {
          return { behavior: 'allow' as const, updatedInput: result.modifiedInput ?? input }
        }
        return { behavior: 'deny' as const, message: result.denyMessage ?? 'User denied tool execution' }
      }
    }

    const hasImages = params.images && params.images.length > 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messageContent: string | any[]
    if (hasImages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = []
      if (params.prompt) {
        blocks.push({ type: 'text', text: params.prompt })
      }
      for (const img of params.images!) {
        const base64 = img.dataUrl.replace(/^data:[^;]+;base64,/, '')
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: base64 }
        })
      }
      messageContent = blocks
    } else {
      messageContent = params.prompt
    }

    if (hasMcpServers || hasImages) {
      async function* streamingPrompt() {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: messageContent },
          parent_tool_use_id: null,
          session_id: ''
        }
      }
      this.currentQuery = query({ prompt: streamingPrompt(), options })
    } else {
      this.currentQuery = query({ prompt: params.prompt, options })
    }

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
          data: msg
        })
      }
      yield* this.transformMessage(msg)
    }
  }

  async interrupt(): Promise<void> {
    if (this.currentQuery && typeof this.currentQuery.interrupt === 'function') {
      await this.currentQuery.interrupt()
    }
  }

  canResume(sessionId: string): boolean {
    return this.sessionId === sessionId
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    const cliPath = this.config.cliPath
    const q = query({
      prompt: 'init',
      options: {
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        ...(this.config.model ? { model: this.config.model } : {}),
        permissionMode: 'plan' as const
      }
    })

    try {
      return await q.supportedModels()
    } finally {
      if (typeof q.close === 'function') {
        q.close()
      }
    }
  }

  async discoverSlashCommands(): Promise<{ name: string; description?: string }[]> {
    const cliPath = this.config.cliPath
    const q = query({
      prompt: 'init',
      options: {
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        model: 'claude-haiku-4-5-20251001',
        permissionMode: 'plan' as const,
        maxTurns: 0,
        ...(this.config.plugins?.length ? { plugins: this.config.plugins } : {})
      }
    })

    const commands: { name: string; description?: string }[] = []
    try {
      for await (const msg of q) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = msg as any
        if (m.type === 'system' && m.subtype === 'init') {
          const slashCommands = m.slash_commands
          if (Array.isArray(slashCommands)) {
            for (const cmd of slashCommands) {
              const name =
                typeof cmd === 'string'
                  ? cmd.startsWith('/')
                    ? cmd
                    : `/${cmd}`
                  : String(cmd)
              commands.push({ name })
            }
          }
          break
        }
      }
    } finally {
      if (typeof (q as ReturnType<typeof query> & { close?: () => void }).close === 'function') {
        ;(q as ReturnType<typeof query> & { close: () => void }).close()
      }
    }
    return commands
  }

  async dispose(): Promise<void> {
    await this.interrupt()
    this.sessionId = undefined
    this.currentQuery = undefined
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *transformMessage(msg: any): Generator<AgentMessage> {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id
          yield {
            type: 'session_init',
            sessionId: msg.session_id,
            tools: msg.tools ?? [],
            slashCommands: msg.slash_commands?.map((cmd: string) => ({
              name: cmd.startsWith('/') ? cmd : `/${cmd}`,
              description: undefined
            }))
          }
        }
        break

      case 'stream_event': {
        const event = msg.event
        if (!event) break
        if (event.type === 'message_start') {
          this.textWasStreamed = false
          this.thinkingWasStreamed = false
          this.pendingToolIds.clear()
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta?.type === 'text_delta' && delta.text) {
            this.textWasStreamed = true
            yield { type: 'text', content: delta.text, isStreaming: true }
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            this.thinkingWasStreamed = true
            yield { type: 'thinking', content: delta.thinking, isStreaming: true }
          }
        } else if (event.type === 'content_block_stop') {
          const index = event.index
          if (typeof index === 'number') {
            const toolId = this.pendingToolIds.get(index)
            if (toolId) {
              yield { type: 'tool_result', toolCallId: toolId, output: '' }
              this.pendingToolIds.delete(index)
            }
          }
        }
        break
      }

      case 'assistant':
        if (msg.error && msg.message?.content) {
          const errorText = msg.message.content
            .filter((b: { type: string; text?: string }) => b.type === 'text' && b.text)
            .map((b: { text: string }) => b.text)
            .join('\n')
          if (errorText) {
            yield { type: 'error', message: errorText, code: msg.error }
          }
          break
        }
        if (msg.message?.content) {
          for (let blockIndex = 0; blockIndex < msg.message.content.length; blockIndex++) {
            const block = msg.message.content[blockIndex]
            if (block.type === 'thinking' && block.thinking) {
              if (!this.thinkingWasStreamed) {
                yield { type: 'thinking', content: block.thinking, isStreaming: false }
              }
            } else if ('text' in block && block.text) {
              if (!this.textWasStreamed) {
                yield { type: 'text', content: block.text, isStreaming: false }
              }
            } else if ('name' in block && block.name === 'TodoWrite') {
              yield { type: 'todo_update', todos: block.input?.todos ?? [] }
            } else if ('name' in block && block.name) {
              const toolId = block.id ?? ''
              if (toolId) {
                this.pendingToolIds.set(blockIndex, toolId)
              }
              yield {
                type: 'tool_use',
                toolName: block.name,
                input: block.input ?? {},
                toolCallId: toolId
              }
            }
          }
          this.textWasStreamed = false
          this.thinkingWasStreamed = false
        }
        break

      case 'user':
        if (msg.message?.content && Array.isArray(msg.message.content)) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_result') {
              const output =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content ?? '')
              yield { type: 'tool_result', toolCallId: block.tool_use_id, output }
            }
          }
        }
        break

      case 'tool_use_summary':
        if (Array.isArray(msg.preceding_tool_use_ids)) {
          for (const toolId of msg.preceding_tool_use_ids) {
            yield { type: 'tool_result', toolCallId: toolId, output: '' }
          }
        }
        break

      case 'result':
        if (msg.is_error || msg.subtype !== 'success') {
          const errorMessages = msg.errors?.length
            ? msg.errors.join('\n')
            : (msg.result ?? msg.subtype ?? 'Unknown error')
          yield {
            type: 'error',
            message: errorMessages,
            code: msg.subtype ?? 'AGENT_ERROR'
          }
        }
        {
          const modelUsageEntries = Object.values(msg.modelUsage ?? {})
          const contextWindow = modelUsageEntries.length > 0
            ? (modelUsageEntries[0] as Record<string, unknown>)?.contextWindow as number | undefined
            : undefined
          yield {
            type: 'result',
            content: msg.result ?? '',
            cost: msg.total_cost_usd,
            usage: msg.usage
              ? ({
                  inputTokens: msg.usage.input_tokens ?? 0,
                  outputTokens: msg.usage.output_tokens ?? 0
                } satisfies TokenUsage)
              : undefined,
            contextWindow,
            stop_reason: msg.stop_reason ?? null
          }
        }
        break

      default:
        break
    }
  }
}

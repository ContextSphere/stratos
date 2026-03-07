import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo
} from './types'

/**
 * Known Codex-compatible models.
 * The Codex SDK doesn't expose a model discovery API,
 * so we maintain a curated list.
 */
const CODEX_MODELS: ModelInfo[] = [
  {
    value: 'codex-mini-latest',
    displayName: 'Codex Mini',
    description: 'Fast, lightweight coding model'
  },
  {
    value: 'o4-mini',
    displayName: 'o4-mini',
    description: 'Small reasoning model optimized for code'
  },
  {
    value: 'o3',
    displayName: 'o3',
    description: 'Advanced reasoning model'
  },
  {
    value: 'gpt-4.1',
    displayName: 'GPT-4.1',
    description: 'Large language model with coding capabilities'
  },
  {
    value: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    description: 'Smaller, faster variant of GPT-4.1'
  }
]

/**
 * Preserve native import() in CJS output. TypeScript compiles dynamic import()
 * to require() in CommonJS mode, but @openai/codex-sdk is ESM-only.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func, @typescript-eslint/no-explicit-any
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

/**
 * OpenAI Codex provider implementation.
 *
 * Uses @openai/codex-sdk to communicate with the Codex CLI via JSONL
 * over stdin/stdout. Runs with approvalPolicy="never" (all tool calls
 * auto-execute within sandbox) since the SDK doesn't expose approval
 * callbacks. Safety is ensured by the Codex sandbox (default: workspace-write).
 *
 * NOTE: The Codex CLI does not support incremental text streaming. The SDK's
 * `codex exec --experimental-json` protocol only emits `item.completed` events
 * with the full text — no intermediate `item.updated` events for agent_message.
 * Text responses therefore appear all at once. This is a limitation of the
 * Codex SDK, not something we can work around at the provider level.
 */
export class CodexProvider implements AgentProvider {
  readonly name = 'codex'
  private config: ProviderConfig = {}
  private threadId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private codexInstance?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeThread?: any
  private sessionInitSent = false

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // Dynamic import to avoid hard dependency.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let CodexModule: any
    try {
      CodexModule = await dynamicImport('@openai/codex-sdk')
    } catch {
      yield {
        type: 'error',
        message: 'Codex SDK not installed. Run: npm install @openai/codex-sdk',
        code: 'CODEX_SDK_MISSING'
      }
      return
    }

    const Codex = CodexModule.Codex ?? CodexModule.default?.Codex ?? CodexModule.default

    if (!Codex) {
      yield {
        type: 'error',
        message: 'Could not find Codex constructor in @openai/codex-sdk. Check SDK version.',
        code: 'CODEX_SDK_INVALID'
      }
      return
    }

    // Create Codex instance if not already created.
    if (!this.codexInstance) {
      this.codexInstance = new Codex({})
    }

    // Build ThreadOptions — model, sandbox, approval go here, not on the constructor.
    const model = params.model ?? this.config.model
    const sandboxPolicy = this.config.sandboxPolicy ?? 'workspace-write'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const threadOptions: Record<string, any> = {
      approvalPolicy: 'never',
      sandboxMode: sandboxPolicy,
      skipGitRepoCheck: true,
      ...(model ? { model } : {})
    }
    if (params.cwd ?? this.config.cwd) {
      threadOptions.workingDirectory = params.cwd ?? this.config.cwd
    }

    // Start or resume thread
    try {
      if (params.sessionId && !this.activeThread) {
        this.activeThread = this.codexInstance.resumeThread(params.sessionId, threadOptions)
        this.threadId = params.sessionId
      } else if (!this.activeThread) {
        this.activeThread = this.codexInstance.startThread(threadOptions)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Failed to start Codex thread: ${errMsg}`, code: 'CODEX_THREAD_ERROR' }
      return
    }

    const input: string = params.prompt

    // Emit session_init on first message
    if (!this.sessionInitSent) {
      this.threadId = this.threadId ?? `codex_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      this.sessionInitSent = true
      yield {
        type: 'session_init',
        sessionId: this.threadId,
        tools: [],
        slashCommands: []
      }
    }

    // Run and yield events as they arrive.
    // The Codex CLI only emits item.completed (no incremental updates),
    // so text appears all at once — this is a Codex SDK limitation.
    try {
      const streamed = await this.activeThread.runStreamed(input)
      const events = streamed.events ?? streamed

      for await (const event of events) {
        if (params.traceCallback) {
          params.traceCallback({
            timestamp: Date.now(),
            sessionId: this.threadId,
            messageType: event.type,
            data: event
          })
        }

        // Capture thread ID from thread.started event
        if (event.type === 'thread.started' && event.thread_id) {
          this.threadId = event.thread_id
        }

        if (event.type === 'item.completed' && event.item) {
          yield* this.transformItem(event.item)
        } else if (event.type === 'turn.completed') {
          const usage = event.usage
          yield {
            type: 'result',
            content: '',
            ...(usage ? {
              usage: {
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0
              }
            } : {}),
            stop_reason: 'end_turn'
          }
        } else if (event.type === 'turn.failed') {
          yield { type: 'error', message: event.error?.message ?? 'Turn failed', code: 'CODEX_TURN_FAILED' }
        } else if (event.type === 'error') {
          yield { type: 'error', message: event.message ?? 'Unknown error', code: 'CODEX_ERROR' }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: errMsg, code: 'CODEX_STREAM_ERROR' }
    }
  }

  /**
   * Transform a completed Codex item into AgentMessage(s).
   *
   * Item types (snake_case per SDK d.ts):
   *   agent_message, reasoning, command_execution, file_change,
   *   mcp_tool_call, web_search, todo_list, error
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *transformItem(item: any): Generator<AgentMessage> {
    switch (item.type) {
      case 'agent_message': {
        const text = item.text ?? ''
        if (text) {
          yield { type: 'text', content: text, isStreaming: false }
        }
        break
      }

      case 'reasoning': {
        const text = item.text ?? ''
        if (text) {
          yield { type: 'thinking', content: text, isStreaming: false }
        }
        break
      }

      case 'command_execution': {
        const toolCallId = item.id ?? `cmd_${Date.now()}`
        yield {
          type: 'tool_use',
          toolName: 'Bash',
          input: { command: item.command ?? '' },
          toolCallId
        }
        const outputParts: string[] = []
        if (item.aggregated_output) outputParts.push(item.aggregated_output)
        if (item.exit_code !== undefined && item.exit_code !== 0) {
          outputParts.push(`\nExit code: ${item.exit_code}`)
        }
        yield {
          type: 'tool_result',
          toolCallId,
          output: outputParts.join('\n') || (item.status === 'completed' ? '(completed)' : `(${item.status})`)
        }
        break
      }

      case 'file_change': {
        const changes = item.changes ?? []
        for (const change of changes) {
          const toolCallId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const toolName = change.kind === 'add' ? 'Write' : change.kind === 'delete' ? 'Delete' : 'Edit'
          yield {
            type: 'tool_use',
            toolName,
            input: { file_path: change.path ?? '', kind: change.kind ?? 'update' },
            toolCallId
          }
          yield {
            type: 'tool_result',
            toolCallId,
            output: `${change.kind ?? 'update'}: ${change.path ?? ''}`
          }
        }
        break
      }

      case 'mcp_tool_call': {
        const toolCallId = item.id ?? `mcp_${Date.now()}`
        yield {
          type: 'tool_use',
          toolName: `mcp__${item.server}__${item.tool}`,
          input: item.arguments ?? {},
          toolCallId
        }
        let output = ''
        if (item.error) {
          output = item.error.message ?? 'MCP tool call failed'
        } else if (item.result) {
          if (item.result.content && Array.isArray(item.result.content)) {
            output = item.result.content.map((b: { text?: string }) => b.text ?? '').join('\n')
          } else {
            output = JSON.stringify(item.result)
          }
        }
        yield { type: 'tool_result', toolCallId, output: output || `(${item.status})` }
        break
      }

      case 'web_search': {
        const toolCallId = item.id ?? `search_${Date.now()}`
        yield {
          type: 'tool_use',
          toolName: 'WebSearch',
          input: { query: item.query ?? '' },
          toolCallId
        }
        yield { type: 'tool_result', toolCallId, output: 'Search completed' }
        break
      }

      case 'todo_list': {
        const items = item.items ?? []
        if (items.length > 0) {
          const text = items.map((t: { text: string; completed: boolean }) =>
            `${t.completed ? '✅' : '⬜'} ${t.text}`
          ).join('\n')
          yield { type: 'text', content: text, isStreaming: false }
        }
        break
      }

      case 'error': {
        yield { type: 'error', message: item.message ?? 'Unknown item error', code: 'CODEX_ITEM_ERROR' }
        break
      }

      default: {
        const text = item.text ?? item.content ?? item.message
        if (typeof text === 'string' && text) {
          yield { type: 'text', content: text, isStreaming: false }
        }
        break
      }
    }
  }

  async interrupt(): Promise<void> {
    this.activeThread = undefined
    this.codexInstance = undefined
  }

  canResume(sessionId: string): boolean {
    return this.threadId === sessionId
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS
  }

  async discoverSlashCommands(): Promise<{ name: string; description?: string }[]> {
    return []
  }

  async dispose(): Promise<void> {
    this.activeThread = undefined
    this.codexInstance = undefined
    this.threadId = undefined
    this.sessionInitSent = false
  }
}

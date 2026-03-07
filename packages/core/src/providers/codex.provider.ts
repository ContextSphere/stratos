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
 * The SDK is dynamically imported to avoid hard failures when the
 * package isn't installed.
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
  /**
   * Tracks how many characters of text we've already emitted per item ID.
   * Used to compute deltas for streaming: on each item.updated we yield
   * only the new portion of text, not the full accumulated string.
   */
  private emittedTextLengths = new Map<string, number>()

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
    // CodexOptions accepts { config, codexPathOverride, baseUrl, apiKey, env }.
    // config is a CodexConfigObject passed as --config key=value overrides.
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

    // Build input
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

    // Run with streaming
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

        yield* this.transformEvent(event)
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: errMsg, code: 'CODEX_STREAM_ERROR' }
    }
  }

  async interrupt(): Promise<void> {
    // The Codex SDK doesn't expose a direct interrupt method on threads.
    // Disposing and recreating is the safest approach.
    this.activeThread = undefined
    this.codexInstance = undefined
    this.emittedTextLengths.clear()
  }

  canResume(sessionId: string): boolean {
    return this.threadId === sessionId
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS
  }

  async discoverSlashCommands(): Promise<{ name: string; description?: string }[]> {
    // Codex doesn't support slash commands
    return []
  }

  async dispose(): Promise<void> {
    this.activeThread = undefined
    this.codexInstance = undefined
    this.threadId = undefined
    this.sessionInitSent = false
    this.emittedTextLengths.clear()
  }

  /**
   * Transform Codex SDK events into AgentPanel AgentMessage format.
   *
   * SDK event types (from d.ts):
   *   thread.started, turn.started, turn.completed, turn.failed,
   *   item.started, item.updated, item.completed, error
   *
   * SDK item types (snake_case):
   *   agent_message, reasoning, command_execution, file_change,
   *   mcp_tool_call, web_search, todo_list, error
   *
   * Streaming strategy:
   *   For text-bearing items (agent_message, reasoning) we track the emitted
   *   character count per item ID. On item.started / item.updated we yield only
   *   the NEW delta (isStreaming: true). On item.completed we yield any remaining
   *   delta (isStreaming: false) and clean up the tracking entry.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *transformEvent(event: any): Generator<AgentMessage> {
    switch (event.type) {
      case 'item.started':
      case 'item.updated': {
        const item = event.item
        if (!item) break
        yield* this.emitStreamingDelta(item)
        break
      }

      case 'item.completed': {
        const item = event.item
        if (!item) break
        yield* this.emitCompletedItem(item)
        break
      }

      case 'turn.completed': {
        // Clear all tracking state for the turn
        this.emittedTextLengths.clear()
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
        break
      }

      case 'turn.failed': {
        this.emittedTextLengths.clear()
        const errorMsg = event.error?.message ?? 'Turn failed'
        yield { type: 'error', message: errorMsg, code: 'CODEX_TURN_FAILED' }
        break
      }

      case 'error': {
        yield { type: 'error', message: event.message ?? 'Unknown error', code: 'CODEX_ERROR' }
        break
      }

      default:
        // Ignore thread.started, turn.started
        break
    }
  }

  /**
   * Yield a streaming text delta for in-progress items (item.started / item.updated).
   * Only emits for text-bearing types (agent_message, reasoning).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *emitStreamingDelta(item: any): Generator<AgentMessage> {
    if (item.type === 'agent_message') {
      const text = item.text ?? ''
      const id = item.id ?? 'msg'
      const prev = this.emittedTextLengths.get(id) ?? 0
      if (text.length > prev) {
        const delta = text.slice(prev)
        this.emittedTextLengths.set(id, text.length)
        yield { type: 'text', content: delta, isStreaming: true }
      }
    } else if (item.type === 'reasoning') {
      const text = item.text ?? ''
      const id = item.id ?? 'reasoning'
      const prev = this.emittedTextLengths.get(id) ?? 0
      if (text.length > prev) {
        const delta = text.slice(prev)
        this.emittedTextLengths.set(id, text.length)
        yield { type: 'thinking', content: delta, isStreaming: true }
      }
    }
    // For non-text items (command_execution, file_change, etc.)
    // we wait for item.completed to emit them in full.
  }

  /**
   * Yield the final output for a completed item.
   * For text items, emits only the remaining un-emitted delta.
   * For tool items, emits the full tool_use + tool_result.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private *emitCompletedItem(item: any): Generator<AgentMessage> {
    switch (item.type) {
      case 'agent_message': {
        const text = item.text ?? ''
        const id = item.id ?? 'msg'
        const prev = this.emittedTextLengths.get(id) ?? 0
        if (text.length > prev) {
          yield { type: 'text', content: text.slice(prev), isStreaming: false }
        }
        this.emittedTextLengths.delete(id)
        break
      }

      case 'reasoning': {
        const text = item.text ?? ''
        const id = item.id ?? 'reasoning'
        const prev = this.emittedTextLengths.get(id) ?? 0
        if (text.length > prev) {
          yield { type: 'thinking', content: text.slice(prev), isStreaming: false }
        }
        this.emittedTextLengths.delete(id)
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
            input: {
              file_path: change.path ?? '',
              kind: change.kind ?? 'update'
            },
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
            output = item.result.content.map((b: { text?: string; type?: string }) => b.text ?? '').join('\n')
          } else {
            output = JSON.stringify(item.result)
          }
        }
        yield {
          type: 'tool_result',
          toolCallId,
          output: output || `(${item.status})`
        }
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
        yield {
          type: 'tool_result',
          toolCallId,
          output: 'Search completed'
        }
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
}

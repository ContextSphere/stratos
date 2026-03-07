import type {
  AgentProvider,
  AgentMessage,
  SendMessageParams,
  ProviderConfig,
  ModelInfo
} from './types'

import { spawn, type ChildProcess } from 'child_process'
import * as readline from 'readline'
import { createRequire } from 'module'
import * as path from 'path'

/**
 * Known Codex-compatible models.
 * The Codex SDK doesn't expose a model discovery API,
 * so we maintain a curated list. These work with both
 * ChatGPT auth and API key auth.
 */
const CODEX_MODELS: ModelInfo[] = [
  {
    value: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex',
    description: 'Latest frontier agentic coding model'
  },
  {
    value: 'gpt-5.2-codex',
    displayName: 'GPT-5.2 Codex',
    description: 'Advanced agentic coding model'
  },
  {
    value: 'gpt-5.1-codex',
    displayName: 'GPT-5.1 Codex',
    description: 'Agentic coding model with deep reasoning'
  },
  {
    value: 'gpt-5.1-codex-mini',
    displayName: 'GPT-5.1 Codex Mini',
    description: 'Fast, lightweight coding model'
  },
  {
    value: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Latest general-purpose model'
  },
  {
    value: 'gpt-5.2',
    displayName: 'GPT-5.2',
    description: 'General-purpose model with coding capabilities'
  }
]

/**
 * Find the Codex CLI binary shipped with @openai/codex via @openai/codex-sdk.
 * This mirrors the findCodexPath() logic in the SDK itself.
 */
function findCodexBinary(): string {
  const { platform, arch } = process
  let targetTriple: string | null = null
  switch (platform) {
    case 'linux':
    case 'android':
      targetTriple = arch === 'x64' ? 'x86_64-unknown-linux-musl'
        : arch === 'arm64' ? 'aarch64-unknown-linux-musl'
          : null
      break
    case 'darwin':
      targetTriple = arch === 'x64' ? 'x86_64-apple-darwin'
        : arch === 'arm64' ? 'aarch64-apple-darwin'
          : null
      break
    case 'win32':
      targetTriple = arch === 'x64' ? 'x86_64-pc-windows-msvc'
        : arch === 'arm64' ? 'aarch64-pc-windows-msvc'
          : null
      break
  }
  if (!targetTriple) {
    throw new Error(`Unsupported platform: ${platform} (${arch})`)
  }

  const platformPackage: Record<string, string> = {
    'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
    'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
    'x86_64-apple-darwin': '@openai/codex-darwin-x64',
    'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
    'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
    'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
  }

  const pkgName = platformPackage[targetTriple]
  if (!pkgName) {
    throw new Error(`No platform package for: ${targetTriple}`)
  }

  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const binaryRelPath = path.join('vendor', targetTriple, 'codex', binaryName)

  const fs = require('fs') as typeof import('fs')

  // Walk up from multiple starting points looking for the codex binary
  const startDirs = [
    __dirname,
    process.cwd(),
    ...(process.versions?.electron ? [
      (process as any).resourcesPath ?? ''
    ] : [])
  ].filter(Boolean)

  for (const startDir of startDirs) {
    let dir = startDir
    for (let i = 0; i < 10; i++) {
      // Check pnpm hoisted layout: node_modules/.pnpm/@openai+codex@*-<platform>-<arch>/...
      const pnpmDir = path.join(dir, 'node_modules', '.pnpm')
      try {
        const entries = fs.readdirSync(pnpmDir)
        for (const entry of entries) {
          if (entry.startsWith('@openai+codex@') && entry.includes(`-${process.platform}-`)) {
            const candidate = path.join(pnpmDir, entry, 'node_modules', '@openai', 'codex', binaryRelPath)
            if (fs.existsSync(candidate)) return candidate
          }
        }
      } catch {
        // Directory doesn't exist
      }

      // Check direct node_modules layout (npm/yarn)
      const directCandidate = path.join(dir, 'node_modules', '@openai', 'codex', binaryRelPath)
      if (fs.existsSync(directCandidate)) return directCandidate

      // Also check via @openai/codex-sdk symlink chain
      const sdkCodexDir = path.join(dir, 'node_modules', '@openai', 'codex-sdk', 'node_modules', '@openai', 'codex')
      const sdkCandidate = path.join(sdkCodexDir, binaryRelPath)
      if (fs.existsSync(sdkCandidate)) return sdkCandidate

      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  throw new Error(
    'Unable to locate Codex CLI binary. Ensure @openai/codex-sdk is installed with optional dependencies.'
  )
}

/**
 * OpenAI Codex provider implementation.
 *
 * Uses the Codex **app-server** protocol (JSON-RPC over stdio) which supports
 * true token-by-token text streaming via `item/agentMessage/delta` notifications.
 *
 * Protocol flow:
 *   initialize → thread/start → turn/start → listen for notifications
 *
 * The older `codex exec --experimental-json` mode (used by @openai/codex-sdk)
 * does NOT support text streaming — it only emits item.completed with full text.
 * The app-server protocol solves this.
 */
export class CodexProvider implements AgentProvider {
  readonly name = 'codex'
  private config: ProviderConfig = {}
  private threadId?: string
  private appServer?: ChildProcess
  private rl?: readline.Interface
  private rpcId = 0
  private initialized = false
  private sessionInitSent = false
  /** Pending RPC responses keyed by request ID */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingRpc = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  /** Notification queue for streaming events during a turn */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private notificationQueue: Array<{ method: string; params: any }> = []
  /** Resolves when a new notification arrives */
  private notificationResolve?: () => void

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendRpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.appServer?.stdin) {
      return Promise.reject(new Error('App server not running'))
    }
    const id = ++this.rpcId
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    this.appServer.stdin.write(msg + '\n')

    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve, reject })
    })
  }

  /**
   * Start the app-server process if not already running.
   */
  private async ensureAppServer(): Promise<void> {
    if (this.appServer && !this.appServer.killed) return

    const codexPath = findCodexBinary()
    this.appServer = spawn(codexPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    this.appServer.on('exit', () => {
      this.appServer = undefined
      this.initialized = false
      this.threadId = undefined
    })

    // Ignore stderr (logging noise)
    this.appServer.stderr?.resume()

    // Set up line reader for JSONL output
    this.rl = readline.createInterface({
      input: this.appServer.stdout!,
      crlfDelay: Infinity
    })

    this.rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line)

        // JSON-RPC response
        if (msg.id !== undefined && !msg.method) {
          const pending = this.pendingRpc.get(msg.id)
          if (pending) {
            this.pendingRpc.delete(msg.id)
            if (msg.error) {
              pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
            } else {
              pending.resolve(msg.result)
            }
          }
          return
        }

        // JSON-RPC notification
        if (msg.method) {
          this.notificationQueue.push({ method: msg.method, params: msg.params ?? {} })
          if (this.notificationResolve) {
            this.notificationResolve()
            this.notificationResolve = undefined
          }
        }
      } catch {
        // Ignore unparseable lines
      }
    })

    // Initialize the app-server
    if (!this.initialized) {
      await this.sendRpc('initialize', {
        clientInfo: { name: 'agentpanel', title: 'AgentPanel', version: '0.1.0' },
        capabilities: { experimentalApi: false }
      })
      this.initialized = true
    }
  }

  /**
   * Wait for the next notification, or return immediately if one is queued.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async waitForNotification(): Promise<{ method: string; params: any } | null> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift()!
    }
    return new Promise((resolve) => {
      this.notificationResolve = () => {
        if (this.notificationQueue.length > 0) {
          resolve(this.notificationQueue.shift()!)
        } else {
          resolve(null)
        }
      }
    })
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<AgentMessage> {
    // Start app-server if needed
    try {
      await this.ensureAppServer()
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      yield {
        type: 'error',
        message: `Failed to start Codex: ${errMsg}`,
        code: 'CODEX_START_ERROR'
      }
      return
    }

    const model = params.model ?? this.config.model
    const sandboxPolicy = this.config.sandboxPolicy ?? 'workspace-write'

    // Start a new thread if we don't have one
    if (!this.threadId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const threadStartParams: Record<string, any> = {
          approvalPolicy: 'never',
          sandbox: sandboxPolicy,
          experimentalRawEvents: false,
          persistExtendedHistory: false
        }
        if (model) threadStartParams.model = model
        if (params.cwd ?? this.config.cwd) {
          threadStartParams.cwd = params.cwd ?? this.config.cwd
        }

        const result = await this.sendRpc('thread/start', threadStartParams)
        // Thread ID comes from response or from thread/started notification
        this.threadId = result?.thread?.id

        // Drain any notifications emitted during thread start (thread/started, mcp_startup, etc.)
        while (this.notificationQueue.length > 0) {
          const notif = this.notificationQueue.shift()!
          if (notif.method === 'thread/started' && notif.params?.thread?.id) {
            this.threadId = notif.params.thread.id
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        yield { type: 'error', message: `Failed to start thread: ${errMsg}`, code: 'CODEX_THREAD_ERROR' }
        return
      }
    }

    if (!this.threadId) {
      yield { type: 'error', message: 'No thread ID after thread/start', code: 'CODEX_THREAD_ERROR' }
      return
    }

    // Emit session_init on first message
    if (!this.sessionInitSent) {
      this.sessionInitSent = true
      yield {
        type: 'session_init',
        sessionId: this.threadId,
        tools: [],
        slashCommands: []
      }
    }

    // Clear notification queue before starting turn
    this.notificationQueue = []

    // Start a turn
    try {
      await this.sendRpc('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text: params.prompt, text_elements: [] }],
        ...(model ? { model } : {})
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      yield { type: 'error', message: `Failed to start turn: ${errMsg}`, code: 'CODEX_TURN_ERROR' }
      return
    }

    // Listen for notifications until turn completes
    let turnComplete = false
    let streamingText = ''
    let currentItemId: string | undefined

    while (!turnComplete) {
      const notif = await this.waitForNotification()
      if (!notif) continue

      const { method, params: p } = notif

      if (params.traceCallback) {
        params.traceCallback({
          timestamp: Date.now(),
          sessionId: this.threadId,
          messageType: method,
          data: p
        })
      }

      switch (method) {
        // *** Text streaming delta — the key event ***
        case 'item/agentMessage/delta': {
          const delta = p.delta ?? ''
          if (delta) {
            streamingText += delta
            // Send just the delta (not accumulated text) — matches Claude provider contract
            yield {
              type: 'text',
              content: delta,
              isStreaming: true
            }
          }
          break
        }

        // Item lifecycle
        case 'item/started': {
          const item = p.item ?? p
          const itemType = item?.type
          currentItemId = item?.id

          if (itemType === 'agentMessage') {
            // Reset text accumulator for new message
            streamingText = ''
          }
          break
        }

        case 'item/completed': {
          const item = p.item ?? p
          const itemType = item?.type

          switch (itemType) {
            case 'agentMessage': {
              // If we already streamed deltas, just emit empty finalization.
              // If we didn't stream (no deltas received), emit the full text.
              if (streamingText) {
                // Deltas were streamed; UI already has the text. Just finalize.
                yield { type: 'text', content: '', isStreaming: false }
              } else {
                // No deltas were received — emit full text (fallback)
                const finalText = item.text ?? ''
                if (finalText) {
                  yield { type: 'text', content: finalText, isStreaming: false }
                }
              }
              streamingText = ''
              break
            }

            case 'reasoning': {
              const text = item.text ?? ''
              if (text) {
                yield { type: 'thinking', content: text, isStreaming: false }
              }
              break
            }

            case 'commandExecution': {
              const toolCallId = item.id ?? `cmd_${Date.now()}`
              yield {
                type: 'tool_use',
                toolName: 'Bash',
                input: { command: item.command ?? '' },
                toolCallId
              }
              const outputParts: string[] = []
              if (item.aggregatedOutput) outputParts.push(item.aggregatedOutput)
              if (item.exitCode !== undefined && item.exitCode !== 0) {
                outputParts.push(`\nExit code: ${item.exitCode}`)
              }
              yield {
                type: 'tool_result',
                toolCallId,
                output: outputParts.join('\n') || (item.status === 'completed' ? '(completed)' : `(${item.status})`)
              }
              break
            }

            case 'fileChange': {
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

            case 'mcpToolCall': {
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

            case 'webSearch': {
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

            case 'error': {
              yield { type: 'error', message: item.message ?? 'Unknown item error', code: 'CODEX_ITEM_ERROR' }
              break
            }

            default: {
              // todoList or unknown types
              const text = item.text ?? item.content ?? item.message
              if (typeof text === 'string' && text) {
                yield { type: 'text', content: text, isStreaming: false }
              }
              break
            }
          }
          break
        }

        // Reasoning delta streaming
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta': {
          // Could stream reasoning too, but keeping it simple for now
          break
        }

        // Turn lifecycle
        case 'turn/completed': {
          turnComplete = true
          const usage = p.turn?.tokenUsage ?? p.tokenUsage
          yield {
            type: 'result',
            content: '',
            ...(usage ? {
              usage: {
                inputTokens: usage.total?.inputTokens ?? usage.input_tokens ?? 0,
                outputTokens: usage.total?.outputTokens ?? usage.output_tokens ?? 0
              }
            } : {}),
            stop_reason: 'end_turn'
          }
          break
        }

        case 'turn/started':
        case 'thread/started':
        case 'thread/status/changed':
        case 'thread/tokenUsage/updated':
          // Lifecycle events — nothing to emit
          break

        case 'error': {
          yield { type: 'error', message: p.message ?? 'Unknown error', code: 'CODEX_ERROR' }
          turnComplete = true
          break
        }

        default:
          // Ignore other notifications (codex/event/*, mcp/*, etc.)
          break
      }
    }
  }

  async interrupt(): Promise<void> {
    if (this.threadId && this.appServer) {
      try {
        await this.sendRpc('turn/interrupt', { threadId: this.threadId })
      } catch {
        // Ignore errors during interrupt
      }
    }
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
    if (this.rl) {
      this.rl.close()
      this.rl = undefined
    }
    if (this.appServer && !this.appServer.killed) {
      this.appServer.kill()
      this.appServer = undefined
    }
    this.threadId = undefined
    this.sessionInitSent = false
    this.initialized = false
    this.pendingRpc.clear()
    this.notificationQueue = []
  }
}

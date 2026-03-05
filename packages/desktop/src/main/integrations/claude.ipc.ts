import { BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import { IPC_CHANNELS } from '../../common/ipc-channels'

// ── Types ───────────────────────────────────────────────────────────────────

interface ClaudeConnectionInfo {
  connected: boolean
  cliInstalled: boolean
  email: string | null
  subscriptionType: string | null
}

// ── Cached state ────────────────────────────────────────────────────────────

let cachedInfo: ClaudeConnectionInfo = {
  connected: false,
  cliInstalled: false,
  email: null,
  subscriptionType: null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the full path to `claude` — Electron on macOS doesn't inherit the user's $PATH. */
let resolvedClaudePath: string | null = null

function resolveClaudePath(): Promise<string> {
  if (resolvedClaudePath) return Promise.resolve(resolvedClaudePath)

  const home = homedir()
  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    'claude'
  ]

  return new Promise((resolve, reject) => {
    let i = 0
    function tryNext(): void {
      if (i >= candidates.length) {
        reject(new Error('claude CLI not found'))
        return
      }
      const candidate = candidates[i++]
      execFile(candidate, ['--version'], { timeout: 5000 }, (err) => {
        if (!err) {
          resolvedClaudePath = candidate
          resolve(candidate)
        } else {
          tryNext()
        }
      })
    }
    tryNext()
  })
}

function runClaude(args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string }> {
  return new Promise(async (resolve, reject) => {
    let claudePath: string
    try {
      claudePath = await resolveClaudePath()
    } catch (err) {
      reject(err)
      return
    }

    // Strip CLAUDECODE env var to avoid nested session detection
    const env = { ...process.env }
    delete env.CLAUDECODE

    execFile(claudePath, args, { timeout: timeoutMs, env }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

function checkCliInstalled(): Promise<boolean> {
  return resolveClaudePath()
    .then(() => true)
    .catch(() => false)
}

async function checkAuthStatus(): Promise<{ authenticated: boolean; email: string | null; subscriptionType: string | null }> {
  try {
    const { stdout } = await runClaude(['auth', 'status', '--json'])
    const status = JSON.parse(stdout)
    // Actual JSON: { loggedIn: true, email: "...", subscriptionType: "max", ... }
    if (status.loggedIn) {
      return {
        authenticated: true,
        email: status.email ?? null,
        subscriptionType: status.subscriptionType ?? null
      }
    }
    return { authenticated: false, email: null, subscriptionType: null }
  } catch {
    return { authenticated: false, email: null, subscriptionType: null }
  }
}

async function refreshCachedInfo(): Promise<ClaudeConnectionInfo> {
  const installed = await checkCliInstalled()
  if (!installed) {
    cachedInfo = { connected: false, cliInstalled: false, email: null, subscriptionType: null }
    return cachedInfo
  }

  const authStatus = await checkAuthStatus()
  cachedInfo = {
    connected: authStatus.authenticated,
    cliInstalled: true,
    email: authStatus.email,
    subscriptionType: authStatus.subscriptionType
  }

  return cachedInfo
}

function tryRestoreConnection(): void {
  refreshCachedInfo().catch(() => {})
}

// ── Public getter ───────────────────────────────────────────────────────────

export function getClaudeConnectionInfo(): ClaudeConnectionInfo {
  return cachedInfo
}

// ── IPC Registration ────────────────────────────────────────────────────────

export function registerClaudeIpc(_window: BrowserWindow): void {
  tryRestoreConnection()

  ipcMain.handle(IPC_CHANNELS.CLAUDE_CHECK_CLI, async () => {
    const installed = await checkCliInstalled()
    return { installed }
  })

  ipcMain.handle(IPC_CHANNELS.CLAUDE_CONNECT, async () => {
    try {
      const installed = await checkCliInstalled()
      if (!installed) {
        return { ok: false, error: 'Claude CLI is not installed' }
      }

      // Run interactive login — this opens the user's browser
      await runClaude(['auth', 'login'], 120_000)

      const info = await refreshCachedInfo()
      return {
        ok: true,
        email: info.email,
        subscriptionType: info.subscriptionType
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Authentication failed'
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.CLAUDE_DISCONNECT, async () => {
    try {
      await runClaude(['auth', 'logout'], 15_000)
    } catch {
      // Best-effort — may already be logged out
    }
    cachedInfo = { connected: false, cliInstalled: cachedInfo.cliInstalled, email: null, subscriptionType: null }
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.CLAUDE_GET_CONNECTION, async () => {
    await refreshCachedInfo()
    return cachedInfo
  })
}

export function unregisterClaudeIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CLAUDE_CHECK_CLI)
  ipcMain.removeHandler(IPC_CHANNELS.CLAUDE_CONNECT)
  ipcMain.removeHandler(IPC_CHANNELS.CLAUDE_DISCONNECT)
  ipcMain.removeHandler(IPC_CHANNELS.CLAUDE_GET_CONNECTION)
}

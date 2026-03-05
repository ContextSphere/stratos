import { BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { IPC_CHANNELS } from '../../common/ipc-channels'

// ── Types ───────────────────────────────────────────────────────────────────

interface GitHubConnectionInfo {
  connected: boolean
  cliInstalled: boolean
  username: string | null
  displayName: string | null
  organizations: string[]
}

// ── Cached state ────────────────────────────────────────────────────────────

let cachedInfo: GitHubConnectionInfo = {
  connected: false,
  cliInstalled: false,
  username: null,
  displayName: null,
  organizations: []
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the full path to `gh` — Electron on macOS doesn't inherit the user's $PATH. */
let resolvedGhPath: string | null = null

function resolveGhPath(): Promise<string> {
  if (resolvedGhPath) return Promise.resolve(resolvedGhPath)

  const candidates = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', 'gh']

  return new Promise((resolve, reject) => {
    let i = 0
    function tryNext(): void {
      if (i >= candidates.length) {
        reject(new Error('gh CLI not found'))
        return
      }
      const candidate = candidates[i++]
      execFile(candidate, ['--version'], { timeout: 5000 }, (err) => {
        if (!err) {
          resolvedGhPath = candidate
          resolve(candidate)
        } else {
          tryNext()
        }
      })
    }
    tryNext()
  })
}

function runGh(args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string }> {
  return new Promise(async (resolve, reject) => {
    let ghPath: string
    try {
      ghPath = await resolveGhPath()
    } catch (err) {
      reject(err)
      return
    }

    execFile(ghPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

function checkCliInstalled(): Promise<boolean> {
  return resolveGhPath()
    .then(() => true)
    .catch(() => false)
}

async function checkAuthStatus(): Promise<boolean> {
  try {
    await runGh(['auth', 'status'])
    return true
  } catch {
    return false
  }
}

async function fetchUserInfo(): Promise<{
  username: string
  displayName: string | null
  organizations: string[]
}> {
  const { stdout: userJson } = await runGh(['api', 'user'])
  const user = JSON.parse(userJson)

  let organizations: string[] = []
  try {
    const { stdout: orgsJson } = await runGh(['api', 'user/orgs'])
    const orgs = JSON.parse(orgsJson)
    organizations = orgs.map((o: { login: string }) => o.login)
  } catch {
    // Not critical — some tokens lack org scope
  }

  return {
    username: user.login,
    displayName: user.name || null,
    organizations
  }
}

async function refreshCachedInfo(): Promise<GitHubConnectionInfo> {
  const installed = await checkCliInstalled()
  if (!installed) {
    cachedInfo = { connected: false, cliInstalled: false, username: null, displayName: null, organizations: [] }
    return cachedInfo
  }

  const authed = await checkAuthStatus()
  if (!authed) {
    cachedInfo = { connected: false, cliInstalled: true, username: null, displayName: null, organizations: [] }
    return cachedInfo
  }

  try {
    const info = await fetchUserInfo()
    cachedInfo = {
      connected: true,
      cliInstalled: true,
      username: info.username,
      displayName: info.displayName,
      organizations: info.organizations
    }
  } catch {
    cachedInfo = { connected: true, cliInstalled: true, username: null, displayName: null, organizations: [] }
  }

  return cachedInfo
}

function tryRestoreConnection(): void {
  refreshCachedInfo().catch(() => {})
}

// ── Public getter for system prompt builder ─────────────────────────────────

export function getGitHubConnectionInfo(): GitHubConnectionInfo {
  return cachedInfo
}

// ── IPC Registration ────────────────────────────────────────────────────────

export function registerGitHubIpc(_window: BrowserWindow): void {
  tryRestoreConnection()

  ipcMain.handle(IPC_CHANNELS.GITHUB_CHECK_CLI, async () => {
    const installed = await checkCliInstalled()
    return { installed }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_CONNECT, async () => {
    try {
      const installed = await checkCliInstalled()
      if (!installed) {
        return { ok: false, error: 'gh CLI is not installed' }
      }

      // Run interactive login — this opens the user's browser
      await runGh(
        ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'ssh'],
        120_000
      )

      const info = await refreshCachedInfo()
      return {
        ok: true,
        username: info.username,
        displayName: info.displayName,
        organizations: info.organizations
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Authentication failed'
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_DISCONNECT, async () => {
    try {
      await runGh(['auth', 'logout', '--hostname', 'github.com', '--yes'], 15_000)
    } catch {
      // Best-effort — gh may already be logged out
    }
    cachedInfo = { connected: false, cliInstalled: cachedInfo.cliInstalled, username: null, displayName: null, organizations: [] }
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_CONNECTION, async () => {
    await refreshCachedInfo()
    return cachedInfo
  })

  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, async (_event, owner: string) => {
    try {
      const { stdout } = await runGh(
        ['repo', 'list', owner, '--json', 'name,description,isPrivate,url', '--limit', '200'],
        30_000
      )
      const repos = JSON.parse(stdout)
      return { ok: true, repos }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to list repositories'
      }
    }
  })
}

export function unregisterGitHubIpc(): void {
  ipcMain.removeHandler(IPC_CHANNELS.GITHUB_CHECK_CLI)
  ipcMain.removeHandler(IPC_CHANNELS.GITHUB_CONNECT)
  ipcMain.removeHandler(IPC_CHANNELS.GITHUB_DISCONNECT)
  ipcMain.removeHandler(IPC_CHANNELS.GITHUB_GET_CONNECTION)
  ipcMain.removeHandler(IPC_CHANNELS.GITHUB_LIST_REPOS)
}

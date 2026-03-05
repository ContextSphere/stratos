import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { mkdirSync } from 'fs'
import { basename, join } from 'path'
import { homedir } from 'os'

export interface WorktreeInfo {
  /** Absolute path to the git worktree root */
  root: string
  /** Short hash derived from the worktree root path */
  hash: string
  /** Human-readable name (basename of the worktree directory) */
  name: string
  /** Isolated userData path: ~/.agentpanel/instances/<hash>/ */
  userDataPath: string
  /** Deterministic CDP port derived from hash (range 9200-9999) */
  cdpPort: number
}

/**
 * Detect the git worktree root. Falls back to cwd if not in a git repo.
 */
export function detectWorktreeRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  } catch {
    return process.cwd()
  }
}

/**
 * Derive a short, deterministic hash from a path.
 * 8 hex chars = 32 bits — collision-free for any reasonable number of worktrees.
 */
export function deriveHash(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 8)
}

/**
 * Derive a deterministic port number from a hash within [rangeStart, rangeEnd).
 */
export function derivePort(hash: string, rangeStart: number, rangeEnd: number): number {
  const num = parseInt(hash.slice(0, 4), 16)
  return rangeStart + (num % (rangeEnd - rangeStart))
}

/**
 * Build the full WorktreeInfo from the detected worktree root.
 */
export function getWorktreeInfo(rootOverride?: string): WorktreeInfo {
  const root = rootOverride ?? detectWorktreeRoot()
  const hash = deriveHash(root)
  const userDataPath = join(homedir(), '.agentpanel', 'instances', hash)

  mkdirSync(userDataPath, { recursive: true })

  return {
    root,
    hash,
    name: basename(root),
    userDataPath,
    cdpPort: derivePort(hash, 9200, 9999)
  }
}

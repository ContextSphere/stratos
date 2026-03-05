import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, appendFileSync, readFileSync, unlinkSync } from 'fs'

const DEFAULT_BASE_DIR = join(homedir(), '.agentpanel')

export interface TraceEntry {
  timestamp: number
  sessionId?: string
  messageUuid?: string
  parentToolUseId?: string | null
  messageType: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

function getTracesDir(baseDir: string): string {
  const dir = join(baseDir, 'threads', 'traces')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getTracePath(threadId: string, baseDir: string): string {
  return join(getTracesDir(baseDir), `${threadId}.jsonl`)
}

export function appendTraceEntry(threadId: string, entry: TraceEntry, baseDir = DEFAULT_BASE_DIR): void {
  try {
    const tracePath = getTracePath(threadId, baseDir)
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(tracePath, line, 'utf-8')
  } catch (error) {
    console.error(`Failed to append trace entry for thread ${threadId}:`, error)
  }
}

export function readTraceEntries(threadId: string, baseDir = DEFAULT_BASE_DIR): TraceEntry[] {
  const tracePath = getTracePath(threadId, baseDir)
  if (!existsSync(tracePath)) {
    return []
  }

  try {
    const content = readFileSync(tracePath, 'utf-8')
    const lines = content.trim().split('\n').filter(line => line.length > 0)
    return lines.map(line => JSON.parse(line) as TraceEntry)
  } catch (error) {
    console.error(`Failed to read trace entries for thread ${threadId}:`, error)
    return []
  }
}

export function clearTraceFile(threadId: string, baseDir = DEFAULT_BASE_DIR): void {
  const tracePath = getTracePath(threadId, baseDir)
  if (existsSync(tracePath)) {
    try {
      unlinkSync(tracePath)
    } catch (error) {
      console.error(`Failed to clear trace file for thread ${threadId}:`, error)
    }
  }
}

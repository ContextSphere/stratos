import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendTraceEntry, readTraceEntries, clearTraceFile, type TraceEntry } from '../storage/trace.store'

describe('trace.store', () => {
  let tmpDir: string
  const threadId = 'test-thread-1'

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentpanel-trace-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when no trace file exists', () => {
    expect(readTraceEntries(threadId, tmpDir)).toEqual([])
  })

  it('appends and reads trace entries', () => {
    const entry: TraceEntry = {
      timestamp: Date.now(),
      messageType: 'assistant',
      data: { text: 'hello' }
    }
    appendTraceEntry(threadId, entry, tmpDir)
    appendTraceEntry(threadId, { ...entry, messageType: 'user' }, tmpDir)

    const entries = readTraceEntries(threadId, tmpDir)
    expect(entries).toHaveLength(2)
    expect(entries[0].messageType).toBe('assistant')
    expect(entries[1].messageType).toBe('user')
  })

  it('clears the trace file', () => {
    appendTraceEntry(threadId, { timestamp: 1, messageType: 'test', data: {} }, tmpDir)
    expect(readTraceEntries(threadId, tmpDir)).toHaveLength(1)

    clearTraceFile(threadId, tmpDir)
    expect(readTraceEntries(threadId, tmpDir)).toEqual([])
  })

  it('clearTraceFile is a no-op when file does not exist', () => {
    expect(() => clearTraceFile('nonexistent', tmpDir)).not.toThrow()
  })
})

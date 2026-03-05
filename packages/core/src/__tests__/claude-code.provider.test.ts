import { describe, it, expect } from 'vitest'
import { ClaudeCodeProvider } from '../providers/claude-code.provider'

describe('ClaudeCodeProvider', () => {
  it('instantiates with correct name', () => {
    const provider = new ClaudeCodeProvider()
    expect(provider.name).toBe('claude-code')
  })

  it('initialize does not throw', async () => {
    const provider = new ClaudeCodeProvider()
    await expect(provider.initialize({})).resolves.toBeUndefined()
  })

  it('canResume returns false when no session exists', () => {
    const provider = new ClaudeCodeProvider()
    expect(provider.canResume('some-session')).toBe(false)
  })

  it('dispose does not throw', async () => {
    const provider = new ClaudeCodeProvider()
    await expect(provider.dispose()).resolves.toBeUndefined()
  })
})

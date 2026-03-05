import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThreadList } from '../components/ThreadList'
import type { Thread } from '@agentpanel/core'

function makeThread(id: string, title: string): Thread {
  return { id, title, createdAt: Date.now(), updatedAt: Date.now() }
}

const baseProps = {
  onThreadClick: vi.fn(),
  onCreateThread: vi.fn(),
  onDeleteThread: vi.fn(),
  runningThreadIds: [] as string[],
  threadNotifications: new Map<string, string>()
}

describe('ThreadList', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('shows "No threads yet" when list is empty', () => {
    render(<ThreadList {...baseProps} threads={[]} activeThreadId={null} />)
    expect(screen.getByText('No threads yet')).toBeInTheDocument()
  })

  it('renders thread titles', () => {
    const threads = [makeThread('a', 'Alpha'), makeThread('b', 'Beta')]
    render(<ThreadList {...baseProps} threads={threads} activeThreadId={null} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('highlights the active thread', () => {
    const threads = [makeThread('a', 'Alpha'), makeThread('b', 'Beta')]
    render(<ThreadList {...baseProps} threads={threads} activeThreadId="a" />)
    const alphaEl = screen.getByText('Alpha').closest('div[class*="rounded-lg"]')!
    expect(alphaEl.className).toContain('bg-[#2a2a2a]')
    const betaEl = screen.getByText('Beta').closest('div[class*="rounded-lg"]')!
    expect(betaEl.className).not.toContain('bg-[#2a2a2a]')
  })

  it('calls onThreadClick with correct id', async () => {
    const user = userEvent.setup()
    const threads = [makeThread('a', 'Alpha')]
    render(<ThreadList {...baseProps} threads={threads} activeThreadId={null} />)
    await user.click(screen.getByText('Alpha'))
    expect(baseProps.onThreadClick).toHaveBeenCalledWith('a')
  })

  it('calls onCreateThread when new thread button is clicked', async () => {
    const user = userEvent.setup()
    render(<ThreadList {...baseProps} threads={[]} activeThreadId={null} />)
    await user.click(screen.getByTitle('New thread'))
    expect(baseProps.onCreateThread).toHaveBeenCalledOnce()
  })

  it('shows the Threads header', () => {
    render(<ThreadList {...baseProps} threads={[]} activeThreadId={null} />)
    expect(screen.getByText('Threads')).toBeInTheDocument()
  })
})

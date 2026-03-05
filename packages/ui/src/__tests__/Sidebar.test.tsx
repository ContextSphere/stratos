import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../components/Sidebar'
import type { Thread } from '@agentpanel/core'

function makeThread(id: string, title: string): Thread {
  return { id, title, createdAt: Date.now(), updatedAt: Date.now() }
}

describe('Sidebar', () => {
  const defaultProps = {
    threads: [makeThread('t1', 'Thread One'), makeThread('t2', 'Thread Two')],
    activeThreadId: 't1',
    onThreadClick: vi.fn(),
    onCreateThread: vi.fn(),
    onDeleteThread: vi.fn(),
    onToggleSidebar: vi.fn(),
    onSettingsClick: vi.fn(),
    runningThreadIds: [] as string[],
    threadNotifications: new Map<string, string>()
  }

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the AgentPanel branding', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Panel')).toBeInTheDocument()
  })

  it('renders thread titles', () => {
    render(<Sidebar {...defaultProps} />)
    expect(screen.getByText('Thread One')).toBeInTheDocument()
    expect(screen.getByText('Thread Two')).toBeInTheDocument()
  })

  it('calls onSettingsClick when settings button is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)
    await user.click(screen.getByTitle('Settings'))
    expect(defaultProps.onSettingsClick).toHaveBeenCalledOnce()
  })

  it('calls onToggleSidebar when collapse button is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)
    await user.click(screen.getByTitle('Collapse sidebar'))
    expect(defaultProps.onToggleSidebar).toHaveBeenCalledOnce()
  })

  it('calls onCreateThread when new thread button is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)
    await user.click(screen.getByTitle('New thread'))
    expect(defaultProps.onCreateThread).toHaveBeenCalledOnce()
  })

  it('calls onThreadClick when a thread is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar {...defaultProps} />)
    await user.click(screen.getByText('Thread Two'))
    expect(defaultProps.onThreadClick).toHaveBeenCalledWith('t2')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TodoList } from '../components/TodoList'
import type { TodoData } from '../types'

describe('TodoList', () => {
  afterEach(() => cleanup())

  it('renders nothing when todos array is empty', () => {
    const { container } = render(<TodoList todoData={{ todos: [] }} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the "Task Progress" heading', () => {
    const todoData: TodoData = {
      todos: [{ content: 'Do something', status: 'pending', activeForm: 'Doing something' }]
    }
    render(<TodoList todoData={todoData} />)
    expect(screen.getByText('Task Progress')).toBeInTheDocument()
  })

  it('renders pending items with content text and circle indicator', () => {
    const todoData: TodoData = {
      todos: [{ content: 'Write tests', status: 'pending', activeForm: 'Writing tests' }]
    }
    render(<TodoList todoData={todoData} />)
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('○')).toBeInTheDocument()
  })

  it('renders in_progress items with activeForm text and animated indicator', () => {
    const todoData: TodoData = {
      todos: [{ content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' }]
    }
    render(<TodoList todoData={todoData} />)
    // Should show activeForm, not content
    expect(screen.getByText('Writing tests')).toBeInTheDocument()
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument()
    expect(screen.getByText('⋯')).toBeInTheDocument()
  })

  it('renders completed items with checkmark and strikethrough styling', () => {
    const todoData: TodoData = {
      todos: [{ content: 'Done task', status: 'completed', activeForm: 'Doing task' }]
    }
    render(<TodoList todoData={todoData} />)
    expect(screen.getByText('Done task')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
    // Check strikethrough class
    const taskText = screen.getByText('Done task')
    expect(taskText.className).toContain('line-through')
  })

  it('renders a mix of statuses correctly', () => {
    const todoData: TodoData = {
      todos: [
        { content: 'First', status: 'completed', activeForm: 'First active' },
        { content: 'Second', status: 'in_progress', activeForm: 'Second active' },
        { content: 'Third', status: 'pending', activeForm: 'Third active' }
      ]
    }
    render(<TodoList todoData={todoData} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second active')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
  })
})

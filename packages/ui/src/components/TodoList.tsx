import type { TodoData } from '../types'

interface TodoListProps {
  todoData: TodoData
}

export function TodoList({ todoData }: TodoListProps): React.ReactElement {
  const { todos } = todoData

  if (!todos || todos.length === 0) return <></>

  return (
    <div className="mt-3 rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
      <h4 className="text-sm font-medium text-gray-300 mb-2">Task Progress</h4>
      <div className="space-y-1.5">
        {todos.map((todo, index) => {
          const isCompleted = todo.status === 'completed'
          const isInProgress = todo.status === 'in_progress'
          const displayText = isInProgress ? todo.activeForm : todo.content

          return (
            <div
              key={index}
              className="flex items-start gap-2 text-sm"
            >
              {/* Status indicator */}
              <div className="flex-shrink-0 mt-1">
                {isCompleted && (
                  <span className="text-green-400">✓</span>
                )}
                {isInProgress && (
                  <span className="text-blue-400 animate-pulse">⋯</span>
                )}
                {todo.status === 'pending' && (
                  <span className="text-gray-600">○</span>
                )}
              </div>

              {/* Task text with strike-through for completed */}
              <span
                className={`flex-1 ${
                  isCompleted
                    ? 'line-through text-gray-500'
                    : isInProgress
                    ? 'text-blue-300 font-medium'
                    : 'text-gray-400'
                }`}
              >
                {displayText}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

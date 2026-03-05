import { PanelCard } from './shared/PanelCard'
import { TodoList } from './TodoList'
import type { TodoData } from '../types'

interface TaskPanelProps {
  todoData: TodoData
  onClose: () => void
}

export function TaskPanel({ todoData, onClose }: TaskPanelProps): React.ReactElement {
  const closeButton = (
    <button
      onClick={onClose}
      className="p-1 rounded hover:bg-[#2a2a2a] text-gray-500 hover:text-gray-300 transition-colors"
      title="Close task panel"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )

  return (
    <div className="fixed top-20 right-8 z-30 w-80 max-w-[calc(100vw-2rem)] hidden md:block">
      <PanelCard title="Active Tasks" headerAction={closeButton}>
        <TodoList todoData={todoData} />
      </PanelCard>
    </div>
  )
}

import type { TodoData } from "../types";

interface TodoListProps {
  todoData: TodoData;
}

export function TodoList({ todoData }: TodoListProps): React.ReactElement {
  const { todos } = todoData;

  if (!todos || !Array.isArray(todos) || todos.length === 0) return <></>;

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)] p-3">
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Task Progress</h4>
      <div className="space-y-1.5">
        {todos.map((todo, index) => {
          const isCompleted = todo.status === "completed";
          const isInProgress = todo.status === "in_progress";
          const displayText = isInProgress ? todo.activeForm : todo.content;

          return (
            <div key={index} className="flex items-start gap-2 text-sm">
              {/* Status indicator */}
              <div className="flex-shrink-0 mt-1">
                {isCompleted && <span className="text-green-600">✓</span>}
                {isInProgress && (
                  <span className="text-blue-500 animate-pulse">⋯</span>
                )}
                {todo.status === "pending" && (
                  <span className="text-[var(--text-muted)]">○</span>
                )}
              </div>

              {/* Task text with strike-through for completed */}
              <span
                className={`flex-1 ${
                  isCompleted
                    ? "line-through text-[var(--text-muted)]"
                    : isInProgress
                      ? "text-blue-500 font-medium"
                      : "text-[var(--text-secondary)]"
                }`}
              >
                {displayText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

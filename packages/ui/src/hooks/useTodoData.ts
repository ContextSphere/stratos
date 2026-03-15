import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, TodoData } from "../types";

export function useTodoData(messages: ChatMessage[]) {
  const [latestTodoData, setLatestTodoData] = useState<TodoData | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const todoFingerprintRef = useRef<string>("");

  const getTodoFingerprint = useCallback((todoData: TodoData): string => {
    return todoData.todos.map((t) => t.content).join("|");
  }, []);

  const areAllTasksCompleted = useCallback((todoData: TodoData): boolean => {
    return (
      todoData.todos.length > 0 &&
      todoData.todos.every((t) => t.status === "completed")
    );
  }, []);

  useEffect(() => {
    const lastTodoMessage = [...messages]
      .reverse()
      .find(
        (m) =>
          m.todoData &&
          Array.isArray(m.todoData.todos) &&
          m.todoData.todos.length > 0,
      );

    if (!lastTodoMessage?.todoData) {
      setLatestTodoData(null);
      setShowTaskPanel(false);
      return;
    }

    const newTodoData = lastTodoMessage.todoData;
    const newFingerprint = getTodoFingerprint(newTodoData);

    if (newFingerprint !== todoFingerprintRef.current) {
      todoFingerprintRef.current = newFingerprint;
    }

    setLatestTodoData(newTodoData);
    if (areAllTasksCompleted(newTodoData)) {
      setShowTaskPanel(false);
    }
  }, [messages]);

  return {
    latestTodoData,
    showTaskPanel,
    setShowTaskPanel,
  };
}

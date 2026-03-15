import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, TodoData } from "../types";

export function useTodoData(messages: ChatMessage[]) {
  const [latestTodoData, setLatestTodoData] = useState<TodoData | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const todoFingerprintRef = useRef<string>("");
  const manuallyToggled = useRef(false);

  const getTodoFingerprint = useCallback((todoData: TodoData): string => {
    return todoData.todos.map((t) => t.content).join("|");
  }, []);

  const areAllTasksCompleted = useCallback((todoData: TodoData): boolean => {
    return (
      todoData.todos.length > 0 &&
      todoData.todos.every((t) => t.status === "completed")
    );
  }, []);

  const handleSetShowTaskPanel = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      manuallyToggled.current = true;
      setShowTaskPanel(value);
    },
    [],
  );

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
      manuallyToggled.current = false;
      return;
    }

    const newTodoData = lastTodoMessage.todoData;
    const newFingerprint = getTodoFingerprint(newTodoData);

    if (newFingerprint !== todoFingerprintRef.current) {
      // New set of tasks — reset manual toggle but don't auto-open
      manuallyToggled.current = false;
      todoFingerprintRef.current = newFingerprint;
      setLatestTodoData(newTodoData);
    } else {
      setLatestTodoData(newTodoData);
      if (!manuallyToggled.current && areAllTasksCompleted(newTodoData)) {
        setShowTaskPanel(false);
      }
    }
  }, [messages]);

  return {
    latestTodoData,
    showTaskPanel,
    setShowTaskPanel: handleSetShowTaskPanel,
  };
}

import { useState, useEffect, useCallback, useRef } from "react";
import type { ChatMessage, TodoData } from "../types";

export function useTodoData(
  messages: ChatMessage[],
  activeThreadId?: string | null,
) {
  const [latestTodoData, setLatestTodoData] = useState<TodoData | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const todoFingerprintRef = useRef<string>("");
  const manuallyToggledRef = useRef(false);
  // Tracks the last message id we saw, so we can tell whether the next render
  // is a continuation of the same timeline (live update) or a wholesale
  // replacement (initial mount, thread switch, history reload).
  const lastSeenMessageIdRef = useRef<string | null>(null);
  const lastSeenThreadIdRef = useRef<string | null | undefined>(undefined);
  const hasInitializedRef = useRef(false);

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
      manuallyToggledRef.current = true;
      setShowTaskPanel(value);
    },
    [],
  );

  useEffect(() => {
    const isFirstRun = !hasInitializedRef.current;
    hasInitializedRef.current = true;

    const threadChanged = lastSeenThreadIdRef.current !== activeThreadId;
    const prevLastId = lastSeenMessageIdRef.current;
    const messageIds = new Set(messages.map((m) => m.id));
    const timelineContinues =
      !isFirstRun &&
      !threadChanged &&
      prevLastId !== null &&
      messageIds.has(prevLastId);

    lastSeenThreadIdRef.current = activeThreadId;
    lastSeenMessageIdRef.current =
      messages.length > 0 ? messages[messages.length - 1].id : null;

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
      todoFingerprintRef.current = "";
      manuallyToggledRef.current = false;
      return;
    }

    const newTodoData = lastTodoMessage.todoData;
    const newFingerprint = getTodoFingerprint(newTodoData);
    setLatestTodoData(newTodoData);

    if (!timelineContinues) {
      // Initial mount, thread switch, or history reload — adopt fingerprint
      // silently and keep panel closed. These tasks are historical context,
      // not a fresh tool call.
      todoFingerprintRef.current = newFingerprint;
      manuallyToggledRef.current = false;
      setShowTaskPanel(false);
      return;
    }

    if (newFingerprint !== todoFingerprintRef.current) {
      // Continuation of the same timeline AND fingerprint changed — a brand
      // new TodoWrite arrived live. Auto-open and forget any prior manual
      // close (this is a new task set, the user hasn't expressed intent yet).
      todoFingerprintRef.current = newFingerprint;
      manuallyToggledRef.current = false;
      setShowTaskPanel(true);
      return;
    }

    // Same fingerprint, status updates only — leave the panel state alone
    // except for the universal rule: auto-close once everything is complete.
    if (areAllTasksCompleted(newTodoData)) {
      setShowTaskPanel(false);
      manuallyToggledRef.current = false;
    }
  }, [messages, activeThreadId, getTodoFingerprint, areAllTasksCompleted]);

  return {
    latestTodoData,
    showTaskPanel,
    setShowTaskPanel: handleSetShowTaskPanel,
  };
}

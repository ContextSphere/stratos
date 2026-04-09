import { useRef, useState, useCallback } from "react";
import type { NavEntry, NavHistoryState } from "../navigation/types";

const MAX_HISTORY = 50;

function entriesEqual(a: NavEntry, b: NavEntry): boolean {
  if (a.threadId !== b.threadId) return false;
  if (a.anchor.type !== b.anchor.type) return false;
  if (a.anchor.type === "message" && b.anchor.type === "message") {
    return a.anchor.messageId === b.anchor.messageId;
  }
  return true; // both "latest"
}

export function useNavHistory(onNavigate: (entry: NavEntry) => void) {
  const historyRef = useRef<NavHistoryState>({ stack: [], index: -1 });
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const push = useCallback((entry: NavEntry) => {
    const state = historyRef.current;
    const current = state.stack[state.index];
    if (current && entriesEqual(current, entry)) return;

    // Trim forward history when branching
    const newStack = state.stack.slice(0, state.index + 1);
    newStack.push(entry);
    if (newStack.length > MAX_HISTORY) newStack.shift();

    const newState: NavHistoryState = {
      stack: newStack,
      index: newStack.length - 1,
    };
    historyRef.current = newState;
    setCanGoBack(newState.index > 0);
    setCanGoForward(false);
  }, []);

  /** Update the anchor of the current history entry (called on scroll, in place) */
  const updateCurrentAnchor = useCallback((entry: NavEntry) => {
    const state = historyRef.current;
    if (state.index >= 0) {
      state.stack[state.index] = {
        ...state.stack[state.index],
        anchor: entry.anchor,
      };
    }
  }, []);

  const back = useCallback(() => {
    const state = historyRef.current;
    if (state.index <= 0) return;
    const newIndex = state.index - 1;
    historyRef.current = { ...state, index: newIndex };
    setCanGoBack(newIndex > 0);
    setCanGoForward(true);
    onNavigate(state.stack[newIndex]);
  }, [onNavigate]);

  const forward = useCallback(() => {
    const state = historyRef.current;
    if (state.index >= state.stack.length - 1) return;
    const newIndex = state.index + 1;
    historyRef.current = { ...state, index: newIndex };
    setCanGoBack(true);
    setCanGoForward(newIndex < state.stack.length - 1);
    onNavigate(state.stack[newIndex]);
  }, [onNavigate]);

  return { push, updateCurrentAnchor, back, forward, canGoBack, canGoForward };
}

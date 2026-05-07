import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTodoData } from "../useTodoData";
import type { ChatMessage, TodoData } from "../../types";

function makeMsg(id: string, todoData?: TodoData): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    todoData,
  };
}

describe("useTodoData", () => {
  it("returns null when no messages have todo data", () => {
    const { result } = renderHook(() =>
      useTodoData([makeMsg("1")], "thread-1"),
    );
    expect(result.current.latestTodoData).toBeNull();
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("does not auto-open on initial mount with historical todos", () => {
    const todos: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result } = renderHook(() =>
      useTodoData([makeMsg("1", todos)], "thread-1"),
    );
    expect(result.current.latestTodoData).toEqual(todos);
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("auto-opens when a new task set arrives in the same thread", () => {
    const initial: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", initial)], tid: "thread-1" } },
    );
    expect(result.current.showTaskPanel).toBe(false);

    // Live new tasks arrive in the same thread (different fingerprint).
    const next: TodoData = {
      todos: [{ content: "Task B", status: "pending", activeForm: "Doing B" }],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", next)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);
    expect(result.current.latestTodoData).toEqual(next);
  });

  it("auto-reopens on same-fingerprint status updates if user has not toggled", () => {
    const initial: TodoData = {
      todos: [
        { content: "Task A", status: "pending", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
      ],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", initial)], tid: "thread-1" } },
    );
    expect(result.current.showTaskPanel).toBe(false);

    // First, a new fingerprint to seed the live state and open the panel.
    const seeded: TodoData = {
      todos: [
        { content: "Task A", status: "pending", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
        { content: "Task C", status: "pending", activeForm: "Doing C" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", seeded)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);

    // Same fingerprint, just a status update — panel stays open.
    const updated: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
        { content: "Task C", status: "pending", activeForm: "Doing C" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", updated)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);
  });

  it("auto-closes when all tasks complete", () => {
    const initial: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
      ],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", initial)], tid: "thread-1" } },
    );

    // Trigger a live update to open the panel.
    const seeded: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", seeded)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);

    // All tasks complete (same fingerprint).
    const done: TodoData = {
      todos: [
        { content: "Task A", status: "completed", activeForm: "Doing A" },
        { content: "Task B", status: "completed", activeForm: "Doing B" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", done)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("does NOT auto-open when messages load asynchronously after a thread switch", () => {
    // Simulates the real-world flow: user switches threads, the renderer's
    // messages array is briefly empty (loading), then populates with the new
    // thread's persisted todoData. The empty-then-populated transition should
    // be treated as historic load, NOT a live update.
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [] as ChatMessage[], tid: "thread-1" } },
    );
    expect(result.current.showTaskPanel).toBe(false);

    // Async message load completes — todos appear in the same thread.
    const todos: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    rerender({ msgs: [makeMsg("1", todos)], tid: "thread-1" });
    expect(result.current.showTaskPanel).toBe(false);
    expect(result.current.latestTodoData).toEqual(todos);
  });

  it("does NOT auto-open when switching to a different thread whose messages load asynchronously", () => {
    // Real-world flow: switching threads first changes activeThreadId, and
    // messages arrive a tick later. Both transitions must stay closed.
    const todosA: TodoData = {
      todos: [{ content: "T1", status: "pending", activeForm: "Doing T1" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", todosA)], tid: "thread-1" } },
    );
    expect(result.current.showTaskPanel).toBe(false);

    // Live update inside thread-1 opens the panel.
    const todosA2: TodoData = {
      todos: [{ content: "T1b", status: "pending", activeForm: "Doing T1b" }],
    };
    rerender({
      msgs: [makeMsg("1", todosA), makeMsg("2", todosA2)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);

    // Switch to thread-2: id changes first, messages briefly empty.
    rerender({ msgs: [], tid: "thread-2" });
    expect(result.current.showTaskPanel).toBe(false);

    // Then thread-2's historical messages arrive.
    const todosB: TodoData = {
      todos: [{ content: "T2", status: "pending", activeForm: "Doing T2" }],
    };
    rerender({ msgs: [makeMsg("3", todosB)], tid: "thread-2" });
    expect(result.current.showTaskPanel).toBe(false);
    expect(result.current.latestTodoData).toEqual(todosB);
  });

  it("does NOT auto-open when switching to a different thread", () => {
    const threadOneTodos: TodoData = {
      todos: [{ content: "T1", status: "pending", activeForm: "Doing T1" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      {
        initialProps: { msgs: [makeMsg("1", threadOneTodos)], tid: "thread-1" },
      },
    );
    expect(result.current.showTaskPanel).toBe(false);

    // A live update inside thread-1 opens the panel.
    const threadOneNext: TodoData = {
      todos: [{ content: "T1b", status: "pending", activeForm: "Doing T1b" }],
    };
    rerender({
      msgs: [makeMsg("1", threadOneTodos), makeMsg("2", threadOneNext)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);

    // User switches to thread-2 which has different historical todos.
    const threadTwoTodos: TodoData = {
      todos: [{ content: "T2", status: "pending", activeForm: "Doing T2" }],
    };
    rerender({
      msgs: [makeMsg("3", threadTwoTodos)],
      tid: "thread-2",
    });
    expect(result.current.showTaskPanel).toBe(false);
    expect(result.current.latestTodoData).toEqual(threadTwoTodos);
  });

  it("respects manual close across status updates", () => {
    const initial: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", initial)], tid: "thread-1" } },
    );

    // Live update opens the panel.
    const seeded: TodoData = {
      todos: [
        { content: "Task A", status: "pending", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", seeded)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);

    // User manually closes.
    act(() => {
      result.current.setShowTaskPanel(false);
    });
    expect(result.current.showTaskPanel).toBe(false);

    // Status update on same fingerprint — should stay closed (respect intent).
    const updated: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
        { content: "Task B", status: "pending", activeForm: "Doing B" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", initial), makeMsg("2", updated)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("manual open is preserved across status updates", () => {
    const initial: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", initial)], tid: "thread-1" } },
    );
    // Initial mount: closed.
    expect(result.current.showTaskPanel).toBe(false);

    // User manually opens.
    act(() => {
      result.current.setShowTaskPanel(true);
    });
    expect(result.current.showTaskPanel).toBe(true);

    // Same-fingerprint update — manual intent preserved (panel still open).
    const updated: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
      ],
    };
    rerender({
      msgs: [makeMsg("1", updated)],
      tid: "thread-1",
    });
    expect(result.current.showTaskPanel).toBe(true);
  });

  it("does not crash when todoData exists but todos is undefined (malformed persisted data)", () => {
    const malformed = { todos: undefined } as unknown as TodoData;
    const messages = [makeMsg("1", malformed)];
    expect(() =>
      renderHook(() => useTodoData(messages, "thread-1")),
    ).not.toThrow();
    const { result } = renderHook(() => useTodoData(messages, "thread-1"));
    expect(result.current.latestTodoData).toBeNull();
  });

  it("does not crash when todoData is a raw array instead of { todos }", () => {
    const rawArray = [
      { content: "Task", status: "pending", activeForm: "" },
    ] as unknown as TodoData;
    const messages = [makeMsg("1", rawArray)];
    expect(() =>
      renderHook(() => useTodoData(messages, "thread-1")),
    ).not.toThrow();
  });

  it("clears todo data when no messages have todos", () => {
    const todos: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result, rerender } = renderHook(
      ({ msgs, tid }: { msgs: ChatMessage[]; tid: string }) =>
        useTodoData(msgs, tid),
      { initialProps: { msgs: [makeMsg("1", todos)], tid: "thread-1" } },
    );
    expect(result.current.latestTodoData).not.toBeNull();

    rerender({ msgs: [makeMsg("1")], tid: "thread-1" });
    expect(result.current.latestTodoData).toBeNull();
    expect(result.current.showTaskPanel).toBe(false);
  });
});

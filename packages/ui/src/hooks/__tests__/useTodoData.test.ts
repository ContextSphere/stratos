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
    const { result } = renderHook(() => useTodoData([makeMsg("1")]));
    expect(result.current.latestTodoData).toBeNull();
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("extracts the latest todo data from messages", () => {
    const todos: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const messages = [makeMsg("1"), makeMsg("2", todos)];
    const { result } = renderHook(() => useTodoData(messages));
    expect(result.current.latestTodoData).toEqual(todos);
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("auto-hides panel when all tasks are completed (same fingerprint)", () => {
    const initial: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
      ],
    };
    const completed: TodoData = {
      todos: [
        { content: "Task A", status: "completed", activeForm: "Doing A" },
      ],
    };
    const { result, rerender } = renderHook(({ msgs }) => useTodoData(msgs), {
      initialProps: { msgs: [makeMsg("1", initial)] },
    });
    expect(result.current.showTaskPanel).toBe(false);

    // Manually open the panel
    act(() => {
      result.current.setShowTaskPanel(true);
    });
    expect(result.current.showTaskPanel).toBe(true);

    // Same fingerprint (content unchanged), but all completed — should auto-close
    rerender({ msgs: [makeMsg("1", completed)] });
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("respects manual toggle and does not auto-show/hide", () => {
    const todos: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
      ],
    };
    const { result, rerender } = renderHook(({ msgs }) => useTodoData(msgs), {
      initialProps: { msgs: [makeMsg("1", todos)] },
    });
    expect(result.current.showTaskPanel).toBe(false);

    // Manually open
    act(() => {
      result.current.setShowTaskPanel(true);
    });
    expect(result.current.showTaskPanel).toBe(true);

    // Manually close
    act(() => {
      result.current.setShowTaskPanel(false);
    });
    expect(result.current.showTaskPanel).toBe(false);

    // Re-render with same fingerprint tasks still in progress — should stay closed
    const stillInProgress: TodoData = {
      todos: [
        {
          content: "Task A",
          status: "in_progress",
          activeForm: "Still doing A",
        },
      ],
    };
    rerender({ msgs: [makeMsg("1", stillInProgress)] });
    expect(result.current.showTaskPanel).toBe(false);
  });

  it("switching to a new task set keeps panel closed and updates data", () => {
    const first: TodoData = {
      todos: [
        { content: "Task A", status: "in_progress", activeForm: "Doing A" },
      ],
    };
    const { result, rerender } = renderHook(({ msgs }) => useTodoData(msgs), {
      initialProps: { msgs: [makeMsg("1", first)] },
    });
    expect(result.current.showTaskPanel).toBe(false);

    // New set of tasks (different fingerprint) — panel stays closed, data updates
    const second: TodoData = {
      todos: [{ content: "Task B", status: "pending", activeForm: "Doing B" }],
    };
    rerender({ msgs: [makeMsg("1", first), makeMsg("2", second)] });
    expect(result.current.showTaskPanel).toBe(false);
    expect(result.current.latestTodoData).toEqual(second);
  });

  it("does not crash when todoData exists but todos is undefined (malformed persisted data)", () => {
    const malformed = { todos: undefined } as unknown as TodoData;
    const messages = [makeMsg("1", malformed)];
    expect(() => renderHook(() => useTodoData(messages))).not.toThrow();
    const { result } = renderHook(() => useTodoData(messages));
    expect(result.current.latestTodoData).toBeNull();
  });

  it("does not crash when todoData is a raw array instead of { todos }", () => {
    const rawArray = [
      { content: "Task", status: "pending", activeForm: "" },
    ] as unknown as TodoData;
    const messages = [makeMsg("1", rawArray)];
    expect(() => renderHook(() => useTodoData(messages))).not.toThrow();
  });

  it("clears todo data when no messages have todos", () => {
    const todos: TodoData = {
      todos: [{ content: "Task A", status: "pending", activeForm: "Doing A" }],
    };
    const { result, rerender } = renderHook(({ msgs }) => useTodoData(msgs), {
      initialProps: { msgs: [makeMsg("1", todos)] },
    });
    expect(result.current.latestTodoData).not.toBeNull();

    rerender({ msgs: [makeMsg("1")] });
    expect(result.current.latestTodoData).toBeNull();
    expect(result.current.showTaskPanel).toBe(false);
  });
});

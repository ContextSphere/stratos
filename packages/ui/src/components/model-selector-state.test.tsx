import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../types";
import { useAvailableModels } from "./model-selector-state";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useAvailableModels", () => {
  it("ignores a late response from the previous fetch scope", async () => {
    const first = deferred<ModelInfo[]>();
    const second = deferred<ModelInfo[]>();
    const { result, rerender } = renderHook(
      ({ scope, fetchModels }) =>
        useAvailableModels(undefined, fetchModels, scope),
      {
        initialProps: {
          scope: "first",
          fetchModels: () => first.promise,
        },
      },
    );

    rerender({ scope: "second", fetchModels: () => second.promise });
    act(() => second.resolve([{ value: "new", displayName: "New" }]));
    await waitFor(() => expect(result.current.models[0]?.value).toBe("new"));

    act(() => first.resolve([{ value: "stale", displayName: "Stale" }]));
    await act(async () => Promise.resolve());
    expect(result.current.models[0]?.value).toBe("new");
  });
});

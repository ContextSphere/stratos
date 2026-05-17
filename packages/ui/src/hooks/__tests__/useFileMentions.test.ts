import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileMentions } from "../useFileMentions";

function makeBridge(files: string[] = ["src/App.tsx", "src/main.ts"]) {
  return {
    listAllFiles: vi.fn().mockResolvedValue(files),
    watchDirectory: vi.fn().mockResolvedValue(undefined),
    unwatchDirectory: vi.fn().mockResolvedValue(undefined),
    onDirectoryChanged: vi.fn().mockReturnValue(vi.fn()), // returns unsubscribe fn
  };
}

describe("useFileMentions", () => {
  it("returns loading=true then files once fetched", async () => {
    const bridge = makeBridge();
    const { result } = renderHook(() => useFileMentions("/project", bridge));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files).toEqual(["src/App.tsx", "src/main.ts"]);
  });

  it("calls watchDirectory and subscribes to onDirectoryChanged on mount", async () => {
    const bridge = makeBridge();
    renderHook(() => useFileMentions("/project", bridge));

    await waitFor(() =>
      expect(bridge.listAllFiles).toHaveBeenCalledWith("/project"),
    );
    expect(bridge.watchDirectory).toHaveBeenCalledWith("/project");
    expect(bridge.onDirectoryChanged).toHaveBeenCalled();
  });

  it("re-fetches after the debounce window when onDirectoryChanged fires", async () => {
    vi.useFakeTimers();
    let changeCallback: ((dir: string) => void) | null = null;
    const bridge = {
      listAllFiles: vi.fn().mockResolvedValue(["src/App.tsx"]),
      watchDirectory: vi.fn().mockResolvedValue(undefined),
      unwatchDirectory: vi.fn().mockResolvedValue(undefined),
      onDirectoryChanged: vi.fn().mockImplementation((cb) => {
        changeCallback = cb;
        return vi.fn();
      }),
    };

    const { result } = renderHook(() => useFileMentions("/project", bridge));
    // First fetch on mount
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    bridge.listAllFiles.mockResolvedValueOnce(["src/App.tsx", "src/new.ts"]);
    act(() => {
      changeCallback?.("/project/src");
    });
    // Not yet — still inside the debounce window
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    // Advance past the 5 s debounce
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(2);
    expect(result.current.files).toEqual(["src/App.tsx", "src/new.ts"]);
    vi.useRealTimers();
  });

  it("coalesces a burst of dir-change events into a single re-walk", async () => {
    // Regression guard for the May 16 OOM where N concurrent rapid file
    // edits triggered N concurrent full-workspace walks in main process,
    // saturating old_space with retained path strings.
    vi.useFakeTimers();
    let changeCallback: ((dir: string) => void) | null = null;
    const bridge = {
      listAllFiles: vi.fn().mockResolvedValue(["src/App.tsx"]),
      watchDirectory: vi.fn().mockResolvedValue(undefined),
      unwatchDirectory: vi.fn().mockResolvedValue(undefined),
      onDirectoryChanged: vi.fn().mockImplementation((cb) => {
        changeCallback = cb;
        return vi.fn();
      }),
    };

    renderHook(() => useFileMentions("/project", bridge));
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    // Simulate 50 rapid file-change events (e.g. agent doing parallel writes)
    act(() => {
      for (let i = 0; i < 50; i++) {
        changeCallback?.(`/project/src/file-${i}.ts`);
      }
    });
    // No re-walks yet (debounce window not elapsed)
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    // Exactly ONE re-walk, regardless of the 50 events
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("skips a re-walk if one is still in flight", async () => {
    vi.useFakeTimers();
    let changeCallback: ((dir: string) => void) | null = null;
    let resolveFirstWalk: (v: string[]) => void = () => {};
    const bridge = {
      listAllFiles: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(["initial.ts"]))
        .mockImplementationOnce(
          () => new Promise<string[]>((r) => (resolveFirstWalk = r)),
        )
        .mockImplementation(() => Promise.resolve(["after.ts"])),
      watchDirectory: vi.fn().mockResolvedValue(undefined),
      unwatchDirectory: vi.fn().mockResolvedValue(undefined),
      onDirectoryChanged: vi.fn().mockImplementation((cb) => {
        changeCallback = cb;
        return vi.fn();
      }),
    };

    renderHook(() => useFileMentions("/project", bridge));
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    // Trigger a debounced walk
    act(() => changeCallback?.("/project/a"));
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(2);

    // While that walk is still pending, fire another change + advance debounce.
    // The second walk attempt must NOT start until the first resolves.
    act(() => changeCallback?.("/project/b"));
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(2);

    // Resolve the first walk; in-flight guard releases.
    resolveFirstWalk(["mid.ts"]);
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
  });

  it("calls unwatchDirectory and unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    const bridge = {
      ...makeBridge(),
      onDirectoryChanged: vi.fn().mockReturnValue(unsubscribe),
    };

    const { unmount } = renderHook(() => useFileMentions("/project", bridge));
    await waitFor(() => expect(bridge.listAllFiles).toHaveBeenCalled());

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(bridge.unwatchDirectory).toHaveBeenCalled();
  });

  it("returns empty files and no loading when cwd is undefined", () => {
    const bridge = makeBridge();
    const { result } = renderHook(() => useFileMentions(undefined, bridge));
    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(bridge.listAllFiles).not.toHaveBeenCalled();
  });

  it("returns empty files and no loading when bridge is undefined", () => {
    const { result } = renderHook(() => useFileMentions("/project", undefined));
    expect(result.current.loading).toBe(false);
    expect(result.current.files).toEqual([]);
  });
});

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

  it("re-fetches when onDirectoryChanged fires", async () => {
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
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(1);

    // Simulate a file system change
    bridge.listAllFiles.mockResolvedValueOnce(["src/App.tsx", "src/new.ts"]);
    act(() => {
      changeCallback?.("/project/src");
    });

    await waitFor(() =>
      expect(result.current.files).toEqual(["src/App.tsx", "src/new.ts"]),
    );
    expect(bridge.listAllFiles).toHaveBeenCalledTimes(2);
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

# FileExplorer Auto-Reload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh `FileExplorer` tree nodes in real time when the agent creates or deletes files, using `fs.watch` in the Electron main process pushing IPC events to the renderer.

**Architecture:** `fs.watch(cwd, { recursive: true })` in the main process debounces change events per directory and pushes `FILES_DIR_CHANGED` to the renderer. The renderer re-fetches only loaded directory nodes whose path matches and merges the result, preserving expanded state.

**Tech Stack:** Node.js `fs.watch`, Electron IPC (`ipcMain.handle` / `webContents.send`), React `useEffect`, Vitest

**Spec:** `docs/superpowers/specs/2026-03-12-filesystem-viewer-auto-reload-design.md`

---

## Chunk 1: IPC Channels + Main Process Watcher

### Task 1: Add IPC channel constants

**Files:**
- Modify: `packages/desktop/src/common/ipc-channels.ts`

- [ ] **Step 1: Add the three new channel names to the `IPC_CHANNELS` object, under the `// File explorer` comment**

  ```ts
  // File explorer
  FILES_LIST_DIR: "files:list-dir",
  FILES_READ_FILE: "files:read-file",
  FILES_WATCH_START: "files:watch-start",
  FILES_WATCH_STOP: "files:watch-stop",
  FILES_DIR_CHANGED: "files:dir-changed",
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm --filter @stratosapp/desktop exec tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/common/ipc-channels.ts
  git commit -m "feat: add FILES_WATCH_START/STOP/DIR_CHANGED IPC channels"
  ```

---

### Task 2: Main process watcher — write tests first

**Files:**
- Modify: `packages/desktop/src/main/files/files.ipc.ts`
- Create: `packages/desktop/src/main/files/__tests__/files-watcher.test.ts`

> **Context:** Look at `packages/desktop/src/main/__tests__/thread.ipc.test.ts` to see the established test pattern: `vi.mock("electron", ...)` with a `handleMocks` map to capture registered handlers, then call them directly. Use the same pattern here.

- [ ] **Step 1: Write the test file**

  ```ts
  // packages/desktop/src/main/files/__tests__/files-watcher.test.ts
  import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
  import { join, dirname } from "path";

  // --- Electron mock ---
  type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
  const handleMocks = new Map<string, IpcHandler>();

  vi.mock("electron", () => ({
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handleMocks.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    },
  }));

  // --- fs mock ---
  const mockWatcherClose = vi.fn();
  const mockWatcherOn = vi.fn().mockReturnThis();
  let capturedWatchHandler: ((eventType: string, filename: string | null) => void) | null = null;

  vi.mock("fs", () => ({
    watch: vi.fn((_, _opts, handler) => {
      capturedWatchHandler = handler;
      return { close: mockWatcherClose, on: mockWatcherOn };
    }),
  }));

  describe("files watcher IPC", () => {
    let mockWebContents: { send: Mock; isDestroyed: Mock };

    beforeEach(async () => {
      handleMocks.clear();
      capturedWatchHandler = null;
      mockWatcherClose.mockReset();
      mockWatcherOn.mockReset().mockReturnThis();

      mockWebContents = {
        send: vi.fn(),
        isDestroyed: vi.fn().mockReturnValue(false),
      };

      // Re-import to re-register handlers after vi.mock reset
      vi.resetModules();
      const { registerFilesIpc } = await import("../files.ipc");
      registerFilesIpc();
    });

    it("FILES_WATCH_START registers a watcher for the given cwd", async () => {
      const { watch } = await import("fs");
      const handler = handleMocks.get("files:watch-start");
      expect(handler).toBeDefined();

      await handler!({ sender: mockWebContents }, "/some/cwd");
      expect(watch).toHaveBeenCalledWith(
        "/some/cwd",
        { recursive: true },
        expect.any(Function),
      );
    });

    it("FILES_WATCH_START attaches an error handler to prevent crashes", async () => {
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");
      expect(mockWatcherOn).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("error handler closes the watcher", async () => {
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");
      const [, errorHandler] = mockWatcherOn.mock.calls.find(
        ([evt]) => evt === "error",
      )!;
      errorHandler(new Error("ENOENT"));
      expect(mockWatcherClose).toHaveBeenCalled();
    });

    it("watcher event sends FILES_DIR_CHANGED with the parent directory", async () => {
      vi.useFakeTimers();
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");

      capturedWatchHandler!("change", "src/foo.ts");
      vi.advanceTimersByTime(150);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        "files:dir-changed",
        join("/some/cwd", dirname("src/foo.ts")),
      );
      vi.useRealTimers();
    });

    it("watcher event for root-level file sends cwd as the changed dir", async () => {
      vi.useFakeTimers();
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");

      capturedWatchHandler!("change", "package.json");
      vi.advanceTimersByTime(150);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        "files:dir-changed",
        "/some/cwd",
      );
      vi.useRealTimers();
    });

    it("null filename falls back to cwd", async () => {
      vi.useFakeTimers();
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");

      capturedWatchHandler!("rename", null);
      vi.advanceTimersByTime(150);

      expect(mockWebContents.send).toHaveBeenCalledWith(
        "files:dir-changed",
        "/some/cwd",
      );
      vi.useRealTimers();
    });

    it("does not send if webContents is destroyed", async () => {
      vi.useFakeTimers();
      mockWebContents.isDestroyed.mockReturnValue(true);
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");

      capturedWatchHandler!("change", "src/foo.ts");
      vi.advanceTimersByTime(150);

      expect(mockWebContents.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("debounces rapid events for the same directory", async () => {
      vi.useFakeTimers();
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/some/cwd");

      capturedWatchHandler!("change", "src/a.ts");
      capturedWatchHandler!("change", "src/b.ts");
      capturedWatchHandler!("change", "src/c.ts");
      vi.advanceTimersByTime(150);

      expect(mockWebContents.send).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("FILES_WATCH_STOP closes the watcher", async () => {
      const startHandler = handleMocks.get("files:watch-start");
      await startHandler!({ sender: mockWebContents }, "/some/cwd");

      const stopHandler = handleMocks.get("files:watch-stop");
      expect(stopHandler).toBeDefined();
      await stopHandler!({});

      expect(mockWatcherClose).toHaveBeenCalled();
    });

    it("FILES_WATCH_STOP is a no-op if no watcher is active", async () => {
      const stopHandler = handleMocks.get("files:watch-stop");
      // Should not throw
      await expect(stopHandler!({})).resolves.toBeUndefined();
    });

    it("starting a second watcher closes the first", async () => {
      const handler = handleMocks.get("files:watch-start");
      await handler!({ sender: mockWebContents }, "/cwd-a");
      await handler!({ sender: mockWebContents }, "/cwd-b");
      expect(mockWatcherClose).toHaveBeenCalledTimes(1);
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  pnpm --filter @stratosapp/desktop test -- packages/desktop/src/main/files/__tests__/files-watcher.test.ts
  ```
  Expected: all tests FAIL (handlers not yet implemented)

- [ ] **Step 3: Implement the watcher handlers in `files.ipc.ts`**

  Add the following to `packages/desktop/src/main/files/files.ipc.ts`, after the existing imports and before `registerFilesIpc`:

  ```ts
  import { watch as fsWatch } from "fs";
  import type { FSWatcher } from "fs";
  import { join, dirname } from "path";
  import type { WebContents } from "electron";

  // Watcher state — one watcher per process
  let activeWatcher: FSWatcher | null = null;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function closeActiveWatcher(): void {
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
  }
  ```

  Then inside `registerFilesIpc()`, add two new `ipcMain.handle` calls after the existing ones:

  ```ts
  ipcMain.handle(
    IPC_CHANNELS.FILES_WATCH_START,
    (_event, cwd: string): void => {
      const webContents: WebContents = _event.sender;
      closeActiveWatcher();
      const watcher = fsWatch(cwd, { recursive: true }, (_, filename) => {
        const changedDir =
          filename == null ? cwd : join(cwd, dirname(filename));
        const existing = debounceTimers.get(changedDir);
        if (existing) clearTimeout(existing);
        debounceTimers.set(
          changedDir,
          setTimeout(() => {
            debounceTimers.delete(changedDir);
            if (!webContents.isDestroyed()) {
              webContents.send(IPC_CHANNELS.FILES_DIR_CHANGED, changedDir);
            }
          }, 100),
        );
      });
      watcher.on("error", () => {
        watcher.close();
        if (activeWatcher === watcher) activeWatcher = null;
      });
      activeWatcher = watcher;
    },
  );

  ipcMain.handle(IPC_CHANNELS.FILES_WATCH_STOP, (): void => {
    closeActiveWatcher();
  });
  ```

  Also add to `unregisterFilesIpc()`:

  ```ts
  closeActiveWatcher();
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_START);
  ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_STOP);
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  pnpm --filter @stratosapp/desktop test -- packages/desktop/src/main/files/__tests__/files-watcher.test.ts
  ```
  Expected: all tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

  ```bash
  pnpm test
  ```
  Expected: all existing tests still pass

- [ ] **Step 6: Commit**

  ```bash
  git add packages/desktop/src/main/files/files.ipc.ts \
          packages/desktop/src/main/files/__tests__/files-watcher.test.ts
  git commit -m "feat: add fs.watch watcher IPC handlers to files.ipc.ts"
  ```

---

## Chunk 2: Bridge, Preload, and FileExplorer

### Task 3: Extend bridge types

**Files:**
- Modify: `packages/ui/src/bridges/types.ts`

- [ ] **Step 1: Add three methods to the `FilesBridge` interface**

  ```ts
  export interface FilesBridge {
    listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
    readFile(
      filePath: string,
      rootPath: string,
    ): Promise<{ content: string; isBinary: boolean }>;
    watchDirectory(cwd: string): Promise<void>;
    unwatchDirectory(): Promise<void>;
    onDirectoryChanged(callback: (dirPath: string) => void): () => void;
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/ui exec tsc --noEmit
  ```
  Expected: no errors (the new methods are optional to existing consumers until we wire them)

- [ ] **Step 3: Commit**

  ```bash
  git add packages/ui/src/bridges/types.ts
  git commit -m "feat: add watchDirectory/unwatchDirectory/onDirectoryChanged to FilesBridge"
  ```

---

### Task 4: Expose watcher methods in preload

**Files:**
- Modify: `packages/desktop/src/preload/index.ts`

> **Context:** The preload file follows a consistent pattern. `ipcRenderer.invoke` for `handle` channels; `ipcRenderer.on` for push channels with a returned cleanup function. Look at `onPreviewOpenUrl` (line 274) as a template for the push listener pattern.

- [ ] **Step 1: Add three new entries to the `api` object, under the `// File explorer` comment**

  ```ts
  // File explorer
  filesListDir: (
    dirPath: string,
    rootPath: string,
  ): Promise<{ name: string; type: "file" | "directory"; size: number }[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST_DIR, dirPath, rootPath),

  filesReadFile: (
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_READ_FILE, filePath, rootPath),

  filesWatchStart: (cwd: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_START, cwd),

  filesWatchStop: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_STOP),

  filesOnDirChanged: (callback: (dirPath: string) => void): (() => void) => {
    const listener = (_event: unknown, dirPath: string) => callback(dirPath);
    ipcRenderer.on(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
  },
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/desktop exec tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/preload/index.ts
  git commit -m "feat: expose filesWatchStart/Stop/OnDirChanged in preload"
  ```

---

### Task 5: Wire bridge methods in App.tsx

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`

> **Context:** The `filesBridge` prop is passed to `PreviewPane` around line 710. Find that section and add the three new methods alongside the existing two.

- [ ] **Step 1: Update the `filesBridge` object passed to `PreviewPane`**

  Find:
  ```ts
  filesBridge={{
    listDirectory: window.api.filesListDir,
    readFile: window.api.filesReadFile,
  }}
  ```

  Replace with:
  ```ts
  filesBridge={{
    listDirectory: window.api.filesListDir,
    readFile: window.api.filesReadFile,
    watchDirectory: window.api.filesWatchStart,
    unwatchDirectory: window.api.filesWatchStop,
    onDirectoryChanged: window.api.filesOnDirChanged,
  }}
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/desktop exec tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/renderer/App.tsx
  git commit -m "feat: wire watchDirectory bridge methods in App.tsx"
  ```

---

### Task 6: FileExplorer — watcher lifecycle + merge logic

**Files:**
- Modify: `packages/ui/src/components/FileExplorer.tsx`
- Create: `packages/ui/src/components/__tests__/FileExplorer.merge.test.ts`

- [ ] **Step 1: Extract the merge logic as a pure function and write tests for it**

  Create `packages/ui/src/components/__tests__/FileExplorer.merge.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { mergeTreeNodes } from "../FileExplorer";
  import type { TreeNode } from "../FileExplorer";
  import type { DirEntry } from "../../bridges/types";

  function makeFile(name: string): DirEntry {
    return { name, type: "file", size: 100 };
  }
  function makeDir(name: string): DirEntry {
    return { name, type: "directory", size: 0 };
  }
  function makeNode(name: string, path: string, overrides: Partial<TreeNode> = {}): TreeNode {
    return {
      entry: makeFile(name),
      path,
      loaded: false,
      expanded: false,
      ...overrides,
    };
  }

  describe("mergeTreeNodes", () => {
    it("adds new entries that did not exist before", () => {
      const existing: TreeNode[] = [makeNode("a.ts", "/cwd/a.ts")];
      const fresh: DirEntry[] = [makeFile("a.ts"), makeFile("b.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result.map((n) => n.entry.name)).toEqual(["a.ts", "b.ts"]);
    });

    it("removes entries that no longer exist", () => {
      const existing: TreeNode[] = [
        makeNode("a.ts", "/cwd/a.ts"),
        makeNode("deleted.ts", "/cwd/deleted.ts"),
      ];
      const fresh: DirEntry[] = [makeFile("a.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result.map((n) => n.entry.name)).toEqual(["a.ts"]);
    });

    it("preserves expanded and loaded state of existing entries", () => {
      const child = makeNode("child.ts", "/cwd/src/child.ts");
      const existing: TreeNode[] = [
        makeNode("src", "/cwd/src", {
          entry: makeDir("src"),
          loaded: true,
          expanded: true,
          children: [child],
        }),
      ];
      const fresh: DirEntry[] = [makeDir("src"), makeFile("new.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      const srcNode = result.find((n) => n.entry.name === "src")!;
      expect(srcNode.expanded).toBe(true);
      expect(srcNode.loaded).toBe(true);
      expect(srcNode.children).toEqual([child]);
    });

    it("new entries start as unloaded and unexpanded", () => {
      const existing: TreeNode[] = [];
      const fresh: DirEntry[] = [makeDir("newdir")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result[0].loaded).toBe(false);
      expect(result[0].expanded).toBe(false);
      expect(result[0].children).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  pnpm --filter @stratosapp/ui test -- packages/ui/src/components/__tests__/FileExplorer.merge.test.ts
  ```
  Expected: FAIL — `mergeTreeNodes` is not exported

- [ ] **Step 3: Export `TreeNode` type and add `mergeTreeNodes` function to `FileExplorer.tsx`**

  Add `export` to the `TreeNode` interface at the top of `FileExplorer.tsx`:
  ```ts
  export interface TreeNode { ... }
  ```

  Add the pure merge function (before the `FileExplorer` component):
  ```ts
  export function mergeTreeNodes(
    existing: TreeNode[],
    fresh: DirEntry[],
    parentPath: string,
  ): TreeNode[] {
    const existingByName = new Map(existing.map((n) => [n.entry.name, n]));
    return fresh.map((entry) => {
      const prev = existingByName.get(entry.name);
      if (prev) {
        return { ...prev, entry }; // update size/type, preserve tree state
      }
      return {
        entry,
        path: `${parentPath}/${entry.name}`,
        loaded: false,
        expanded: false,
      };
    });
  }
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  pnpm --filter @stratosapp/ui test -- packages/ui/src/components/__tests__/FileExplorer.merge.test.ts
  ```
  Expected: all PASS

- [ ] **Step 5: Add watcher lifecycle and `handleDirChanged` to the `FileExplorer` component**

  In `FileExplorer.tsx`, update the `Props` interface to include the three new bridge methods (optional so the component still renders without them):

  ```ts
  interface Props {
    cwd: string;
    targetFilePath?: string;
    targetLine?: number;
    listDirectory: (dirPath: string, rootPath: string) => Promise<DirEntry[]>;
    readFile: (
      filePath: string,
      rootPath: string,
    ) => Promise<{ content: string; isBinary: boolean }>;
    watchDirectory?: (cwd: string) => Promise<void>;
    unwatchDirectory?: () => Promise<void>;
    onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
  }
  ```

  Add a `useRef` to always track the latest tree without re-running the watcher effect. Add this near the top of the component, alongside the other `useRef`/`useState` calls:

  ```ts
  const treeRef = useRef<TreeNode[]>(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  ```

  Add the watcher `useEffect` after the existing `useEffect` that loads the root directory:

  ```ts
  useEffect(() => {
    if (!watchDirectory || !unwatchDirectory || !onDirectoryChanged) return;

    const handleDirChanged = async (changedDirPath: string) => {
      const currentTree = treeRef.current;

      // Root case: entries live directly in `tree`, not as children of a node
      if (changedDirPath === cwd) {
        try {
          const fresh = await listDirectory(cwd, cwd);
          // Use functional updater to avoid stale closure over `tree`
          setTree((prev) => mergeTreeNodes(prev, fresh, cwd));
        } catch {
          // keep stale on error
        }
        return;
      }

      // Subtree case: walk and refresh any loaded node whose path matches
      const refreshInTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        const result: TreeNode[] = [];
        for (const node of nodes) {
          if (node.path === changedDirPath && node.loaded) {
            try {
              const fresh = await listDirectory(changedDirPath, cwd);
              result.push({
                ...node,
                children: mergeTreeNodes(node.children ?? [], fresh, changedDirPath),
              });
            } catch {
              result.push(node); // keep stale on error
            }
          } else if (node.children) {
            result.push({ ...node, children: await refreshInTree(node.children) });
          } else {
            result.push(node);
          }
        }
        return result;
      };

      // Do async work on a snapshot, then apply atomically.
      // Last-write-wins if multiple events fire concurrently — acceptable since
      // listDirectory always fetches fresh data from disk.
      const updated = await refreshInTree(currentTree);
      setTree(updated);
    };

    // Register listener BEFORE starting watcher — events can arrive before invoke resolves
    const cleanup = onDirectoryChanged(handleDirChanged);
    void watchDirectory(cwd);

    return () => {
      cleanup(); // remove listener first to close the stale-event window
      void unwatchDirectory();
    };
  }, [cwd, watchDirectory, unwatchDirectory, onDirectoryChanged, listDirectory]);
  ```

- [ ] **Step 6: Run all tests**

  ```bash
  pnpm test
  ```
  Expected: all pass

- [ ] **Step 7: Typecheck all packages**

  ```bash
  pnpm --filter @stratosapp/desktop exec tsc --noEmit
  pnpm --filter @stratosapp/ui exec tsc --noEmit
  ```
  Expected: no errors

- [ ] **Step 8: Commit**

  ```bash
  git add packages/ui/src/components/FileExplorer.tsx \
          packages/ui/src/components/__tests__/FileExplorer.merge.test.ts
  git commit -m "feat: add watcher lifecycle and dir-change merge logic to FileExplorer"
  ```

---

## Final Verification

- [ ] **Build the full project**

  ```bash
  pnpm build
  ```
  Expected: all three packages build without errors

- [ ] **Manual smoke test**
  1. Run `pnpm --filter @stratosapp/desktop dev:debug`
  2. Open a thread with a git repo as its cwd
  3. Open the file explorer panel
  4. In a terminal, run `touch <cwd>/test-auto-reload.txt`
  5. Verify the file appears in the explorer within ~1 second without any manual refresh
  6. Run `rm <cwd>/test-auto-reload.txt`
  7. Verify the file disappears from the explorer

- [ ] **Final commit if anything was missed**

  ```bash
  git add -p
  git commit -m "chore: filesystem viewer auto-reload cleanup"
  ```

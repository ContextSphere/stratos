# FileExplorer Auto-Reload Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live-reload the FileExplorer tree when files are created or deleted on disk, using `fs.watch` in the Electron main process pushing IPC events to the renderer.

**Architecture:** Main process watches `cwd` recursively with `fs.watch`; debounces change events per directory and pushes `FILES_DIR_CHANGED` to the renderer via `webContents.send`. Renderer re-fetches only the affected loaded nodes and merges new entries into the tree while preserving expanded subtree state. Deleted entries are dropped from the result.

**Tech Stack:** Node.js `fs.watch` (built-in), Electron IPC (`ipcMain.handle` / `webContents.send` / `ipcRenderer.on`), React `useEffect`, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-12-filesystem-viewer-auto-reload-design.md`

---

## Chunk 1: IPC channels + main process watcher

### Task 1: Add IPC channel names

**Files:**

- Modify: `packages/desktop/src/common/ipc-channels.ts`

> **Note:** As of this writing the three channels may already have been added. Verify by checking if `FILES_WATCH_START`, `FILES_WATCH_STOP`, `FILES_DIR_CHANGED` exist in the file before editing.

- [ ] **Step 1: Add three channel constants under the `// File explorer` comment (skip if already present)**

  Find:

  ```ts
  // File explorer
  FILES_LIST_DIR: "files:list-dir",
  FILES_READ_FILE: "files:read-file",
  ```

  Add three lines after `FILES_READ_FILE`:

  ```ts
  FILES_WATCH_START: "files:watch-start",
  FILES_WATCH_STOP: "files:watch-stop",
  FILES_DIR_CHANGED: "files:dir-changed",
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/desktop typecheck
  ```

  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/common/ipc-channels.ts
  git commit -m "feat: add FILES_WATCH_START/STOP/DIR_CHANGED IPC channels"
  ```

---

### Task 2: Main process watcher

**Files:**

- Modify: `packages/desktop/src/main/files/files.ipc.ts`
- Create: `packages/desktop/src/main/__tests__/files.watcher.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `packages/desktop/src/main/__tests__/files.watcher.test.ts`:

  ```ts
  import {
    beforeEach,
    afterEach,
    describe,
    expect,
    it,
    vi,
    type Mock,
  } from "vitest";

  // ---- Mocks ----------------------------------------------------------------

  const handleMocks = new Map<string, (...args: unknown[]) => unknown>();

  vi.mock("electron", () => ({
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handleMocks.set(channel, handler);
        },
      ),
      removeHandler: vi.fn(),
    },
  }));

  const mockWatcherClose = vi.fn();
  const mockWatcherOn = vi.fn().mockReturnThis();
  let capturedWatchHandler:
    | ((eventType: string, filename: string | null) => void)
    | null = null;

  vi.mock("fs", () => ({
    watch: vi.fn(
      (
        _path: string,
        _opts: object,
        handler: (e: string, f: string | null) => void,
      ) => {
        capturedWatchHandler = handler;
        return { close: mockWatcherClose, on: mockWatcherOn };
      },
    ),
  }));

  // ---- Helpers --------------------------------------------------------------

  function makeWebContents(destroyed = false): {
    send: Mock;
    isDestroyed: Mock;
  } {
    return {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(destroyed),
    };
  }

  async function invoke(
    channel: string,
    wc: ReturnType<typeof makeWebContents>,
    ...args: unknown[]
  ) {
    const handler = handleMocks.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({ sender: wc }, ...args);
  }

  // ---- Tests ----------------------------------------------------------------

  describe("files watcher IPC", () => {
    beforeEach(async () => {
      handleMocks.clear();
      capturedWatchHandler = null;
      mockWatcherClose.mockReset();
      mockWatcherOn.mockReset().mockReturnThis();
      vi.useFakeTimers();
      vi.resetModules();
      const { registerFilesIpc } = await import("../files/files.ipc");
      registerFilesIpc();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("FILES_WATCH_START calls fs.watch with cwd and recursive:true", async () => {
      const { watch } = await import("fs");
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      expect(watch).toHaveBeenCalledWith(
        "/my/project",
        { recursive: true },
        expect.any(Function),
      );
    });

    it("attaches an error handler to prevent process crash", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      expect(mockWatcherOn).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("error handler closes the watcher", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      const [, errorHandler] = mockWatcherOn.mock.calls.find(
        ([e]) => e === "error",
      )!;
      errorHandler(new Error("ENOENT"));
      expect(mockWatcherClose).toHaveBeenCalled();
    });

    it("sends FILES_DIR_CHANGED after debounce for nested file change", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      capturedWatchHandler!("change", "src/index.ts");
      expect(wc.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(wc.send).toHaveBeenCalledWith(
        "files:dir-changed",
        "/my/project/src",
      );
    });

    it("sends cwd when filename is a root-level file", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      capturedWatchHandler!("change", "package.json");
      vi.advanceTimersByTime(100);
      expect(wc.send).toHaveBeenCalledWith("files:dir-changed", "/my/project");
    });

    it("sends cwd when filename is null", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      capturedWatchHandler!("rename", null);
      vi.advanceTimersByTime(100);
      expect(wc.send).toHaveBeenCalledWith("files:dir-changed", "/my/project");
    });

    it("skips send if webContents is destroyed", async () => {
      const wc = makeWebContents(true);
      await invoke("files:watch-start", wc, "/my/project");
      capturedWatchHandler!("change", "src/foo.ts");
      vi.advanceTimersByTime(100);
      expect(wc.send).not.toHaveBeenCalled();
    });

    it("debounces rapid changes to the same dir into one send", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      capturedWatchHandler!("change", "src/a.ts");
      capturedWatchHandler!("change", "src/b.ts");
      capturedWatchHandler!("change", "src/c.ts");
      vi.advanceTimersByTime(100);
      expect(wc.send).toHaveBeenCalledTimes(1);
    });

    it("starting a new watcher closes the previous one", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/cwd-a");
      await invoke("files:watch-start", wc, "/cwd-b");
      expect(mockWatcherClose).toHaveBeenCalledTimes(1);
    });

    it("FILES_WATCH_STOP closes the active watcher", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      await invoke("files:watch-stop", wc, "/my/project");
      expect(mockWatcherClose).toHaveBeenCalled();
    });

    it("FILES_WATCH_STOP with matching cwd closes the watcher", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/my/project");
      await invoke("files:watch-stop", wc, "/my/project");
      expect(mockWatcherClose).toHaveBeenCalledTimes(1);
    });

    it("FILES_WATCH_STOP with non-matching cwd is a no-op (guards against race)", async () => {
      const wc = makeWebContents();
      await invoke("files:watch-start", wc, "/new/project");
      // Old cwd tries to stop — should not close the new watcher
      await invoke("files:watch-stop", wc, "/old/project");
      expect(mockWatcherClose).not.toHaveBeenCalled();
    });

    it("FILES_WATCH_STOP is a no-op when no watcher is active", async () => {
      const wc = makeWebContents();
      await expect(
        invoke("files:watch-stop", wc, "/my/project"),
      ).resolves.toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they all fail**

  ```bash
  pnpm --filter @stratosapp/desktop test -- --reporter=verbose files.watcher
  ```

  Expected: all tests fail

- [ ] **Step 3: Implement the watcher in `files.ipc.ts`**

  Open `packages/desktop/src/main/files/files.ipc.ts`.

  Add a new import line for the synchronous `fs.watch` (keep the existing `fs/promises` import unchanged):

  ```ts
  import { watch, type FSWatcher } from "fs";
  ```

  Update the path import to include `dirname`:

  ```ts
  import { join, resolve, dirname } from "path";
  ```

  Add module-level state after the `MAX_FILE_SIZE` constant:

  ```ts
  // One watcher per process — single-panel constraint (see design spec)
  let activeWatcher: FSWatcher | null = null;
  let activeCwd: string | null = null;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  ```

  At the end of `registerFilesIpc()`, before its closing `}`, add:

  ```ts
  ipcMain.handle(
    IPC_CHANNELS.FILES_WATCH_START,
    (_event, cwd: string): void => {
      // Close any existing watcher first
      if (activeWatcher) {
        activeWatcher.close();
        activeWatcher = null;
      }
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      activeCwd = cwd;

      const webContents = _event.sender;

      const watcher = watch(cwd, { recursive: true }, (_, filename) => {
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
        if (activeWatcher === watcher) {
          activeWatcher = null;
          activeCwd = null;
        }
      });

      activeWatcher = watcher;
    },
  );

  // cwd parameter is a guard: only stop if we're watching that exact cwd.
  // Prevents a race where an old cwd's cleanup stops a newly-started watcher
  // for a different cwd (React cleanup fires before new effect, but both are
  // async IPC — passing cwd makes the guard explicit and safe).
  ipcMain.handle(IPC_CHANNELS.FILES_WATCH_STOP, (_event, cwd: string): void => {
    if (activeCwd !== cwd) return; // guard against stale stop from old cwd
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    activeCwd = null;
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
  });
  ```

  Update `unregisterFilesIpc()`:

  ```ts
  export function unregisterFilesIpc(): void {
    ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_DIR);
    ipcMain.removeHandler(IPC_CHANNELS.FILES_READ_FILE);
    ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_START);
    ipcMain.removeHandler(IPC_CHANNELS.FILES_WATCH_STOP);
    if (activeWatcher) {
      activeWatcher.close();
      activeWatcher = null;
    }
    activeCwd = null;
  }
  ```

- [ ] **Step 4: Run tests — all should pass**

  ```bash
  pnpm --filter @stratosapp/desktop test -- --reporter=verbose files.watcher
  ```

  Expected: all 12 tests pass

- [ ] **Step 5: Run full suite**

  ```bash
  pnpm test
  ```

  Expected: all tests pass

- [ ] **Step 6: Commit**

  ```bash
  git add packages/desktop/src/main/files/files.ipc.ts \
          packages/desktop/src/main/__tests__/files.watcher.test.ts
  git commit -m "feat: add fs.watch watcher IPC handlers to files.ipc"
  ```

---

## Chunk 2: Bridge, preload, App wiring, and FileExplorer

### Task 3: Add bridge type methods

**Files:**

- Modify: `packages/ui/src/bridges/types.ts`

- [ ] **Step 1: Add 3 optional methods to `FilesBridge`**

  Find:

  ```ts
  export interface FilesBridge {
    listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
    readFile(
      filePath: string,
      rootPath: string,
    ): Promise<{ content: string; isBinary: boolean }>;
  }
  ```

  Replace with:

  ```ts
  export interface FilesBridge {
    listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
    readFile(
      filePath: string,
      rootPath: string,
    ): Promise<{ content: string; isBinary: boolean }>;
    // Optional — not all bridge contexts support file watching
    watchDirectory?(cwd: string): Promise<void>;
    unwatchDirectory?(cwd: string): Promise<void>;
    onDirectoryChanged?(callback: (dirPath: string) => void): () => void;
  }
  ```

  Note: `unwatchDirectory` takes `cwd` so the main process can guard against stopping the wrong watcher in a CWD-switch race.

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/ui typecheck
  ```

  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/ui/src/bridges/types.ts
  git commit -m "feat: add watchDirectory/unwatchDirectory/onDirectoryChanged to FilesBridge"
  ```

---

### Task 4: Expose methods in preload

**Files:**

- Modify: `packages/desktop/src/preload/index.ts`

- [ ] **Step 1: Add three methods after `filesReadFile` in the api object**

  Find:

  ```ts
  filesReadFile: (
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_READ_FILE, filePath, rootPath),
  ```

  Add after it:

  ```ts
  filesWatchStart: (cwd: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_START, cwd),

  // cwd is passed as a guard on the main process side — see files.ipc.ts
  filesWatchStop: (cwd: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_WATCH_STOP, cwd),

  // NOTE: unlike other preload listeners, this one MUST return the cleanup fn.
  // Do not change the return type to void — FileExplorer depends on this to
  // remove the listener on cleanup. The return value flows through ElectronAPI
  // via `typeof api` inference.
  filesOnDirChanged: (callback: (dirPath: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, dirPath: string) =>
      callback(dirPath);
    ipcRenderer.on(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.FILES_DIR_CHANGED, listener);
  },
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm --filter @stratosapp/desktop typecheck
  ```

  Expected: no errors. TypeScript will infer `filesOnDirChanged` as `(callback: ...) => () => void` from the function body — verify the return type is NOT `void`.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/preload/index.ts
  git commit -m "feat: expose filesWatchStart/Stop/OnDirChanged in preload"
  ```

---

### Task 5: Wire bridge methods in App.tsx

**Files:**

- Modify: `packages/desktop/src/renderer/App.tsx`

> **Note:** `window.api.filesListDir`, `window.api.filesWatchStart`, etc. are all stable references — they're properties of the module-level `api` object defined in the preload. Assigning them inline in the JSX object literal does NOT cause the watcher `useEffect` to re-fire on every render, because each prop's function identity is stable across renders.

- [ ] **Step 1: Extend the `filesBridge` prop**

  Find:

  ```tsx
  filesBridge={{
    listDirectory: window.api.filesListDir,
    readFile: window.api.filesReadFile,
  }}
  ```

  Replace with:

  ```tsx
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
  pnpm --filter @stratosapp/desktop typecheck
  ```

  Expected: no errors

- [ ] **Step 3: Commit**

  ```bash
  git add packages/desktop/src/renderer/App.tsx
  git commit -m "feat: wire watcher bridge methods in App.tsx"
  ```

---

### Task 6: FileExplorer — merge logic and watcher lifecycle

**Files:**

- Modify: `packages/ui/src/components/FileExplorer.tsx`
- Modify: `packages/ui/src/components/PreviewPane.tsx`

- [ ] **Step 1: Export `TreeNode` and write failing tests for `mergeTreeNodes`**

  Create `packages/ui/src/components/__tests__/FileExplorer.merge.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { mergeTreeNodes } from "../FileExplorer";
  import type { TreeNode } from "../FileExplorer";
  import type { DirEntry } from "../../bridges/types";

  function file(name: string): DirEntry {
    return { name, type: "file", size: 100 };
  }
  function dir(name: string): DirEntry {
    return { name, type: "directory", size: 0 };
  }
  function node(
    name: string,
    path: string,
    overrides: Partial<TreeNode> = {},
  ): TreeNode {
    return {
      entry: file(name),
      path,
      loaded: false,
      expanded: false,
      ...overrides,
    };
  }

  describe("mergeTreeNodes", () => {
    it("adds new entries from fresh listing", () => {
      const existing = [node("a.ts", "/cwd/a.ts")];
      const fresh = [file("a.ts"), file("b.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result.map((n) => n.entry.name)).toEqual(["a.ts", "b.ts"]);
    });

    it("drops entries absent from the fresh listing (deleted files)", () => {
      const existing = [
        node("a.ts", "/cwd/a.ts"),
        node("gone.ts", "/cwd/gone.ts"),
      ];
      const fresh = [file("a.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result.map((n) => n.entry.name)).toEqual(["a.ts"]);
    });

    it("preserves expanded/loaded/children state for existing entries", () => {
      const child = node("child.ts", "/cwd/src/child.ts");
      const existing = [
        node("src", "/cwd/src", {
          entry: dir("src"),
          loaded: true,
          expanded: true,
          children: [child],
        }),
      ];
      const fresh = [dir("src"), file("new.ts")];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      const srcNode = result.find((n) => n.entry.name === "src")!;
      expect(srcNode.expanded).toBe(true);
      expect(srcNode.loaded).toBe(true);
      expect(srcNode.children).toEqual([child]);
    });

    it("new entries start unloaded and unexpanded", () => {
      const result = mergeTreeNodes([], [dir("newdir")], "/cwd");
      expect(result[0].loaded).toBe(false);
      expect(result[0].expanded).toBe(false);
      expect(result[0].children).toBeUndefined();
    });

    it("updates entry metadata (size) for existing entries", () => {
      const existing = [node("a.ts", "/cwd/a.ts")]; // size: 100
      const fresh = [{ name: "a.ts", type: "file" as const, size: 999 }];
      const result = mergeTreeNodes(existing, fresh, "/cwd");
      expect(result[0].entry.size).toBe(999);
    });
  });
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  pnpm --filter @stratosapp/ui test -- --reporter=verbose FileExplorer.merge
  ```

  Expected: all fail (`mergeTreeNodes` not exported yet)

- [ ] **Step 3: Export `TreeNode` interface and add `mergeTreeNodes` to `FileExplorer.tsx`**

  In `FileExplorer.tsx`, add `export` to the `TreeNode` interface:

  ```ts
  export interface TreeNode {
    entry: DirEntry;
    path: string;
    children?: TreeNode[];
    loaded: boolean;
    expanded: boolean;
  }
  ```

  Add this exported pure function after `formatSize` and before `FolderIcon`:

  ```ts
  // Exported for testing. Merges a fresh directory listing into existing tree nodes.
  // - Entries present in `fresh` but absent from `existing`: added as unloaded/unexpanded
  // - Entries present in `existing` but absent from `fresh`: dropped (file deleted)
  // - Entries present in both: existing tree state preserved, entry metadata updated
  export function mergeTreeNodes(
    existing: TreeNode[],
    fresh: DirEntry[],
    parentPath: string,
  ): TreeNode[] {
    const existingByName = new Map(existing.map((n) => [n.entry.name, n]));
    return fresh.map((entry) => {
      const prev = existingByName.get(entry.name);
      if (prev) {
        return { ...prev, entry }; // update metadata, preserve tree state
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

- [ ] **Step 4: Run tests — all should pass**

  ```bash
  pnpm --filter @stratosapp/ui test -- --reporter=verbose FileExplorer.merge
  ```

  Expected: all 5 tests pass

- [ ] **Step 5: Add watcher props and lifecycle to `FileExplorer`**

  Update the `Props` interface (add 3 optional props at the end):

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
    unwatchDirectory?: (cwd: string) => Promise<void>;
    onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
  }
  ```

  Update the component signature to destructure the new props:

  ```ts
  export function FileExplorer({
    cwd,
    targetFilePath,
    targetLine,
    listDirectory,
    readFile,
    watchDirectory,
    unwatchDirectory,
    onDirectoryChanged,
  }: Props): React.ReactElement {
  ```

  Add a `treeRef` to track current tree for use inside the async handler without stale closures. Place it alongside the other `useRef` declarations:

  ```ts
  const treeRef = useRef<TreeNode[]>(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  ```

  Add the watcher `useEffect` after the existing root-load effect and before the auto-open effects:

  ```ts
  // Watcher lifecycle — starts watching cwd, refreshes affected loaded nodes on change
  useEffect(() => {
    if (!watchDirectory || !unwatchDirectory || !onDirectoryChanged) return;

    const handleDirChanged = async (changedDirPath: string) => {
      try {
        const fresh = await listDirectory(changedDirPath, cwd);

        if (changedDirPath === cwd) {
          // Root level: merge directly into tree
          setTree((prev) => mergeTreeNodes(prev, fresh, cwd));
        } else {
          // Subtree: walk tree snapshot, refresh any loaded node matching the dir
          const refreshed = await (async function refresh(
            nodes: TreeNode[],
          ): Promise<TreeNode[]> {
            return Promise.all(
              nodes.map(async (node) => {
                if (node.path === changedDirPath && node.loaded) {
                  return {
                    ...node,
                    children: mergeTreeNodes(
                      node.children ?? [],
                      fresh,
                      changedDirPath,
                    ),
                  };
                }
                if (node.children) {
                  return { ...node, children: await refresh(node.children) };
                }
                return node;
              }),
            );
          })(treeRef.current);
          setTree(refreshed);
        }
      } catch {
        // Directory deleted or unreadable — keep stale state silently
      }
    };

    // Register listener BEFORE invoking watchDirectory: once FILES_WATCH_START
    // is received by main, the watcher fires immediately and events can arrive
    // before the invoke promise resolves. Registering first guarantees no events
    // are missed.
    const cleanup = onDirectoryChanged(handleDirChanged);
    void watchDirectory(cwd);

    return () => {
      // Remove listener first to close the window where a stale event for the
      // old cwd could arrive after cwd changes. Then stop the watcher.
      cleanup();
      void unwatchDirectory(cwd);
    };
  }, [
    cwd,
    watchDirectory,
    unwatchDirectory,
    onDirectoryChanged,
    listDirectory,
  ]);
  ```

- [ ] **Step 6: Pass new props through `PreviewPane`**

  In `packages/ui/src/components/PreviewPane.tsx`, find:

  ```tsx
  <FileExplorer
    cwd={preview.cwd}
    targetFilePath={preview.targetFilePath}
    targetLine={preview.targetLine}
    listDirectory={filesBridge.listDirectory}
    readFile={filesBridge.readFile}
  />
  ```

  Replace with:

  ```tsx
  <FileExplorer
    cwd={preview.cwd}
    targetFilePath={preview.targetFilePath}
    targetLine={preview.targetLine}
    listDirectory={filesBridge.listDirectory}
    readFile={filesBridge.readFile}
    watchDirectory={filesBridge.watchDirectory}
    unwatchDirectory={filesBridge.unwatchDirectory}
    onDirectoryChanged={filesBridge.onDirectoryChanged}
  />
  ```

- [ ] **Step 7: Typecheck and run all tests**

  ```bash
  pnpm --filter @stratosapp/ui typecheck
  pnpm test
  ```

  Expected: no type errors, all tests pass

- [ ] **Step 8: Commit**

  ```bash
  git add packages/ui/src/components/FileExplorer.tsx \
          packages/ui/src/components/PreviewPane.tsx \
          packages/ui/src/components/__tests__/FileExplorer.merge.test.ts
  git commit -m "feat: auto-reload FileExplorer tree via fs.watch IPC"
  ```

---

## Final verification

- [ ] **Full build**

  ```bash
  pnpm build
  ```

  Expected: all 3 packages build cleanly

- [ ] **Full test suite**

  ```bash
  pnpm test
  ```

  Expected: all tests pass

- [ ] **Manual smoke test** (app running with `pnpm --filter @stratosapp/desktop dev:debug`)
  1. Open the Files panel on any thread
  2. In a terminal: `touch <cwd>/test-file.txt` — file should appear in the tree within ~200ms
  3. `rm <cwd>/test-file.txt` — file disappears from tree
  4. Switch to a different thread (different cwd) — tree reloads for new cwd, old watch stops
  5. Delete the watched directory itself — no crash in main process

# @ File Mention Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cursor-style `@` file mention picker to the Stratos chat InputBar that fuzzy-searches the thread's working directory and inserts the selected relative path into the message.

**Architecture:** A new `files:list-all` IPC channel recursively lists all files in the thread's `cwd`. A `useFileMentions` hook holds the cached file list and subscribes to the existing `fs.watch` watcher for cache invalidation. A new `FileMentionMenu` component renders an upward-opening dropdown modeled on `SlashCommandMenu`. InputBar detects `@<query>` alongside existing `/` detection and renders the menu.

**Note on StratosProvider:** `StratosProvider` is defined in `packages/ui` but is NOT mounted in the desktop `App.tsx` — components receive bridge methods as direct props. The hook therefore accepts bridge methods as a parameter instead of calling `useFilesBridge()`. This is consistent with how `FileExplorer` works.

**Tech Stack:** Electron IPC (ipcMain.handle), Node.js `fs/promises` (readdir), React hooks, Vitest + @testing-library/react

---

## Chunk 1: IPC + Bridge Layer

### Task 1: Add `FILES_LIST_ALL` IPC channel constant

**Files:**
- Modify: `packages/desktop/src/common/ipc-channels.ts`

- [ ] **Step 1: Add the constant**

In `packages/desktop/src/common/ipc-channels.ts`, add `FILES_LIST_ALL` after `FILES_DIR_CHANGED` in the "File explorer" section (line 76):

```ts
  FILES_LIST_ALL: "files:list-all",
```

The block should now read:
```ts
  // File explorer
  FILES_LIST_DIR: "files:list-dir",
  FILES_READ_FILE: "files:read-file",
  FILES_WRITE_FILE: "files:write-file",
  FILES_WATCH_START: "files:watch-start",
  FILES_WATCH_STOP: "files:watch-stop",
  FILES_DIR_CHANGED: "files:dir-changed",
  FILES_LIST_ALL: "files:list-all",
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @stratosapp/desktop typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/common/ipc-channels.ts
git commit -m "feat: add FILES_LIST_ALL IPC channel constant"
```

---

### Task 2: Implement and test the `files:list-all` IPC handler

**Files:**
- Create: `packages/desktop/src/main/__tests__/files.list-all.test.ts`
- Modify: `packages/desktop/src/main/files/files.ipc.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/main/__tests__/files.list-all.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock fs/promises readdir only — keep other fns from the real module
const readdirMock = vi.fn();
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, readdir: readdirMock };
});

// Mock fs (watcher) so registerFilesIpc doesn't blow up on import
vi.mock("fs", () => ({
  watch: vi.fn(() => ({ close: vi.fn(), on: vi.fn().mockReturnThis() })),
}));

// ---- Helpers --------------------------------------------------------------

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handleMocks.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: { isDestroyed: () => false, send: vi.fn() } }, ...args);
}

// ---- Tests ----------------------------------------------------------------

describe("files:list-all", () => {
  beforeEach(async () => {
    handleMocks.clear();
    vi.resetAllMocks();
    const { registerFilesIpc } = await import(
      "../files/files.ipc"
    );
    registerFilesIpc();
  });

  it("returns flat list of relative paths for a flat directory", async () => {
    readdirMock.mockResolvedValueOnce([
      { name: "App.tsx", isDirectory: () => false },
      { name: "main.ts", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["App.tsx", "main.ts"]);
  });

  it("recurses into subdirectories", async () => {
    // First call: root
    readdirMock.mockResolvedValueOnce([
      { name: "src", isDirectory: () => true },
      { name: "README.md", isDirectory: () => false },
    ]);
    // Second call: src/
    readdirMock.mockResolvedValueOnce([
      { name: "App.tsx", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["README.md", "src/App.tsx"]);
  });

  it("skips node_modules, .git, dist, build, .next, .turbo", async () => {
    readdirMock.mockResolvedValueOnce([
      { name: "node_modules", isDirectory: () => true },
      { name: ".git", isDirectory: () => true },
      { name: "dist", isDirectory: () => true },
      { name: "build", isDirectory: () => true },
      { name: ".next", isDirectory: () => true },
      { name: ".turbo", isDirectory: () => true },
      { name: "index.ts", isDirectory: () => false },
    ]);

    const result = await invoke("files:list-all", "/project");
    expect(result).toEqual(["index.ts"]);
    // readdir called only once (skipped dirs never walked)
    expect(readdirMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when readdir throws", async () => {
    readdirMock.mockRejectedValueOnce(new Error("ENOENT"));
    const result = await invoke("files:list-all", "/nonexistent");
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @stratosapp/desktop test -- --reporter=verbose files.list-all 2>&1 | tail -20
```

Expected: tests fail with "No handler for files:list-all".

- [ ] **Step 3: Implement the handler**

In `packages/desktop/src/main/files/files.ipc.ts`:

Add `relative` to the existing path import at line 5:
```ts
import { join, resolve, dirname, relative } from "path";
```

Add `readdir` is already imported on line 2. No change needed there.

Add the new handler inside `registerFilesIpc()`, after the `FILES_WATCH_STOP` handler (before the closing `}`).

Security note: `isPathWithin(child, parent)` requires a known-good parent to validate against. For `list-all`, `cwd` is the root itself — calling `isPathWithin(cwd, cwd)` always returns `true` and provides no security value. The spec's intent to "reuse the security guard" cannot be applied here. The `startsWith("/")` check is a basic sanity guard that rejects empty strings or relative paths; it does not prevent a malicious renderer from passing `/etc`. The real protection is Electron's process boundary, OS permissions, and the `try/catch` handling ENOENT/EPERM errors. This is an intentional departure from the spec's phrasing.

```ts
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    ".turbo",
  ]);

  ipcMain.handle(
    IPC_CHANNELS.FILES_LIST_ALL,
    async (_event, cwd: string): Promise<string[]> => {
      // Basic security: ensure cwd resolves to an absolute path
      const resolvedCwd = resolve(cwd);
      if (!resolvedCwd.startsWith("/")) return [];

      const results: string[] = [];

      async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
              await walk(join(dir, entry.name));
            }
          } else {
            results.push(relative(resolvedCwd, join(dir, entry.name)));
          }
        }
      }

      try {
        await walk(resolvedCwd);
      } catch {
        return [];
      }

      return results;
    },
  );
```

Add cleanup in `unregisterFilesIpc()` (after the existing `removeHandler` calls):
```ts
  ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_ALL);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @stratosapp/desktop test -- --reporter=verbose files.list-all 2>&1 | tail -20
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/__tests__/files.list-all.test.ts packages/desktop/src/main/files/files.ipc.ts
git commit -m "feat: add files:list-all recursive IPC handler"
```

---

### Task 3: Expose `filesListAll` in preload and `FilesBridge` types

**Files:**
- Modify: `packages/ui/src/bridges/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`

- [ ] **Step 1: Add `listAllFiles` to FilesBridge**

In `packages/ui/src/bridges/types.ts`, add `listAllFiles?` after `writeFile` on line 105:

```ts
export interface FilesBridge {
  listDirectory(dirPath: string, rootPath: string): Promise<DirEntry[]>;
  readFile(
    filePath: string,
    rootPath: string,
  ): Promise<{ content: string; isBinary: boolean }>;
  writeFile(filePath: string, content: string, rootPath: string): Promise<void>;
  listAllFiles?(cwd: string): Promise<string[]>;
  watchDirectory?(cwd: string): Promise<void>;
  unwatchDirectory?(): Promise<void>;
  onDirectoryChanged?(callback: (dirPath: string) => void): () => void;
}
```

- [ ] **Step 2: Expose `filesListAll` in preload**

In `packages/desktop/src/preload/index.ts`, add after the `filesWriteFile` block (around line 317):

```ts
  filesListAll: (cwd: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST_ALL, cwd),
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/bridges/types.ts packages/desktop/src/preload/index.ts
git commit -m "feat: expose listAllFiles in FilesBridge and preload"
```

---

## Chunk 2: Hook, Component, and Integration

### Task 4: `useFileMentions` hook with tests

**Files:**
- Create: `packages/ui/src/hooks/useFileMentions.ts`
- Create: `packages/ui/src/hooks/__tests__/useFileMentions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/hooks/__tests__/useFileMentions.test.ts`:

```ts
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
    const { result } = renderHook(() =>
      useFileMentions("/project", bridge),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files).toEqual(["src/App.tsx", "src/main.ts"]);
  });

  it("calls watchDirectory and subscribes to onDirectoryChanged on mount", async () => {
    const bridge = makeBridge();
    renderHook(() => useFileMentions("/project", bridge));

    await waitFor(() => expect(bridge.listAllFiles).toHaveBeenCalledWith("/project"));
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
    act(() => { changeCallback?.("/project/src"); });

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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter @stratosapp/ui test -- --reporter=verbose useFileMentions 2>&1 | tail -15
```

Expected: fail with "Cannot find module '../useFileMentions'".

- [ ] **Step 3: Implement the hook**

Create `packages/ui/src/hooks/useFileMentions.ts`:

```ts
import { useState, useEffect, useRef } from "react";

export interface FileMentionsBridge {
  listAllFiles?: (cwd: string) => Promise<string[]>;
  watchDirectory?: (cwd: string) => Promise<void>;
  unwatchDirectory?: () => Promise<void>;
  onDirectoryChanged?: (callback: (dirPath: string) => void) => () => void;
}

export function useFileMentions(
  cwd: string | undefined,
  bridge: FileMentionsBridge | undefined,
): { files: string[]; loading: boolean } {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // Use a ref so the change callback always sees the latest bridge/cwd
  // without adding them to the effect deps (avoids re-running on every render
  // when the caller passes an inline bridge object).
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    const b = bridgeRef.current;
    if (!cwd || !b?.listAllFiles) return;

    setLoading(true);
    void b.listAllFiles(cwd)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));

    if (b.watchDirectory) {
      void b.watchDirectory(cwd);
    }

    const unsubscribe = b.onDirectoryChanged?.(() => {
      const currentCwd = cwdRef.current;
      const currentBridge = bridgeRef.current;
      if (!currentCwd || !currentBridge?.listAllFiles) return;
      void currentBridge.listAllFiles(currentCwd)
        .then(setFiles)
        .catch(() => setFiles([]));
    });

    return () => {
      unsubscribe?.();
      void bridgeRef.current?.unwatchDirectory?.();
    };
  }, [cwd]); // bridge accessed entirely via bridgeRef — no eslint-disable needed

  return { files, loading };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm --filter @stratosapp/ui test -- --reporter=verbose useFileMentions 2>&1 | tail -15
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/hooks/useFileMentions.ts packages/ui/src/hooks/__tests__/useFileMentions.test.ts
git commit -m "feat: add useFileMentions hook with watcher integration"
```

---

### Task 5: `FileMentionMenu` component

**Files:**
- Create: `packages/ui/src/components/FileMentionMenu.tsx`

- [ ] **Step 1: Create the component**

Create `packages/ui/src/components/FileMentionMenu.tsx`:

```tsx
import { useState, useEffect, useCallback, useRef, type ReactElement } from "react";

interface Props {
  files: string[];
  query: string;
  position: { bottom: number; left: number };
  onSelect: (path: string) => void;
  onClose: () => void;
  loading: boolean;
}

export function FileMentionMenu({
  files,
  query,
  position,
  onSelect,
  onClose,
  loading,
}: Props): ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? files
        .filter((f) => {
          const filename = f.split("/").pop() ?? f;
          return filename.toLowerCase().includes(query.toLowerCase());
        })
        .slice(0, 6)
    : files.slice(0, 6);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (loading || filtered.length === 0) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          onSelect(filtered[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onClose, loading],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  if (!loading && filtered.length === 0) return null;

  return (
    <div
      className="absolute z-50 w-80 max-h-48 overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-lg shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
      ref={listRef}
    >
      {loading ? (
        <div className="px-3 py-2 text-sm text-gray-400 flex items-center gap-2">
          <span className="animate-spin inline-block">⟳</span>
          Loading files…
        </div>
      ) : (
        filtered.map((filePath, i) => {
          const filename = filePath.split("/").pop() ?? filePath;
          const dir = filePath.includes("/")
            ? filePath.slice(0, filePath.lastIndexOf("/"))
            : "";
          return (
            <button
              key={filePath}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(filePath);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                i === selectedIndex
                  ? "bg-[var(--border)] text-gray-200"
                  : "text-gray-400 hover:bg-[var(--border)]"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span>📄</span>
                <span className="font-semibold text-[var(--text-primary)] truncate">
                  {filename}
                </span>
              </span>
              {dir && (
                <span className="text-gray-500 text-xs truncate font-mono flex-shrink-0 max-w-[40%]">
                  {dir}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @stratosapp/ui typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/FileMentionMenu.tsx
git commit -m "feat: add FileMentionMenu dropdown component"
```

---

### Task 6: Wire `@` detection into `InputBar`

**Files:**
- Modify: `packages/ui/src/components/InputBar.tsx`

**Note:** The existing `InputBar` component already uses `React.ReactElement` as its return type (line 66). In the current codebase this compiles fine via the JSX transform. Do not change the existing return type annotation — only add the changes described below.

- [ ] **Step 1: Add imports, new props, and hook call**

At the top of `packages/ui/src/components/InputBar.tsx`, add the new imports after line 10:

```ts
import { FileMentionMenu } from "./FileMentionMenu";
import { useFileMentions, type FileMentionsBridge } from "../hooks/useFileMentions";
```

Add `cwd` and `filesBridge` to the `Props` interface (after `slashCommands`, before the closing `}`):

```ts
  cwd?: string;
  filesBridge?: FileMentionsBridge;
```

In the function signature, destructure the new props (after `slashCommands = []`):

```ts
    cwd,
    filesBridge,
```

Add the hook call inside the component body, after the `slashMenu` state declaration (line 71):

```ts
  const [mentionMenu, setMentionMenu] = useState<{
    triggerPos: number;
    query: string;
  } | null>(null);
  const { files: mentionFiles, loading: mentionLoading } = useFileMentions(
    cwd,
    filesBridge,
  );
```

- [ ] **Step 2: Update `handleSend` to clear `mentionMenu`**

In `handleSend`, every place `setSlashMenu(null)` is called, add `setMentionMenu(null)` alongside it. There are two locations:

Lines 125 and 135 — after each `setSlashMenu(null)`:
```ts
setSlashMenu(null);
setMentionMenu(null);
```

- [ ] **Step 3: Update `handleKeyDown` to block send when mention menu is open**

Replace line 142:
```ts
      if (slashMenu) return;
```
with:
```ts
      if (slashMenu || mentionMenu) return;
```

Also add `mentionMenu` to the deps array on line 148:
```ts
    [handleSend, slashMenu, mentionMenu],
```

- [ ] **Step 4: Update `handleInput` to detect `@`**

Replace the full `handleInput` callback (lines 151–170) with:

```ts
  const handleInput = useCallback(() => {
    setHasContent(getPlainText().trim().length > 0);

    const textBefore = getTextBeforeCursor();

    // Slash command detection
    if (slashCommands.length > 0) {
      const lastSlashIdx = textBefore.lastIndexOf("/");
      if (
        lastSlashIdx >= 0 &&
        (lastSlashIdx === 0 || /\s/.test(textBefore[lastSlashIdx - 1]))
      ) {
        const afterSlash = textBefore.slice(lastSlashIdx);
        if (!afterSlash.includes(" ") || afterSlash === "/") {
          setSlashMenu({ triggerPos: lastSlashIdx });
          setMentionMenu(null);
          return;
        }
      }
      setSlashMenu(null);
    }

    // @ file mention detection
    if (filesBridge?.listAllFiles) {
      const lastAtIdx = textBefore.lastIndexOf("@");
      if (
        lastAtIdx >= 0 &&
        (lastAtIdx === 0 || /\s/.test(textBefore[lastAtIdx - 1]))
      ) {
        const afterAt = textBefore.slice(lastAtIdx + 1); // exclude @
        if (!afterAt.includes(" ")) {
          setMentionMenu({ triggerPos: lastAtIdx, query: afterAt });
          return;
        }
      }
      setMentionMenu(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashCommands]); // filesBridge intentionally omitted — it's an inline object that changes every render; the gate check (filesBridge?.listAllFiles) is safe as a one-time guard since cwd won't change without a re-mount
```

- [ ] **Step 5: Add `handleMentionSelect` callback**

Add after `handleSlashSelect` (after line 223):

```ts
  const handleMentionSelect = useCallback(
    (filePath: string) => {
      if (mentionMenu === null || !editableRef.current) return;
      const el = editableRef.current;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let charCount = 0;
      let triggerNode: Text | null = null;
      let triggerOffset = 0;

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const len = textNode.length;
        if (charCount + len >= mentionMenu.triggerPos) {
          triggerNode = textNode;
          triggerOffset = mentionMenu.triggerPos - charCount;
          break;
        }
        charCount += len;
      }

      if (!triggerNode) return;

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const cursorRange = selection.getRangeAt(0);

      const range = document.createRange();
      range.setStart(triggerNode, triggerOffset);
      range.setEnd(cursorRange.startContainer, cursorRange.startOffset);
      range.deleteContents();
      range.insertNode(document.createTextNode("@" + filePath + " "));

      const insertedNode = range.startContainer;
      const newRange = document.createRange();
      newRange.setStart(
        insertedNode,
        insertedNode.textContent?.length ?? 0,
      );
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      setMentionMenu(null);
      setHasContent(getPlainText().trim().length > 0);
      el.focus();
    },
    [mentionMenu],
  );
```

- [ ] **Step 6: Render `FileMentionMenu` in JSX**

In the JSX, add `FileMentionMenu` immediately after the existing `SlashCommandMenu` block (after line 305):

```tsx
      {mentionMenu !== null && (
        <FileMentionMenu
          files={mentionFiles}
          query={mentionMenu.query}
          position={{
            bottom: containerRef.current
              ? containerRef.current.offsetHeight
              : 60,
            left: 16,
          }}
          onSelect={handleMentionSelect}
          onClose={() => setMentionMenu(null)}
          loading={mentionLoading}
        />
      )}
```

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter @stratosapp/ui typecheck 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/InputBar.tsx
git commit -m "feat: add @ file mention detection and FileMentionMenu to InputBar"
```

---

### Task 7: Wire in `App.tsx` and export from `index.ts`

> **Depends on Chunk 1** — `window.api.filesListAll` is exposed in Task 3. Complete Chunk 1 before running the typecheck in this task.

**Spec divergence note:** The spec says "No bridge method wiring needed — StratosProvider context already carries the bridge." In practice `StratosProvider` is not mounted in `App.tsx`, so bridge methods must be passed as props — consistent with how `FileExplorer`/`PreviewPane` receive bridge methods today.

**Files:**
- Modify: `packages/desktop/src/renderer/App.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Add `cwd` and `filesBridge` props to `<InputBar>` in App.tsx**

In `packages/desktop/src/renderer/App.tsx`, find the `<InputBar>` block (lines 640–649). Add two new props:

```tsx
              <InputBar
                key={activeThreadId}
                ref={inputRef}
                onSend={handleSend}
                onInterrupt={interrupt}
                isStreaming={isStreaming}
                interactiveMode={interactiveMode}
                onInteractiveResponse={handleInteractiveResponse}
                slashCommands={slashCommands}
                cwd={activeThread?.cwd}
                filesBridge={{
                  listAllFiles: window.api.filesListAll,
                  watchDirectory: window.api.filesWatchStart,
                  unwatchDirectory: window.api.filesWatchStop,
                  onDirectoryChanged: window.api.filesOnDirChanged,
                }}
              />
```

- [ ] **Step 2: Export `FileMentionMenu` and `useFileMentions` from `packages/ui/src/index.ts`**

Add after the `SlashCommandMenu` export (line 24):
```ts
export { FileMentionMenu } from "./components/FileMentionMenu";
```

Add after the `useTodoData` export (line 71):
```ts
export { useFileMentions } from "./hooks/useFileMentions";
export type { FileMentionsBridge } from "./hooks/useFileMentions";
```

- [ ] **Step 3: Run full test suite and typecheck**

```bash
pnpm test 2>&1 | tail -20
pnpm typecheck 2>&1 | tail -10
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/App.tsx packages/ui/src/index.ts
git commit -m "feat: wire @ file mention into App and export from ui package"
```

---

## Visual Verification

After all tasks are complete, verify the feature visually using the Chrome DevTools MCP (see CLAUDE.md "Mandatory: Visually Verify Every UI Change"):

1. Start the app: `pnpm --filter @stratosapp/desktop dev:debug`
2. Open a thread with a working directory set
3. Take snapshot, click the input bar
4. Type `@` — the FileMentionMenu should appear above the input
5. Type a few characters — the list should filter
6. Press `↑`/`↓` to navigate, `Enter` to select — path should be inserted as `@path/to/file `
7. Screenshot to confirm the result

# FileExplorer Auto-Reload Design

**Date:** 2026-03-12
**Status:** Approved

## Problem

The `FileExplorer` component loads the directory tree once on mount and never refreshes. When an agent creates or deletes files, the tree becomes stale — users must close and reopen the panel to see changes.

## Goal

Automatically refresh any loaded (and expanded) directory nodes when their contents change on disk, in real time.

## Approach

Use Node's built-in `fs.watch` with `{ recursive: true }` in the Electron main process. On macOS this uses FSEvents; on Windows it uses ReadDirectoryChangesW. Both are OS-level event callbacks with zero polling and essentially zero CPU at idle. When a change is detected, the main process debounces per-directory and pushes an IPC event to the renderer, which re-fetches and merges only the affected nodes.

**Platform note:** `fs.watch({ recursive: true })` is supported on macOS and Windows only. On Linux it does not recurse — a file change inside a subdirectory will not be detected. This is a known limitation; Stratos is macOS-primary so this is acceptable for now.

## Architecture

### New IPC Channels

Three channels added to `packages/desktop/src/common/ipc-channels.ts`:

| Channel | Direction | Payload |
|---|---|---|
| `FILES_WATCH_START` | renderer → main (invoke) | `cwd: string` |
| `FILES_WATCH_STOP` | renderer → main (invoke) | — |
| `FILES_DIR_CHANGED` | main → renderer (send) | `dirPath: string` |

### Main Process (`files.ipc.ts`)

On `FILES_WATCH_START(cwd, event)`:
1. Close any existing watcher and clear all pending debounce timers
2. Store `webContents = event.sender` for use in the watcher callback (the handler returns before the watcher fires, so `event` is not in scope later)
3. Call `fs.watch(cwd, { recursive: true }, handler)` — use the platform-native `path.join` / `path.dirname` (i.e. `import { join, dirname } from 'path'`), not `path.posix.*`, so path handling is correct on both macOS and Windows
4. Attach `.on('error', () => { watcher.close() })` — `fs.watch` emits async `'error'` events (e.g. ENOENT when the directory is deleted); without a handler Node throws an unhandled error and crashes the main process

Handler receives `(eventType, filename)`:
- If `filename` is null (can happen on some platforms): fall back to refreshing root `cwd`
- Otherwise: `changedDirPath = join(cwd, dirname(filename))`. Note: `dirname` of a root-level file (e.g. `"package.json"`) returns `"."`, so `join(cwd, ".")` correctly resolves to `cwd` itself — verified for both POSIX and Win32 `path.join`
- Debounce 100ms per unique `changedDirPath`, then — **before calling `.send()`** — check `if (!webContents.isDestroyed())`. If the renderer has been closed or navigated before the debounce fires, skip the send. Calling `.send()` on a destroyed `webContents` throws in the main process.
- `webContents.send(FILES_DIR_CHANGED, changedDirPath)`

On `FILES_WATCH_STOP`: close watcher (if one exists — this is a no-op if no watcher is active, e.g. if called before `FILES_WATCH_START` resolves), clear all debounce timers. The handler always resolves successfully.

**Single-watcher constraint:** One watcher per process. Starting a new one automatically closes the previous. This design assumes a single `FileExplorer` instance is mounted at a time — if two instances mounted simultaneously, the second `FILES_WATCH_START` would silently kill the first. This is a known limitation acceptable for the current single-panel UI.

### Bridge Layer

Three new methods added to bridge types (`packages/ui/src/bridges/types.ts`) and wired in `App.tsx`:

```ts
watchDirectory(cwd: string): Promise<void>
unwatchDirectory(): Promise<void>
onDirectoryChanged(callback: (dirPath: string) => void): () => void  // returns cleanup fn
```

`onDirectoryChanged` is wired to `ipcRenderer.on(FILES_DIR_CHANGED, ...)` and returns a cleanup function that calls `ipcRenderer.removeListener`. Note: events are sent to the specific `webContents` that started the watcher, so multi-window setups would require each window to manage its own watcher lifecycle.

### `FileExplorer` Component

**Tree node shape** (existing type, referenced for clarity):
```ts
interface TreeNode {
  entry: DirEntry;
  path: string;         // absolute path
  children?: TreeNode[];
  loaded: boolean;      // true if children have been fetched at least once
  expanded: boolean;
}
```

**Lifecycle (in a single `useEffect` on `cwd`):**
1. Call `onDirectoryChanged(handleDirChanged)` — store the cleanup fn. **Listener must be registered before calling `watchDirectory`:** once `FILES_WATCH_START` is received by main, the watcher starts immediately and events can arrive at the renderer before the invoke promise resolves. Registering first ensures no events are missed.
2. Call `watchDirectory(cwd)`
3. Return cleanup: call the listener cleanup fn first (synchronously removes the IPC listener), then call `unwatchDirectory()`. Removing the listener before stopping the watcher closes the narrow async window where a stale event for the old `cwd` could arrive after `cwd` has changed. Note: if two `FileExplorer` instances somehow mount and both call `watchDirectory`, a later `unwatchDirectory` from the first to unmount will stop the second's watcher — this is a known hazard of the single-watcher design, acceptable given the single-panel layout constraint.

**`handleDirChanged(changedDirPath)`:**
1. Walk the tree recursively
2. For each node where `node.path === changedDirPath && node.loaded === true`:
   - Call `listDirectory(changedDirPath, cwd)`
   - Merge result with existing `node.children`:
     - New entries: add as `{ loaded: false, expanded: false, children: undefined }`
     - Removed entries: drop from children array
     - Existing entries: keep current `expanded`, `loaded`, `children` state
3. `setTree(mergedTree)`

This merge strategy preserves already-expanded subtrees — a user who has `src/components/` open won't lose that state when a file appears in `src/`.

## Files Changed

| File | Change |
|---|---|
| `packages/desktop/src/common/ipc-channels.ts` | Add `FILES_WATCH_START`, `FILES_WATCH_STOP`, `FILES_DIR_CHANGED` |
| `packages/desktop/src/main/files/files.ipc.ts` | Add watcher handlers, `fs.watch` lifecycle, `.on('error')`, per-dir debounce |
| `packages/desktop/src/preload/index.ts` | Expose `watchDirectory`, `unwatchDirectory`, `onDirectoryChanged` |
| `packages/ui/src/bridges/types.ts` | Add 3 new bridge method type signatures |
| `packages/desktop/src/renderer/App.tsx` | Wire bridge methods to IPC invoke/on calls |
| `packages/ui/src/components/FileExplorer.tsx` | Mount/unmount watcher, handle DIR_CHANGED, merge logic |

## Known Limitations

- **Linux:** `fs.watch({ recursive: true })` does not recurse on Linux. Files changed inside subdirectories will not be detected. Acceptable for macOS-primary deployment.
- **Single instance:** One global watcher. Two simultaneous `FileExplorer` mounts would conflict. Not an issue with the current single-panel layout.
- **Multi-window:** Each window must start its own watcher. The current single-window architecture handles this correctly by design.

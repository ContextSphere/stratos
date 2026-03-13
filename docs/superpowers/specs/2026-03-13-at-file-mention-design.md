# @ File Mention — Design Spec

**Date:** 2026-03-13
**Status:** Approved

## Overview

Add a Cursor-style `@` file mention picker to the Stratos chat input. When a user types `@` in the InputBar, a fuzzy-search dropdown opens above the input showing files from the thread's working directory. Selecting a file inserts its relative path as `@path/to/file` into the message text.

## Behaviour

- **Trigger:** User types `@` in the InputBar contentEditable div.
- **Dropdown:** Opens upward (anchored above the input bar, same positioning as `SlashCommandMenu`). Shows up to 6 results, scrollable.
- **Each row:** File icon + filename (bold) + relative directory path (secondary, right-aligned).
- **Filtering:** As the user continues typing after `@`, results are fuzzy-filtered client-side on the filename portion only (e.g. `@App` matches `App.tsx` anywhere in the tree). The query passed to `FileMentionMenu` is the text typed *after* `@`, not including `@` itself.
- **Empty query:** Shows all files (up to 6) when the user has just typed `@` with nothing after it.
- **Loading state:** While the initial file list fetch is in progress, `FileMentionMenu` renders a single non-interactive row showing a spinner and the text "Loading files…".
- **Keyboard:** `↑`/`↓` navigate, `Enter`/`Tab` select, `Escape` closes without inserting.
- **Selection:** Inserts `@<relative-path> ` (space appended) at the cursor position in the contentEditable, replacing the `@<query>` trigger text. Uses the same TreeWalker insertion logic as `handleSlashSelect`.
- **Dismiss:** Escape or click outside closes the dropdown without inserting.
- **Mutual exclusion:** The mention menu and slash command menu are mutually exclusive. Opening one closes the other. `handleKeyDown` guards `Enter` (preventing message send) when either menu is open.
- **Filename extraction:** Uses `relativePath.split('/').pop()` — not `path.basename` — since the renderer runs in a browser context.

## Architecture

### New IPC channel — `files:list-all`

Recursive directory walker in the main process. Returns a flat array of relative file paths.

```ts
// IPC channel: files:list-all
// Input: cwd: string
// Output: string[]  — relative paths, e.g. ["src/App.tsx", "packages/ui/src/components/ChatView.tsx"]
```

- Reuses `isPathWithin()` security guard from `files.ipc.ts`.
- Skips `node_modules`, `.git`, `.next`, `dist`, `build`, `.turbo` directories.
- Must be cleaned up in `unregisterFilesIpc()` via `ipcMain.removeHandler(IPC_CHANNELS.FILES_LIST_ALL)`.

### New hook — `useFileMentions`

Lives in `packages/ui/src/hooks/useFileMentions.ts`.

```ts
function useFileMentions(cwd: string | undefined): { files: string[]; loading: boolean }
```

- Calls `useFilesBridge()` internally to access `listAllFiles`, `watchDirectory`, `unwatchDirectory`, and `onDirectoryChanged` from `StratosProvider` context. No bridge methods are accepted as parameters.
- On mount (when `cwd` is set): calls `listAllFiles(cwd)` to populate the cache and calls `watchDirectory(cwd)` to start the watcher. Guards for their absence (both are optional on `FilesBridge`).
- Subscribes to `onDirectoryChanged` — on any change event, re-fetches `listAllFiles(cwd)` in the background.
- On unmount: calls `unwatchDirectory()` and unsubscribes from `onDirectoryChanged`.
- Returns `{ files: string[], loading: boolean }`.

### New component — `FileMentionMenu`

Lives in `packages/ui/src/components/FileMentionMenu.tsx`. Modeled on `SlashCommandMenu`.

```ts
interface FileMentionMenuProps {
  files: string[]           // all files from useFileMentions
  query: string             // text typed after @, not including @
  onSelect: (path: string) => void
  onClose: () => void
  loading: boolean
}
```

- Filters `files` client-side: case-insensitive substring match on `relativePath.split('/').pop()`.
- Renders upward from the input bar (`bottom: 100%`), max 6 items, scrollable, keyboard navigable.
- While `loading` is true: renders a single non-interactive row with a spinner and "Loading files…".
- Uses `onMouseDown` with `preventDefault` to avoid stealing focus from the input (same as `SlashCommandMenu`).

### Changes to `InputBar.tsx`

1. Accept a new `cwd?: string` prop (the thread's working directory).
2. Call `useFileMentions(cwd)` inside the component to get `{ files, loading }`.
3. Add `mentionMenu: { triggerPos: number; query: string } | null` state, parallel to `slashMenu`.
4. In `handleInput`: detect `@<query>` pattern (same approach as `/` detection). When `@` is found, set `mentionMenu` and close `slashMenu`. When `/` is found, set `slashMenu` and close `mentionMenu`. All other paths clear both.
5. In `handleKeyDown`: check `mentionMenu` alongside `slashMenu` before allowing `Enter` to send.
6. On select (`handleMentionSelect`): use TreeWalker insertion to replace `@<query>` with `@<relative-path> `.
7. Render `<FileMentionMenu>` when `mentionMenu !== null`.

### Changes to `FilesBridge` (types.ts + preload)

Add `listAllFiles?(cwd: string): Promise<string[]>` to the `FilesBridge` interface and expose as `filesListAll` via the preload script.

### Changes to `App.tsx`

Add `cwd={activeThread?.cwd}` to the `<InputBar>` props (lines 640-649). No bridge method wiring needed — `StratosProvider` context already carries the bridge with the new `listAllFiles` method.

## File Checklist

| File | Change |
|------|--------|
| `packages/desktop/src/common/ipc-channels.ts` | Add `FILES_LIST_ALL` |
| `packages/desktop/src/main/files/files.ipc.ts` | Add `files:list-all` handler (recursive walker) + cleanup in `unregisterFilesIpc` |
| `packages/desktop/src/preload/index.ts` | Expose `filesListAll` |
| `packages/ui/src/bridges/types.ts` | Add `listAllFiles?` to `FilesBridge` |
| `packages/ui/src/hooks/useFileMentions.ts` | New hook |
| `packages/ui/src/components/FileMentionMenu.tsx` | New component |
| `packages/ui/src/components/InputBar.tsx` | `cwd` prop + `@` detection + `FileMentionMenu` integration + mutual exclusion with slash menu |
| `packages/desktop/src/renderer/App.tsx` | Add `cwd={activeThread?.cwd}` to `<InputBar>` |
| `packages/ui/src/index.ts` | Export `FileMentionMenu` and `useFileMentions` |

## Out of Scope

- Including file contents inline (path reference only, not attachment).
- Navigating outside the thread's working directory.
- Syntax highlighting or special rendering of `@mentions` in sent messages (already partially handled by `highlightMentions()` in `MessageBubble`).
- File type filtering.

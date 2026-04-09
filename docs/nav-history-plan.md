# Navigation History — Design Plan

Back/forward navigation across threads and messages, matching the VSCode experience
(`Ctrl+-` / `Ctrl+Shift+-` on macOS).

---

## 1. Mental Model

Every time the user "lands" somewhere meaningful — opens a thread, or scrolls up
and pauses on a particular message — a **navigation entry** is pushed onto a
history stack. Back (`Ctrl+-`) moves one step earlier in that stack; forward
(`Ctrl+Shift+-`) moves one step later, exactly like VSCode's editor navigation.

### What is a "location"?

```
Location = { threadId, anchor }

anchor = "latest"          // user was at the bottom — restore to most-recent msg
       | { messageId }     // user had scrolled to this specific message
```

`"latest"` is the default. A specific `messageId` is recorded only when the user
**intentionally** scrolls away from the bottom and comes to rest at a message.

---

## 2. VSCode Key Shortcuts

| Action  | macOS          | Windows / Linux |
| ------- | -------------- | --------------- |
| Go back | `Ctrl + -`     | `Alt + ←`       |
| Go fwd  | `Ctrl + ⇧ + -` | `Alt + →`       |

Electron intercepts `Ctrl+-` on macOS before the renderer; the keyboard handler
must use `ctrlKey` (not `metaKey`) and `key === "-"`.

---

## 3. Navigation Entry Data Structure

```typescript
// packages/desktop/src/renderer/navigation/types.ts  (new file)

export type NavAnchor =
  | { type: "latest" }
  | { type: "message"; messageId: string };

export interface NavEntry {
  threadId: string;
  anchor: NavAnchor;
}

export interface NavHistoryState {
  stack: NavEntry[]; // oldest → newest
  index: number; // current position; -1 = empty
}
```

**Rules:**

- Maximum 50 entries (oldest are dropped when cap is reached).
- Duplicate suppression: if the new entry is identical to `stack[index]`, skip push.
- Pushing while `index < stack.length - 1` trims the forward portion (same as
  VSCode "branching" behavior).

---

## 4. When to Record a Location

### 4.1 Thread switch (always record)

When the user clicks a thread in the sidebar the current location is pushed
**before** the switch happens. The new thread opens to `"latest"` and that is
pushed immediately after, making both ends of the jump addressable via back/forward.

Push sequence on `handleThreadClick(newThreadId)`:

1. Capture current `{ threadId: activeThreadId, anchor: currentAnchor() }` → push if different from `stack[index]`.
2. Switch to `newThreadId`.
3. Push `{ threadId: newThreadId, anchor: { type: "latest" } }`.

### 4.2 Manual scroll — debounced anchor update

When the user scrolls the chat viewport, a debounced handler (300 ms) fires after
they stop. At that point:

- **Near bottom (within 80 px):** anchor stays/becomes `"latest"`.
- **Scrolled up:** find the message whose top edge is nearest to the top of the
  visible area → record `{ type: "message", messageId }`.

This debounced position is stored in a ref (`pendingAnchorRef`) inside `ChatView`
and is passed up to `App` only when it differs meaningfully from the last recorded
anchor. The parent can decide whether to push a new history entry or just update
the current index's anchor in place.

**Important:** A pure scroll within the same thread does **not** push a new entry.
Instead it _updates_ the anchor of the current entry (`stack[index].anchor = ...`).
This matches VSCode: moving your cursor around updates the current location; only
a deliberate navigation (closing/opening a file, Cmd+Click to definition) pushes
a new entry.

### 4.3 Back / forward keypress (never records, only navigates)

Pressing `Ctrl+-` or `Ctrl+Shift+-` traverses the existing stack without pushing.

---

## 5. State & Storage

### 5.1 In-memory state (renderer process)

```typescript
// packages/desktop/src/renderer/App.tsx (additions)

const navHistoryRef = useRef<NavHistoryState>({ stack: [], index: -1 });
```

A ref (not state) is used for the stack itself to avoid re-renders on every
scroll update. A separate `useState` boolean `canGoBack` / `canGoForward` drives
any UI indicators.

### 5.2 Persistence (optional — session restore)

Navigation history is **session-level**, not persisted to disk. If the app is
restarted, history starts fresh (same as VSCode with a single window). This
keeps the implementation simple and avoids stale `messageId` references.

If session restore is desired in the future, the history could be saved to
`~/.stratos/instances/<hash>/nav-history.json` following the same pattern as
`app-settings.json`, but that is out of scope here.

---

## 6. Scroll Restoration

When back/forward navigation lands on a `NavEntry`, `ChatView` needs to scroll
to the target anchor.

### 6.1 "Latest" anchor

Scroll `scrollRef.current.scrollTop = scrollRef.current.scrollHeight` — same as
the existing "scroll to bottom" button behavior.

### 6.2 "Message" anchor

Each message bubble needs a stable DOM identity:

```tsx
// MessageBubble renders:
<div id={`msg-${message.id}`} data-message-id={message.id} ...>
```

On navigation, `ChatView` exposes an imperative handle:

```typescript
export interface ChatViewHandle {
  scrollToMessage(messageId: string): void;
  scrollToBottom(): void;
}
```

The parent calls `chatViewRef.current.scrollToMessage(messageId)` using
`document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "start" })`.

If the message is not yet rendered (thread just loaded), the scroll is deferred
via a `pendingScrollRef` that is consumed inside a `useEffect([messages])`.

---

## 7. Message Visibility Detection (for anchor recording)

Inside `ChatView`, an `IntersectionObserver` is used to track which message is
nearest to the top of the viewport:

```typescript
const topMessageIdRef = useRef<string | null>(null);

// Single observer, root = scrollRef.current, rootMargin = "0px 0px -60% 0px"
// The first message that becomes visible from the top wins.
```

Alternatively (simpler): on the debounced scroll handler, walk the rendered
message list and find the one whose `getBoundingClientRect().top` is closest to
`scrollRef.current.getBoundingClientRect().top`. This avoids observer bookkeeping
and is sufficient for this use case.

`ChatView` calls a prop `onAnchorChange(anchor: NavAnchor)` whenever the
top-visible message changes (debounced, 300 ms).

---

## 8. Component & Hook Changes

### 8.1 New: `useNavHistory` hook

**File:** `packages/desktop/src/renderer/hooks/useNavHistory.ts`

```typescript
export function useNavHistory() {
  // Manages the NavHistoryState ref
  // Exposes: push(entry), back(), forward(), canGoBack, canGoForward
  // Calls a provided `navigate(entry: NavEntry)` callback when traversing
}
```

### 8.2 Modified: `App.tsx`

- Import and call `useNavHistory`.
- Pass `onAnchorChange` prop down to `ChatView` to receive live anchor updates.
- Register `Ctrl+-` / `Ctrl+Shift+-` (macOS) and `Alt+ArrowLeft` / `Alt+ArrowRight`
  (Win/Linux) keyboard handlers.
- Wrap `handleThreadClick` to push entries before/after the switch.
- Call `chatViewRef.current.scrollToMessage` / `scrollToBottom` when
  `navigate(entry)` fires.

### 8.3 Modified: `ChatView.tsx`

- Add `id` / `data-message-id` to every message bubble root element.
- Add debounced scroll handler that calls `props.onAnchorChange`.
- Expose `ChatViewHandle` via `useImperativeHandle` for `scrollToMessage` /
  `scrollToBottom`.
- Consume `pendingScrollRef` in `useEffect([messages])` to handle deferred
  scrolls after thread load.

### 8.4 Modified: `MessageBubble` (or wherever messages are rendered)

Add stable `id` and `data-message-id` attributes to the root element of each
rendered message.

---

## 9. Back / Forward Navigation Flow

```
User presses Ctrl+-
  → keyboard handler in App.tsx
  → navHistory.back()
      → index -= 1
      → entry = stack[index]
  → if entry.threadId !== activeThreadId:
      → setActiveThreadId(entry.threadId)
      → set pendingScrollRef = entry.anchor   (consumed after messages load)
  → else:
      → chatViewRef.current.scrollToMessage(entry.anchor.messageId)
        OR chatViewRef.current.scrollToBottom()
  → update canGoBack / canGoForward
```

The "across threads" case requires waiting for the thread's messages to load
before scrolling. The `pendingScrollRef` in `ChatView` (or a ref in `useChat`)
is the handoff mechanism.

---

## 10. Deduplication & Noise Suppression

| Situation                                   | Behavior                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| User scrolls back to bottom in same thread  | Anchor updated in place; no new entry pushed               |
| User clicks the same thread already active  | No push (same `threadId`, anchor already recorded)         |
| New message arrives while user is at bottom | `"latest"` anchor stays current; no push                   |
| User sends a message (scrolls to bottom)    | No push — programmatic scroll, not a deliberate navigation |
| Back/forward key pressed                    | No push — traversal only                                   |

---

## 11. Optional UI: Back / Forward Toolbar Buttons

Small `←` `→` buttons in the header bar (greyed out when `!canGoBack` /
`!canGoForward`), following the same visual language as Chrome or VSCode's
editor breadcrumb area. These are optional and can be deferred.

---

## 12. Files Touched

| File                                                           | Change                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/renderer/navigation/types.ts`            | **New** — `NavEntry`, `NavAnchor`, `NavHistoryState` types                                                                  |
| `packages/desktop/src/renderer/hooks/useNavHistory.ts`         | **New** — history stack hook                                                                                                |
| `packages/desktop/src/renderer/App.tsx`                        | Add keyboard handlers, wire `useNavHistory`, pass `onAnchorChange` to `ChatView`, hold `chatViewRef`                        |
| `packages/ui/src/components/ChatView.tsx`                      | Expose `ChatViewHandle`, add `onAnchorChange` prop, debounced anchor detection, `pendingScrollRef`, message `id` attributes |
| `packages/ui/src/components/MessageBubble.tsx` (or equivalent) | Add `id={`msg-${message.id}`}` and `data-message-id` to root element                                                        |

No IPC changes, no storage changes, no new packages required.

---

## 13. Edge Cases

| Case                                                 | Handling                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Thread deleted while in history                      | On navigate, if `threads.find(t => t.id === entry.threadId)` returns nothing, skip that entry and continue traversal |
| Message deleted / thread cleared                     | `scrollIntoView` silently fails; fall back to `scrollToBottom`                                                       |
| Thread still streaming on navigate-away              | Existing auto-scroll logic already handles re-entry; `"latest"` anchor scrolls to bottom which shows the stream      |
| Very fast back/forward keypresses                    | Debounce the keyboard handler (150 ms) to avoid thrashing thread loads                                               |
| App opens with no history                            | `canGoBack = false`, `canGoForward = false`; buttons/shortcuts are no-ops                                            |
| Multiple simultaneous `Ctrl+-` before load completes | Queue at most one pending navigation; subsequent presses during load are ignored                                     |

---

## 14. Non-Goals (out of scope)

- Persisting history across app restarts.
- Tracking scroll position within a single message (e.g., a very long assistant turn).
- Per-worktree independent histories.
- Syncing history across multiple Stratos windows.

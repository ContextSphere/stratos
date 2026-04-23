# Design: First-Class UX for Internal Stratos Tools

**Status:** Draft  
**Scope:** UI/UX design only — no implementation

---

## Problem Statement

Stratos has a growing set of first-party, in-process tools that agents can invoke — three built-in MCP servers today, with more likely to come as Stratos adds capabilities. These tools currently render identically to third-party MCP calls: opaque cards showing raw names like `mcp__stratos-scheduler__schedule_create`, collapsed JSON input, and plain text output.

The goal is to give internal Stratos tools **first-class, native UX treatment** — distinct icons, accent colors, human-readable titles, and rich card bodies — while building the system in an **extensible, registry-driven way** so that new internal tools can be onboarded without touching core dispatch logic.

### Current internal tools

| Tool origin                                 | Tool names                               | Session scope      |
| ------------------------------------------- | ---------------------------------------- | ------------------ |
| `stratos-scheduler` MCP                     | `mcp__stratos-scheduler__schedule_*`     | All sessions       |
| `stratos-preview` MCP                       | `mcp__stratos-preview__preview_*`        | All sessions       |
| `stratos-manager` MCP                       | `mcp__stratos-manager__*`                | Manager Agent only |
| Native tools with existing custom renderers | `Monitor`, `Skill`, memory ops, file ops | All sessions       |

The existing native renderers (`MonitorCard`, `SkillCard`, `MemoryOperationCard`, `FileChangeViewer`) were each added by modifying `ToolCallCard.tsx` directly. This ad-hoc approach does not scale: every new internal tool requires a code change to the dispatch switch, knowledge of the dispatch order, and awareness of existing renderers. A registry replaces that with a single registration call.

---

## 1. Core Concept: The Internal Tool Registry

### 1.1 What the registry is

The **Internal Tool Registry** is a static, build-time map from tool identity patterns to rendering descriptors. It is the single source of truth for:

- Whether a tool is internal (vs. external/third-party)
- What it looks like (icon, accent color, display name)
- How its card body is rendered (component reference or inline render function)
- How it behaves in permission/filtering contexts (optional metadata)

The registry lives in `packages/ui/src/tool-registry/` and is entirely within the `@stratosapp/ui` package — no Electron dependency. It is evaluated at module load time (no runtime cost).

### 1.2 Registry entry shape

```ts
// packages/ui/src/tool-registry/types.ts

type ToolMatchPattern =
  | { type: "exact"; name: string } // matches a single tool name exactly
  | { type: "prefix"; prefix: string } // matches any tool whose name starts with prefix
  | { type: "mcp-server"; server: string } // matches all tools from a named MCP server
  | { type: "predicate"; fn: (name: string) => boolean }; // arbitrary match logic

interface InternalToolDescriptor {
  /** Unique key for this registration (used for deduplication and debugging). */
  id: string;

  /** One or more patterns that identify which tool names this entry handles. */
  match: ToolMatchPattern | ToolMatchPattern[];

  /** Visual identity */
  display: {
    /** Short human-readable source label shown in the card header (e.g. "Stratos Scheduler"). */
    sourceLabel: string;
    /** Icon component or icon name string from the app's icon set. */
    icon: React.ComponentType<{ size?: number; className?: string }> | string;
    /** Tailwind/CSS color token or hex. Used for the left accent border and icon tint. */
    accentColor: string;
  };

  /**
   * Produces the human-readable title line for a specific tool call.
   * Receives the full toolCall so it can interpolate input fields.
   * Falls back to humanizing the tool short name if omitted.
   */
  title?: (toolCall: ToolCall) => string;

  /**
   * The React component that renders the card body.
   * Receives the full toolCall and the resolved descriptor.
   * If omitted, the default BuiltinToolCard body is used (humanized key-value input + text output).
   */
  CardBody?: React.ComponentType<ToolCardBodyProps>;

  /**
   * Controls whether this tool is visible in the thread at all.
   * Defaults to "visible". Use "hidden" for high-frequency read operations
   * that would create visual noise (e.g. repeated list/get calls).
   * Can also be a function for per-call decisions.
   */
  visibility?:
    | "visible"
    | "hidden"
    | ((toolCall: ToolCall) => "visible" | "hidden");

  /**
   * Optional: override the expand-by-default behavior.
   * Defaults to collapsed. "auto" expands when status === "running".
   */
  defaultExpanded?: boolean | "auto";
}

interface ToolCardBodyProps {
  toolCall: ToolCall;
  descriptor: InternalToolDescriptor;
}
```

### 1.3 Registry API

```ts
// packages/ui/src/tool-registry/registry.ts

class InternalToolRegistry {
  /** Register one descriptor. Safe to call multiple times; last write wins per id. */
  register(descriptor: InternalToolDescriptor): void;

  /** Register multiple at once (convenience). */
  registerAll(descriptors: InternalToolDescriptor[]): void;

  /**
   * Look up the descriptor for a tool name.
   * Patterns are evaluated in registration order; first match wins.
   * Returns null if no match (tool is external/third-party).
   */
  resolve(toolName: string): InternalToolDescriptor | null;

  /** Returns true if any registered entry matches toolName. */
  isInternal(toolName: string): boolean;
}

// Singleton exported for use across the UI package
export const toolRegistry = new InternalToolRegistry();
```

Registrations happen in dedicated descriptor files that are imported once from the UI package entry point — they never touch `ToolCallCard.tsx`.

### 1.4 Dispatch in `ToolCallCard.tsx`

The dispatch block becomes a single registry lookup, replacing the current chain of `if` checks:

```tsx
// ToolCallCard.tsx (conceptual, not implementation)

const descriptor = toolRegistry.resolve(toolCall.toolName);
if (descriptor) {
  return (
    <BuiltinToolCard toolCall={toolCall} descriptor={descriptor}>
      {descriptor.CardBody ? (
        <descriptor.CardBody toolCall={toolCall} descriptor={descriptor} />
      ) : (
        <DefaultBuiltinCardBody toolCall={toolCall} descriptor={descriptor} />
      )}
    </BuiltinToolCard>
  );
}
// ... existing MonitorCard, SkillCard, file ops, generic fallback
```

The existing special-cased native tools (`Monitor`, `Skill`, memory ops, file ops) can be migrated into the registry incrementally — or left as-is in `ToolCallCard.tsx` since they predate the registry. New tools should always use the registry.

### 1.5 Migration path for existing native tools

The registry supports the same `exact` match pattern that existing native tools use. Over time, existing renderers can be refactored as registry entries:

| Existing renderer     | Migration notes                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `MonitorCard`         | Register with `{ type: "exact", name: "Monitor" }`, keep existing component as `CardBody` |
| `SkillCard`           | Register with `{ type: "exact", name: "Skill" }`                                          |
| `MemoryOperationCard` | Register with a `predicate` matching the memory path heuristic                            |
| `FileChangeViewer`    | Register with a `predicate` matching file operation tool names                            |

Migration is optional and can be deferred — the registry check runs before the existing chain, so both coexist safely.

---

## 2. Registering Internal MCP Servers

### 2.1 Descriptor files

Each MCP server has its own descriptor file in the registry module:

```
packages/ui/src/tool-registry/
  types.ts                       ← descriptor shape, ToolCardBodyProps
  registry.ts                    ← InternalToolRegistry class + singleton
  index.ts                       ← re-exports; imports all descriptors to trigger registration
  descriptors/
    scheduler.descriptor.ts      ← stratos-scheduler entry + SchedulerCardBody component
    preview.descriptor.ts        ← stratos-preview entry + PreviewCardBody component
    manager.descriptor.ts        ← stratos-manager entry + ManagerCardBody component
```

`index.ts` imports all descriptor files as a side effect. Any file that imports from `@stratosapp/ui` gets all registrations automatically — no explicit initialization call required.

### 2.2 Adding a new internal tool in the future

To give a new internal tool first-class treatment, a developer:

1. Creates `packages/ui/src/tool-registry/descriptors/<name>.descriptor.ts`
2. Calls `toolRegistry.register({ id: "...", match: ..., display: ..., ... })`
3. Adds a single import line to `index.ts`

That's it. `ToolCallCard.tsx` does not change. The dispatch loop, the classification utilities, and the ToolsPopover grouping all react automatically to whatever is in the registry.

---

## 3. Visual Language

### 3.1 Card shell: `BuiltinToolCard`

All registered internal tools render inside a shared `BuiltinToolCard` shell component. It reads `descriptor.display` to apply consistent styling:

```
┌─ [accent border, 4px] ──────────────────────────────── ▼ ─┐
│  [Icon]  {sourceLabel}                    [status chip]    │
│  {title(toolCall)}                                         │
│  ────────────────────────────────────────────────────────  │
│  {CardBody or DefaultBuiltinCardBody}  (collapsed)         │
└────────────────────────────────────────────────────────────┘
```

- **Left border accent**: 4 px solid in `descriptor.display.accentColor`, matching the `MonitorCard` pattern.
- **Header row**: icon (tinted with accent color) + `sourceLabel` on the left; status chip on the right.
- **Title line**: result of `descriptor.title(toolCall)` or humanized short name fallback.
- **Body**: collapsed by default; expandable chevron reveals `CardBody`.
- **Status chip**: Running → amber spinner; Completed → green dot; Denied → red dot; Pending → grey dot.

Generic external MCP cards (not in the registry) retain their current grey styling with no accent.

### 3.2 Accent color assignments

| Registered entry    | Accent color      | Icon           | Rationale               |
| ------------------- | ----------------- | -------------- | ----------------------- |
| `stratos-scheduler` | Amber `#F59E0B`   | Clock          | Scheduling = time       |
| `stratos-preview`   | Indigo `#6366F1`  | Eye / sidebar  | Preview = viewing       |
| `stratos-manager`   | Emerald `#10B981` | Layers / agent | Manager = orchestration |
| _(future)_          | Pick from palette | —              | Add to descriptor       |

Colors must be validated against light/dark theme tokens for WCAG AA contrast.

### 3.3 `DefaultBuiltinCardBody`

When a descriptor omits `CardBody`, the default body renders:

- **Input**: humanized key-value pairs (`file_path` → "File", `prompt` → "Prompt"), never raw JSON.
- **Output**: single-line text for scalars; red-tinted text for errors; compact list for arrays (max 5 items + overflow count).

This means even unregistered-but-future tools get reasonable rendering with zero per-tool code.

---

## 4. Per-Server Card Bodies

Each built-in server ships a `CardBody` component in its descriptor file. These are standard React components and can use any UI primitives.

### 4.1 SchedulerCardBody

Renders inside `BuiltinToolCard` for all `mcp__stratos-scheduler__*` tools.

**Title interpolation** (via `descriptor.title`):

| Tool               | Title                       |
| ------------------ | --------------------------- |
| `schedule_create`  | "Created schedule: {name}"  |
| `schedule_list`    | "Listed schedules"          |
| `schedule_delete`  | "Deleted schedule: {name}"  |
| `schedule_enable`  | "Enabled schedule: {name}"  |
| `schedule_disable` | "Disabled schedule: {name}" |
| `schedule_folders` | "Fetched available folders" |

**Card body detail:**

- `schedule_create` / `schedule_enable` / `schedule_disable`: show cron expression (human-readable label, e.g. "Every day at 9 AM"), folder name, enabled/disabled badge.
- `schedule_list`: compact table — schedule name, next run, status — capped at 5 rows with "View all" link. Uses compact single-line variant when `visibility` logic marks it as a poll call (consecutive calls within 10 s).
- `schedule_delete`: deleted schedule name in strikethrough.
- `schedule_folders`: list of folder names, no extra detail needed.

### 4.2 PreviewCardBody

**Title interpolation:**

| Tool                | Title                                            |
| ------------------- | ------------------------------------------------ |
| `preview_open_file` | "Opened preview: {title or basename(file_path)}" |
| `preview_close`     | "Closed preview pane"                            |

**Card body detail:**

- `preview_open_file`: file-type icon (from extension), filename as a clickable link (re-opens via IPC bridge from `StratosProvider` context), full path as a secondary line.
- `preview_close`: minimal — no expandable body needed; `CardBody` can be omitted, using `DefaultBuiltinCardBody` or a static message.

### 4.3 ManagerCardBody

**Title interpolation:**

| Tool               | Title                         |
| ------------------ | ----------------------------- |
| `create_session`   | "Started session in {folder}" |
| `send_message`     | "Sent message to session"     |
| `stop_session`     | "Stopped session"             |
| `delete_session`   | "Deleted session"             |
| `list_sessions`    | "Listed sessions"             |
| `get_session`      | "Fetched session info"        |
| `search_sessions`  | "Searched sessions: {query}"  |
| `get_dashboard`    | "Fetched dashboard"           |
| `list_workspaces`  | "Listed workspaces"           |
| `create_workspace` | "Created workspace: {name}"   |
| `remove_workspace` | "Removed workspace: {name}"   |

**Card body detail:**

- `create_session` / `send_message`: folder/workspace name + truncated prompt preview (max 80 chars); `send_message` while `status === "running"` shows a pulsing indicator.
- `list_sessions` / `get_dashboard`: compact count summary ("3 active, 1 stopped") rather than raw JSON.
- Read-only queries (`get_session`, `search_sessions`, `get_dashboard`, `list_sessions`, `list_workspaces`) can set `visibility: "hidden"` in their descriptor to suppress low-value informational cards from the thread.

---

## 5. ToolsPopover: Grouped Display

`ToolsPopover.tsx` lists available MCP servers. With the registry, it can dynamically separate internal from external tools:

```
─── Stratos Built-in ───────────────────────
  [Clock amber]   Stratos Scheduler   (6 tools)
  [Eye indigo]    Stratos Preview     (2 tools)
  [Layers green]  Stratos Manager     (11 tools)
─── External ───────────────────────────────
  github          (5 tools)
  ...
```

The popover queries the registry — `toolRegistry.isInternal("mcp__" + server + "__any")` or a dedicated `toolRegistry.getServerDescriptor(serverName)` — rather than maintaining a separate hardcoded list. This means future built-in servers automatically appear in the "Stratos Built-in" section without any popover changes.

---

## 6. Filtering & Visibility

The `visibility` field on a descriptor gives each entry control over whether its cards appear in the thread:

- `"visible"` (default): always rendered.
- `"hidden"`: card is never rendered (silent tool call). Use for noisy read-only polls.
- Function form: per-call decision based on `toolCall` state — e.g. suppress `schedule_list` if the previous tool call in the thread was also `schedule_list`.

`MessageBubble.tsx` consults the registry when building its `regularToolCalls` filter:

```ts
// Extend the existing filter to also suppress registry-hidden calls
const regularToolCalls = toolCalls.filter((tc) => {
  if (ALWAYS_HIDDEN_TOOLS.has(tc.toolName)) return false;
  const descriptor = toolRegistry.resolve(tc.toolName);
  if (descriptor) {
    const vis =
      typeof descriptor.visibility === "function"
        ? descriptor.visibility(tc)
        : (descriptor.visibility ?? "visible");
    if (vis === "hidden") return false;
  }
  return true;
});
```

This is the only change required to `MessageBubble.tsx`.

---

## 7. Data Model Changes

No changes to `StoredToolCall`, `ToolCall`, or any storage types. The registry is a pure render-layer concern. Tool names already carry all identity information needed for classification.

The only additive change to `@stratosapp/core` is an optional shared `isInternalToolName(toolName: string): boolean` utility in `packages/core/src/utils/tool-classification.ts`, for use in server-side logic (e.g. `resolveToolBehavior` in `agent-session-logic.ts`). This utility must not import from the registry (which lives in `@stratosapp/ui`); it maintains a minimal parallel list of internal server names.

---

## 8. Rendering Pipeline Changes Summary

| File                                                                | Change                                                 | Type            |
| ------------------------------------------------------------------- | ------------------------------------------------------ | --------------- |
| `packages/ui/src/tool-registry/types.ts`                            | New — descriptor types                                 | New file        |
| `packages/ui/src/tool-registry/registry.ts`                         | New — registry class + singleton                       | New file        |
| `packages/ui/src/tool-registry/index.ts`                            | New — imports all descriptor files                     | New file        |
| `packages/ui/src/tool-registry/descriptors/scheduler.descriptor.ts` | New — scheduler descriptor + CardBody                  | New file        |
| `packages/ui/src/tool-registry/descriptors/preview.descriptor.ts`   | New — preview descriptor + CardBody                    | New file        |
| `packages/ui/src/tool-registry/descriptors/manager.descriptor.ts`   | New — manager descriptor + CardBody                    | New file        |
| `packages/ui/src/components/BuiltinToolCard.tsx`                    | New — shared card shell                                | New file        |
| `packages/ui/src/components/DefaultBuiltinCardBody.tsx`             | New — fallback body renderer                           | New file        |
| `packages/ui/src/components/ToolCallCard.tsx`                       | Add single registry lookup block before existing chain | Edit (~5 lines) |
| `packages/ui/src/components/MessageBubble.tsx`                      | Extend tool filter to respect `visibility`             | Edit (~8 lines) |
| `packages/ui/src/components/ToolsPopover.tsx`                       | Separate built-in vs external server groups            | Edit            |
| `packages/core/src/utils/tool-classification.ts`                    | New — minimal server name set for core-layer use       | New file        |

`ToolCallCard.tsx` receives only a single additive block. Its existing native tool chain is untouched.

---

## 9. Edge Cases

### 9.1 Unknown tool on a known server

If `mcp__stratos-scheduler__new_future_tool` appears and has no specific title mapping, the descriptor's `title` function returns a humanized fallback ("New future tool") and `DefaultBuiltinCardBody` renders a generic key-value expansion. The card is still visually branded as Stratos Scheduler. No crash, no raw tool name exposed to users.

### 9.2 Malformed input JSON

All field extractions in `title` functions and `CardBody` components must treat input fields as optional. If `name` is absent from `schedule_create`, display "schedule" as a placeholder. Input is `Record<string, unknown>` — never assume field presence.

### 9.3 Denied tools

`BuiltinToolCard` always renders the title and status chip regardless of status. The `CardBody` receives the full `toolCall` including `status === "denied"`, and can choose to render "requested but not executed" context in the expansion. The card shell handles this uniformly — individual `CardBody` implementations do not need to branch on denial.

### 9.4 Built-in tools inside Task child calls

`TaskCard` renders `childToolCalls` via `ToolCallCard`. The registry lookup in `ToolCallCard` fires for every call, including nested ones — built-in tools in sub-tasks automatically get first-class rendering.

### 9.5 stratos-manager only in Manager Agent

Because classification is name-based, `ManagerCardBody` components are only ever rendered when a Manager Agent actually emits those tool calls. No session-context awareness needed in the registry.

### 9.6 Third-party server naming collision

The registry matches on **exact** server names from the `mcp-server` pattern, not on the `stratos-` prefix. A user-configured server named `stratos-foo` would not match any registered entry and would render as a generic external MCP card. The registry must not use prefix matching for the `mcp-server` pattern type.

### 9.7 Registry registration order

If two entries match the same tool name, first-registered wins. Descriptor files should use narrow patterns (prefer `exact` or `mcp-server` over broad `predicate`) to avoid accidental shadowing. The registry should log a warning in development if a registration would shadow an existing entry.

### 9.8 Preview pane re-open link

`PreviewCardBody` needs to call IPC to re-open a file. It accesses the bridge via `useStratosContext()` from `StratosProvider` — the same pattern used by other bridge-dependent components. In non-Electron environments (tests, Storybook), the bridge call is a no-op, keeping the component safely portable.

### 9.9 Visibility function and consecutive poll detection

The function form of `visibility` receives only the current `toolCall`. It cannot introspect neighboring calls in the thread without prop-drilling context. For the consecutive-poll suppression use case (`schedule_list` spam), consider passing the full `toolCalls` array to the visibility function, or handling it at the `MessageBubble` filter level where the full list is available.

### 9.10 Registry in packaged builds

The registry is evaluated at module load time with no async initialization. It has no dependency on the Electron main process, no IPC, and no file system reads. It is safe in packaged builds, SSR, and test environments.

---

## 10. Out of Scope

- Permission handling: built-in MCP tools follow the existing `resolveToolBehavior` flow. No registry involvement.
- Audit / history view: no changes to thread storage or export formats.
- Accessibility: `BuiltinToolCard` inherits existing card a11y patterns. No new requirements.
- Analytics / telemetry.
- Inline action buttons on cards (e.g. "Delete this schedule" on a `schedule_create` card) — future enhancement.
- Runtime dynamic registration (e.g. loading descriptors from a plugin file at runtime) — all registrations are static and bundled.

---

## 11. Open Questions

1. **Icon library**: Are server icons sourced from an existing icon set in the codebase, or custom SVGs? The `display.icon` field accepts either a component or a name string — the implementation can support both, but the design should confirm which is preferred.
2. **Accent color tokens**: The proposed amber/indigo/emerald values should be mapped to the app's Tailwind/CSS token system and validated for WCAG AA contrast in both light and dark themes.
3. **`schedule_list` table navigation**: Should schedule rows link to a Schedules management view? If so, what is the navigation API available to UI components via `StratosProvider`?
4. **`send_message` live status**: Should `ManagerCardBody` for `send_message` update in real time as the downstream session produces output? If so, what bridge/IPC channel provides that subscription?
5. **Visibility function signature**: Should `visibility` receive only the current `toolCall`, or also the sibling `toolCalls` array for consecutive-call detection? Passing siblings is more powerful but requires a richer `ToolCardBodyProps` interface.
6. **Incremental migration of existing renderers**: Should `MonitorCard`, `SkillCard`, `MemoryOperationCard`, and `FileChangeViewer` be migrated into the registry as part of this work, or deferred? Migrating them makes the dispatch in `ToolCallCard.tsx` fully declarative; deferring reduces scope.

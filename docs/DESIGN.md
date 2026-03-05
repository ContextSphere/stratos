# AgentPanel — Open Source Design Doc

**Status:** Draft / Brainstorming
**Date:** 2026-03-04

## One-liner

AgentPanel — an open-source platform to manage AI agent sessions with a polished UI. Built on Electron + React + Claude Agent SDK. By ContextSphere.

## What is AgentPanel vs ContextSphere?

| | **AgentPanel** (OSS) | **ContextSphere** (Proprietary) |
|---|---|---|
| **Purpose** | Generic platform for managing AI agent sessions | AI assistant for Product Managers |
| **Repo** | Public, new repo | Private, `contextsphere-desktop` |
| **Relationship** | The base platform | Built on top of AgentPanel |
| **Branding** | By ContextSphere, no proprietary tech | ContextSphere brand, PM-specific UX |

## Problem

There's no good open-source desktop client for managing multiple AI coding agent sessions. Developers currently use terminal-based tools (Claude Code CLI, Codex CLI) or closed-source editors. There's a gap for a dedicated, open, extensible desktop app that gives you:

- A proper UI for streaming agent conversations
- Multi-session/thread management
- Tool execution visibility and permission control
- Provider abstraction (not locked to one AI backend)

## Scope: What's In vs Out

### IN — AgentPanel (OSS)

- Core platform: Electron + Vite + React + TypeScript + Tailwind CSS
- Provider abstraction layer (AgentProvider interface)
- Claude Agent SDK provider implementation
- Chat UI (streaming messages, markdown rendering, code highlighting)
- Tool call visualization and permission dialogs
- Thread management (create, list, persist, switch) with configurable storage
- No workspace concept — flat thread management (CS adds workspaces on top)
- Sub-agent support (`.claude/agents/*.md`)
- GitHub integration
- Settings store

### OUT — Stays in ContextSphere (Proprietary)

- Workspace management (grouping threads, workspace overview)
- Artifacts (extraction, preview, editor)
- Knowledge Graph (all KG features, sync, MCP server, UI)
- Notion integration
- Amplitude integration
- Google Docs / Slides integration
- PM-specific system prompts and agent configurations
- ContextSphere branding, naming, product-sense features
- Any other non-GitHub integrations

## Open Questions

<!-- Add questions here as we brainstorm -->

1. **Provider strategy:** Ship with Claude Agent SDK only, or include stubs for others (OpenAI Codex, etc.)?
2. **Licensing:** MIT? Apache 2.0?
3. **Distribution:** Homebrew, GitHub Releases, app stores?
4. **Plugin system:** Should the OSS version support plugins/extensions from day one?
5. **How does ContextSphere consume AgentPanel?** Fork? Git subtree? npm package? Monorepo with private layer?
6. **Contribution model:** What guidelines for community PRs?

## Decisions

<!-- Record decisions here as we make them -->

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | OSS project name | **AgentPanel** (working name) | Control panel for agents, by ContextSphere |
| 2 | Knowledge Graph | **Out** — CS proprietary | Core differentiator for CS product |
| 3 | Integrations | **Only GitHub** in OSS | Notion, Amplitude, Google Docs/Slides stay in CS |
| 4 | Branding | **No proprietary CS tech** in OSS, brand association OK | OSS is foundational tech from ContextSphere |
| 5 | Styling/Design | **Keep current look as-is** | Good enough for now, revisit later |
| 6 | License | **Apache 2.0** | Patent protection, permissive enough for CS proprietary layer on top |
| 7 | Architecture | **Monorepo with 3 packages** (`ui`, `core`, `desktop`) | Modular from day one; single repo for fast iteration; agents handle cross-package changes easily |
| 8 | `core` constraint | **Pure TypeScript, no React** | Framework-agnostic — works in Node, web, CLI, not just React |
| 9 | External UI libs | **Wrapped, never exposed** | Monaco, react-markdown, etc. are internal deps of `ui` — consumers use AgentPanel components, not raw libs |
| 10 | Thread storage | **Configurable via `StorageAdapter` interface** | OSS ships default file adapter; CS provides workspace-aware adapter |
| 11 | Workspaces | **Not in OSS** — CS adds on top | OSS has flat thread management; CS groups threads into workspaces |
| 12 | Artifacts | **Not in OSS** — CS injects via extension points | Core provides `messageProcessors` hooks; UI provides `renderCustomPanel` slots |
| 13 | Screen customization | **Slot-based layout + composable components** | OSS provides `AgentPanelLayout` with slots + raw components; CS can customize slots or build entirely custom screens |

## Name Shortlist

| Name | Vibe |
|---|---|
| **Plexor** | Multiplexer — handling many agents through one surface |
| **AgentPanel** | Control panel for agents (minor dead collision: 65 stars, inactive 2 yrs) |
| **AgentSphere** | Sphere family — the agent layer of ContextSphere |

## Architecture

### Vision

AgentPanel is three things:
1. **React Component Library** for agentic applications — usable in any React app
2. **Comprehensive SDK layer** for Claude Code, Codex, OpenCode — the industry-standard provider abstraction
3. **A beautiful desktop app** — the reference implementation that makes agents accessible to everyone

### Monorepo Structure

Single repo, three packages, modular packaging. All code lives together for fast iteration.

```
agentpanel/
├── packages/
│   ├── ui/              ← @agentpanel/ui
│   ├── core/            ← @agentpanel/core
│   └── desktop/         ← @agentpanel/desktop
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### Package Details

**`@agentpanel/ui` — React Component Library**
- ChatView, InputBar, MessageBubble
- ToolCallCard, PermissionDialog
- StreamingRenderer, MarkdownViewer, CodeBlock
- Sidebar, ThreadList, WorkspaceSelector
- CodeEditor, DiffViewer (wraps Monaco), ResizableLayout (wraps react-resizable-panels)
- Receives data via props/hooks — no SDK internals
- Zero dependency on Electron — works in any React app (web, Next.js, etc.)
- External UI libraries (Monaco, react-markdown, react-syntax-highlighter, react-resizable-panels) are internal dependencies — never exposed to consumers. Wrapped behind AgentPanel's own component API so internals can be swapped without breaking consumer code.

**`@agentpanel/core` — SDK & Provider Abstraction**
- `AgentProvider` interface (the contract all backends implement)
- Claude Code SDK provider implementation
- Codex SDK provider implementation
- OpenCode SDK provider implementation
- Normalized `AgentMessage` union type across all providers
- Session/thread management
- MCP handling, tool registry
- Streaming via AsyncGenerator
- Pure TypeScript — no React, no DOM, no Electron

**`@agentpanel/desktop` — Electron App**
- Electron shell that combines `ui` + `core`
- IPC bridge (main ↔ renderer via typed channels)
- Preload/context bridge for secure communication
- Disk persistence (threads, settings, workspaces)
- OS-level features (notifications, menu bar, auto-update)
- The "download and use" experience

### Import Boundaries

| Package | Can import from | Must NOT import from |
|---|---|---|
| `ui` | React, shared types | `core` provider internals, `desktop` |
| `core` | shared types | `ui`, `desktop`, `react` |
| `desktop` | `ui`, `core` | — (glue layer, can import both) |

Enforced via ESLint rules.

### How Different Consumers Use AgentPanel

```
Web developer:      @agentpanel/ui + @agentpanel/core → custom web app
Desktop user:       @agentpanel/desktop (batteries included)
SDK-only user:      @agentpanel/core → own UI, any framework
ContextSphere:      All three + KG + integrations (proprietary layer)
```

### Extensibility Model

AgentPanel provides primitives + sensible defaults. ContextSphere (or any consumer) injects its own implementations.

**`core` extension points:**

```typescript
interface AgentPanelConfig {
  storage: StorageAdapter           // where threads are stored
  providers: AgentProvider[]        // which AI backends are available
  messageProcessors?: MessageProcessor[]  // CS injects artifact extraction
  toolHandlers?: Record<string, ToolHandler>
}

interface StorageAdapter {
  saveThread(threadId: string, messages: AgentMessage[]): Promise<void>
  loadThread(threadId: string): Promise<AgentMessage[]>
  listThreads(): Promise<ThreadMeta[]>
  deleteThread(threadId: string): Promise<void>
}
```

**`ui` extension points:**

```typescript
// Slot-based layout — quick start with customizable slots
<AgentPanelLayout
  sidebar={<ThreadList />}              // replaceable
  main={<ChatView />}                   // replaceable
  panel={null}                          // optional side panel
  pages={[]}                            // additional full-screen pages
/>

// Individual components — for fully custom screens
import { ChatView, ThreadList, ToolCallCard } from '@agentpanel/ui'
// compose however you want
```

**How ContextSphere extends:**

| Extension point | OSS default | CS implementation |
|---|---|---|
| `StorageAdapter` | `FileStorageAdapter` (flat, configurable path) | `WorkspaceStorageAdapter` (groups by workspace) |
| `messageProcessors` | None | Artifact extraction, KG linking |
| `sidebar` slot | `<ThreadList />` (flat list) | `<WorkspaceSidebar />` (grouped by workspace) |
| `panel` slot | None | `<ArtifactPreview />` |
| `pages` | None | KG page, Workspace Overview |

### Layered Architecture (within desktop)

```
┌─────────────────────────────────────────────┐
│  Renderer (React)              ← ui/        │
│  Components + Hooks                         │
│         │                                   │
│         │ IPC (typed channels)              │
│         │                                   │
│  Preload (Context Bridge)      ← desktop/   │
│         │                                   │
│         │ IPC                               │
│         │                                   │
│  Main Process (Node.js)        ← core/      │
│  Providers, Sessions, Stores                │
└─────────────────────────────────────────────┘
```

## Roadmap (TBD)

<!-- Will flesh out as we go -->

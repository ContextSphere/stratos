# AgentPanel Implementation Status

Last updated: 2026-03-05

## Completed

### Phase 1-5: Core Implementation

- **Monorepo scaffolding** — pnpm workspaces + turborepo, 3 packages
- **`@agentpanel/core`** (packages/core)
  - Provider abstraction (`Provider` interface, `ClaudeCodeProvider` using Claude Agent SDK)
  - `FileStorageAdapter` — thread CRUD, message persistence, active thread tracking
  - `TraceStore` — JSON Lines trace recording for SDK messages
  - Worktree utilities — deterministic hash/port derivation, instance isolation
  - 32 tests passing (4 test files)
- **`@agentpanel/ui`** (packages/ui)
  - 30+ React components: ChatView, Sidebar, ThreadList, InputBar, MessageBubble, ModeToggle, ModelSelector, PreviewPane, TodoList, TaskPanel, ToolCallCard, FileChangeViewer, SlashCommandMenu, PermissionDialog, etc.
  - Shared primitives: Button, Card, Dialog, Input, PanelCard, StatusIndicator, Tooltip, TypeaheadInput
  - Bridge system: `AgentPanelProvider` context for platform-agnostic component tree
  - Monaco editor integration for code previews
  - 31 tests passing (5 test files)
- **`@agentpanel/desktop`** (packages/desktop)
  - Electron main process with BrowserWindow, IPC bridge (60+ channels)
  - Preload script with contextBridge exposure
  - Renderer with full React app: App.tsx + 5 hooks (useChat, useThreads, useClaude, useGitHub, usePreview) + 3 dialog components
  - IPC modules: thread, claude, github, directory, settings, skills
  - Agent manager with session tracking and slash command discovery
  - electron-builder config for macOS distribution
  - CDP support via `--remoteDebuggingPort` flag
  - Tailwind CSS v4 styling

### Phase 6: CDP & Dev Tooling

- CDP verified working on port 9224 via `pnpm dev:debug`
- `.mcp.json` configured with `chrome-devtools` MCP server
- `.claude/settings.local.json` with pre-allowed CDP tool permissions
- `scripts/cdp-mcp.sh` launch script
- `CLAUDE.md` with agent instructions for UI verification workflow

### Branding

- All source code references cleaned: no "ContextSphere" in packages/
- Design doc (docs/DESIGN.md) retains intentional ContextSphere references explaining the OSS/proprietary relationship

## Known TODOs (v0.1.0-alpha acceptable)

### Not Yet Implemented

| Area | Detail | Priority |
|------|--------|----------|
| `useChat` streaming | Message streaming from Claude Agent SDK is partially wired. The hook structure and UI are complete but the SDK `streamMessage()` call needs real integration testing. | High for v0.1 |
| Dynamic slash commands | `AgentManager.discoverSlashCommands()` returns a hardcoded list. Could auto-discover from `claude --help` output. | Low |
| Desktop tests | No test files in `packages/desktop/`. Main/preload code is hard to unit test without Electron mocking. | Medium |
| Worktree IPC handlers | Worktree create/cleanup IPC handlers may be incomplete — the `skills.ipc.ts` registers handlers but actual worktree git operations need verification. | Medium |

### Architecture Decisions Made

- **Worktree isolation is opt-in** — Set `AGENTPANEL_WORKTREE=1` to enable. Without it, the app uses standard `~/Library/Application Support/AgentPanel/`. This prevents conflicts when developing inside a parent Electron app (e.g., ContextSphere).
- **Fixed CDP port (9224)** — Unlike ContextSphere which derives ports from worktree hashes, AgentPanel uses a fixed port for simplicity. Override with `CDP_PORT` env var if needed.
- **`app.name` set explicitly** — Both worktree and non-worktree paths set `app.name` to prevent singleton lock conflicts with other Electron apps using the generic `Electron` binary.

## Git History

```
8eca53c fix: CDP support and worktree isolation
7842d6c fix: wire running threads tracker, add turbo outputs for desktop
d1f105a feat: implement core, ui, and desktop packages
d5fec3a docs: add initial design doc for AgentPanel
9f0cd1b Initial commit
```

## How to Resume Development

```bash
cd workspace/agentpanel
pnpm install
pnpm build            # Verify all packages compile
pnpm test             # Verify tests pass (63 tests)

# Launch with CDP for UI work
pnpm --filter @agentpanel/desktop dev:debug
# CDP available at http://127.0.0.1:9224/json
```

### Next Steps (suggested)

1. **Integration test the chat flow** — Wire `useChat` to actually call Claude Agent SDK and verify message round-trip
2. **Add README.md** — Public-facing readme for the OSS repo
3. **CI pipeline** — GitHub Actions for build + test
4. **npm publish config** — Set up `@agentpanel/core` and `@agentpanel/ui` for npm publishing
5. **Tag v0.1.0-alpha** — First tagged release once chat flow works end-to-end

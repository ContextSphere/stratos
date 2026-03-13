# CLAUDE.md — Stratos

## Quick Start

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all 3 packages (core, ui, desktop)
pnpm test             # Run tests across all packages
pnpm --filter @stratosapp/desktop dev         # Dev mode with HMR
pnpm --filter @stratosapp/desktop dev:debug   # Dev mode + CDP (port auto-derived from git root)
```

## Testing

```bash
pnpm test                                          # Run all tests (core + ui + desktop)
pnpm --filter @stratosapp/core test                # Core unit + integration tests only
pnpm --filter @stratosapp/ui test                  # UI component tests only
pnpm --filter @stratosapp/desktop test             # Desktop unit + integration tests only
```

> **Always add unit tests for changes in `@stratosapp/core`**, especially anything touching the SDK integration (e.g. `sdk-transcript.ts`, providers, storage adapters).

**CI runs automatically** on every push via GitHub Actions (`.github/workflows/ci.yml`):

- `lint` — ESLint across all packages
- `typecheck` — `tsc --noEmit` after a full build
- `test` — Vitest across all packages

**Pre-commit hook** (Husky + lint-staged) runs `prettier --write` on staged `*.{ts,tsx,json,md}` files before every commit.

## Mandatory: Visually Verify Every UI Change

**You MUST test every UI change using Chrome DevTools MCP before considering it done.** Do not ask the user to verify — verify it yourself.

```bash
# 1. Start the app with CDP enabled (if not already running)
pnpm --filter @stratosapp/desktop dev:debug

# 2. Snapshot the UI to get element UIDs
#    REQUIRED before any click/fill/press_key — UIDs are session-scoped
take_snapshot

# 3. Interact with the feature you changed
click uid=...
fill uid=... value="..."
press_key key="Enter"

# 4. Screenshot + snapshot to verify the result
take_screenshot filePath="/tmp/verify.png"
take_snapshot
```

**Rules:**

- Every `take_snapshot` starts a new session. You MUST call it before any interaction.
- After interacting, WAIT 2-5 seconds, then screenshot + snapshot to capture the updated state.
- READ the screenshot image to confirm visual correctness. READ the snapshot text to confirm content/structure.
- If something looks wrong, fix it and re-verify. Do not move on with broken UI.
- **Typing into React inputs:** `fill` sets the DOM value but does NOT trigger React state updates. Use `evaluate_script` with native setter + `input` event:
  ```js
  (el) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(el, "your text here");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  ```
- **InputBar is a `contentEditable` div (not a textarea):** Set `el.textContent` directly then dispatch `new Event('input', { bubbles: true })`.

## CDP Configuration

- **Port:** Always auto-derived from the git root path using SHA256: `PORT = 9200 + (first 4 hex chars of hash % 799)`. Both the Electron app and `scripts/cdp-mcp.sh` use the same derivation, so they always agree. Override with `CDP_PORT` env var if needed.
- **How it works:** `dev:debug` sets `ENABLE_CDP=1` which makes Electron open `--remote-debugging-port` on the derived port. The `.mcp.json` MCP config runs `scripts/cdp-mcp.sh` which derives the same port and connects `chrome-devtools-mcp` to it.
- **Check your port:** The Electron console logs `[worktree] CDP port=XXXX` on startup, or run: `ROOT=$(git rev-parse --show-toplevel) && HASH=$(echo -n "$ROOT" | shasum -a 256 | cut -c1-4) && echo $((9200 + 16#$HASH % 799))`
- **First-time setup:** When Claude Code prompts to enable the `chrome-devtools` MCP server, accept it. To pre-allow all CDP tools, create `.claude/settings.local.json`:
  ```json
  {
    "permissions": {
      "allow": [
        "mcp__chrome-devtools__list_pages",
        "mcp__chrome-devtools__take_snapshot",
        "mcp__chrome-devtools__click",
        "mcp__chrome-devtools__fill",
        "mcp__chrome-devtools__press_key",
        "mcp__chrome-devtools__take_screenshot",
        "mcp__chrome-devtools__evaluate_script"
      ]
    },
    "enableAllProjectMcpServers": true
  }
  ```
- **Troubleshooting:** If MCP can't connect, ensure the app is running with `dev:debug` and that the Electron process and MCP script resolve the same git root (check with `git rev-parse --show-toplevel`).

## Project Structure

Monorepo with 3 packages managed by pnpm workspaces + turborepo:

| Package               | Path               | Description                                                         |
| --------------------- | ------------------ | ------------------------------------------------------------------- |
| `@stratosapp/core`    | `packages/core`    | Provider abstraction, storage adapters, trace store, worktree utils |
| `@stratosapp/ui`      | `packages/ui`      | React components, bridge system, hooks (zero Electron dependency)   |
| `@stratosapp/desktop` | `packages/desktop` | Electron shell, IPC bridge (60+ channels), preload, renderer        |

## Key Files

| Area            | File                                                  |
| --------------- | ----------------------------------------------------- |
| Electron main   | `packages/desktop/src/main/index.ts`                  |
| Agent manager   | `packages/desktop/src/main/agent-manager.ts`          |
| IPC channels    | `packages/desktop/src/common/ipc-channels.ts`         |
| Renderer entry  | `packages/desktop/src/renderer/App.tsx`               |
| Chat hook       | `packages/desktop/src/renderer/hooks/useChat.ts`      |
| Claude provider | `packages/core/src/providers/claude-code.provider.ts` |
| Storage adapter | `packages/core/src/storage/file-adapter.ts`           |
| Chat view       | `packages/ui/src/components/ChatView.tsx`             |
| Bridge provider | `packages/ui/src/bridges/StratosProvider.tsx`         |

## NEVER Use pkill/killall on Electron

**DO NOT run `pkill -f electron`, `killall Electron`, or any broad process kill.**
The user may be running inside ContextSphere (also Electron). Broad kills destroy everything.

**To stop the Stratos dev instance:**

```bash
# By CDP port (check console output for your port, or derive it — see CDP Configuration)
lsof -ti :YOUR_CDP_PORT | xargs kill

# By PID (if you spawned it)
kill $PID

# Graceful close via CDP
# evaluate_script(() => window.close())
```

## Layer Boundaries (MUST follow)

**Import rules:**

| Package   | Can import from     | Must NOT import from                           |
| --------- | ------------------- | ---------------------------------------------- |
| `ui`      | React, shared types | `core` provider internals, `desktop`, Electron |
| `core`    | shared types        | `ui`, `desktop`, React, DOM                    |
| `desktop` | `ui`, `core`        | — (glue layer, can import both)                |

**Package constraints:**

- **`core` is pure TypeScript** — no React, no DOM, no Electron. Must work in Node, web, CLI.
- **`ui` has zero Electron dependency** — works in any React app (web, Next.js, etc.). Platform capabilities come through the bridge system (`StratosProvider` context), never direct imports.
- **`desktop` is the glue layer** — wires `core` providers to `ui` components via IPC bridge. All Electron-specific code lives here.
- **External UI libs are wrapped, never exposed** — Monaco, react-markdown, etc. are internal deps of `ui`. Consumers use Stratos components, not raw libs. Internals can be swapped without breaking consumers.

## Architecture Notes

- **Worktree isolation** is automatic in dev mode. Each git root gets a deterministic isolated data dir at `~/.stratos/instances/<hash>/` and a unique CDP port. Packaged builds use `~/Library/Application Support/Stratos/`.
- **IPC bridge pattern:** Main process registers handlers via `ipcMain.handle()`, preload exposes them via `contextBridge`, renderer accesses via `window.electronAPI`.
- **Provider abstraction:** `@stratosapp/core` defines a `Provider` interface. `ClaudeCodeProvider` implements it using `@anthropic-ai/claude-agent-sdk`. New providers can be added without touching UI code.
- **Bridge system:** `@stratosapp/ui` components receive platform capabilities through `StratosProvider` context. Desktop injects Electron IPC; other platforms can inject their own implementations.

## Self-Development (Dual-Instance Workflow)

Stratos can develop itself: run one instance as the "dev tool" (main worktree) and a second as the "dev target" (feature worktree). Each gets a unique CDP port derived from its git root path, a distinct logo color, and a different dock icon. See `.claude/skills/dev-target.md` for the full workflow.

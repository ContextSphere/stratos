[CI badge](#ci) [License badge](#license) [Version badge](#)

# AgentPanel

> Claude Code. No terminal required.

<img width="1467" height="943" alt="Screenshot 2026-03-07 at 11 13 25 PM" src="https://github.com/user-attachments/assets/259160ca-513a-4cbc-85e5-af393aa55b36" />


A desktop GUI for the most powerful AI coding agents.

Run Claude Code and Codex through a visual, multi-threaded interface, whether you're a developer or just want AI to help you build things.

---

## Download

[macOS .dmg](#) | [Build from source](#quick-start-developers)

---

## Why AgentPanel

Claude Code is one of the most capable coding agents available.

But it lives entirely in your terminal, which makes it hard to use, hard to review, and hard to trust for anyone who isn't already comfortable with the command line.

AgentPanel gives you:

- **Visibility**: watch tool calls, file changes, and thinking in real time
- **Control**: approve, plan, or let agents run freely (`Plan` / `Default` / `AcceptEdits` / `Bypass` modes)
- **Threads**: manage multiple agent sessions across projects without losing context
- **No terminal required**: a point-and-click interface for the people who need it most

---

## Features

- Multi-thread agent sessions with folder organization
- Real-time streaming: tokens, tool calls, reasoning, file changes
- Permission modes: `Plan`, `Default`, `AcceptEdits`, `Bypass`
- File explorer + diff preview integrated into chat
- Claude Code and Codex providers
- Cost and token tracking
- Worktree isolation for parallel development

---

## Quick Start (Developers)

```bash
pnpm install
pnpm build
pnpm --filter @agentpanel/desktop dev
```

## Build On It (Embedders/Builders)

- `@agentpanel/core`: provider abstraction, storage (pure TypeScript, no React)
- `@agentpanel/ui`: React components, zero Electron dependency
- `@agentpanel/desktop`: Electron reference app

## Harness Engineering

AgentPanel supports a self-development loop where one instance can drive and verify another:

- Run a control instance in one worktree
- Run a target instance in another worktree
- Use isolated state and deterministic dev ports for repeatable checks

This makes it practical to evolve AgentPanel with AgentPanel.

## Repository Structure

```text
packages/
  core/     # @agentpanel/core
  ui/       # @agentpanel/ui
  desktop/  # @agentpanel/desktop
docs/       # design notes, implementation status, plans
```

## Prerequisites

- Node.js 22+
- pnpm 9 (`pnpm@9.15.4` in CI)
- macOS for packaged desktop builds (`pnpm build:mac`)

## Common Commands

```bash
pnpm dev          # run development tasks
pnpm build        # build all packages
pnpm test         # run tests
pnpm typecheck    # type-check all packages
pnpm lint         # lint all packages
pnpm build:mac    # build desktop macOS artifact
```

## Contributing

Short version: open an issue, discuss scope, send a focused PR.

Detailed guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Roadmap

### Near Term

- Stabilize end-to-end chat streaming integration
- Expand desktop test coverage
- Improve slash command discovery
- Prepare first tagged alpha release

### Bigger Items

- OpenCode provider support and parity with existing providers
- Deeper provider interoperability and model capability mapping
- Plugin/extension surface for third-party integrations
- Better multi-agent orchestration workflows

## CI

GitHub Actions CI runs on pushes and pull requests:

- lint
- typecheck
- test

Workflow file: `.github/workflows/ci.yml`.

## Documentation

- `docs/DESIGN.md` - OSS architecture direction
- `docs/IMPLEMENTATION-STATUS.md` - implementation status and TODOs
- `docs/codex-provider.md` - Codex provider design notes

## License

Apache-2.0. See `LICENSE`.

# Contributing to Stratos

Thanks for contributing.

## Before You Start

- Search existing issues to avoid duplicates
- For larger changes, open an issue first to align on scope/design
- Keep PRs focused (one change set per PR)

## Development Setup

```bash
pnpm install
pnpm build
pnpm test
```

Run the desktop app locally:

```bash
pnpm --filter @stratosapp/desktop dev
```

## Required Checks

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Pull Request Guidelines

- Use a clear title and explain the problem + solution
- Link related issues (`Fixes #123` when appropriate)
- Include tests for behavior changes
- Update docs when changing behavior or developer workflow
- Keep commits and diffs reviewable

## Working with AI Agents

Stratos is AI-native — most of the codebase was written and tested using coding agents, and we encourage you to do the same. The repo is set up to make this work well:

- **The repo includes full harness engineering.** `CLAUDE.md` defines architecture constraints and layer boundaries. Skills (`.claude/skills/`) provide reusable agent workflows. MCP configs wire up tools like Chrome DevTools so agents can visually verify UI changes. Your agent has everything it needs to understand, build, and test — end to end.
- **The architecture is agent-friendly by design.** Strict package boundaries, clear separation of concerns, and comprehensive type definitions help agents produce code that fits.
- **Test everything.** Agents write bugs too. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` before opening a PR — the same checks CI will run.

### Quality over speed

AI agents can produce a lot of code quickly. That's a feature, not a free pass. We hold AI-assisted contributions to the same standard as any other:

- No unnecessary abstractions, over-engineering, or speculative code
- No verbose comments restating what the code already says
- No copy-paste patterns where a clean abstraction exists
- Respect the layer boundaries in `CLAUDE.md` — if your agent imports `electron` in the UI package, that's a reject

If you're unsure whether your agent's output meets the bar, read the diff as if a human wrote it. If it wouldn't pass review from a human, it won't pass here either.

## Areas You Can Help With

- Provider integrations and protocol handling
- Desktop reliability and test coverage
- UI quality, accessibility, and interaction polish
- Documentation and developer onboarding

## Community Standards

- Be respectful and constructive in issues and PRs
- Assume good intent and focus on technical clarity
- If unsure about direction, ask early

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for full community guidelines.

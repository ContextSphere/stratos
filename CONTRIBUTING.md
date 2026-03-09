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

## Areas You Can Help With

- Provider integrations and protocol handling
- Desktop reliability and test coverage
- UI quality, accessibility, and interaction polish
- Documentation and developer onboarding

## Community Standards

- Be respectful and constructive in issues and PRs
- Assume good intent and focus on technical clarity
- If unsure about direction, ask early

A dedicated `CODE_OF_CONDUCT.md` will be added as project governance matures.

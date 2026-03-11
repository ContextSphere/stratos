# Packaged App Validation

This document captures release validation practices for desktop app artifacts.

## Core Principles

- Validate the packaged artifact that users actually install, not only a locally launched build directory.
- Treat packaged runtime behavior as separate from development runtime behavior.
- Assume external tools and environment variables behave differently once the app is launched outside a developer shell.
- Verify critical user flows end to end after installation, not only app startup.

## Release Smoke Test Checklist

Before publishing a desktop release:

1. Install the packaged artifact in the same way an end user would.
2. Launch the installed app from the normal application location.
3. Confirm the app renders its packaged UI rather than relying on any development server or dev-only asset path.
4. Exercise one happy-path flow for each critical integration.
5. Verify any required external CLI or helper dependency resolves from a stable production path.
6. Confirm the app still works when started outside a terminal session.

## Common Failure Patterns

- The packaged app still depends on development-only paths or workspace layout.
- A runtime helper is available in development but not executable from the installed artifact.
- Development environment variables leak into packaged startup and change runtime behavior.
- Connection checks succeed, but the actual end-to-end integration path uses a different executable or startup method.
- Validation is performed against the wrong artifact, which hides differences between the tested build and the installed build.

## Debugging Guidance

When a packaged build behaves differently from development:

- Compare the installed artifact with the locally built artifact before assuming the same code is running.
- Inspect the packaged startup path separately from the integration startup path.
- Capture stderr and exit codes from spawned tools instead of relying on a generic UI error.
- Prefer explicit, production-safe executable resolution for external dependencies.
- Re-test after installation, not just after rebuilding.

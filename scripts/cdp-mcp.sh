#!/usr/bin/env bash
# Launch chrome-devtools-mcp pointing at the AgentPanel Electron app.
# Derives a deterministic CDP port from the git worktree root path.
# Override with CDP_PORT env var.

if [ -z "$CDP_PORT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  HASH="$(echo -n "$ROOT" | shasum -a 256 | cut -c1-4)"
  DECIMAL=$((16#$HASH))
  PORT=$((9200 + DECIMAL % 799))
else
  PORT="$CDP_PORT"
fi

exec npx chrome-devtools-mcp --browser-url="http://127.0.0.1:${PORT}"

#!/usr/bin/env bash
# Launch chrome-devtools-mcp pointing at the AgentPanel Electron app.
# Default port matches `pnpm dev:debug` (9224). Override with CDP_PORT.
PORT="${CDP_PORT:-9224}"
exec npx chrome-devtools-mcp --browser-url="http://127.0.0.1:${PORT}"

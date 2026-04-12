# Opencode Integration Design

## Overview

Stratos integrates [opencode](https://github.com/sst/opencode) as a third provider alongside Claude Code and Codex. Opencode runs as a local HTTP daemon and exposes 20+ LLM backends (Anthropic, OpenAI, OpenRouter, Google, Groq, Mistral, and more) through a unified SSE streaming API. This gives Stratos access to any model supported by the Vercel AI SDK without requiring per-model API surface changes.

## Architecture

### Server Mode (chosen over CLI mode)

Opencode supports two invocation patterns:

| Mode            | Command                                           | Streaming                    |
| --------------- | ------------------------------------------------- | ---------------------------- |
| CLI mode        | `opencode run --format json`                      | Per-part only (no per-token) |
| **Server mode** | `opencode serve --hostname 127.0.0.1 --port PORT` | **Per-token via SSE**        |

Server mode was chosen because it provides true per-token streaming via `message.part.delta` SSE events, matching the UX of the other providers.

### Static Server Registry

One opencode server process runs per Stratos worktree. Multiple `OpencodeProvider` instances in the same worktree share the same server via a static registry keyed by port number:

```
Thread 1 ──┐
Thread 2 ──┼──▶ OpencodeProvider instance ──▶ serverRegistry[port] ──▶ opencode server PID
Thread 3 ──┘
```

Provider instances are created and disposed per-stream, but the server process persists until:

- The port is explicitly restarted (e.g. after API key change)
- The Electron process exits

### Port Derivation

Each worktree gets a deterministic port derived from its `cwd` path:

```typescript
const hash = deriveHash(cwd); // SHA256, first 8 hex chars
const port = derivePort(hash, 8200, 8999); // range avoids CDP (9200–9999) and opencode default (4096)
```

This matches the pattern used for CDP ports, ensuring no collisions across worktrees.

## Data Flow

### Startup (first message in a session)

```
App.tsx                 agent-manager.ts         OpencodeProvider        opencode server
   │                          │                        │                       │
   ├─sendMessage──────────────▶                        │                       │
   │                     runStream()                   │                       │
   │                      provider.initialize()        │                       │
   │                          ├───────────────────────▶│                       │
   │                          │                   ensureServer()               │
   │                          │                        ├──spawn opencode serve─▶│
   │                          │                        │◀──stdout: "listening"──┤
   │                          │                        │   (poll GET /provider) │
   │                          │◀─(initialized)─────────│                       │
   │                      provider.sendMessage()        │                       │
   │                          ├───────────────────────▶│                       │
   │                          │                   POST /session (create)       │
   │                          │                        ├──────────────────────▶│
   │                          │                        │◀─{id: "session-abc"}──┤
   │                          │                   emit session_init            │
   │                          │                   GET /event (SSE subscribe)   │
   │                          │                        ├──────────────────────▶│
   │                          │                   POST /session/abc/prompt_async│
   │                          │                        ├──────────────────────▶│
   │                          │◀──SSE message.part.delta events ───────────────┤
   │◀─STREAM_MESSAGE events───│                        │                       │
```

### SSE Event Processing

The SSE stream delivers events in the format:

```
data: {"type":"message.part.delta","properties":{"sessionId":"...","messageId":"...","part":{"id":"p1","type":"text","field":"text","value":"Hello"}}}\n\n
```

Key event types processed:

| SSE type               | Stratos AgentMessage                         | Notes                                     |
| ---------------------- | -------------------------------------------- | ----------------------------------------- |
| `message.part.delta`   | `text` or `thinking`                         | Type resolved from `partTypeMap`          |
| `message.part.updated` | Corrects prior `text` → `thinking` if needed | Updates `partTypeMap`                     |
| `tool.use.start`       | `tool_use`                                   | Maps opencode tool names to Stratos names |
| `tool.use.completed`   | `tool_use` + `tool_result`                   | With output                               |
| `tool.use.error`       | `tool_use` + `tool_result`                   | With error message                        |
| `session.completed`    | `result`                                     | With usage stats                          |
| `session.error`        | `error`                                      |                                           |

#### Reasoning vs Text Disambiguation

Opencode delta events don't carry part type inline — both text and reasoning use `field: "text"`. The `partTypeMap` tracks `partId → type`, populated when `message.part.updated` fires with full part data. Deltas are optimistically yielded as `text` and corrected to `thinking` on the settled `message.part.updated` event.

### Session Resumption

Opencode sessions persist on the opencode server across turns. Stratos stores the opencode session ID in `Thread.sessionId`:

1. First message: `POST /session` → creates a new session, stores `session.id` in thread
2. Subsequent messages: `canResume(sessionId)` returns `true` → reuses existing session
3. Server restart: `canResume` is not affected — session IDs are stored server-side and survive provider instance recreation but not server process restart

## API Key Management

### Storage

API keys are stored in `~/.stratos/app-settings.json` under `opencodeProviderKeys`:

```json
{
  "opencodeProviderKeys": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." },
    "openrouter": {
      "apiKey": "sk-or-...",
      "baseURL": "https://openrouter.ai/api/v1"
    }
  }
}
```

### Injection

Keys are injected into the opencode server at startup via the `OPENCODE_CONFIG_CONTENT` environment variable:

```json
{
  "providers": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." }
  }
}
```

### Key Change Lifecycle

When a user adds or removes a key via the Opencode Settings dialog:

1. `OpencodeProvider.restartServer()` kills all running opencode servers
2. The model cache is invalidated
3. The next `initialize()` call spawns a fresh server with updated keys

## Model Selection

Models are fetched from `GET /provider` which returns a list of all installed providers and their models. Stratos maps them to `ModelInfo` with the value format `"providerID/modelID"` (e.g. `"anthropic/claude-sonnet-4-5"`). This format is passed directly to `POST /session` as the `modelID` field.

## Permission Model

Opencode operates in one of two Stratos modes:

| Stratos Mode        | Behavior                                            |
| ------------------- | --------------------------------------------------- |
| `default`           | Every tool use triggers a permission dialog         |
| `bypassPermissions` | All tools auto-approved; opencode runs autonomously |

Opencode does not have a native plan mode or per-tool permission — it's the Stratos `permissionHandler` that mediates all tool use decisions.

## File Structure

```
packages/core/src/providers/
  opencode.provider.ts          # Main provider implementation (~460 lines)

packages/core/src/providers/
  index.ts                      # Registry: added "opencode" → OpencodeProvider

packages/core/src/index.ts     # Exports OpencodeProvider

packages/core/src/types/
  thread.ts                     # ProviderType: added "opencode"
  mode.ts                       # PROVIDER_AGENT_MODES: added opencode

packages/ui/src/utils/modes.ts # ProviderType, PROVIDER_AGENT_MODES: added opencode
packages/ui/src/components/
  ProviderToggle.tsx            # Added "Opencode" button

packages/desktop/src/common/
  ipc-channels.ts               # Added OPENCODE_GET_PROVIDER_KEYS, SET, DELETE

packages/desktop/src/preload/
  index.ts                      # Exposed opencode key management APIs

packages/desktop/src/main/
  agent-manager.ts              # Initialize with opencodeConfig, IPC handlers
  settings/settings.store.ts    # OpencodeProviderKey type, CRUD helpers

packages/desktop/src/renderer/
  App.tsx                       # ProviderType casts, OpencodeSettingsDialog
  utils/modes.ts                # ProviderType: added "opencode"
  components/
    OpencodeSettingsDialog.tsx  # Key management UI
```

## Testing

Manual verification steps:

1. **Server startup**: Add an Anthropic key via the Opencode Settings dialog. Open a new thread, select "Opencode" provider and a model like `anthropic/claude-sonnet-4-5`. Send a message — the server should start and respond.

2. **Per-token streaming**: Text should appear incrementally, not in one chunk.

3. **Session resume**: Send a follow-up message in the same thread — the existing session should be reused (no `session_init` emitted again).

4. **Key update**: Add/remove a key and confirm the server restarts and model list refreshes.

5. **Multi-provider**: Configure both Anthropic and OpenAI keys, switch models between providers in the same thread.

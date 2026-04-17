# Ollama Integration Plan (via Opencode Provider)

## Summary

Enable Stratos to use local Ollama models (e.g. `gemma4:26b`) through the existing Opencode provider. Ollama runs at `localhost:11434` and exposes an OpenAI-compatible API. Opencode supports custom providers via `OPENCODE_CONFIG_CONTENT` using the `@ai-sdk/openai-compatible` SDK adapter.

## Proof of Concept (verified)

The following command successfully sends a prompt to Ollama through opencode, with tool calling:

```bash
OPENCODE_CONFIG_CONTENT='{
  "provider": {
    "ollama": {
      "id": "ollama",
      "name": "Ollama",
      "npm": "@ai-sdk/openai-compatible",
      "api": "http://localhost:11434/v1",
      "options": { "apiKey": "ollama" },
      "models": {
        "gemma4:26b": {
          "id": "gemma4:26b",
          "name": "Gemma 4 26B",
          "tool_call": true,
          "temperature": true,
          "limit": { "context": 131072, "output": 8192 }
        }
      }
    }
  }
}' opencode run -m "ollama/gemma4:26b" "Read package.json and tell me the project name"
```

Result: opencode successfully calls its `read` tool and returns the answer. Server mode (`opencode serve`) also works and exposes the ollama provider at `/provider` with `status: "active"`.

## Current Architecture

The opencode provider config flow in Stratos today:

```
app-settings.json                     buildOpencodeEnv()                   opencode server
  opencodeProviderKeys: {     --->    OPENCODE_CONFIG_CONTENT:    --->     Recognizes provider,
    "anthropic": {                    {"provider": {                       fetches models,
      apiKey: "sk-ant-..."            "anthropic": {                       accepts messages
    }                                   "options": { "apiKey": "..." }
  }                                   }}}
```

**Problem:** `buildOpencodeEnv()` only passes `{ options: { apiKey, baseURL? } }` per provider. For Ollama, we need the full provider definition including `npm`, `api`, and `models` fields because "ollama" is not a built-in opencode provider.

## Implementation Plan

### Phase 1: Core — Extend config to support full provider definitions

**File: `packages/core/src/providers/types.ts`**

Add an `OpencodeCustomProvider` type alongside the existing simple key format:

```typescript
export interface OpencodeCustomProvider {
  id: string;
  name: string;
  npm: string; // e.g. "@ai-sdk/openai-compatible"
  api: string; // e.g. "http://localhost:11434/v1"
  apiKey?: string; // dummy key for Ollama ("ollama"), real key for others
  models: Record<
    string,
    {
      id: string;
      name: string;
      tool_call?: boolean;
      temperature?: boolean;
      reasoning?: boolean;
      attachment?: boolean; // vision/image input support
      limit?: { context?: number; output?: number };
    }
  >;
}
```

Update `ProviderConfig.opencodeConfig`:

```typescript
opencodeConfig?: {
  providers?: Record<string, { apiKey: string; baseURL?: string }>;
  customProviders?: Record<string, OpencodeCustomProvider>;  // NEW
  port?: number;
  binaryPath?: string;
};
```

**File: `packages/core/src/providers/opencode.provider.ts`**

Update `buildOpencodeEnv()` to merge custom provider definitions into `OPENCODE_CONFIG_CONTENT`:

```typescript
function buildOpencodeEnv(config: ProviderConfig): NodeJS.ProcessEnv {
  const providers = config.opencodeConfig?.providers ?? {};
  const customProviders = config.opencodeConfig?.customProviders ?? {};

  const providerConfig: Record<string, unknown> = {};

  // Standard providers: just inject apiKey + baseURL
  for (const [id, { apiKey, baseURL }] of Object.entries(providers)) {
    if (!apiKey) continue;
    providerConfig[id] = {
      options: { apiKey, ...(baseURL ? { baseURL } : {}) },
    };
  }

  // Custom providers: inject full definition (npm, api, models, etc.)
  for (const [id, def] of Object.entries(customProviders)) {
    providerConfig[id] = {
      id: def.id,
      name: def.name,
      npm: def.npm,
      api: def.api,
      options: { apiKey: def.apiKey ?? "none" },
      models: def.models,
    };
  }

  return {
    ...process.env,
    ...(Object.keys(providerConfig).length > 0
      ? {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: providerConfig }),
        }
      : {}),
  };
}
```

### Phase 2: Settings Store — Persist Ollama configuration

**File: `packages/desktop/src/main/settings/settings.store.ts`**

Add new types and CRUD helpers:

```typescript
export interface OllamaModelInfo {
  name: string;
  size: number;               // bytes on disk
  parameterSize: string;      // e.g. "25.8B"
  family: string;             // e.g. "gemma4"
  quantization: string;       // e.g. "Q4_K_M"
  capabilities: {
    vision: boolean;          // from /api/show capabilities.includes("vision")
    tools: boolean;           // from /api/show capabilities.includes("tools")
    thinking: boolean;        // from /api/show capabilities.includes("thinking")
  };
  contextLength: number;      // from /api/show model_info.{family}.context_length
}

export interface OllamaConfig {
  baseURL: string;                          // default: "http://localhost:11434"
  models: Record<string, OllamaModelInfo>;  // keyed by model name (e.g. "gemma4:26b")
}

// In AppSettings:
ollamaConfig?: OllamaConfig;

// CRUD helpers:
export function getOllamaConfig(): OllamaConfig | undefined;
export function setOllamaConfig(config: OllamaConfig): void;
export function clearOllamaConfig(): void;
```

### Phase 3: Agent Manager — Wire Ollama config into opencode init

**File: `packages/desktop/src/main/agent-manager.ts`**

When initializing the opencode provider, build the `customProviders` record from `ollamaConfig`, mapping the rich model metadata (capabilities, context window) into the opencode model definition:

```typescript
// In the opencode provider initialization block:
const ollamaConfig = getOllamaConfig();
const customProviders: Record<string, OpencodeCustomProvider> = {};

if (ollamaConfig && Object.keys(ollamaConfig.models).length > 0) {
  customProviders["ollama"] = {
    id: "ollama",
    name: "Ollama",
    npm: "@ai-sdk/openai-compatible",
    api: `${ollamaConfig.baseURL}/v1`,
    apiKey: "ollama",
    models: Object.fromEntries(
      Object.entries(ollamaConfig.models).map(([id, m]) => [
        id,
        {
          id,
          name: `${m.name} (${m.parameterSize})`,
          tool_call: m.capabilities.tools,       // from /api/show
          temperature: true,
          reasoning: m.capabilities.thinking,     // from /api/show
          attachment: m.capabilities.vision,       // from /api/show — enables image input
          limit: {
            context: m.contextLength,             // from /api/show model_info
            output: 8192,
          },
        },
      ]),
    ),
  };
}

await provider.initialize({
  opencodeConfig: {
    providers: getOpencodeProviderKeys(),
    customProviders,
  },
  ...
});
```

Add IPC handlers for Ollama config + model discovery (see "Discovery flow" section below for full implementation of `OLLAMA_DISCOVER_MODELS`):

```typescript
ipcMain.handle(IPC_CHANNELS.OLLAMA_GET_CONFIG, async () => getOllamaConfig());
ipcMain.handle(IPC_CHANNELS.OLLAMA_SET_CONFIG, async (_event, config) => {
  setOllamaConfig(config);
  OpencodeProvider.restartServer();
  this.modelsCache.delete("opencode");
});
ipcMain.handle(IPC_CHANNELS.OLLAMA_DISCOVER_MODELS, async (_event, baseURL) => {
  // Two-step discovery: /api/tags + /api/show per model
  // See "Discovery flow" section for full implementation
});
```

### Phase 4: IPC Channels & Preload

**File: `packages/desktop/src/common/ipc-channels.ts`**

```typescript
OLLAMA_GET_CONFIG: "integration:ollama:get-config",
OLLAMA_SET_CONFIG: "integration:ollama:set-config",
OLLAMA_DISCOVER_MODELS: "integration:ollama:discover-models",
```

**File: `packages/desktop/src/preload/index.ts`**

```typescript
ollamaGetConfig: () => ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_GET_CONFIG),
ollamaSetConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_SET_CONFIG, config),
ollamaDiscoverModels: (baseURL) => ipcRenderer.invoke(IPC_CHANNELS.OLLAMA_DISCOVER_MODELS, baseURL),
```

### Phase 5: UI — Ollama Settings

**File: `packages/desktop/src/renderer/components/OllamaSettingsDialog.tsx`** (new)

A dialog that:

1. Shows a "Base URL" input (default: `http://localhost:11434`)
2. Has a "Discover Models" button that fetches from Ollama's `/api/tags`
3. Displays discovered models with checkboxes to enable/disable
4. Shows model metadata (size, parameter count, family)
5. Saves configuration to `app-settings.json`
6. Adds "ollama" to the model allowlist automatically

**File: `packages/desktop/src/renderer/components/OpencodeSettingsDialog.tsx`**

Add an "Ollama (Local)" button/section that opens the OllamaSettingsDialog, or integrate it as a special provider in the existing dialog.

### Phase 6: Model Allowlist

Update `DEFAULT_OPENCODE_MODEL_ALLOWLIST` to include "ollama" when ollamaConfig is set, or auto-add "ollama" to the allowlist when the user configures it.

## File Change Summary

| File                                                                  | Change                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/core/src/providers/types.ts`                                | Add `OpencodeCustomProvider` type, extend `opencodeConfig`   |
| `packages/core/src/providers/opencode.provider.ts`                    | Extend `buildOpencodeEnv()` to merge custom providers        |
| `packages/desktop/src/main/settings/settings.store.ts`                | Add `OllamaConfig` type + CRUD helpers                       |
| `packages/desktop/src/main/agent-manager.ts`                          | Build `customProviders` from ollama config, add IPC handlers |
| `packages/desktop/src/common/ipc-channels.ts`                         | Add 3 Ollama IPC channels                                    |
| `packages/desktop/src/preload/index.ts`                               | Expose 3 Ollama APIs to renderer                             |
| `packages/desktop/src/renderer/components/OllamaSettingsDialog.tsx`   | New: Ollama config UI with model discovery                   |
| `packages/desktop/src/renderer/components/OpencodeSettingsDialog.tsx` | Add Ollama entry point                                       |
| `packages/desktop/src/renderer/App.tsx`                               | Wire OllamaSettingsDialog                                    |

## Testing Plan

### 1. Prerequisites

```bash
# Verify Ollama is running
curl http://localhost:11434/api/tags
# Should list gemma4:26b

# Verify opencode is installed
opencode --version
# Should be >= 1.3.17
```

### 2. Manual E2E Test

1. Open Stratos, go to Opencode Settings
2. Click "Ollama (Local)" to open Ollama configuration
3. Click "Discover Models" — should show `gemma4:26b`
4. Enable the model and save
5. Create a new thread, select Opencode provider
6. In the model picker, `ollama/gemma4:26b` should appear
7. Send a message — should get a streaming response from local Ollama
8. Test tool use: "Read the file package.json" — should invoke opencode's `read` tool
9. Test session resume: send a follow-up message in the same thread

### 3. Unit Tests

- `buildOpencodeEnv()` correctly merges custom providers into `OPENCODE_CONFIG_CONTENT`
- `parseOpencodeModels()` correctly parses the ollama provider from `/provider` response
- Settings store CRUD for `ollamaConfig`

### 4. Edge Cases

- Ollama not running: model discovery should show a clear error
- Ollama model pulled/removed between discovery and use: opencode returns an error that Stratos surfaces
- Multiple Ollama models: each appears as `ollama/<model-name>` in the picker
- Ollama URL changed: restart opencode server, re-discover models

## Alternatives Considered

### A. Direct Ollama provider (new provider type)

Create a `packages/core/src/providers/ollama.provider.ts` that talks directly to Ollama's API using the `openai` npm package. This would require implementing the full agentic loop (tool calling, multi-turn, file I/O) from scratch. **Rejected** because opencode already has a mature tool execution engine.

### B. Modify opencode's models.json cache

Directly edit `~/.cache/opencode/models.json` to add an "ollama" provider. **Rejected** because it's fragile (overwritten on opencode updates) and not user-configurable.

### C. Use lmstudio provider with custom baseURL

Point the existing `lmstudio` provider at Ollama's port. **Rejected** because model IDs would be wrong (lmstudio has hardcoded model list) and it's semantically misleading.

## Ollama Model Metadata API (verified)

Model discovery requires two API calls per model:

### Step 1: `GET /api/tags` — list all local models

Returns basic info only (name, size, family). Does **not** include capabilities or context window.

```json
{
  "models": [
    {
      "name": "gemma4:26b",
      "model": "gemma4:26b",
      "size": 17987581215,
      "details": {
        "family": "gemma4",
        "families": ["gemma4"],
        "parameter_size": "25.8B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}
```

### Step 2: `POST /api/show` — get capabilities and context window per model

Request: `{ "model": "gemma4:26b" }`

Key fields in the response:

| Field                         | Example                                         | Use                                                      |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `capabilities`                | `["completion", "vision", "tools", "thinking"]` | Detect vision, tool calling, reasoning support           |
| `model_info.*.context_length` | `262144`                                        | Actual context window (key is `{family}.context_length`) |
| `details.parameter_size`      | `"25.8B"`                                       | Display in model picker                                  |
| `details.family`              | `"gemma4"`                                      | Used to find the context_length key in model_info        |

### Capability mapping to opencode model definition

```typescript
// Ollama capabilities → opencode model fields
const capabilities: string[] = showResponse.capabilities ?? [];

const modelDef = {
  id: model.name,
  name: formatDisplayName(model.name, details.parameter_size),
  tool_call: capabilities.includes("tools"), // default true if missing
  temperature: true, // always supported
  reasoning: capabilities.includes("thinking"),
  attachment: capabilities.includes("vision"), // enables image input
  limit: {
    context:
      extractContextLength(showResponse.model_info, details.family) ?? 131072,
    output: 8192, // Ollama doesn't report max output tokens; 8192 is a safe default
  },
};
```

### Context length extraction

The context length is stored in `model_info` under a key like `{family}.context_length`:

```typescript
function extractContextLength(
  modelInfo: Record<string, unknown>,
  family: string,
): number | undefined {
  // Try family-specific key first (e.g. "gemma4.context_length")
  const familyKey = `${family}.context_length`;
  if (typeof modelInfo[familyKey] === "number") {
    return modelInfo[familyKey] as number;
  }
  // Fallback: search for any key ending in ".context_length"
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}
```

### Discovery flow (updated)

The `OLLAMA_DISCOVER_MODELS` IPC handler performs both calls:

```typescript
ipcMain.handle(
  IPC_CHANNELS.OLLAMA_DISCOVER_MODELS,
  async (_event, baseURL: string) => {
    // 1. List all models
    const tagsResp = await fetch(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!tagsResp.ok) throw new Error(`Ollama not reachable at ${baseURL}`);
    const { models } = await tagsResp.json();

    // 2. Enrich each model with capabilities + context window
    const enriched = await Promise.all(
      models.map(async (m) => {
        try {
          const showResp = await fetch(`${baseURL}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: m.name }),
            signal: AbortSignal.timeout(5000),
          });
          const show = await showResp.json();
          const capabilities: string[] = show.capabilities ?? [];
          const family = m.details?.family ?? "";
          const contextLength = extractContextLength(
            show.model_info ?? {},
            family,
          );

          return {
            name: m.name,
            size: m.size,
            parameterSize: m.details?.parameter_size ?? "unknown",
            family,
            quantization: m.details?.quantization_level ?? "unknown",
            capabilities: {
              vision: capabilities.includes("vision"),
              tools: capabilities.includes("tools"),
              thinking: capabilities.includes("thinking"),
            },
            contextLength: contextLength ?? 131072,
          };
        } catch {
          // If /api/show fails for a model, return with defaults
          return {
            name: m.name,
            size: m.size,
            parameterSize: m.details?.parameter_size ?? "unknown",
            family: m.details?.family ?? "",
            quantization: m.details?.quantization_level ?? "unknown",
            capabilities: { vision: false, tools: true, thinking: false },
            contextLength: 131072,
          };
        }
      }),
    );

    return enriched;
  },
);
```

### Updated OllamaConfig type

```typescript
export interface OllamaModelInfo {
  name: string;
  size: number;
  parameterSize: string;
  family: string;
  quantization: string;
  capabilities: {
    vision: boolean;
    tools: boolean;
    thinking: boolean;
  };
  contextLength: number;
}

export interface OllamaConfig {
  baseURL: string; // default: "http://localhost:11434"
  models: Record<string, OllamaModelInfo>; // keyed by model name (e.g. "gemma4:26b")
}
```

### Updated agent-manager model mapping

```typescript
if (ollamaConfig && Object.keys(ollamaConfig.models).length > 0) {
  customProviders["ollama"] = {
    id: "ollama",
    name: "Ollama",
    npm: "@ai-sdk/openai-compatible",
    api: `${ollamaConfig.baseURL}/v1`,
    apiKey: "ollama",
    models: Object.fromEntries(
      Object.entries(ollamaConfig.models).map(([id, m]) => [
        id,
        {
          id,
          name: `${m.name} (${m.parameterSize})`,
          tool_call: m.capabilities.tools,
          temperature: true,
          reasoning: m.capabilities.thinking,
          attachment: m.capabilities.vision,
          limit: {
            context: m.contextLength,
            output: 8192,
          },
        },
      ]),
    ),
  };
}
```

## Resolved Decisions

1. **Tool calling**: Default to `true` for all models. Ollama's `/api/show` provides explicit `capabilities` array — use `capabilities.includes("tools")` when available, fall back to `true`.

2. **Vision/image support**: Detected from `capabilities.includes("vision")` in `/api/show` response. Maps to `attachment: true` in the opencode model definition. For gemma4, this is `true`. No deferral needed.

3. **Context window**: Extracted from `model_info.{family}.context_length` in `/api/show` response. For gemma4:26b this is `262144`. Falls back to `131072` if unavailable.

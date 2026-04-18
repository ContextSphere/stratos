# Opencode Status Dot Design

## Problem

The Opencode dot in the top bar is hardcoded `bg-gray-600` — it doesn't
reflect any state. Every other integration dot (Claude, Codex, GitHub)
shows green when the integration is set up and grey otherwise. Opencode
should follow the same pattern.

## What "set up" means for each integration today

| Dot      | Green when                                                 |
| -------- | ---------------------------------------------------------- |
| Claude   | `claudeGetConnection().connected === true` (CLI logged in) |
| Codex    | `codexGetConnection().connected === true` (CLI logged in)  |
| GitHub   | `github.isConnected` (gh CLI authenticated)                |
| Opencode | _nothing — always grey_                                    |

These are all binary "is the integration configured" signals. None of them
live-ping the underlying service on every render.

## Design

**Rule:** the Opencode dot is green iff at least one opencode sub-provider
is configured. Otherwise grey. Match the Claude/Codex/GitHub pattern —
purely a configuration check, no health probe.

### What counts as "configured"

A sub-provider is configured if either of:

1. It has an API key saved in `opencodeProviderKeys` (Anthropic, OpenAI,
   OpenRouter, Google, Groq, Mistral, or a user-added custom provider).
2. It is Ollama with `ollamaConfig` present and ≥1 model in `models`.

We deliberately do **not** check the `opencodeEnabledModels` map. A
provider with a saved key but the toggle off is still "set up" — the user
just temporarily disabled it. Treating it as unconfigured would flicker
the dot every time the toggle flips, which is noisy.

### States

| Condition               | Dot colour  | Text colour      | Tooltip                                             |
| ----------------------- | ----------- | ---------------- | --------------------------------------------------- |
| No providers configured | `gray-600`  | muted            | "Opencode — no providers configured. Click to add." |
| ≥1 configured           | `green-500` | `--text-control` | "Opencode — Anthropic, OpenAI, Ollama (2 models)"   |

The tooltip lists the configured sub-providers so the user sees at a
glance what's wired up.

**Not doing (for v1):**

- Amber / half-green when all providers are toggled off (via
  `opencodeEnabledModels`). Extra state adds UI noise for little gain.
  If requested later, add as a third tier.
- Live health check (is the opencode server running? is Ollama reachable?
  are API keys valid?). Sub-provider health can't be probed cheaply for
  paid APIs without burning rate-limit budget, and opencode is
  lazy-spawned — a not-yet-running server isn't a real "down" state.
  The existing auto-recovery in `OpencodeProvider.sendMessage` + the
  drift detection in `GET_AVAILABLE_MODELS` handle the "something's
  wedged" case at use-time, which is where it matters.

## Implementation

### New hook: `useOpencodeStatus`

File: `packages/desktop/src/renderer/hooks/useOpencodeStatus.ts`

```ts
interface OpencodeStatus {
  configured: boolean;
  providerLabels: string[];   // e.g. ["Anthropic", "Ollama (2 models)"]
  refresh: () => Promise<void>;
}

export function useOpencodeStatus(): OpencodeStatus { ... }
```

Internally calls existing IPCs — **no new IPC channels needed**:

- `window.api.opencodeGetProviderKeys()` → `Record<providerId, {apiKey, baseURL?}>`
- `window.api.ollamaGetConfig()` → `{baseURL, models} | undefined`

Derives:

- `configured = Object.keys(keys).length > 0 || (ollamaConfig && Object.keys(ollamaConfig.models).length > 0)`
- `providerLabels = [...keys with friendly label] ++ (ollama ? ["Ollama (N models)"] : [])`

### Refresh triggers

1. Mount (initial load).
2. When the Opencode Settings dialog closes — that's the only place
   configuration changes happen from the UI. Pass an `onConfigChanged`
   callback from `App.tsx` to `OpencodeSettingsDialog` → call `refresh()`
   after save/remove/toggle operations. Simpler alternative: just always
   call `refresh()` on dialog close.

No polling interval needed — config only changes through the dialog, and
the `onClose` refresh guarantees the dot updates right after the user
finishes editing.

### App.tsx changes

Replace the hardcoded block:

```tsx
<div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
<span className="text-[var(--text-muted)]">Opencode</span>
```

with a state-driven one (mirrors the Claude/Codex/GitHub pattern already
used in the same file around lines 1008–1025):

```tsx
const opencode = useOpencodeStatus();

// ...
<button
  title={
    opencode.configured
      ? `Opencode — ${opencode.providerLabels.join(", ")}`
      : "Opencode — no providers configured. Click to add."
  }
>
  <div
    className={`w-1.5 h-1.5 rounded-full ${
      opencode.configured ? "bg-green-500" : "bg-gray-600"
    }`}
  />
  <span
    className={
      opencode.configured
        ? "text-[var(--text-control)]"
        : "text-[var(--text-muted)]"
    }
  >
    Opencode
  </span>
</button>;
```

### Dialog close wiring

`OpencodeSettingsDialog` already takes `onClose`. In `App.tsx`, replace

```tsx
onClose={() => setShowOpencodeDialog(false)}
```

with

```tsx
onClose={() => {
  setShowOpencodeDialog(false);
  opencode.refresh();
}}
```

## Test plan

1. Unit test the hook in isolation with mocked `window.api`:
   - No keys, no Ollama → `configured: false, providerLabels: []`
   - One key → `configured: true, providerLabels: ["Anthropic"]`
   - Ollama only → `configured: true, providerLabels: ["Ollama (2 models)"]`
   - Mix of keys + Ollama → correct labels + order (Ollama last, matching
     the dialog's row ordering).

2. Visual via Chrome DevTools MCP:
   - Fresh install (no config) → grey dot, tooltip says "no providers".
   - Add Anthropic via dialog → dot flips green on dialog close.
   - Remove Anthropic → dot back to grey.
   - Add Ollama → tooltip includes "Ollama (N models)".

## Out of scope

- Live health check (opencode server reachable, Ollama server reachable).
  Handled at chat time by `healthCheck` + `recoverServer` in the
  provider. If it becomes a common failure mode, add an amber state and
  a periodic probe.
- Per-provider dots. The user just needs a single yes/no indicator that
  matches the other integrations.
- Custom provider support in the label pretty-printer. Use the raw
  provider ID for anything we don't have a friendly label for.

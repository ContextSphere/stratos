# Opencode Settings Redesign Plan

## Problem

The current Opencode Settings dialog (`packages/desktop/src/renderer/components/OpencodeSettingsDialog.tsx`) surfaces three overlapping concepts as separate sections, which makes it cluttered and confusing:

1. **CONFIGURED PROVIDERS** — providers with an API key saved.
2. **ADD PROVIDER KEY** — a row of buttons to pick a provider and paste a key.
3. **VISIBLE MODEL PROVIDERS** — a separate allowlist that decides which configured providers actually surface in the model picker.

Users must think about "configured" and "visible" as two independent axes. In practice, if you've added a key you almost always want the models visible, and enabling/disabling a provider should be one interaction — not two sections in two places.

Ollama also has its own completely separate dialog (`OllamaSettingsDialog.tsx`) even though, conceptually, Ollama is just another opencode sub-provider. That split doubles the surface area and leaves users unsure where to look.

## Goals

- One list: every configured provider shows up in a single table.
- One action to add: "Add provider" button opens an inline panel with a dropdown of provider types.
- One control for visibility: a toggle per row (replaces the allowlist concept).
- Ollama is a first-class provider in the same list, with its own auth flow (server URL + multi-select model picker) instead of an API key.
- **Per-model selection for every provider**, not just Ollama. After a key is saved, the user picks which of that provider's models should appear in the model picker (same multi-select UX as Ollama). The row shows "N models" as a summary.
- No "Custom..." provider button for now — keep the surface small. (Can be re-added later as another dropdown option.)

## Non-Goals

- Rewriting the opencode server launch / env injection (`opencode.provider.ts`). Only the settings UX and the small slice of storage it touches change.
- Changing `opencodeModelAllowlist` storage semantics on disk — we keep the field for backward compatibility but derive it from the new "enabled" toggle.
- Touching the footer status dots (`ProviderToggle.tsx`) — those read transient state and don't need changes for this redesign.

## Proposed UX

### Empty state

```
Opencode Settings                                              ×

Configure providers for the opencode runtime. Keys are stored
locally and injected at server startup.

  No providers configured.

                    ┌──────────────────┐
                    │  + Add Provider  │
                    └──────────────────┘
```

### Populated state

```
Opencode Settings                                              ×

PROVIDERS
┌────────────────────────────────────────────────────────────┐
│ ● Anthropic         sk-ant-…x7s2 · 4 models   [▣] Manage ⋯ │
│ ● OpenAI            sk-…ab3f    · 6 models    [▣] Manage ⋯ │
│ ○ Mistral           key-…       · 0 models    [ ] Manage ⋯ │
│ ● Ollama            localhost:11434 · 3 models[▣] Manage ⋯ │
└────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │  + Add Provider  │
                    └──────────────────┘
```

- Left dot = enabled status (green = enabled & key valid & ≥1 model selected, gray = disabled or no models).
- Right control = toggle switch (replaces the separate allowlist chips).
- Every row shows a model count. `Manage` opens the model multi-select sub-panel (same UX for API providers and Ollama). `⋯` reveals Remove.
- Ollama row shows server URL + model count instead of a masked key; API providers show masked key + model count.

### Add Provider flow (inline panel, not a second modal)

Clicking "+ Add Provider" collapses the empty-state CTA and expands an inline card above it. The flow is now **two-step**: first the user saves a key, then the models for that key are fetched and offered as a multi-select.

**Step 1 — credentials:**

```
ADD PROVIDER
┌────────────────────────────────────────────────────────────┐
│ Provider   [ Anthropic        ▾ ]                          │
│                                                            │
│ API Key    [ sk-ant-…                        ] (password)  │
│ Base URL   [ optional                        ]             │
│                                                            │
│            [ Cancel ]                    [ Continue → ]    │
└────────────────────────────────────────────────────────────┘
```

**Step 2 — model selection (fetched from opencode `/provider` after the key is saved):**

```
ADD PROVIDER — ANTHROPIC
┌────────────────────────────────────────────────────────────┐
│ Fetching models… / ✓ 7 models found / ✗ Error (Retry)      │
│                                                            │
│ Models (multi-select)        [Select all] [None] [Recommend]│
│  ☑ claude-3-5-sonnet    200k ctx · reasoning · $3/M in     │
│  ☑ claude-3-5-haiku     200k ctx · $0.80/M in              │
│  ☐ claude-3-opus        200k ctx · $15/M in                │
│  ☐ claude-3-sonnet      200k ctx · $3/M in                 │
│  ☐ …                                                       │
│                                                            │
│            [ ← Back ]                   [ Save Provider ]  │
└────────────────────────────────────────────────────────────┘
```

- "Recommend" pre-selects a small sensible default (newest flagship + newest cheap model per provider) so users aren't forced to pick from an unfamiliar list.
- Badges surface the metadata the opencode `/provider` response already returns: context window (`limit.context`), reasoning support (`capabilities.reasoning`), and cost (`cost.input`).
- **Save Provider** is disabled until at least one model is ticked. Skipping selection is not allowed — an enabled provider with zero models would be pointless.
- If model fetch fails (bad key, network error), the Retry button re-runs the fetch. The user can go Back to fix the key. The key remains saved even if they close the dialog at this stage; they can resume via **Manage**.

Dropdown options (same six as today, minus Custom): Anthropic, OpenAI, OpenRouter, Google AI, Groq, Mistral, **Ollama**.

Providers that are already configured are **greyed out / disabled** in the dropdown (you can still remove and re-add, but you can't have two entries for the same provider).

### Ollama variant of the panel

When `Ollama` is selected in the dropdown, the panel swaps to a different form:

```
ADD PROVIDER
┌────────────────────────────────────────────────────────────┐
│ Provider   [ Ollama           ▾ ]                          │
│                                                            │
│ Server URL [ http://localhost:11434                      ] │
│            [ Connect ]                                     │
│                                                            │
│  Connecting… / ✓ Connected — 7 models found / ✗ Error msg │
│                                                            │
│ Models (multi-select)                                      │
│  ☑ llama3.1:8b        8B · 4.7 GB · 128k ctx · tools       │
│  ☑ qwen2.5-coder:7b   7B · 4.4 GB · 32k ctx  · tools       │
│  ☐ llava:13b          13B · 8.0 GB · 8k ctx  · vision      │
│  ☐ …                                                       │
│                                                            │
│            [ Cancel ]           [ Save Provider ]          │
└────────────────────────────────────────────────────────────┘
```

- Connect auto-fires once when the user picks Ollama (debounced on URL edits). No manual "Discover" button needed in happy path — but we keep it as a retry button if the first attempt fails.
- The model list is the existing `ollamaDiscoverModels` output rendered as a scrollable checkbox list with capability badges (`tools`, `vision`, `thinking`) and context length — same renderer (shared component) as the API-provider model step.
- **Save Provider** is disabled until at least one model is ticked.

### Managing an existing row (any provider)

Clicking **Manage** on any row re-opens the inline panel in edit mode, jumping straight to Step 2 with the current selection pre-ticked. For API providers this re-fetches `/provider` to pick up any newly released models; for Ollama it re-runs discovery. No separate dialog.

## Architectural Approach

### Option A (recommended) — merge Ollama into the same dialog

Delete `OllamaSettingsDialog.tsx`. Have `OpencodeSettingsDialog.tsx` handle both flows via the dropdown. This matches the mental model (one list of providers) and removes a whole second entry point.

Pros: one source of truth, fewer components to maintain, matches the user's requested UX. \
Cons: `OpencodeSettingsDialog` becomes larger — mitigated by splitting into subcomponents (see "Component layout").

### Option B — keep `OllamaSettingsDialog` and deep-link

Open the Ollama dialog in-place when `Ollama` is picked from the dropdown. Less code churn but leaves two dialogs and a worse UX (modal-on-modal).

**Going with Option A.**

### Option C (future, out of scope) — a general custom-provider row

Re-introduce "Custom" as a dropdown option once the base redesign ships. Deferred.

## Data Model Changes

The per-model-selection requirement forces a new field. The current `opencodeModelAllowlist: string[]` stores only provider IDs (`"anthropic"`, `"openai"`). We need to remember which specific model IDs the user picked per provider.

**New field (replaces the role of `opencodeModelAllowlist`):**

```ts
/**
 * Enabled model IDs per opencode sub-provider. The KEY is the provider id
 * (e.g. "anthropic"). The VALUE is the set of fully-qualified model values
 * (e.g. "anthropic/claude-3-5-sonnet") that should appear in the model picker.
 *
 * A provider with an entry in this map AND ≥1 model is "enabled". Toggling the
 * row off deletes the entry; toggling back on restores the previously picked
 * models (kept under `opencodeEnabledModelsArchive` for this purpose — see below).
 */
opencodeEnabledModels?: Record<string, string[]>;

/** Holds the last-known selection per provider so that toggling off then on
 * doesn't force the user to re-pick. Cleared when a provider is Removed. */
opencodeEnabledModelsArchive?: Record<string, string[]>;
```

**Migration from `opencodeModelAllowlist`:**

- On load, if `opencodeEnabledModels` is missing but `opencodeModelAllowlist` exists, migrate: for each allowlisted provider id, populate `opencodeEnabledModels[id] = []` (empty — meaning "all models" as a fallback) OR, better, do the migration _lazily_ by treating a missing entry as "all models of that provider are visible" so pre-upgrade users don't have their model picker emptied. On the next Manage interaction, the user's explicit picks overwrite the lazy default.
- Write both fields for one release so older code paths that still read `opencodeModelAllowlist` keep working (the opencode env builder, for instance — we should audit). After that, drop `opencodeModelAllowlist` in a follow-up.

**Filter change in `agent-manager.ts`:**

Replace (`agent-manager.ts:399-404`):

```ts
models = models.filter((m) => allowlist.includes(m.value.split("/")[0]));
```

with:

```ts
const enabled = getOpencodeEnabledModels();
models = models.filter((m) => {
  const providerId = m.value.split("/")[0];
  const picks = enabled[providerId];
  if (!picks) return false; // provider not enabled
  if (picks.length === 0) return true; // lazy-migration case: all models
  return picks.includes(m.value); // explicit per-model selection
});
```

**Ollama mapping unchanged.** `ollamaConfig.models` is already a per-model selection. The new `opencodeEnabledModels["ollama"]` mirrors the keys of `ollamaConfig.models` and is written whenever `ollamaSetConfig` runs — keeps one filter path in the agent manager for all providers.

**Toggle semantics:**

- Toggle OFF → move `opencodeEnabledModels[id]` into `opencodeEnabledModelsArchive[id]`, delete the live entry. Key/ollamaConfig untouched.
- Toggle ON → if archive has an entry, restore it. If not (first time), open Manage automatically to force a model pick. Zero-model enablement is not a valid state.
- Remove → delete key (or ollamaConfig) + both enabled and archive entries.

## IPC / Main-Process Changes

Required:

- **`OPENCODE_LIST_PROVIDER_MODELS(providerId) → ModelInfo[]`** — fetches the full, unfiltered model list for one provider from the running opencode server. Today `GET_AVAILABLE_MODELS` applies the allowlist filter before returning; for the Manage panel we need the _raw_ list so users can pick from it. Implementation: calls the existing `/provider` HTTP endpoint opencode exposes and returns the subset for the requested providerId, bypassing the filter.
- **`OPENCODE_GET_ENABLED_MODELS() → Record<string, string[]>`** and **`OPENCODE_SET_ENABLED_MODELS(providerId, modelValues[])`** — thin wrappers over the new settings field.

Unchanged channels (still used):

- `opencodeGetProviderKeys` / `opencodeSetProviderKey` / `opencodeDeleteProviderKey`
- `ollamaGetConfig` / `ollamaSetConfig` / `ollamaClearConfig` / `ollamaDiscoverModels`

Deprecated (kept for one release, then removed):

- `opencodeGetModelAllowlist` / `opencodeSetModelAllowlist` — callers inside Stratos are migrated; the env-builder in `opencode.provider.ts` should be audited to confirm it doesn't depend on the allowlist shape.

**Opencode server restart sensitivity:** today, mutating the allowlist doesn't restart the server — only key changes do. The new per-model selection is purely a display-side filter (applied in `agent-manager.ts` after fetching models), so toggling models never restarts opencode. Cheap operation.

**Bootstrapping models for the Add flow:** after `opencodeSetProviderKey`, the opencode server may need a short moment (or a restart) to pick up the new credential before `/provider` returns that provider's models. Plan: after `setProviderKey`, poll `OPENCODE_LIST_PROVIDER_MODELS(id)` with a small retry/backoff (e.g. 3 attempts over ~3s) before surfacing an error. If the server restart is synchronous in `opencode.provider.ts` this is unnecessary — verify during implementation.

## Component Layout

Split the new dialog into three files under `packages/desktop/src/renderer/components/opencode-settings/`:

| File                         | Responsibility                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OpencodeSettingsDialog.tsx` | Orchestrator — loads keys/allowlist/ollama config, owns the add/edit panel state, renders the list + inline panel.                                                                                                                   |
| `ProviderRow.tsx`            | One row: status dot, label, key hint (or Ollama summary), toggle, Remove / Manage button.                                                                                                                                            |
| `AddProviderPanel.tsx`       | The inline add/edit form. Owns the two-step flow (credentials → model selection). Takes `mode: "add" \| "edit"` and a `providerId`. Internally branches on `providerId === "ollama"` for the connect-and-discover variant of step 1. |
| `ModelMultiSelect.tsx`       | Shared checkbox list used by step 2 in both the API-provider and Ollama flows. Renders name, context length, capability badges, and cost when available. Select-all / none / recommend helpers.                                      |

Rationale: each file stays under ~200 lines and the Ollama-specific logic is encapsulated inside `AddProviderPanel`. Shared pieces (dropdown, masked-key rendering, capability badges) are local helpers inside this directory — they're not general enough to belong in `@stratosapp/ui` yet.

Delete `OllamaSettingsDialog.tsx` and the menu entry that opens it (it's currently reachable from the footer Ollama dot). That entry point gets redirected to open the unified dialog with the Ollama row focused.

## Step-by-Step Implementation Plan

1. **Scaffold the new directory and move the orchestrator.**
   - Create `packages/desktop/src/renderer/components/opencode-settings/`.
   - Move `OpencodeSettingsDialog.tsx` into it and split into the three files above. Keep behavior identical first (still renders the old UI) so the refactor is a pure restructure — easier to review.

2. **Add the new settings field + IPC + filter change (main process).**
   - Extend `AppSettings` with `opencodeEnabledModels` and `opencodeEnabledModelsArchive`. Add getters/setters. Implement lazy migration from `opencodeModelAllowlist` on load.
   - Add IPC channels `OPENCODE_LIST_PROVIDER_MODELS`, `OPENCODE_GET_ENABLED_MODELS`, `OPENCODE_SET_ENABLED_MODELS`. Wire preload.
   - Update the filter in `agent-manager.ts:399-404` to consume `opencodeEnabledModels` instead of `opencodeModelAllowlist`.
   - Unit tests for the migration + filter changes in `@stratosapp/core` / desktop.

3. **Build the unified provider list (`ProviderRow`).**
   - Source of truth: merge `opencodeProviderKeys` + (if present) a synthetic `"ollama"` entry derived from `ollamaConfig`.
   - Each row reads the model count from `opencodeEnabledModels[id]`. Toggle flips entry presence (archive / restore). Remove calls `opencodeDeleteProviderKey` (or `ollamaClearConfig`) + clears enabled + archive.
   - Replace the "CONFIGURED PROVIDERS" and "VISIBLE MODEL PROVIDERS" sections with this single list. Delete the allowlist chip UI.

4. **Build the Add Provider dropdown + Step 1 (credentials).**
   - Dropdown uses `COMMON_PROVIDERS` (already defined) plus an `"ollama"` entry. Disable options whose id is already in the merged list.
   - Non-Ollama: API key + optional base URL. Continue calls `opencodeSetProviderKey` then transitions to Step 2.
   - Ollama: URL + auto-Connect. Connect success transitions to Step 2.

5. **Build `ModelMultiSelect` (Step 2).**
   - Reusable checkbox list component. Takes `{ models: ModelInfo[], selected: Set<string>, onToggle, onSelectAll, onSelectNone, onSelectRecommended }`.
   - API providers: fetch via the new `OPENCODE_LIST_PROVIDER_MODELS` IPC. Show reasoning / cost / context badges.
   - Ollama: fetch via `ollamaDiscoverModels`. Show vision / tools / thinking badges.
   - Save writes `opencodeEnabledModels[id] = selectedValues` (and for Ollama, also `ollamaSetConfig` with the matching model subset). Closes the panel, highlights the new row.
   - Error + retry handling for the fetch step. Support "Back" to fix credentials without losing selection.

6. **Wire edit mode.**
   - Clicking **Manage** on any row opens `AddProviderPanel` in `edit` mode with step index pinned to 2, selection pre-filled from `opencodeEnabledModels[id]`. Step 1 credentials are hidden but reachable via a small "Change key" link for API providers.

7. **Wire the footer entry point.**
   - The footer Ollama dot currently opens `OllamaSettingsDialog`. Change it to open the unified dialog with an `initialFocus: "ollama"` hint so the Ollama row is highlighted (or the add panel pre-opened in `edit` mode if the row doesn't exist yet).
   - Delete `OllamaSettingsDialog.tsx` and its import.

8. **Clean up.**
   - Remove `DEFAULT_OPENCODE_MODEL_ALLOWLIST` default-mutation behavior if it's surprising in the new UI — verify the default still makes sense: when a user has _no_ providers configured, the allowlist being `["anthropic", "openai"]` is harmless because those entries aren't rendered without keys. Leave as-is.
   - Remove the "Custom..." button (explicit user request). If we want to preserve custom-provider support, land it in a follow-up with its own design pass.

9. **Tests.**
   - `packages/core`: no changes, no new tests needed.
   - `packages/desktop`: add component tests for `OpencodeSettingsDialog` covering:
     - listing configured providers including the synthetic Ollama row;
     - the toggle flipping allowlist entries via mocked `window.api`;
     - the add panel adding a non-Ollama provider;
     - the Ollama add/edit flow saving config + allowlist.
   - Follow CLAUDE.md rule: every package change gets tests.

10. **Visual verification (mandatory per CLAUDE.md).**

- Run `pnpm --filter @stratosapp/desktop dev:debug`.
- Use Chrome DevTools MCP to:
  1.  Open Opencode Settings from the footer — confirm list + empty state.
  2.  Add Anthropic with a fake key — confirm row appears with toggle on.
  3.  Toggle off — confirm allowlist updated (re-open dialog to verify persistence).
  4.  Add Ollama, connect to a local server (or mock), pick 2 models, save — confirm row shows "N models".
  5.  Manage Ollama — confirm pre-fill.
  6.  Remove providers — confirm list empties back to empty state.
- Screenshot each step; read the screenshots.

## Risks & Open Questions

- **Ollama connect UX when the server is down.** Today the dialog shows an error and lets the user retry. In the new inline panel we should keep the URL field editable and the Connect button visible after a failed attempt, rather than blocking on it. Plan: Connect button always present; auto-fire is a convenience, not the only path.
- **Toggle latency.** `opencodeSetModelAllowlist` triggers an opencode server restart. Debounce toggles by ~300 ms so rapid flipping doesn't thrash the server. Follow-up if needed.
- **Backward compatibility with existing saved settings.** Since storage is unchanged, existing users' keys and allowlists load as-is. Verify by running the new dialog against an `~/.stratos/app-settings.json` with pre-existing entries before shipping.
- **Default allowlist semantics.** `DEFAULT_OPENCODE_MODEL_ALLOWLIST = ["anthropic", "openai"]` means a brand-new install with no keys implicitly "enables" those two. Once the user adds Anthropic, the row shows as enabled by default — which matches the desired UX. Leave default as-is.
- **Provider dropdown order.** Sort configured providers first in the list (for easy scanning), but sort the dropdown options alphabetically with Ollama pinned last so the local-model option is clearly separated.

## Out of Scope (future follow-ups)

- Re-introducing a "Custom..." provider entry with a typed `id` + `npm package` + model list form.
- Surfacing server health (did opencode successfully start with this key?) inline in each row — currently only visible via the footer dots.
- Dropping the deprecated `opencodeModelAllowlist` field in settings once no code reads it.

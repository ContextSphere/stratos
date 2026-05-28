# Copilot Provider — Verification & UI Smoke Plan

**Status:** Draft / pre-implementation
**Audience:** Engineer landing the Copilot provider + reviewers
**Companion to:** `docs/copilot-provider-design.md` (sections referenced as **D§N**)
**Driver:** Chrome DevTools MCP (per `CLAUDE.md` § "Mandatory: Visually Verify Every UI Change")

---

## 0. TL;DR

This document is the test-execution side of the Copilot provider work. It defines:

1. The CDP harness rules every UI scenario must follow (snapshot first, InputBar contentEditable handling, screenshot evidence).
2. A library of **reusable recipes** (provider picker, thread create, model picker, mode toggle, send message, approve permission) so each scenario stays short.
3. A **test matrix** of 47 scenarios across 11 capability groups, each marked with provider scope (Copilot-only or cross-provider regression).
4. A **failure playbook** and **reporting format** so a run can be reproduced or escalated.

The plan favours fast, deterministic, foreground CDP runs over a tiny set of full-stack integration tests. Most signal lives in the chat-render and tool-card paths; we lean on those.

---

## 1. Goals

- Prove that every capability in **D§5** (streaming, tools, sub-agents, TODOs, edits, reasoning, MCP, permissions, persistence, images, slash commands) works end-to-end through the real Stratos UI.
- Prove that provider switching (new thread, manager-agent provider swap, picker mid-thread) does not corrupt state, leak subprocesses, or break the other three providers.
- Prove model selection, model switching, reasoning effort, and mode changes all flow correctly into `MessageOptions` / `setModel` / `agentMode`.
- Establish a regression matrix that can be re-run on every Copilot SDK bump.
- Output evidence (screenshots + trace JSONL) sufficient for a reviewer to confirm without re-running.

### Non-goals

- Load testing (deferred; the CDP harness is single-user).
- Cross-platform CI (manual on macOS for v1; the Copilot CLI isn't bundled).
- Canvas rendering (deferred per **D§ Non-Goals**).

---

## 2. Pre-flight

### 2.1 Host & prereqs

- macOS, Stratos worktree at `/Users/ajprakas/.stratos/worktrees/sleek-oasis` (or any worktree path — the CDP port is auto-derived).
- `gh` CLI installed; `gh extension install github/gh-copilot` completed.
- `copilot auth status` returns "authenticated as <user>" before starting any scenario. Verification scenarios assume an authenticated user (the Connect-flow scenarios cover the unauthenticated path separately).
- Active Copilot subscription (Individual / Business / Enterprise) — note tier in the run report, since model availability differs.

### 2.2 Stratos build & launch

```
pnpm install
pnpm build
pnpm --filter @stratosapp/desktop dev:debug
```

- Wait for the Electron console line `[worktree] CDP port=XXXX`. Record that port.
- The CDP MCP server (`scripts/cdp-mcp.sh`) derives the same port from `git rev-parse --show-toplevel`; nothing further to wire.

### 2.3 Clean-state harness

Each scenario starts from a known clean state. Before _every_ scenario, run:

```
# Stop the dev instance
lsof -ti :<CDP_PORT> | xargs kill

# Wipe per-instance data (worktree-isolated; safe)
rm -rf ~/.stratos/instances/$(node -e "console.log(require('crypto').createHash('sha256').update('/Users/ajprakas/.stratos/worktrees/sleek-oasis').digest('hex').slice(0,12))")

# Relaunch
pnpm --filter @stratosapp/desktop dev:debug
```

For scenarios that explicitly test **persistence across restart**, the second launch skips the wipe.

### 2.4 Fixture files & prompts

Pre-create on disk (one-time, then committed under `test/fixtures/copilot/`):
| Path | Contents |
|---|---|
| `/tmp/copilot-verify/hello.txt` | Single line `hello world` |
| `/tmp/copilot-verify/big.txt` | 3 MB of `lorem ipsum` (tests truncation) |
| `/tmp/copilot-verify/cat.png` | A small valid PNG (tests image input) |
| `/tmp/copilot-verify/screenshot-3mb.png` | A 3 MB PNG (tests image cap) |
| `/tmp/copilot-verify/sample.ts` | A TypeScript file with a single export — used as an edit target |

Canonical prompt set (each tagged with `[CP-NN]` so test logs can refer to them):

| Tag     | Prompt                                                                                 | Exercises                                           |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `CP-01` | `Say hello in one word.`                                                               | Streaming text, result                              |
| `CP-02` | `Think hard about whether 2+2 is 4, then answer.`                                      | Reasoning stream, model with `reasoningEffort=high` |
| `CP-03` | `Read /tmp/copilot-verify/hello.txt and tell me what it says.`                         | Read tool, permission (read), tool_result           |
| `CP-04` | `Read /tmp/copilot-verify/big.txt and summarize the first paragraph.`                  | Tool output cap, truncation marker                  |
| `CP-05` | `Append the line "added by copilot" to /tmp/copilot-verify/hello.txt.`                 | Edit tool, diff card, permission (write)            |
| `CP-06` | `Create /tmp/copilot-verify/new.txt with content "fresh".`                             | Write tool, new-file card, permission (write)       |
| `CP-07` | `Run ls /tmp/copilot-verify in a shell.`                                               | Bash tool, terminal output, permission (shell)      |
| `CP-08` | `Grep for "hello" under /tmp/copilot-verify.`                                          | Grep tool, multi-line result                        |
| `CP-09` | `Fetch https://example.com and tell me the title.`                                     | WebFetch, permission (url)                          |
| `CP-10` | `Make a plan to refactor this TypeScript file. Don't execute yet.` (in plan mode)      | Plan mode, `session.plan_changed`, exit-plan prompt |
| `CP-11` | `Track these TODOs: 1) Read sample.ts 2) Edit it 3) Verify.`                           | `update_plan` tool → `todo_update` card             |
| `CP-12` | `Use a code-reviewer sub-agent to review /tmp/copilot-verify/sample.ts.`               | `subagent.*`, nested tool_use                       |
| `CP-13` | (paste a cat image) `What is this?`                                                    | Image input                                         |
| `CP-14` | `/help`                                                                                | Slash command palette                               |
| `CP-15` | `Edit sample.ts to add a JSDoc comment to the export.`                                 | Edit diff synthesis (D§5.5)                         |
| `CP-16` | `Read /etc/passwd.` (in plan mode)                                                     | Plan mode blocks privileged read                    |
| `CP-17` | `Open the stratos MCP scheduler tool and list schedules.`                              | MCP tool routing, in-process vs stdio               |
| `CP-18` | `Switch to model gpt-4.1 and say "switched".`                                          | `setModel` mid-session                              |
| `CP-19` | (long-running prompt) `Write a 500-line essay on Go concurrency.` then click interrupt | `abort`, clean stop                                 |
| `CP-20` | `Show me the current context usage breakdown.`                                         | `getContextUsage` panel                             |

---

## 3. CDP Harness Rules & Reusable Recipes

### 3.1 Hard rules (from `CLAUDE.md`)

- **Every interaction sequence begins with `take_snapshot`** — UIDs are session-scoped and invalidate on the next snapshot.
- After interacting, wait 2–5 seconds, then `take_screenshot` AND `take_snapshot` to capture state.
- **READ the screenshot** (visual correctness) AND **read the snapshot text** (DOM correctness). Both gates.
- The InputBar is a `contentEditable` div — typing via `fill` will not trigger React state. Use the `evaluate_script` pattern below.

### 3.2 InputBar typing recipe

```js
// CDP: evaluate_script
(el) => {
  el.focus();
  el.textContent = "<PROMPT>";
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
// then: press_key key="Enter"
```

For multiline, replace the assignment with `el.innerHTML = "..."` carefully, or insert `<br>` between lines.

### 3.3 React textarea / input recipe (for settings panels)

```js
(el) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, // or HTMLInputElement
    "value",
  ).set;
  setter.call(el, "<VALUE>");
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
```

### 3.4 Recipe: open provider picker → pick Copilot

```
1. take_snapshot
2. click <uid of provider toggle>
3. wait 1s
4. take_snapshot
5. click <uid of "Copilot" menu item>
6. wait 1s
7. take_snapshot
8. take_screenshot path=/tmp/cdp/<scenario>-picker.png
```

**Verify:** toggle label now reads "Copilot"; thread `provider` field updated (cross-check via `agent-manager` trace).

### 3.5 Recipe: open model picker → pick model

```
1. take_snapshot
2. click <uid of model toggle (next to provider toggle)>
3. wait 1s — populates from getAvailableModels()
4. take_snapshot
5. click <uid of "gpt-4.1" row>  // or whichever
6. wait 500ms
7. take_screenshot path=/tmp/cdp/<scenario>-model.png
```

**Verify:** model row marked active; settings file `~/.stratos/app-settings.json` now contains `providers.copilot.lastUsedModel: "gpt-4.1"`.

### 3.6 Recipe: open mode picker → pick mode

```
1. take_snapshot
2. click <uid of mode chip (Plan / Default / Accept Edits / Bypass / Full access)>
3. wait 500ms
4. take_snapshot
5. click <uid of target mode row>
6. take_screenshot path=/tmp/cdp/<scenario>-mode.png
```

**Verify:** mode chip label + color updated; trace shows `MODE_CHANGED` IPC roundtrip.

### 3.7 Recipe: create new thread

```
1. take_snapshot
2. click <uid of "New thread" or "+" button in thread list>
3. wait 500ms
4. take_snapshot
5. (assert active thread changed; thread title placeholder visible)
```

**Verify:** A new file appears under `~/.stratos/instances/<hash>/threads/`. Thread row reflects the user's last-used provider.

### 3.8 Recipe: send a prompt

```
1. take_snapshot
2. evaluate_script <InputBar typing recipe with the prompt>
3. press_key key="Enter"
4. wait 1s (streaming begins)
5. take_snapshot (mid-stream)
6. wait until trace shows session.idle OR poll for 30s
7. take_snapshot
8. take_screenshot path=/tmp/cdp/<scenario>-final.png
```

### 3.9 Recipe: respond to permission prompt

```
1. take_snapshot
2. (locate permission card; assert toolName + input rendered)
3. click <uid of "Approve" or "Deny">
4. wait 1s
5. take_snapshot
```

### 3.10 Recipe: interrupt running turn

```
1. take_snapshot mid-stream
2. click <uid of stop / interrupt button>
3. wait 1s
4. take_snapshot
5. (assert: "Interrupted" pill present, input bar re-enabled)
```

### 3.11 Trace verification helper

Most scenarios cross-check the streamed `AgentMessage` sequence in the trace file:

```
~/.stratos/instances/<hash>/threads/traces/<threadId>.jsonl
```

Helper: read the last N lines and assert event types appear in expected order. (Wrap in a small shell helper later; for now grep manually.)

---

## 4. Test Matrix

47 scenarios across 11 groups. Each cell scoped: **C** = Copilot-only, **R** = cross-provider regression, **CR** = both.

| #   | Scenario                                                                          | Group        | Scope | Coverage |
| --- | --------------------------------------------------------------------------------- | ------------ | ----- | -------- |
| 1   | CLI not installed — error path                                                    | Connectivity | C     | D§8.1    |
| 2   | CLI installed, not authenticated — connect flow                                   | Connectivity | C     | D§8.2    |
| 3   | Authenticated — status reflects subscription tier                                 | Connectivity | C     | D§8.2    |
| 4   | Disconnect → status flips to "Disconnected"                                       | Connectivity | C     | D§8.2    |
| 5   | Restart while authenticated — status persists                                     | Connectivity | C     | D§5.8    |
| 6   | Provider picker lists Copilot                                                     | Selection    | C     | D§7.1    |
| 7   | Provider picker default after first install                                       | Selection    | CR    | D§7.4    |
| 8   | New thread uses last-selected provider                                            | Selection    | CR    | D§7.4    |
| 9   | Switching provider mid-empty-thread allowed                                       | Selection    | CR    | —        |
| 10  | Switching provider mid-running-thread blocked or queued                           | Selection    | CR    | risk #7  |
| 11  | Manager Agent `switch_provider` to Copilot works                                  | Selection    | C     | —        |
| 12  | Model picker populates after picking Copilot                                      | Models       | C     | D§9      |
| 13  | Model list cached 1h on disk                                                      | Models       | C     | D§9      |
| 14  | `lastUsedModel` per provider persisted                                            | Models       | CR    | D§9      |
| 15  | `setModel` mid-session via picker → next turn uses new model                      | Models       | C     | D§3.3    |
| 16  | Reasoning-capable model exposes effort dropdown                                   | Models       | C     | D§5.6    |
| 17  | Effort `max` translates to Copilot `high`                                         | Models       | C     | D§5.6    |
| 18  | Plan mode: read-only enforced                                                     | Modes        | C     | D§10     |
| 19  | Default mode: write prompts for permission                                        | Modes        | C     | D§10     |
| 20  | Accept Edits: writes auto-approved, shell still prompts                           | Modes        | C     | D§10     |
| 21  | Full Access: no prompts at all                                                    | Modes        | C     | D§10     |
| 22  | Bypass option hidden for Copilot                                                  | Modes        | C     | D§10     |
| 23  | Mode change mid-session honored next turn                                         | Modes        | C     | D§4.3    |
| 24  | `CP-01` Streaming text                                                            | Streaming    | C     | D§5.1    |
| 25  | `CP-02` Reasoning + text concurrent streaming                                     | Streaming    | C     | D§5.1    |
| 26  | `CP-03` Read tool — full pipeline                                                 | Tools        | C     | D§5.2    |
| 27  | `CP-04` Big read — output capped + truncation marker                              | Tools        | C     | D§5.2    |
| 28  | `CP-05` Edit tool — diff card identical to Claude                                 | Tools        | C     | D§5.5    |
| 29  | `CP-06` Write tool — new file card                                                | Tools        | C     | D§5.5    |
| 30  | `CP-07` Bash tool — terminal output                                               | Tools        | C     | D§5.2    |
| 31  | `CP-08` Grep tool — multi-line result                                             | Tools        | C     | D§5.2    |
| 32  | `CP-09` WebFetch tool — url permission                                            | Tools        | C     | D§5.2    |
| 33  | `CP-15` Edit diff synthesis — `onPreToolUse` capture                              | Tools        | C     | D§5.5    |
| 34  | Permission deny path — model receives denial                                      | Tools        | C     | D§5.7    |
| 35  | `CP-11` TODOs render via TodoWrite card                                           | Plan/TODOs   | C     | D§5.4    |
| 36  | `CP-10` Plan mode lifecycle (start → plan_changed → exit)                         | Plan/TODOs   | C     | D§5.4    |
| 37  | `CP-12` Sub-agent invocation + nested tool calls                                  | Sub-agents   | C     | D§5.3    |
| 38  | `CP-13` Image input                                                               | Images       | C     | D§5.11   |
| 39  | 3 MB image attached — capped per `STREAM_IMAGE_DATA_CAP`                          | Images       | C     | D§5.11   |
| 40  | `CP-14` Slash command palette                                                     | Slash        | C     | D§5.12   |
| 41  | `CP-17` MCP tool — Stratos scheduler exposed                                      | MCP          | C     | D§5.9    |
| 42  | MCP server status panel renders 4-state correctly                                 | MCP          | C     | D§5.9    |
| 43  | MCP OAuth elicitation → URL flow                                                  | MCP          | C     | D§5.9    |
| 44  | `CP-20` Context usage panel                                                       | Context      | C     | D§5.10   |
| 45  | `CP-19` Interrupt mid-stream                                                      | Lifecycle    | C     | D§5.15   |
| 46  | Quit + relaunch → thread resumes with full history                                | Lifecycle    | C     | D§5.8    |
| 47  | Cross-provider regression sweep: re-run CP-01/05/07/12 on Claude, Codex, Opencode | Regression   | R     | D§ Goals |

---

## 5. Detailed Scenarios

Each scenario below uses the recipes from § 3. Expected outcomes are listed both as **UI evidence** (what the screenshot/snapshot should contain) and **internal evidence** (what the trace JSONL or settings file should contain).

> Notation: `[Recipe N.M]` references the recipe in § 3.

### 5.1 Connectivity group

#### Scenario 1 — CLI not installed

**Setup:** `mv $(which copilot) $(which copilot).bak`
**Steps:** Open Settings → Integrations → Copilot panel. Click "Check CLI".
**UI evidence:**

- Panel shows "Copilot CLI not found. Install via `brew install gh && gh extension install github/gh-copilot`."
- Connect button disabled.
- Screenshot: `/tmp/cdp/01-cli-missing.png`.
  **Internal evidence:** IPC `COPILOT_CHECK_CLI` returned `{ installed: false }`. No subprocess spawn attempt logged.
  **Cleanup:** `mv $(which copilot).bak $(which copilot)`.

#### Scenario 2 — CLI installed, not authenticated

**Setup:** `copilot auth logout` (or equivalent).
**Steps:**

1. Settings → Copilot → Check CLI → reports `installed: true`.
2. Click "Connect to GitHub".
3. Browser opens to `github.com/login/device`. Enter the displayed device code. Authorize.
4. Return to Stratos.
   **UI evidence:** Status flips from "Disconnected" → "Connecting…" → "Connected as <user>" within 60s. Screenshot: `/tmp/cdp/02-connect.png`.
   **Internal evidence:** IPC `COPILOT_CONNECT` resolves with `{ status: "connected", login, subscription }`.

#### Scenario 3 — Subscription tier rendered

**Steps:** Settings → Copilot panel.
**Expected:** Tier badge visible (Individual / Business / Enterprise). For BYOK auth, tier is "BYOK".

#### Scenario 4 — Disconnect

**Steps:** Click "Disconnect" in Copilot panel.
**Expected:** Status flips to "Disconnected". `copilot auth status` from shell confirms.

#### Scenario 5 — Restart preserves auth

**Steps:** Quit Stratos (Cmd-Q), relaunch via `pnpm --filter @stratosapp/desktop dev:debug`.
**Expected:** Copilot panel still shows "Connected as <user>" — Stratos does not store tokens; it reads `copilot auth status` on demand, so this verifies the polling/lookup path.

### 5.2 Selection group

#### Scenario 6 — Provider picker lists Copilot

**Steps:** [Recipe 3.4] open picker; assert "Copilot" item present alongside Claude / Codex / Opencode.
**UI evidence:** All four entries visible; current selection highlighted.

#### Scenario 7 — Default provider after install

**Setup:** Wipe `~/.stratos/instances/<hash>` (no prior thread). Launch.
**Expected:** First thread defaults to Claude Code (preserves backward compat per **D§7.4**). User explicitly picks Copilot for the first time → subsequent new threads default to Copilot.

#### Scenario 8 — New thread inherits last-used provider

**Steps:**

1. Set provider to Copilot. [Recipe 3.4]
2. Create new thread. [Recipe 3.7]
3. Verify new thread shows Copilot in the toggle without manual selection.

#### Scenario 9 — Switching provider on empty thread

**Steps:**

1. Create new thread (no message sent yet).
2. Switch provider Copilot → Claude → Copilot.
3. Send `CP-01`.
   **Expected:** No errors. Final answer streams. Trace shows only one Copilot session start.

#### Scenario 10 — Switching provider mid-running thread

**Steps:**

1. Send `CP-19` (long prompt).
2. While streaming, attempt to change provider.
   **Expected (preferred design):** Picker is disabled with tooltip "Cannot change provider during stream"; or the change is queued and applied to the next thread. **Risk #7** — verify behaviour matches design.

#### Scenario 11 — Manager Agent provider swap

**Steps:**

1. Open Manager Agent.
2. Ask: "Switch this thread to Copilot."
3. Expect Manager to invoke `MANAGER_SWITCH_PROVIDER` IPC.
   **Expected:** Active thread `provider` updates. Existing messages remain visible; sending a new message uses Copilot.

### 5.3 Models group

#### Scenario 12 — Model picker populates

**Steps:** [Recipe 3.4] pick Copilot. [Recipe 3.5] open model picker.
**Expected:** List shows ≥ 1 model with non-empty `displayName` and `description`. At minimum: a default model and a reasoning model (e.g. `gpt-4.1`, `gpt-5` or `o4-mini`).

#### Scenario 13 — Model list cache

**Steps:**

1. Open model picker (populates list).
2. Quit, relaunch, open model picker again.
   **Expected:** List appears within 100ms (served from disk cache). After 1h TTL elapses, next open refreshes via `getAvailableModels()`.

#### Scenario 14 — Per-provider `lastUsedModel`

**Steps:**

1. Provider: Copilot. Pick model `gpt-4.1`.
2. Provider: Claude. Pick model `claude-sonnet-4-5`.
3. Provider: Copilot.
   **Expected:** Model picker now defaults to `gpt-4.1` — Claude's selection didn't bleed.
   **Internal evidence:** `~/.stratos/app-settings.json` contains both `providers.copilot.lastUsedModel` and `providers.claude-code.lastUsedModel`.

#### Scenario 15 — `setModel` mid-session

**Steps:**

1. Send `CP-01` using model A.
2. Open model picker. Pick model B.
3. Send `CP-01` again.
   **Expected:** Second turn uses model B. Internal: SDK `session.setModel(B)` called between turns. Trace shows `session.model_change` event with new model id.

#### Scenario 16 — Reasoning effort dropdown for capable models

**Steps:** With a reasoning model selected (e.g. `gpt-5`), open model picker.
**Expected:** Effort selector visible with options Low / Medium / High / Max. For non-reasoning models, the selector is hidden.

#### Scenario 17 — Max → high translation

**Steps:** Pick reasoning model. Set effort to Max. Send `CP-02`.
**Internal evidence:** Trace shows `MessageOptions.reasoningEffort = "high"` (Stratos `max` → Copilot `high`, per D§5.6).

### 5.4 Modes group

#### Scenario 18 — Plan mode blocks writes

**Steps:**

1. Switch to Plan mode. [Recipe 3.6]
2. Send `CP-05` (append-to-file).
   **Expected:** Model produces a plan but does not execute the Edit. Trace contains `session.mode_changed { mode: "plan" }` then no `permission.requested` with `kind: "write"`.
   **Edge case:** If the model tries anyway, Copilot CLI rejects and emits `permission.completed { result: "denied_plan_mode" }`. Renderer shows "Blocked by plan mode" pill.

#### Scenario 19 — Default mode prompts

**Steps:** Switch to Default. Send `CP-05`.
**Expected:** Permission card appears for the Edit tool. [Recipe 3.9] Approve. Edit applies, diff card renders.

#### Scenario 20 — Accept Edits auto-approves writes, prompts shell

**Steps:** Switch to Accept Edits. Send `CP-05` then `CP-07`.
**Expected:** `CP-05` (write) — no permission prompt, diff card appears directly. `CP-07` (shell) — permission prompt appears.

#### Scenario 21 — Full Access (autopilot) — no prompts

**Steps:** Switch to Full access. Send `CP-05` then `CP-07`.
**Expected:** No permission prompts. Both tools execute directly. Mode chip is red and labelled "Full access" — risk surface visible.

#### Scenario 22 — Bypass hidden for Copilot

**Steps:** Open mode picker on Copilot thread.
**Expected:** Items are Plan / Default / Accept Edits / Full access only. "Bypass" not in list (per D§10).

#### Scenario 23 — Mid-session mode change

**Steps:** Default mode, send `CP-03` (read — approves trivially). Then switch to Accept Edits. Send `CP-05`.
**Expected:** First turn ran in default. Second turn ran in Accept Edits — no write prompt.
**Internal evidence:** Trace shows `session.mode_changed` between turns.

### 5.5 Streaming group

#### Scenario 24 — Streaming text (`CP-01`)

**Steps:** [Recipe 3.8] send `CP-01`. Capture mid-stream snapshot.
**UI evidence:** Mid-stream snapshot shows partial text with the streaming cursor. Final snapshot shows complete text, cursor gone, result footer with usage tokens. Screenshots: `/tmp/cdp/24-mid.png`, `/tmp/cdp/24-final.png`.
**Internal evidence:** Trace contains an ordered sequence:

```
assistant.message_start
assistant.message_delta (×N)
assistant.message
assistant.usage
session.task_complete
session.idle
```

Stratos AgentMessage sequence: `text (streaming) × N → text (final) → result`.

#### Scenario 25 — Concurrent reasoning + text (`CP-02`)

**Steps:** With a reasoning model + effort=High, send `CP-02`.
**UI evidence:** Two distinct bubbles streaming in parallel: a "Thinking…" block + the answer block. Screenshot mid-stream + final.
**Internal evidence:** Trace contains interleaved `reasoning_delta` and `message_delta` events. AgentMessage stream has `thinking (streaming)` and `text (streaming)` alternating.

### 5.6 Tools group

#### Scenario 26 — Read tool (`CP-03`)

**Steps:** Default mode. Send `CP-03`. Approve read permission. [Recipe 3.9]
**UI evidence:** Read tool card with `file_path=/tmp/copilot-verify/hello.txt`. Tool output contains `hello world`.
**Internal:** AgentMessage sequence includes `permission_request (Read)` → `tool_use (Read)` → `tool_result`.

#### Scenario 27 — Big read truncation (`CP-04`)

**Steps:** Send `CP-04`. Approve.
**Expected:** Tool result rendered with truncation marker `[… truncated N characters from streaming]`. UI display also caps at 50 KB (`TOOL_OUTPUT_DISPLAY_LIMIT`).

#### Scenario 28 — Edit tool, diff card (`CP-05`)

**Steps:** Send `CP-05`. Approve write.
**UI evidence:** Edit card shows file path, before/after, additions in green, deletions in red — visually indistinguishable from a Claude Edit. Screenshot: `/tmp/cdp/28-edit-diff.png`.
**Internal:** Provider's pre-edit snapshot captured via `onPreToolUse`. `tool_use` input synthesised as `{ file_path, old_string, new_string }`. Verify by reading the trace JSONL for the tool_use line.

#### Scenario 29 — Write tool, new file (`CP-06`)

**Expected:** Write card with `file_path=/tmp/copilot-verify/new.txt` and content preview. After approval, file exists on disk.

#### Scenario 30 — Bash (`CP-07`)

**Expected:** Bash card with command, terminal-styled output. Working directory shown.

#### Scenario 31 — Grep (`CP-08`)

**Expected:** Grep card with pattern, file matches, line numbers.

#### Scenario 32 — WebFetch (`CP-09`)

**Expected:** Permission card with URL highlighted. After approval, response body summary in tool result.

#### Scenario 33 — Edit-diff synthesis edge case (`CP-15`)

**Steps:** Set the file to be read-only (`chmod 444`). Send `CP-15`.
**Expected:** Pre-edit capture succeeds (read perm is fine). Edit fails with permission denied at write time. Tool result is `failure`; UI shows error pill. Validates that pre-snapshot path is independent of write-success path.

#### Scenario 34 — Permission deny path

**Steps:** Send `CP-05`. Click Deny instead of Approve.
**Expected:** Tool result `denied`. Model's next turn acknowledges the denial.

### 5.7 Plan / TODOs group

#### Scenario 35 — TodoWrite (`CP-11`)

**Steps:** Send `CP-11`.
**UI evidence:** Todo card with 3 items, each with status pending/in-progress/completed and `activeForm`. As the agent works, statuses update.
**Internal:** AgentMessage stream contains `todo_update` with parsed `todos` array.

#### Scenario 36 — Plan lifecycle (`CP-10`)

**Steps:**

1. Switch to Plan mode.
2. Send `CP-10`.
3. Watch for plan content to stream into a `plan_update` card.
4. Model emits `exit_plan_mode.requested`.
5. UI shows plan-review modal.
6. Click "Accept and continue" (or "Reject").
   **UI evidence:** Plan card with markdown rendered. Plan review modal blocks input. After accept: mode auto-flips to Default (or remains Plan, per design); model proceeds to execute.
   **Internal:** Trace contains `session.plan_changed` → `exit_plan_mode.requested` → `exit_plan_mode.completed { action }`.

### 5.8 Sub-agents group

#### Scenario 37 — Sub-agent invocation (`CP-12`)

**Setup:** Configure a `code-reviewer` custom agent via the agents config UI (or seed via settings file).
**Steps:** Send `CP-12`.
**UI evidence:** Task card appears with sub-agent name. Its internal tool calls render nested (indented) inside the card.
**Internal:** AgentMessage stream contains `subagent_event { status: "started", name, subagentId }` → nested `tool_use { parentToolUseId }` events → `subagent_event { status: "completed", summary }`.
**Edge case (risk #12):** If `parentToolUseId` is missing on nested tools, they'll render at the top level — note the regression.

### 5.9 Images group

#### Scenario 38 — Image input (`CP-13`)

**Steps:** Paste `cat.png` into InputBar. Type `CP-13` prompt. Send.
**UI evidence:** Image thumbnail in the user message bubble. Model's response describes the cat.
**Internal:** `MessageOptions.attachments` contains `{ type: "blob", mimeType: "image/png", data: <base64> }`.

#### Scenario 39 — Oversized image cap

**Steps:** Attach `screenshot-3mb.png`. Send a prompt.
**Expected:** Image still sent (or down-scaled per the existing input-bar pre-resize at 2000px). `STREAM_IMAGE_DATA_CAP=512_000` strips outliers from downstream IPC; verify no main-process memory spike.

### 5.10 Slash commands group

#### Scenario 40 — Slash commands (`CP-14`)

**Steps:** Type `/` in InputBar.
**UI evidence:** Palette popup with command list. Each command shows name + description. Select `help`. Send. Verify response.
**Internal:** `discoverSlashCommands()` was called at session init; cache populated. AgentMessage `session_init` carries `slashCommands` array.

### 5.11 MCP group

#### Scenario 41 — Stratos MCP tool (`CP-17`)

**Steps:** Default mode. Send `CP-17`. Approve MCP permission.
**Expected:** Tool card `MCP:stratos:schedule_list` runs; returns the schedule list.
**Internal:** `mcpServers` config includes `stratos` (stdio path per D§7.7). Trace shows `tool.execution_start { mcpServerName: "stratos" }`.

#### Scenario 42 — MCP server status panel

**Steps:** Open MCP servers panel (gear icon).
**Expected:** `stratos` server listed with status `connected`. Toggle off → status `disabled` (renders only on next session per design). Disconnect-then-reconnect via mock failure scenarios.

#### Scenario 43 — MCP OAuth elicitation

**Setup:** Configure an OAuth-requiring MCP server (e.g. a GitHub MCP server). On first use, Copilot fires `mcp_oauth.required`.
**Expected:** Stratos elicitation modal shows authorization URL with "Open" button. Click opens external browser. Status flips to `connected` after user authorizes.

### 5.12 Context group

#### Scenario 44 — Context usage panel (`CP-20`)

**Steps:** Send a few messages first (so the window has content). Open the context panel.
**Expected:** Panel renders categories: system prompt, tools, messages, MCP, etc. Percentage bar matches `session.usage_info`. Auto-compact threshold visible if configured. Screenshot: `/tmp/cdp/44-context.png`.
**Internal:** `getContextUsage()` returned cached value from last `session.usage_info`. If no session is live, transient session probed (D§5.10).

### 5.13 Lifecycle group

#### Scenario 45 — Interrupt (`CP-19`)

**Steps:** Send `CP-19`. While streaming, click stop. [Recipe 3.10]
**UI evidence:** Stream halts. "Interrupted" pill visible. Input bar re-enabled within 2s.
**Internal:** Trace shows `abort { reason: "user_initiated" }` → `session.idle`. No orphaned `copilot` subprocess (verify with `ps`).

#### Scenario 46 — Resume across restart

**Steps:**

1. Send `CP-03`. Wait for completion.
2. Quit Stratos.
3. Confirm Copilot CLI subprocess is gone.
4. Relaunch.
5. Open the thread.
6. Send a follow-up: `What did I just ask you?`
   **Expected:** Thread history fully restored. Follow-up gets a coherent answer referencing the prior question.
   **Internal:** `canResume(sessionId)` returned true. `client.createSession({ sessionId })` rehydrated. `getEvents()` returned the prior turn.

### 5.14 Regression sweep

#### Scenario 47 — Other providers still work

**Steps:** For each of Claude Code, Codex, Opencode:

1. Create new thread, pick the provider.
2. Run `CP-01`, `CP-05`, `CP-07`, `CP-12` (sub-agent — use that provider's analog).
   **Expected:** Identical pass criteria as the Copilot scenarios for those tests. Bug if any newly-added abstraction broke an existing path.

---

## 6. Cross-cutting Verification

Beyond per-scenario checks, every run also verifies:

### 6.1 Memory profile

- Open Activity Monitor / `top` for the main Electron process.
- Before scenario start: record RSS.
- After scenario completes: record RSS.
- After 5 minutes idle: record RSS.
  **Pass:** Idle RSS within ±50 MB of pre-start. Repeated runs do not show a monotonic increase.
  **Background:** GC/OOM history per `docs/learnings/gc-memory-debugging.md` makes this a known sensitive area.

### 6.2 Subprocess accounting

```
ps -ef | grep -E "copilot|claude|codex|opencode" | grep -v grep
```

- After a Copilot turn ends, exactly one `copilot` runtime subprocess remains (the singleton client). It is reaped on app quit.
- Switching threads must not spawn additional `copilot` subprocesses.

### 6.3 Trace file integrity

- `~/.stratos/instances/<hash>/threads/traces/<threadId>.jsonl` is well-formed JSONL (one parseable object per line).
- File size respects the 5 MB rotation cap (`MAX_TRACE_BYTES`).
- `.1` backup is present after rotation.

### 6.4 No console errors

- Stratos Electron console should be free of red errors during all scenarios.
- "Warnings" about deferred SDK features are acceptable if they reference open questions in **D§15**.

### 6.5 No IPC backpressure

- During heavy streaming (CP-04, CP-19), the renderer remains responsive. Cursor blinks; scroll works.
- Acceptance: 60fps in scroll; no >1s frame drops.

---

## 7. Failure Analysis Playbook

When a scenario fails, follow this order before raising a bug.

### 7.1 Capture

1. Screenshot the failure state.
2. Snapshot the DOM (for renderer issues) or copy the last 200 lines of the trace JSONL (for stream/protocol issues).
3. Copy the Electron console output.
4. Note: Copilot CLI version (`copilot --version`), SDK version (`pnpm list @github/copilot-sdk`), commit SHA, model id, mode.

### 7.2 Localise

| Symptom                                                           | Likely layer                                  |
| ----------------------------------------------------------------- | --------------------------------------------- |
| No `text` AgentMessages but trace shows `assistant.message_delta` | Provider's event mapping (D§4.1)              |
| Tool card renders raw tool name (e.g. `read`)                     | Tool name normalization table (D§5.2(a))      |
| Diff missing additions/deletions                                  | Pre-edit snapshot path (D§5.5)                |
| Permission card stuck "pending"                                   | `registerPermissionHandler` wiring            |
| Sub-agent renders flat                                            | `parentToolUseId` extraction (risk #12)       |
| Stream never closes                                               | `session.idle` event handler / queue drain    |
| Memory growth                                                     | Backpressure on queue; missing `disconnect()` |
| Subprocess orphan                                                 | `dispose()` not awaited                       |

### 7.3 Reproduce minimally

- Re-run with `logLevel: "debug"` set on the `CopilotClient` to capture raw JSON-RPC.
- Try a different model (rules out model-specific event shape).
- Try the same prompt against the Claude provider (rules out the prompt itself).

### 7.4 Escalate

File issue with: scenario number, reproducer steps, captured artefacts, hypothesis, and a pointer to the relevant **D§** section.

---

## 8. Reporting Format

A run is recorded as a single markdown table committed to `docs/test-runs/<date>-copilot.md`:

```
| # | Scenario | Pass | Notes | Evidence |
|---|---|---|---|---|
| 1 | CLI not installed | ✓ | — | /tmp/cdp/01-cli-missing.png |
| 2 | Connect flow | ✓ | 12s to complete | /tmp/cdp/02-connect.png |
| …| … | … | … | … |
```

Plus three short summary blocks:

- **Environment:** OS, Copilot CLI version, SDK version, Stratos commit, models tested.
- **Pass rate:** N/47, with broken-down failures.
- **Open risks observed:** Cross-reference D§15 items that surfaced.

---

## 9. Automation Roadmap

Manual CDP runs work for v1 but won't scale. Roadmap:

| Phase    | Scope                                                                  | Tech                                                        |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| v1 (now) | Manual CDP per § 5. Reported manually.                                 | Chrome DevTools MCP                                         |
| v1.1     | Codify recipes (§ 3) as TS helpers under `packages/desktop/test/cdp/`. | playwright-electron or wrapper around `chrome-devtools-mcp` |
| v1.2     | Headless-only subset: streaming, tool calls, modes. Wire into CI.      | Vitest + spawn Electron + CDP                               |
| v2       | Full matrix in CI, gated by `RUN_COPILOT_VERIFY=1`. Record videos.     | Above + ffmpeg                                              |

### Unit-level fixtures

Independently of UI verification, every Copilot event from **D§ Appendix A** should have a JSON fixture under `packages/core/src/__tests__/fixtures/copilot-events/<event>.json`. A single parameterised Vitest test asserts the provider's mapping function returns the expected `AgentMessage[]`. This is the regression net that catches SDK bumps.

### Snapshot stability

The trace JSONL files for the canonical prompts (`CP-01`, `CP-05`, `CP-12`) should be captured once and stored under `test/fixtures/copilot/traces/`. A periodic check re-runs the prompt, scrubs timestamps/IDs, and diffs against the snapshot — catches non-obvious regressions in event ordering.

---

## 10. Checklist (TL;DR for execution)

Before declaring the Copilot provider ready:

- [ ] Scenarios 1–46 pass against the Copilot provider.
- [ ] Scenario 47 (regression sweep) passes for Claude, Codex, Opencode.
- [ ] Memory profile within ±50 MB after a 30-minute mixed session.
- [ ] No orphaned subprocesses after quit.
- [ ] No console errors.
- [ ] Event fixture suite (89 events) green.
- [ ] Trace snapshot suite green.
- [ ] Run report committed under `docs/test-runs/`.
- [ ] Open risks from D§15 each have a verification-status note (observed / not observed / blocked).

---

_End of verification plan. Pairs with `docs/copilot-provider-design.md`; reference D§N throughout._

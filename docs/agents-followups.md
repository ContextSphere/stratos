# Agents — deferred work

Follow-ups deliberately left out of the first Agents release. Each entry says
what was cut, **why**, and what would have to be true to bring it back — so the
next person does not have to reconstruct the reasoning or repeat a mistake.

Shipped in v1: agent definitions (`~/.stratos/agents/*.json`), a Folders/Agents
sidebar grouping, an agent overview + editor, per-agent prompt and MCP servers,
per-provider realization adapters, and four seeded personas (Droid, Penny,
Friday, Mimir).

---

## 1. Telegram — one bot per agent

**Status:** designed, not built. Highest-value follow-up.

`AgentDefinition.telegram` already exists in the type
(`{ enabled, botToken, trustedChatId }`) and is persisted, but nothing reads it
and the editor has no field for it. Binding an agent to a bot today means
hand-editing its JSON.

**Design (decided):** one Telegram bot per agent, not forum-topic routing.
Each enabled agent starts its own gateway instance with its own token, so the
bot _is_ the address — no routing table, no fallback semantics, and revoking one
agent's reach is deleting one token. This matches how personal-cfo does it.

**Work:**

- `packages/desktop/src/main/integrations/telegram.ipc.ts` — today
  `onMessage` hands every message to `getManagerRef()` (~line 144), and settings
  hold a single `{ botToken, trustedChatId }`. Make the store per-agent and start
  one gateway per enabled agent, each closing over its own `agentId`.
- `packages/ui/src/components/AgentEditor.tsx` — add the Telegram fields.
- `packages/gateway/src/telegram/handler.ts` — unchanged; the agent is bound at
  start time. It already forwards `msg.message_thread_id` if topics are ever
  wanted.
- WhatsApp (`whatsapp.ipc.ts`) can follow the same shape afterwards.

**Blast radius — do not skip.** Today a Telegram message reaches exactly one
Manager. Once every agent is reachable, one trusted chat can drive several
concurrent sessions in `bypassPermissions` with nobody at the keyboard. Make the
Telegram surface **per-agent opt-in, off by default**, and keep the
`trustedChatId` gate exactly as strict as it is now.

---

## 2. Skills

**Status:** built, then removed on purpose. Do not re-add the shape without the
mechanism.

Skills were `{ name, instruction, tools[] }` on an agent. The entire implemented
behavior was appending a markdown bullet list to the system prompt:

```
## Skills

Invoke these by name when the request matches.

- **portfolio** — Summarize holdings and allocation. (tools: ...)
```

That is a paragraph the user could have typed into the prompt, wrapped in a
form. `tools[]` was stringified into the bullet as prose: it granted nothing,
narrowed nothing, and there was no `/portfolio` invocation. The shape was
imported from OpenBot without the mechanism that makes the shape worth having.

**Bring it back only alongside one of these:**

1. **Per-run tool narrowing.** Offer the model only the tools of the skills that
   match the message, intersected with what the agent actually holds. The
   argument for this is concrete: a model picks the right tool reliably out of
   ~10 and unreliably out of ~30. This is the strongest reason to have skills at
   all.
2. **Slash invocation.** `/portfolio` in the composer, per agent — what
   personal-cfo calls `skill_commands`. Note `SKILLS_LIST` in
   `packages/desktop/src/main/skills/skills.ipc.ts` is currently a stub
   returning `[]`, and slash commands come from the provider CLI globally, not
   per agent. There is no existing per-agent instruction surface to reuse.

Removal commit touches: `types/agent.ts`, `agents/resolve-prompt.ts`,
`storage/agent-seeds.ts`, `AgentEditor.tsx`, `AgentOverview.tsx`,
`utils/agent-defaults.ts`.

---

## 3. A computer per agent

**Status:** deferred. Borrowed from CopilotKit/OpenBot's "a computer per Bot".

Each agent gets its own container: own browser profile and logins, own
`/workspace`, optionally gVisor. Stratos's worktree isolation covers the coding
case, so this only starts to matter for non-coding agents that browse or hold
credentials.

---

## 4. Policy and audit seam

**Status:** deferred, but leave room for it.

Stratos decides tool calls per-call via `PermissionDialog` and five permission
modes. There is no policy language and no audit trail, and the decision is made
on what the model _says_ it is doing.

OpenBot's gateway (`server/src/computer/gateway.ts`) is the reference: resolve
the target from a server-held snapshot, evaluate policy fail-closed, write the
audit row, _then_ act. Their own comment makes the point sharply — a gateway
that decides on a model-supplied label is theatre, because "never click Submit"
is evaded by relabelling the element.

This matters much more once §1 lands: unattended agents driven from a phone.
Retrofitting a choke point later is far harder than leaving one now — the
natural seam is `packages/desktop/src/main/agents/resolve.ts`, which every agent
session already passes through.

---

## 5. Smaller items

| Item                                | Note                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared validation is duplicated** | `packages/ui/src/utils/agent-defaults.ts` copies `validateAgentDefinition` from core because `ui` cannot import runtime values from `core` (the CJS barrel pulls in Node-only `fs` modules and breaks the renderer bundle — same reason `renderer/utils/modes.ts` exists). Byte-identical today. If core's rules change and the copy does not, the editor will accept agents the store rejects. Wants a browser-safe entry point. |
| **`fieldBase` vs `fieldLabel`**     | In `AgentEditor.tsx`, controls inside a flex row must use `fieldBase`. `fieldLabel` hardcodes `w-full`, which Tailwind resolves against `w-24` by stylesheet order — it silently let one control eat a whole row. Comment is on the helper; a lint rule would be better if the pattern spreads.                                                                                                                                   |
| **Agent store is global**           | Agents live in `~/.stratos/agents/`, shared across dev worktrees (same convention as `scheduled-prompts.json`). Testing in a worktree writes to the real store.                                                                                                                                                                                                                                                                   |
| **Per-agent scheduling**            | Socrates was cut from the seeded personas because its value is a scheduling loop. Wiring agents to Stratos schedules is its own feature.                                                                                                                                                                                                                                                                                          |
| **Dashboards**                      | personal-cfo's `DashboardWidget` is backed by Python resolvers over a finance DB. Porting means inventing a widget-source protocol. Out of scope.                                                                                                                                                                                                                                                                                 |
| **Agent-to-agent delegation**       | personal-cfo has `callable_agent_ids`. Stratos already has a truer analogue in the Manager's `create_session` MCP tool. Shipping both would confuse where work happens — keep only `create_session`.                                                                                                                                                                                                                              |

---

## Provider fidelity

Not a TODO so much as a standing constraint, verified against each provider's
`initialize()`:

| Agent field | claude-code    | codex                   | copilot                 | opencode    |
| ----------- | -------------- | ----------------------- | ----------------------- | ----------- |
| prompt      | `systemPrompt` | `developerInstructions` | `customAgents[].prompt` | **no path** |
| mcpServers  | yes            | `-c` args               | yes                     | JSON config |
| model / cwd | yes            | yes                     | yes                     | yes         |

`agentFidelity()` reports what a given provider will drop; the overview surfaces
it as a badge. Opencode is the only real gap — closing it means teaching the
provider to write an agent block into `OPENCODE_CONFIG_CONTENT`. An `AGENTS.md`
fallback would cover every harness at once, but codex's and opencode's discovery
behavior has **not** been verified against their current releases — treat that
as a task, not a fact.

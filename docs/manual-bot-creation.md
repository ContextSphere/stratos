# Manual bot creation

This iteration is **Create one yourself**. Open **Bots → New bot**, enter a
name and operating instructions, then choose **Create** or **Create and start
chat**. Provider and model are visible in the main form; other advanced
configuration is optional. Saved bots can be edited and reused
from the Bots sidebar.

New conversations inherit the bot's provider, model, permission mode, and pinned
workspace when configured. Save failures retain the draft; creating a duplicate
name does not overwrite the existing bot. Editing preserves configuration that
the compact form does not expose, including MCP arguments and environment fields.

## Branches

- `feat/simple-agent-creation`: manual creation and the Bots naming.
- `future/conversational-bots-and-delegation` at `caee9e0`: the complete previous
  implementation, including conversational bot creation, caller-scoped delegation,
  result delivery, provider fixes, and its research and verification documents.

The focused branch is rebased onto `origin/main` at `c2fc5b7`, preserving its
Classic and Refined themes and Codex SDK update. The pre-rebase version is saved
on `backup/simple-agent-creation-before-rebase` at `7bf26bb`. It does not add the
future branch's bot MCP tools, caller tokens, delegation state, or result cards.
Existing Manager/session capabilities remain as they were before this work.

## Verification

Automated command: `pnpm exec turbo build lint typecheck test`.
After rebasing, all 15 targets pass: 826 tests pass and 3 are skipped
(core 294, desktop 293, UI 235, gateway 4). Existing lint warnings remain;
there are no lint errors. Both themed editors retain visible provider/model
selection and optional advanced configuration.

The final manual flow is verified through Chrome DevTools MCP in a separate
profile. Live checks cover the Bots labels, the compact initial form, creation
with only name and instructions, immediate chat launch, editing optional settings,
and a new Codex Sol conversation inheriting the saved model. The live check
identified two defects that are fixed here: the model was not copied onto new
threads, and non-Claude providers were not receiving the saved system instructions.
Regression tests check instruction delivery for both interactive and scheduled
session initialization without launching a provider.

After restarting Electron, the saved Pocket Math bot retained its settings.
Its new conversation `jade-inlet` used `gpt-5.6-sol` and answered the plain
question "What is 31 × 13?" with its saved custom prefix and cross-check:
"Pocket check: 403. Cross-check: 31 × (10 + 3) = 310 + 93 = 403."
The transcript contains no tool calls. This confirms that the saved role reached
the real provider, rather than merely appearing in the editor.
Creating another Pocket Math through the form displayed a duplicate-name error,
retained the draft, and left the original instructions and model unchanged.

## Preview

```sh
STRATOS_DATA_DIR=/private/tmp/stratos-manual-bots-preview/data \
STRATOS_AGENTS_DIR=/private/tmp/stratos-manual-bots-preview/agents \
STRATOS_SETTINGS_DIR=/private/tmp/stratos-manual-bots-preview/settings \
pnpm --filter @stratosapp/desktop dev:debug
```

The profile overrides are opt-in and keep preview bots, chats, schedules, traces,
and preferences separate from the normal profile. Provider authentication uses
the existing installation.

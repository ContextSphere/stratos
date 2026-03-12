# Harness Engineering

Stratos can develop itself. You run two instances — one as the **dev tool** (where you or your agent writes code) and one as the **dev target** (the running app being tested). The dev tool can interact with the dev target programmatically through Chrome DevTools, taking screenshots, clicking elements, and verifying changes — all without manual intervention.

This is what makes Stratos fully vibe-codable. An agent can make a change, watch it hot-reload in the target instance, screenshot the result, and iterate — in a loop, autonomously.

---

## How It Works

### 1. Worktree Isolation

Each instance of Stratos runs in its own git worktree with fully isolated state:

```
Main Instance (Dev Tool)                Feature Instance (Dev Target)
├─ Git root: /path/to/stratos           ├─ Git root: /path/to/stratos-feature
├─ Hash: ab3f01c2 (from path)           ├─ Hash: 7e9d44a1 (from path)
├─ CDP port: 9347 (derived)             ├─ CDP port: 9512 (derived)
├─ User data: ~/.stratos/instances/     ├─ User data: ~/.stratos/instances/
│             ab3f01c2/                 │             7e9d44a1/
└─ Dock icon: default                   └─ Dock icon: hue-shifted
```

Every instance gets:

- **Deterministic CDP port** — derived from a SHA256 hash of the git root path. No port conflicts, no manual configuration.
- **Isolated user data directory** — sessions, threads, and settings are kept separate at `~/.stratos/instances/<hash>/`.
- **Unique app identity** — separate dock icon, window title (`Stratos — <branch-name>`), and process.

### 2. Chrome DevTools Protocol (CDP)

When an instance starts with `ENABLE_CDP=1`, Electron opens a remote debugging port at the worktree's derived port. The MCP config (`.mcp.json`) runs a script that derives the same port using identical logic, so tools like `chrome-devtools-mcp` connect automatically.

This gives agents full control over the target instance:

- **`take_snapshot`** — read the accessibility tree to understand page structure and get element UIDs
- **`click`**, **`fill`**, **`press_key`** — interact with UI elements
- **`take_screenshot`** — capture the current state and visually verify changes
- **`evaluate_script`** — run arbitrary JavaScript in the target's renderer

The port derivation is the same in both TypeScript and bash:

```
PORT = 9200 + (first 4 hex chars of SHA256(git_root) % 799)
```

No config files to sync. The port is always deterministic from the path.

### 3. Visual Identification

Each worktree instance gets a **hue-shifted dock icon** so you can tell them apart at a glance.

The hue is derived from the worktree's path hash:

```
hue = 20 + (first 4 hex chars of hash % 320)
```

This produces a distinct color for each worktree while avoiding the default icon's color range. The main instance keeps its original icon. Only linked worktrees (created via `git worktree add`) get the color shift.

Window titles also include the branch name (e.g., `Stratos — feature-xyz`) for additional clarity.

### 4. Cross-Instance Debugging

When an agent session runs inside Stratos with `STRATOS_WORKTREE=1`, the agent manager detects the target thread's git root and derives its CDP port. If the target is a different worktree, it automatically injects a `chrome-devtools` MCP server pointed at the target instance.

This means the dev tool instance can programmatically control the dev target — no manual wiring needed.

---

## Quick Start

### 1. Launch a dev target from the app

Use the worktree toggle in Stratos to create and launch a second instance. The app handles worktree creation, dependency installation, and startup automatically — no manual git commands needed.

The target instance starts with its own CDP port and isolated state. You'll see it appear with a hue-shifted dock icon so you can tell the two apart.

### 2. Develop and verify

From the main instance, use your agent to edit code in the feature worktree. Changes hot-reload in the target instance. The agent can verify its work through CDP:

```
take_snapshot    → understand the current UI state
click uid=...    → interact with elements
take_screenshot  → visually confirm the result
```

---

## Why This Matters

Most projects require manual testing — you make a change, switch to the app, click around, and decide if it works. Harness engineering removes that loop. The agent has direct, programmatic access to the running app. It can build a feature, verify it visually, fix issues, and iterate — all without human intervention.

This is what makes it practical to vibe-code on Stratos. You describe what you want, and the agent handles the full cycle: code, reload, verify, repeat.

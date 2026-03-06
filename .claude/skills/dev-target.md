# Skill: dev-target

Build and test AgentPanel features using a second AgentPanel instance.

## Workflow

### Setup
1. Create a git worktree for the feature:
   ```bash
   git worktree add ../agentpanel-<feature> -b <feature-branch>
   ```
2. Start the dev target with worktree isolation:
   ```bash
   cd ../agentpanel-<feature> && AGENTPANEL_WORKTREE=1 pnpm --filter @agentpanel/desktop dev:debug
   ```
3. Note the CDP port from the startup log: `[worktree] CDP port=XXXX`
4. Set `CDP_PORT=XXXX` in your environment so MCP tools connect to the target

### Connecting
- The MCP `chrome-devtools` server auto-derives the port from the git root
- If you're in the main worktree, it connects to the main instance
- To connect to the target: `CDP_PORT=XXXX npx chrome-devtools-mcp --browser-url=http://127.0.0.1:XXXX`

### Visual Identification
- Dev tool (main worktree): blue "Panel" text in sidebar, default dock icon
- Dev target (feature worktree): different colored "Panel" text + hue-shifted dock icon
- Window title shows worktree name: "AgentPanel — <feature>"

### Verification Loop
1. Make code changes in the target worktree
2. HMR auto-reloads the target instance
3. `take_snapshot` → interact → `take_screenshot` to verify
4. Fix issues and repeat

### Cleanup
- Kill target: `lsof -ti :<CDP_PORT> | xargs kill`
- Remove worktree: `git worktree remove ../agentpanel-<feature>`

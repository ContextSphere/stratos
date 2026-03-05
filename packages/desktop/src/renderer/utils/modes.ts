/** Browser-safe mode utilities (avoids importing Node.js deps from @agentpanel/core) */

export type AgentMode = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions'

export function normalizeMode(mode: string | undefined): AgentMode {
  if (!mode || mode === 'execute') return 'default'
  if (['plan', 'default', 'acceptEdits', 'bypassPermissions'].includes(mode))
    return mode as AgentMode
  return 'default'
}

export const AGENT_MODES: AgentMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions']

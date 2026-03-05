import type { AgentMode } from './thread'

export interface ModeConfig {
  label: string
  sdkPermissionMode: string
  color: string
  description: string
  dangerous: boolean
}

export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
  plan: {
    label: 'Plan',
    sdkPermissionMode: 'plan',
    color: 'amber',
    description: 'Read-only. Plans without modifying files.',
    dangerous: false
  },
  default: {
    label: 'Default',
    sdkPermissionMode: 'default',
    color: 'blue',
    description: 'Prompts for permission on each tool use.',
    dangerous: false
  },
  acceptEdits: {
    label: 'Accept Edits',
    sdkPermissionMode: 'acceptEdits',
    color: 'green',
    description: 'Auto-accepts file edits. Prompts for terminal commands.',
    dangerous: false
  },
  bypassPermissions: {
    label: 'Bypass',
    sdkPermissionMode: 'bypassPermissions',
    color: 'red',
    description: 'Skips all permission prompts.',
    dangerous: true
  }
}

export const AGENT_MODES: AgentMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions']

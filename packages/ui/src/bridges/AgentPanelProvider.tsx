import { createContext, useContext } from 'react'
import type { ChatBridge, ThreadBridge, SettingsBridge, PreviewBridge } from './types'

export interface AgentPanelContextValue {
  chat: ChatBridge
  threads: ThreadBridge
  settings: SettingsBridge
  preview?: PreviewBridge
}

const AgentPanelContext = createContext<AgentPanelContextValue | null>(null)

export function AgentPanelProvider({
  value,
  children
}: {
  value: AgentPanelContextValue
  children: React.ReactNode
}): React.ReactElement {
  return (
    <AgentPanelContext.Provider value={value}>
      {children}
    </AgentPanelContext.Provider>
  )
}

export function useAgentPanel(): AgentPanelContextValue {
  const ctx = useContext(AgentPanelContext)
  if (!ctx) {
    throw new Error('useAgentPanel must be used within an AgentPanelProvider')
  }
  return ctx
}

export function useChatBridge(): ChatBridge {
  return useAgentPanel().chat
}

export function useThreadBridge(): ThreadBridge {
  return useAgentPanel().threads
}

export function useSettingsBridge(): SettingsBridge {
  return useAgentPanel().settings
}

export function usePreviewBridge(): PreviewBridge | undefined {
  return useAgentPanel().preview
}

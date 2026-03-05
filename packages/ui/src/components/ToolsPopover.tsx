import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { PanelCard } from './shared/PanelCard'

interface MCPServer {
  name: string
  displayName: string
  tools: string[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  sessionTools: string[]
}

export function ToolsPopover({ isOpen, onClose, sessionTools }: Props): React.ReactElement | null {
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const servers = useMemo<MCPServer[]>(() => {
    const mcpTools = sessionTools.filter(tool => tool.startsWith('mcp__'))
    const serverMap = new Map<string, string[]>()
    for (const toolName of mcpTools) {
      const parts = toolName.split('__')
      if (parts.length >= 3) {
        const serverName = parts[1]
        const toolShortName = parts.slice(2).join('__')
        if (!serverMap.has(serverName)) serverMap.set(serverName, [])
        serverMap.get(serverName)!.push(toolShortName)
      }
    }
    return Array.from(serverMap.entries()).map(([name, tools]) => ({
      name,
      displayName: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      tools
    }))
  }, [sessionTools])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const mcpToolCount = servers.reduce((sum, s) => sum + s.tools.length, 0)
  const builtInCount = sessionTools.length - mcpToolCount

  const closeButton = (
    <button
      onClick={onClose}
      className="p-1 rounded hover:bg-[#2a2a2a] text-gray-500 hover:text-gray-300 transition-colors"
      title="Close"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed top-20 right-8 z-30 w-80 max-w-[calc(100vw-2rem)] hidden md:block"
    >
      <PanelCard
        title="Available Tools"
        headerAction={closeButton}
        footer={`${mcpToolCount} MCP · ${builtInCount} built-in · ${sessionTools.length} total`}
      >
        {builtInCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2a2a2a]">
            <span className="text-xs text-gray-400">Built-in Claude Code tools</span>
            <span className="text-xs text-gray-600">{builtInCount}</span>
          </div>
        )}

        {servers.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-600 text-center">No MCP tools connected</div>
        ) : (
          <div>
            {servers.map((server) => (
              <div key={server.name} className="border-b border-[#2a2a2a] last:border-0">
                <button
                  onClick={() => setExpandedServer(expandedServer === server.name ? null : server.name)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#222] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 flex-shrink-0" />
                    <span className="text-xs text-gray-300">{server.displayName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">{server.tools.length}</span>
                    <svg
                      className={`w-3 h-3 text-gray-600 transition-transform duration-150 ${expandedServer === server.name ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                {expandedServer === server.name && (
                  <div className="px-4 pb-2 grid grid-cols-2 gap-1">
                    {server.tools.map((tool) => (
                      <div
                        key={tool}
                        className="text-xs font-mono text-gray-500 bg-[#111] px-2 py-1 rounded truncate"
                        title={tool}
                      >
                        {tool}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </div>,
    document.body
  )
}

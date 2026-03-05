import { useState, useEffect, useCallback, useRef } from 'react'

export interface SlashCommandInfo {
  name: string
  description?: string
}

interface Props {
  commands: SlashCommandInfo[]
  filter: string
  position: { bottom: number; left: number }
  onSelect: (command: string) => void
  onClose: () => void
}

export function SlashCommandMenu({ commands, filter, position, onSelect, onClose }: Props): React.ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(filter.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => (i + 1) % filtered.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          onSelect(filtered[selectedIndex].name)
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleKeyDown])

  if (filtered.length === 0) return null

  return (
    <div
      className="absolute z-50 w-72 max-h-48 overflow-y-auto bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
      ref={listRef}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.name) }}
          onMouseEnter={() => setSelectedIndex(i)}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 ${
            i === selectedIndex ? 'bg-[#2a2a2a] text-gray-200' : 'text-gray-400 hover:bg-[#222]'
          }`}
        >
          <span className="font-mono text-blue-400">{cmd.name}</span>
          {cmd.description && <span className="text-gray-500 text-xs truncate">{cmd.description}</span>}
        </button>
      ))}
    </div>
  )
}

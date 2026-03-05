import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setVisible(true), 300)
  }

  const hide = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setVisible(false)
    setPosition(null)
  }

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const tooltip = tooltipRef.current.getBoundingClientRect()
    const gap = 8

    let top = 0
    let left = 0
    switch (side) {
      case 'top':
        top = trigger.top - tooltip.height - gap
        left = trigger.left + trigger.width / 2 - tooltip.width / 2
        break
      case 'bottom':
        top = trigger.bottom + gap
        left = trigger.left + trigger.width / 2 - tooltip.width / 2
        break
      case 'left':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2
        left = trigger.left - tooltip.width - gap
        break
      case 'right':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2
        left = trigger.right + gap
        break
    }
    setPosition({ top, left })
  }, [visible, side])

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    []
  )

  const tooltipEl = visible && (
    <div
      ref={tooltipRef}
      className="fixed z-[9999] px-3 py-2 rounded-lg bg-[#2a2a2a] border border-white/10 shadow-xl text-sm text-gray-200 whitespace-nowrap flex items-center gap-2"
      style={
        position
          ? { top: position.top, left: position.left }
          : { top: -9999, left: -9999, visibility: 'hidden' as const }
      }
      role="tooltip"
    >
      {content}
    </div>
  )

  return (
    <div ref={triggerRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {typeof document !== 'undefined' && tooltipEl && createPortal(tooltipEl, document.body)}
    </div>
  )
}

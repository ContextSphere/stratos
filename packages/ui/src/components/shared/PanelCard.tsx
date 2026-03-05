import React from 'react'

interface PanelCardProps {
  title: string
  headerAction: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

export function PanelCard({ title, headerAction, children, footer }: PanelCardProps): React.ReactElement {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {headerAction}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {children}
      </div>
      {footer && (
        <div className="px-4 py-2 border-t border-[#2a2a2a] text-xs text-gray-600">
          {footer}
        </div>
      )}
    </div>
  )
}

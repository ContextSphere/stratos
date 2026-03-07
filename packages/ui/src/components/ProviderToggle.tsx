import React from 'react'

type ProviderType = 'claude-code' | 'codex'

interface ProviderToggleProps {
  provider?: ProviderType
  onProviderChange: (provider: ProviderType) => void
  disabled?: boolean
}

const PROVIDERS: { value: ProviderType; label: string; icon: React.ReactNode }[] = [
  {
    value: 'claude-code',
    label: 'Claude',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.709 15.955l4.486-2.592a.2.2 0 0 0 .1-.173V8.818a.2.2 0 0 0-.1-.173L4.71 6.053a.2.2 0 0 0-.3.173v9.556a.2.2 0 0 0 .3.173zM14.706 8.818v4.372a.2.2 0 0 0 .1.173l4.486 2.592a.2.2 0 0 0 .3-.173V6.226a.2.2 0 0 0-.3-.173l-4.486 2.592a.2.2 0 0 0-.1.173zM9.804 5.88l4.487-2.592a.2.2 0 0 0 0-.346L9.804.35a.2.2 0 0 0-.3.173v5.184a.2.2 0 0 0 .3.173zM9.504 18.12L5.018 20.71a.2.2 0 0 0 0 .346l4.486 2.592a.2.2 0 0 0 .3-.173V18.29a.2.2 0 0 0-.3-.173z" />
      </svg>
    )
  },
  {
    value: 'codex',
    label: 'Codex',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    )
  }
]

export default function ProviderToggle({
  provider = 'claude-code',
  onProviderChange,
  disabled = false
}: ProviderToggleProps): React.ReactElement {
  return (
    <div className="flex items-center">
      <div className="flex bg-[#1a1a1a] rounded-md p-0.5 gap-0.5">
        {PROVIDERS.map((p) => {
          const isActive = provider === p.value
          return (
            <button
              key={p.value}
              onClick={() => !disabled && onProviderChange(p.value)}
              disabled={disabled}
              className={`no-drag flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
                isActive
                  ? 'bg-[#2a2a2a] text-gray-200'
                  : 'text-gray-500 hover:text-gray-400'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              title={`Use ${p.label} provider`}
            >
              {p.icon}
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

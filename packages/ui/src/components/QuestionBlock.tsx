import React, { useState } from 'react'

export interface QuestionData {
  question: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

interface QuestionBlockProps {
  data: QuestionData
  onSubmit: (answer: string) => void
  disabled?: boolean
}

export function QuestionBlock({ data, onSubmit, disabled }: QuestionBlockProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  const isDisabled = disabled || submitted

  function handleToggle(idx: number): void {
    if (isDisabled) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (data.multiSelect) {
        if (next.has(idx)) next.delete(idx)
        else next.add(idx)
      } else {
        next.clear()
        next.add(idx)
      }
      return next
    })
  }

  function handleSubmit(): void {
    if (selected.size === 0 || isDisabled) return
    const labels = Array.from(selected)
      .sort()
      .map((i) => data.options[i].label)
    const answer = labels.length === 1 ? labels[0] : labels.join(', ')
    setSubmitted(true)
    onSubmit(answer)
  }

  return (
    <div className="my-3 rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
      <p className="text-sm font-medium text-gray-200 mb-2">{data.question}</p>
      <div className="space-y-1.5">
        {data.options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => handleToggle(idx)}
            disabled={isDisabled}
            className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
              selected.has(idx)
                ? 'border-blue-500 bg-blue-600/20 text-gray-200'
                : 'border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:border-[#3a3a3a] hover:text-gray-300'
            } ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className="text-sm">{opt.label}</span>
            {opt.description && (
              <span className="block text-xs text-gray-500 mt-0.5">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        disabled={selected.size === 0 || isDisabled}
        className={`mt-2 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
          selected.size > 0 && !isDisabled
            ? 'bg-blue-600 text-white hover:bg-blue-500 cursor-pointer'
            : 'bg-[#2a2a2a] text-gray-600 cursor-not-allowed'
        }`}
      >
        {submitted ? 'Submitted' : 'Submit'}
      </button>
    </div>
  )
}

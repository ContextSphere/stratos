import React, { useState } from 'react'
import type { PlanReviewRequest } from '../types'

interface PlanReviewBlockProps {
  data: PlanReviewRequest
  onDecision: (requestId: string, decision: { type: string; feedback?: string }) => void
  onViewPlan?: (content: string, title: string) => void
}

export function PlanReviewBlock({ data, onDecision, onViewPlan }: PlanReviewBlockProps): React.ReactElement {
  const [submitted, setSubmitted] = useState(false)

  function handleChoice(type: string): void {
    if (submitted) return
    setSubmitted(true)
    onDecision(data.requestId, { type })
  }

  return (
    <div className="my-3 rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-200">
          Plan is ready. Would you like to proceed?
        </p>
        {data.planContent && onViewPlan && (
          <button
            onClick={() => onViewPlan(data.planContent!, data.planTitle ?? 'Plan')}
            className="text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer flex-shrink-0 ml-3"
          >
            View plan
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <button
          onClick={() => handleChoice('bypass')}
          disabled={submitted}
          className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
            submitted
              ? 'border-[#2a2a2a] bg-[#1a1a1a] text-gray-600 opacity-60 cursor-not-allowed'
              : 'border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:border-[#3a3a3a] hover:text-gray-300 cursor-pointer'
          }`}
        >
          <span className="text-sm">Yes, bypass permissions</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Auto-approve tool permissions
          </span>
        </button>

        <button
          onClick={() => handleChoice('manual')}
          disabled={submitted}
          className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
            submitted
              ? 'border-[#2a2a2a] bg-[#1a1a1a] text-gray-600 opacity-60 cursor-not-allowed'
              : 'border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:border-[#3a3a3a] hover:text-gray-300 cursor-pointer'
          }`}
        >
          <span className="text-sm">Yes, manually approve edits</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Require manual approval for each tool
          </span>
        </button>
      </div>
    </div>
  )
}

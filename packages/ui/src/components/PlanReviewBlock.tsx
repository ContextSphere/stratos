import React, { useState } from "react";
import type { PlanReviewRequest } from "../types";
import type { ProviderType } from "../utils/modes";

interface PlanReviewBlockProps {
  provider?: ProviderType;
  data: PlanReviewRequest;
  onDecision: (
    requestId: string,
    decision: { type: string; feedback?: string },
  ) => void;
  onViewPlan?: (content: string, title: string) => void;
}

const BTN_ENABLED =
  "border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:border-[#3a3a3a] hover:text-gray-300 cursor-pointer";
const BTN_DISABLED =
  "border-[#2a2a2a] bg-[#1a1a1a] text-gray-600 opacity-60 cursor-not-allowed";

export function PlanReviewBlock({
  provider,
  data,
  onDecision,
  onViewPlan,
}: PlanReviewBlockProps): React.ReactElement {
  const [submitted, setSubmitted] = useState(false);
  const disabled = submitted || (data.responded ?? false);

  function handleChoice(type: string): void {
    if (disabled) return;
    setSubmitted(true);
    onDecision(data.requestId, { type });
  }

  const isCodex = provider === "codex";

  return (
    <div className="my-3 rounded-lg border border-[#2a2a2a] bg-[#111] p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-200">
          Plan is ready. Would you like to proceed?
        </p>
        {data.planContent && onViewPlan && (
          <button
            onClick={() =>
              onViewPlan(data.planContent!, data.planTitle ?? "Plan")
            }
            className="text-xs text-blue-400 hover:text-blue-300 hover:underline cursor-pointer flex-shrink-0 ml-3"
          >
            View plan
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {isCodex ? (
          <button
            onClick={() => handleChoice("implement")}
            disabled={disabled}
            className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${disabled ? BTN_DISABLED : BTN_ENABLED}`}
          >
            <span className="text-sm">Implement plan</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Auto-approve and execute the plan
            </span>
          </button>
        ) : (
          <>
            <button
              onClick={() => handleChoice("bypass")}
              disabled={disabled}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${disabled ? BTN_DISABLED : BTN_ENABLED}`}
            >
              <span className="text-sm">Yes, bypass permissions</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Auto-approve tool permissions
              </span>
            </button>

            <button
              onClick={() => handleChoice("manual")}
              disabled={disabled}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${disabled ? BTN_DISABLED : BTN_ENABLED}`}
            >
              <span className="text-sm">Yes, manually approve edits</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Require manual approval for each tool
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

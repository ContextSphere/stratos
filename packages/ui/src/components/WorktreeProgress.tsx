import type { WorktreeProgressData } from "../types";
import { LoadingSpinner, StatusIndicator } from "./shared/StatusIndicator";

interface Props {
  progressData: WorktreeProgressData;
}

export function WorktreeProgress({ progressData }: Props): React.ReactElement {
  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-mid)] p-3 text-xs space-y-2">
      <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        Initializing worktree
      </div>
      <div className="space-y-1.5 pl-6">
        {progressData.steps.map((step, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {step.status === "running" ? (
              <LoadingSpinner size="sm" className="text-blue-400" />
            ) : step.status === "error" ? (
              <span className="text-red-400 text-xs">✕</span>
            ) : (
              <StatusIndicator status="completed" size="sm" />
            )}
            <span
              className={
                step.status === "running"
                  ? "text-[var(--text-primary)]"
                  : step.status === "error"
                    ? "text-red-500"
                    : "text-[var(--text-secondary)]"
              }
            >
              {step.step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

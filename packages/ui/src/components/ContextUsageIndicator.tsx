import { useRef, useState } from "react";
import type { ContextUsage } from "../bridges/types";
import { ContextUsagePopover } from "./ContextUsagePopover";

interface Props {
  usage: ContextUsage | null;
  onRefresh?: () => void;
}

function colorForPercent(p: number): string {
  if (p >= 92) return "text-red-400";
  if (p >= 80) return "text-orange-400";
  if (p >= 60) return "text-yellow-400";
  return "text-emerald-400";
}

function strokeForPercent(p: number): string {
  if (p >= 92) return "stroke-red-400";
  if (p >= 80) return "stroke-orange-400";
  if (p >= 60) return "stroke-yellow-400";
  return "stroke-emerald-400";
}

export function ContextUsageIndicator({
  usage,
  onRefresh,
}: Props): React.ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  if (!usage) return null;

  const pct = Math.max(0, Math.min(100, Math.round(usage.percentage)));
  const radius = 7;
  const stroke = 2;
  const size = (radius + stroke) * 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => {
          if (!isOpen) {
            setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
            onRefresh?.();
          }
          setIsOpen((v) => !v);
        }}
        title={`Context: ${pct}% (${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens). Click for full breakdown.`}
        className="no-drag flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--border)] transition-colors whitespace-nowrap"
        data-testid="context-usage-indicator"
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="flex-shrink-0"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-[var(--border)]"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={`${strokeForPercent(pct)} transition-[stroke-dashoffset] duration-300`}
          />
        </svg>
        <span
          className={`text-[11px] font-medium tabular-nums ${colorForPercent(pct)}`}
        >
          {pct}%
        </span>
      </button>

      <ContextUsagePopover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        usage={usage}
        anchorRect={anchorRect}
      />
    </>
  );
}

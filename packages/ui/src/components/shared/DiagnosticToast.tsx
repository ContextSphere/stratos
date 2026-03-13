import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagnosticError } from "../../hooks/useDiagnostics";

const SEVERITY_STYLES = {
  error: {
    bar: "bg-red-500",
    icon: "text-red-400",
    badge: "bg-red-500/15 text-red-400 border-red-500/25",
  },
  warning: {
    bar: "bg-amber-500",
    icon: "text-amber-400",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  },
  info: {
    bar: "bg-blue-500",
    icon: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
};

const AUTO_DISMISS_MS = 15_000;

interface Props {
  toast: DiagnosticError;
  onDismiss: (id: string) => void;
}

export function DiagnosticToast({
  toast,
  onDismiss,
}: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(100);
  const startRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);
  const severity = toast.severity ?? "error";
  const styles = SEVERITY_STYLES[severity];
  const hasDetails = !!(toast.context || toast.stack);

  // Countdown progress bar & auto-dismiss
  useEffect(() => {
    startRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onDismiss(toast.id);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [toast.id, onDismiss]);

  const handleCopy = useCallback(() => {
    const lines: string[] = [
      `[${new Date(toast.timestamp).toISOString()}] ${toast.title}`,
      toast.message,
    ];
    if (toast.context) {
      lines.push("\nContext:");
      for (const [k, v] of Object.entries(toast.context)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
    if (toast.stack) {
      lines.push("\nStack:");
      lines.push(toast.stack);
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [toast]);

  return (
    <div className="no-drag relative w-80 bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-xl shadow-2xl overflow-hidden">
      {/* Severity bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${styles.bar}`} />

      {/* Progress bar at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-[var(--border)]">
        <div
          className={`h-full ${styles.bar} opacity-60 transition-none`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="pl-3 pr-3 pt-3 pb-2.5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Severity icon */}
            <svg
              className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {toast.title}
            </span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-0.5 -mr-0.5"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Message */}
        <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
          {toast.message}
        </p>

        {/* Action bar */}
        <div className="mt-2 flex items-center gap-2">
          {hasDetails && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${styles.badge} transition-colors`}
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
              {expanded ? "Hide" : "Details"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-mid)] transition-colors"
          >
            {copied ? (
              <>
                <svg
                  className="w-3 h-3 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy
              </>
            )}
          </button>
          <span className="ml-auto text-[10px] text-[var(--text-muted)] opacity-60">
            {new Date(toast.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Expandable details */}
        {expanded && hasDetails && (
          <div className="mt-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border)] p-2 space-y-2 max-h-48 overflow-y-auto">
            {toast.context && Object.keys(toast.context).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Context
                </p>
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(toast.context).map(([k, v]) => (
                      <tr key={k} className="align-top">
                        <td className="pr-2 text-[var(--text-muted)] whitespace-nowrap font-mono pb-0.5">
                          {k}
                        </td>
                        <td className="text-[var(--text-primary)] font-mono break-all pb-0.5">
                          {typeof v === "string" ? v : JSON.stringify(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {toast.stack && (
              <div>
                <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Stack
                </p>
                <pre className="text-[10px] text-[var(--text-muted)] whitespace-pre-wrap break-all leading-relaxed">
                  {toast.stack}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Container that renders all active diagnostic toasts in the bottom-right corner. */
export function DiagnosticToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: DiagnosticError[];
  onDismiss: (id: string) => void;
}): React.ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <DiagnosticToast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

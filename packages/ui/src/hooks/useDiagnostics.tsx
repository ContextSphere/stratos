import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface DiagnosticError {
  id: string;
  title: string;
  message: string;
  /** Structured key-value context (e.g. threadId, sessionId, file path) */
  context?: Record<string, unknown>;
  /** Raw stack trace or additional log lines */
  stack?: string;
  timestamp: number;
  severity?: "error" | "warning" | "info";
}

interface DiagnosticsContextValue {
  toasts: DiagnosticError[];
  report: (error: Omit<DiagnosticError, "id" | "timestamp">) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const DiagnosticsContext = createContext<DiagnosticsContextValue | null>(null);

/** Max toasts shown at once — oldest are dropped. */
const MAX_TOASTS = 5;

export function DiagnosticsProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<DiagnosticError[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const report = useCallback(
    (error: Omit<DiagnosticError, "id" | "timestamp">) => {
      const entry: DiagnosticError = {
        ...error,
        id: `diag-${Date.now()}-${counterRef.current++}`,
        timestamp: Date.now(),
        severity: error.severity ?? "error",
      };
      console.error(
        `[diagnostic] ${entry.title}: ${entry.message}`,
        entry.context ?? "",
        entry.stack ?? "",
      );
      setToasts((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_TOASTS
          ? next.slice(next.length - MAX_TOASTS)
          : next;
      });
    },
    [],
  );

  return (
    <DiagnosticsContext.Provider
      value={{ toasts, report, dismiss, dismissAll }}
    >
      {children}
    </DiagnosticsContext.Provider>
  );
}

export function useDiagnostics(): DiagnosticsContextValue {
  const ctx = useContext(DiagnosticsContext);
  if (!ctx)
    throw new Error("useDiagnostics must be used within DiagnosticsProvider");
  return ctx;
}

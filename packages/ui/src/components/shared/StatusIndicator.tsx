export interface StatusIndicatorProps {
  status:
    | "connected"
    | "disconnected"
    | "pending"
    | "running"
    | "completed"
    | "denied";
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Status indicator with colored dot and optional label.
 *
 * @example
 * <StatusIndicator status="connected" label="Connected" />
 * <StatusIndicator status="pending" size="sm" />
 */
export function StatusIndicator({
  status,
  label,
  size = "md",
  className = "",
}: StatusIndicatorProps): React.ReactElement {
  const statusColors = {
    connected: "bg-green-500",
    disconnected: "bg-gray-600",
    pending: "bg-yellow-400",
    running: "bg-blue-400",
    completed: "bg-green-400",
    denied: "bg-red-400",
  };

  const dotSize = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`${dotSize} rounded-full ${statusColors[status]}`} />
      {label && (
        <span
          className={`${textSize} ${status === "connected" ? "text-green-400" : status === "denied" ? "text-red-400" : "text-gray-400"} font-medium`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Loading spinner component.
 *
 * @example
 * <LoadingSpinner size="sm" />
 */
export function LoadingSpinner({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}): React.ReactElement {
  const sizeStyles = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-6 w-6",
  };

  return (
    <svg
      className={`animate-spin ${sizeStyles[size]} ${className}`}
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/**
 * Typing indicator with animated dots.
 *
 * @example
 * <TypingIndicator />
 */
export function TypingIndicator({
  className = "",
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={`inline-flex items-center gap-2 text-gray-500 ${className}`}
    >
      <span className="text-xs">Thinking</span>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500/70 animate-pulse motion-reduce:animate-none" />
        <span
          className="h-1.5 w-1.5 rounded-full bg-gray-500/60 animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: "0.18s" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-gray-500/50 animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: "0.36s" }}
        />
      </span>
    </div>
  );
}

import { ReactNode } from "react";

export interface CardProps {
  variant?: "default" | "nested";
  className?: string;
  children: ReactNode;
}

/**
 * Reusable card component following design system patterns.
 *
 * @example
 * <Card>Content here</Card>
 * <Card variant="nested">Nested content</Card>
 */
export function Card({
  variant = "default",
  className = "",
  children,
}: CardProps): React.ReactElement {
  const variantStyles = {
    default:
      "bg-[var(--bg-surface)] border border-[var(--border-mid)] rounded-2xl p-6",
    nested:
      "bg-[var(--bg-overlay)] border border-[var(--border)] rounded-lg p-4",
  };

  return (
    <div className={`${variantStyles[variant]} ${className}`}>{children}</div>
  );
}

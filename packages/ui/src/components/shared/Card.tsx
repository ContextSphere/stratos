import { ReactNode } from 'react'

export interface CardProps {
  variant?: 'default' | 'nested'
  className?: string
  children: ReactNode
}

/**
 * Reusable card component following design system patterns.
 *
 * @example
 * <Card>Content here</Card>
 * <Card variant="nested">Nested content</Card>
 */
export function Card({
  variant = 'default',
  className = '',
  children
}: CardProps): React.ReactElement {
  const variantStyles = {
    default: 'bg-[#1a1a1a] border border-[#333] rounded-2xl p-6',
    nested: 'bg-[#111] border border-[#2a2a2a] rounded-lg p-4'
  }

  return <div className={`${variantStyles[variant]} ${className}`}>{children}</div>
}

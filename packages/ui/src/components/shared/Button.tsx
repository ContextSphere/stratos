import { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  className?: string
  children: ReactNode
}

/**
 * Reusable button component following design system patterns.
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>Save</Button>
 * <Button variant="destructive" loading={isDeleting}>Delete</Button>
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps): React.ReactElement {
  const baseStyles =
    'font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'

  const variantStyles = {
    primary:
      'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed',
    secondary: 'bg-[#2a2a2a] hover:bg-[#333] text-gray-300',
    destructive: 'bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30',
    icon: 'bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed'
  }

  const sizeStyles = {
    sm: variant === 'icon' ? 'w-8 h-8 rounded-lg' : 'px-3 py-1.5 text-xs rounded-lg',
    md: variant === 'icon' ? 'w-10 h-10 rounded-xl' : 'px-4 py-2.5 text-sm rounded-xl',
    lg: variant === 'icon' ? 'w-12 h-12 rounded-xl' : 'px-6 py-3 text-base rounded-xl'
  }

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
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
          {typeof children === 'string' ? children : 'Loading...'}
        </span>
      ) : (
        children
      )}
    </button>
  )
}

import { InputHTMLAttributes, forwardRef } from 'react'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: string
  error?: string
  className?: string
}

/**
 * Reusable input component following design system patterns.
 *
 * @example
 * <Input label="API Key" type="text" placeholder="Enter your API key" />
 * <Input label="Password" type="password" error="Password is required" />
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && <label className="block text-xs text-gray-500 mb-1.5">{label}</label>}
        <input
          ref={ref}
          className={`w-full bg-[#111] border ${error ? 'border-red-500' : 'border-[#333]'} rounded-lg px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors ${props.type === 'password' ? 'font-mono' : ''} ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

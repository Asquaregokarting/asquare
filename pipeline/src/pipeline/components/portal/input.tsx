import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-11 w-full rounded-lg border border-white/[0.08] bg-portal-panel px-3.5 py-2 text-sm text-white placeholder:text-portal-muted/60 focus-visible:outline-none focus-visible:border-instagram/60 focus-visible:ring-2 focus-visible:ring-instagram/20 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }

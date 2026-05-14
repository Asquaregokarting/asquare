import * as React from 'react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'success'
type Size = 'default' | 'sm' | 'lg' | 'icon'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClass: Record<Variant, string> = {
  default: 'bg-instagram text-white hover:bg-instagram-700',
  secondary: 'bg-white/[0.06] text-white hover:bg-white/[0.10] border border-white/[0.06]',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
  outline: 'border border-white/15 bg-transparent text-white hover:bg-white/[0.06]',
  ghost: 'bg-transparent text-white hover:bg-white/[0.06]',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
}

const sizeClass: Record<Size, string> = {
  default: 'h-10 px-4 py-2 text-sm',
  sm: 'h-9 px-3 text-xs',
  lg: 'h-11 px-6 text-base',
  icon: 'h-10 w-10',
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-instagram/60',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

export { Button }
export type { ButtonProps }

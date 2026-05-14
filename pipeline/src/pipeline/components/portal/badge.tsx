import * as React from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-instagram/15 text-instagram border-instagram/30',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  destructive: 'bg-red-500/15 text-red-400 border-red-500/30',
  info: 'bg-primary-500/15 text-primary-300 border-primary-500/30',
  muted: 'bg-white/[0.05] text-portal-muted border-white/[0.06]',
}

const Badge: React.FC<BadgeProps> = ({ className, variant = 'default', ...props }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
      variantClass[variant],
      className,
    )}
    {...props}
  />
)

export { Badge }
export type { BadgeVariant }

import * as React from 'react'
import { cn } from '@/lib/utils'

const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    className={cn('animate-pulse rounded-lg bg-white/[0.04]', className)}
    {...props}
  />
)

export { Skeleton }

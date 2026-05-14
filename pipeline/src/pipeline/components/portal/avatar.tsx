import * as React from 'react'
import { cn } from '@/lib/utils'

const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative flex h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/[0.08]',
        className,
      )}
      {...props}
    />
  ),
)
Avatar.displayName = 'Avatar'

const AvatarImage: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({
  className,
  alt = '',
  ...props
}) => (
  <img className={cn('aspect-square h-full w-full object-cover', className)} alt={alt} {...props} />
)

const AvatarFallback: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'flex h-full w-full items-center justify-center bg-instagram/10 text-instagram/70',
      className,
    )}
    {...props}
  />
)

export { Avatar, AvatarImage, AvatarFallback }

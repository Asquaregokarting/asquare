import { type HTMLAttributes } from 'react'

/**
 * Tailwind-only skeleton placeholder. Use for loading states where you know
 * the rough shape of the eventual content.
 *
 * Examples:
 *   <Skeleton className="h-6 w-32" />              // text line
 *   <Skeleton className="h-40 w-full rounded-xl" /> // hero/image
 *   <Skeleton className="h-10 w-10 rounded-full" /> // avatar
 *
 * Don't add bespoke gray boxes inline — reach for this so the shimmer is
 * consistent everywhere.
 */
export default function Skeleton({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse rounded-md bg-dark-700/60 ${className}`}
      {...rest}
    />
  )
}

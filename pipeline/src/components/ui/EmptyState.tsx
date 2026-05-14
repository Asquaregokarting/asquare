import { type ReactNode } from 'react'

interface EmptyStateProps {
  /** Lucide icon or any element. Rendered above the title. */
  icon?: ReactNode
  title: string
  description?: string
  /** Optional CTA — e.g. <Link to="/activities">Browse activities</Link>. */
  action?: ReactNode
  className?: string
}

/**
 * Standard empty-state UI for "no bookings", "no transactions", "no results".
 *
 * Use this whenever a page or section has nothing to show. Pages should
 * never render an empty `<div>` — pick this and give the user a next action.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center px-6 py-12 gap-3 ${className}`}
    >
      {icon ? <div className="text-dark-400 mb-1">{icon}</div> : null}
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description ? (
        <p className="text-sm text-dark-300 max-w-sm">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

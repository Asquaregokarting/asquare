import { type ReactNode } from 'react'

interface ErrorStateProps {
  /** Short, human-readable headline. e.g. "Couldn't load your bookings". */
  title: string
  /** Optional longer message — usually a sanitized error.message. */
  description?: string
  /** Click handler for the primary "try again" action. */
  onRetry?: () => void
  /** Optional secondary action (e.g. "Go home"). */
  secondaryAction?: ReactNode
  className?: string
}

/**
 * In-page error state. Use this for recoverable per-section errors (a list
 * failed to load, a query errored). For full-tree crashes use ErrorBoundary
 * instead.
 */
export default function ErrorState({
  title,
  description,
  onRetry,
  secondaryAction,
  className = '',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center text-center px-6 py-10 gap-3 ${className}`}
    >
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description ? (
        <p className="text-sm text-dark-300 max-w-md">{description}</p>
      ) : null}
      <div className="flex gap-2 pt-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded bg-primary text-white text-sm font-medium"
          >
            Try again
          </button>
        ) : null}
        {secondaryAction}
      </div>
    </div>
  )
}

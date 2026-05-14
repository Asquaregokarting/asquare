import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '../lib/logger'

interface Props {
  children: ReactNode
  /** Optional fallback override. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Tag added to log messages so we can tell which boundary fired. */
  scope?: string
}

interface State {
  error: Error | null
}

/**
 * Top-level error boundary. Catches render-time errors anywhere in its child
 * tree, logs them via the structured logger, and shows a recovery UI.
 *
 * Note: error boundaries do NOT catch errors in event handlers, async code,
 * or server-side rendering - those still need explicit try/catch + logger.error.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error(`error_boundary.${this.props.scope ?? 'root'}.caught`, error, {
      componentStack: errorInfo.componentStack,
    })
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    return (
      <div
        role="alert"
        className="min-h-screen bg-dark-900 text-white flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-2xl font-display font-bold gradient-text">
            Something went wrong
          </h1>
          <p className="text-dark-300 text-sm">
            We hit an unexpected error. Try refreshing — if it keeps happening, our
            team has been notified.
          </p>
          {!import.meta.env.PROD && (
            <pre className="text-xs text-left bg-black/40 p-3 rounded overflow-auto max-h-40">
              {error.message}
            </pre>
          )}
          <div className="flex gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={this.reset}
              className="px-4 py-2 rounded bg-primary text-white text-sm font-medium"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded border border-dark-600 text-sm font-medium"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

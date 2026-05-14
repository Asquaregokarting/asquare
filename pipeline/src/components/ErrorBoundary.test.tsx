import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import ErrorBoundary from './ErrorBoundary'
import { logger } from '../lib/logger'

function ProblemChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test render error')
  return <div>All good</div>
}

describe('ErrorBoundary', () => {
  // Suppress console.error from React's error boundary logging
  const originalError = console.error
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Error: Uncaught')) return
      if (typeof args[0] === 'string' && args[0].includes('The above error')) return
      originalError(...args)
    }
  })
  afterAll(() => {
    console.error = originalError
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Hello World')).toBeInTheDocument()
  })

  it('catches render error and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows Try again and Reload buttons', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Try again')).toBeInTheDocument()
    expect(screen.getByText('Reload')).toBeInTheDocument()
  })

  it('Try again resets error state', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Click try again — re-renders children, which will throw again
    fireEvent.click(screen.getByText('Try again'))
    // After reset, if child still throws, boundary catches it again
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('uses custom fallback when provided', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <div>
            <span>Custom: {error.message}</span>
            <button onClick={reset}>Reset</button>
          </div>
        )}
      >
        <ProblemChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Custom: Test render error')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })

  it('logs error via structured logger', () => {
    render(
      <ErrorBoundary scope="test-scope">
        <ProblemChild />
      </ErrorBoundary>,
    )
    expect(logger.error).toHaveBeenCalledWith(
      'error_boundary.test-scope.caught',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    )
  })

  it('uses root scope by default', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    )
    expect(logger.error).toHaveBeenCalledWith(
      'error_boundary.root.caught',
      expect.any(Error),
      expect.anything(),
    )
  })

  it('shows error message in dev mode', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    )
    // In test env (non-production), error message should be visible
    expect(screen.getByText('Test render error')).toBeInTheDocument()
  })
})

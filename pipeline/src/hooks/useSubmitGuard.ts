import { useCallback, useRef, useState } from 'react'

/**
 * Double-submit guard for any async action that must run at most once at a time.
 *
 * Why both a ref AND state:
 *   - The `inFlightRef` rejects re-entry synchronously, before React schedules
 *     a re-render. State alone loses to fast double-clicks because the second
 *     click handler sees the stale (false) value.
 *   - The `submitting` state drives `disabled` styling on the button.
 *
 * Pair with a `clientRequestId` on the server side for true idempotency
 * across tabs / devices. The guard alone only protects a single component
 * instance; the server check protects the rest.
 */
export function useSubmitGuard(): {
  submitting: boolean
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>
} {
  const inFlightRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const guard = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlightRef.current) return undefined
    inFlightRef.current = true
    setSubmitting(true)
    try {
      return await fn()
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }, [])

  return { submitting, guard }
}

/**
 * Generate a fresh idempotency token for a booking submission. Caller stores
 * it in a ref tied to the cart/form lifecycle and passes it as
 * `clientRequestId` to createUnifiedBooking. Replays of the same token are a
 * no-op on the server.
 */
export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cri_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Auto-mock factory for API objects.
 *
 * Returns a Proxy where any property access returns a vi.fn() that resolves
 * to a safe default. Explicit overrides take priority.
 *
 * Usage in test files:
 *   import { autoMockApi } from '../../../test/auto-mock-api'
 *   vi.mock('../../api/billing', () => ({ billingApi: autoMockApi() }))
 */
import { vi } from 'vitest'

export const autoMockApi = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
  new Proxy(overrides, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined
      if (prop in target) return target[prop]
      // Return a vi.fn that resolves to a safe empty value
      const mock = vi.fn(() => Promise.resolve(null))
      // Cache it so the same mock is returned on repeated access
      target[prop] = mock
      return mock
    },
  })

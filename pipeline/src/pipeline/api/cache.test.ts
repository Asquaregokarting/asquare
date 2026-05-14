import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTtlCache } from './cache'

describe('createTtlCache', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null when empty', () => {
    const cache = createTtlCache<string>(1000)
    expect(cache.get()).toBeNull()
  })

  it('stores and retrieves value', () => {
    const cache = createTtlCache<string>(1000)
    cache.set('hello')
    expect(cache.get()).toBe('hello')
  })

  it('returns value within TTL window', () => {
    const cache = createTtlCache<number>(5000)
    cache.set(42)
    vi.advanceTimersByTime(4999)
    expect(cache.get()).toBe(42)
  })

  it('returns null after TTL expires', () => {
    const cache = createTtlCache<number>(5000)
    cache.set(42)
    vi.advanceTimersByTime(5001)
    expect(cache.get()).toBeNull()
  })

  it('overwrites previous value', () => {
    const cache = createTtlCache<string>(5000)
    cache.set('first')
    cache.set('second')
    expect(cache.get()).toBe('second')
  })

  it('invalidate clears cache immediately', () => {
    const cache = createTtlCache<string>(60000)
    cache.set('data')
    cache.invalidate()
    expect(cache.get()).toBeNull()
  })

  it('works with object values', () => {
    const cache = createTtlCache<{ items: string[] }>(5000)
    cache.set({ items: ['a', 'b'] })
    expect(cache.get()?.items).toEqual(['a', 'b'])
  })

  it('set resets the TTL timer', () => {
    const cache = createTtlCache<number>(5000)
    cache.set(1)
    vi.advanceTimersByTime(3000)
    cache.set(2) // reset TTL
    vi.advanceTimersByTime(3000) // 3s after second set (within new TTL)
    expect(cache.get()).toBe(2)
  })
})

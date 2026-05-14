import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  formatCurrency,
  getErrorMessage,
  getErrorCode,
  vibrate,
  formatTime,
  setWithExpiry,
  getWithExpiry,
  isPeakHours,
  calculateComboDiscount,
  getLocalISODate,
} from './utils'

describe('cn (Tailwind class merger)', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('deduplicates tailwind classes', () => {
    const r = cn('px-2 py-1', 'px-4')
    expect(r).toContain('px-4')
    expect(r).not.toContain('px-2')
  })

  it('handles falsy values', () => {
    const isHidden = false as boolean
    expect(cn('base', isHidden && 'hidden', 'visible')).toBe('base visible')
  })

  it('handles undefined/null', () => {
    expect(cn('base', undefined, null as unknown as string)).toBe('base')
  })
})

describe('formatCurrency', () => {
  it('formats positive amount in INR', () => {
    expect(formatCurrency(1500)).toContain('1,500')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toContain('0')
  })

  it('formats large amounts with Indian grouping', () => {
    expect(formatCurrency(125000)).toContain('1,25,000')
  })

  it('includes rupee symbol', () => {
    expect(formatCurrency(100)).toMatch(/₹/)
  })
})

describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('Test error'))).toBe('Test error')
  })

  it('returns string directly', () => {
    expect(getErrorMessage('Direct string')).toBe('Direct string')
  })

  it('extracts message from plain object', () => {
    expect(getErrorMessage({ message: 'Object error' })).toBe('Object error')
  })

  it('returns fallback for null', () => {
    expect(getErrorMessage(null)).toBe('Something went wrong')
  })

  it('returns custom fallback', () => {
    expect(getErrorMessage(null, 'Custom')).toBe('Custom')
  })

  it('returns fallback for empty string', () => {
    expect(getErrorMessage('')).toBe('Something went wrong')
  })

  it('returns fallback for number', () => {
    expect(getErrorMessage(42)).toBe('Something went wrong')
  })
})

describe('getErrorCode', () => {
  it('extracts code from object', () => {
    expect(getErrorCode({ code: 'NOT_FOUND' })).toBe('NOT_FOUND')
  })

  it('returns undefined for no code', () => {
    expect(getErrorCode(new Error('no code'))).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(getErrorCode(null)).toBeUndefined()
  })

  it('returns undefined for numeric code', () => {
    expect(getErrorCode({ code: 404 })).toBeUndefined()
  })
})

describe('vibrate', () => {
  it('calls navigator.vibrate with pattern', () => {
    vibrate(50)
    expect(navigator.vibrate).toHaveBeenCalledWith(50)
  })

  it('defaults to 10ms', () => {
    vibrate()
    expect(navigator.vibrate).toHaveBeenCalledWith(10)
  })
})

describe('formatTime', () => {
  it('converts 24h afternoon to 12h PM', () => {
    expect(formatTime('14:30')).toBe('2:30 PM')
  })

  it('handles midnight as 12:00 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM')
  })

  it('handles noon as 12:00 PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM')
  })

  it('handles morning time', () => {
    expect(formatTime('09:15')).toBe('9:15 AM')
  })

  it('returns input if no colon', () => {
    expect(formatTime('invalid')).toBe('invalid')
  })

  it('returns empty for empty input', () => {
    expect(formatTime('')).toBe('')
  })
})

describe('setWithExpiry / getWithExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('stores and retrieves value', () => {
    setWithExpiry('test', { score: 100 }, 5000)
    expect(getWithExpiry<{ score: number }>('test')).toEqual({ score: 100 })
  })

  it('returns null for missing key', () => {
    expect(getWithExpiry('nonexistent')).toBeNull()
  })

  it('returns value within TTL', () => {
    setWithExpiry('data', 'hello', 10000)
    vi.advanceTimersByTime(9999)
    expect(getWithExpiry('data')).toBe('hello')
  })

  it('returns null after TTL expires', () => {
    setWithExpiry('data', 'hello', 5000)
    vi.advanceTimersByTime(5001)
    expect(getWithExpiry('data')).toBeNull()
  })

  it('removes expired key from localStorage', () => {
    setWithExpiry('temp', 42, 1000)
    vi.advanceTimersByTime(1001)
    getWithExpiry('temp')
    expect(localStorage.getItem('temp')).toBeNull()
  })

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem('bad', 'not-json')
    expect(getWithExpiry('bad')).toBeNull()
  })

  it('handles complex objects', () => {
    const data = { tires: 50, progress: { level: 3 }, scores: [100, 200] }
    setWithExpiry('game', data, 60000)
    expect(getWithExpiry('game')).toEqual(data)
  })
})

describe('isPeakHours', () => {
  it('weekends are always peak', () => {
    const saturday = new Date('2026-04-18') // Saturday
    expect(isPeakHours(saturday, '10:00')).toBe(true)
    expect(isPeakHours(saturday, '14:00')).toBe(true)
  })

  it('sunday is always peak', () => {
    const sunday = new Date('2026-04-19') // Sunday
    expect(isPeakHours(sunday, '09:00')).toBe(true)
  })

  it('weekday evening 16:00-21:59 is peak', () => {
    const monday = new Date('2026-04-13') // Monday
    expect(isPeakHours(monday, '16:00')).toBe(true)
    expect(isPeakHours(monday, '18:30')).toBe(true)
    expect(isPeakHours(monday, '21:00')).toBe(true)
  })

  it('weekday morning is not peak', () => {
    const tuesday = new Date('2026-04-14') // Tuesday
    expect(isPeakHours(tuesday, '10:00')).toBe(false)
    expect(isPeakHours(tuesday, '14:00')).toBe(false)
  })

  it('weekday 22:00+ is not peak', () => {
    const wednesday = new Date('2026-04-15')
    expect(isPeakHours(wednesday, '22:00')).toBe(false)
  })
})

describe('calculateComboDiscount', () => {
  it('no discount for 0 items', () => {
    expect(calculateComboDiscount(0)).toBe(0)
  })

  it('no discount for 1 item', () => {
    expect(calculateComboDiscount(1)).toBe(0)
  })

  it('5% for 2 items', () => {
    expect(calculateComboDiscount(2)).toBe(5)
  })

  it('10% for 3-4 items', () => {
    expect(calculateComboDiscount(3)).toBe(10)
    expect(calculateComboDiscount(4)).toBe(10)
  })

  it('20% for 5+ items', () => {
    expect(calculateComboDiscount(5)).toBe(20)
    expect(calculateComboDiscount(10)).toBe(20)
  })
})

describe('getLocalISODate', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(getLocalISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

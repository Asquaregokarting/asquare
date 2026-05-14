import { describe, it, expect } from 'vitest'
import { deriveVendorIds, nowIso, toOptionalString, stripUndefined } from './firestore-utils'

describe('nowIso', () => {
  it('returns ISO 8601 string', () => {
    const result = nowIso()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('is parseable as Date', () => {
    const d = new Date(nowIso())
    expect(d.getTime()).not.toBeNaN()
  })
})

describe('toOptionalString', () => {
  it('returns trimmed string for valid input', () => {
    expect(toOptionalString('  hello  ')).toBe('hello')
  })

  it('returns undefined for empty string', () => {
    expect(toOptionalString('')).toBeUndefined()
  })

  it('returns undefined for whitespace-only', () => {
    expect(toOptionalString('   ')).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(toOptionalString(null)).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(toOptionalString(undefined)).toBeUndefined()
  })

  it('converts number to string', () => {
    expect(toOptionalString(42)).toBe('42')
  })

  it('converts boolean to string', () => {
    expect(toOptionalString(true)).toBe('true')
  })
})

describe('stripUndefined', () => {
  it('removes undefined values', () => {
    const result = stripUndefined({ a: 1, b: undefined, c: 'x' })
    expect(result).toEqual({ a: 1, c: 'x' })
    expect('b' in result).toBe(false)
  })

  it('keeps null values', () => {
    const result = stripUndefined({ a: null, b: 0, c: false })
    expect(result).toEqual({ a: null, b: 0, c: false })
  })

  it('keeps empty strings', () => {
    const result = stripUndefined({ a: '', b: undefined })
    expect(result).toEqual({ a: '' })
  })

  it('handles empty object', () => {
    expect(stripUndefined({})).toEqual({})
  })

  it('handles all undefined values', () => {
    const result = stripUndefined({ a: undefined, b: undefined })
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('deriveVendorIds', () => {
  it('returns unique vendor ids from items', () => {
    const ids = deriveVendorIds([
      { vendorId: '7777997226' },
      { vendorId: '7569859456' },
      { vendorId: '7777997226' },
    ])
    expect(ids.sort()).toEqual(['7569859456', '7777997226'])
  })

  it('skips items without a vendorId (company-only line)', () => {
    const ids = deriveVendorIds([
      { vendorId: '7777997226' },
      { vendorId: undefined },
      { vendorId: null },
      { vendorId: '' },
      { vendorId: '   ' },
    ])
    expect(ids).toEqual(['7777997226'])
  })

  it('trims whitespace before deduping', () => {
    const ids = deriveVendorIds([{ vendorId: ' 123 ' }, { vendorId: '123' }])
    expect(ids).toEqual(['123'])
  })

  it('returns empty array for null/undefined/non-array input', () => {
    expect(deriveVendorIds(null)).toEqual([])
    expect(deriveVendorIds(undefined)).toEqual([])
    expect(deriveVendorIds([])).toEqual([])
  })

  it('tolerates null entries inside the array', () => {
    const ids = deriveVendorIds([null, undefined, { vendorId: '7777997226' }])
    expect(ids).toEqual(['7777997226'])
  })
})

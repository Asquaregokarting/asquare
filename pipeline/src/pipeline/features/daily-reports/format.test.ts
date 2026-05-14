import { describe, expect, it } from 'vitest'
import {
  fmtDiscrepancy,
  fmtDuration,
  fmtRelative,
  fmtRupees,
  fmtRupeesDecimal,
  fmtShortDate,
  fmtTime,
} from './format'

describe('daily-reports/format', () => {
  it('formats rupees in Indian grouping', () => {
    expect(fmtRupees(0)).toBe('₹0')
    expect(fmtRupees(1234)).toBe('₹1,234')
    expect(fmtRupees(184250)).toBe('₹1,84,250')
    expect(fmtRupees(10_000_000)).toBe('₹1,00,00,000')
  })

  it('rounds rupees and accepts negative input', () => {
    expect(fmtRupees(123.6)).toBe('₹124')
    expect(fmtRupees(-2840)).toBe('₹-2,840')
  })

  it('preserves two decimals in fmtRupeesDecimal', () => {
    expect(fmtRupeesDecimal(1000)).toBe('₹1,000.00')
    expect(fmtRupeesDecimal(1234.567)).toBe('₹1,234.57')
  })

  it('formats discrepancy with sign + tone', () => {
    expect(fmtDiscrepancy(0)).toEqual({ text: '₹0', tone: 'settled' })
    expect(fmtDiscrepancy(450)).toEqual({ text: '▲ +₹450', tone: 'excess' })
    expect(fmtDiscrepancy(-2840)).toEqual({ text: '▼ −₹2,840', tone: 'shortage' })
  })

  it('uses U+2212 minus for shortage (color-blind safe sign)', () => {
    const result = fmtDiscrepancy(-100)
    expect(result.text).toContain('−') // U+2212
    expect(result.text).not.toContain('-') // hyphen-minus
  })

  it('returns "—" for invalid duration ranges', () => {
    expect(fmtDuration('not-a-date')).toBe('—')
    expect(fmtDuration('2026-05-01T10:00:00Z', '2026-05-01T09:00:00Z')).toBe('—')
  })

  it('formats duration cleanly', () => {
    expect(fmtDuration('2026-05-01T10:00:00Z', '2026-05-01T11:42:00Z')).toBe('1h 42m')
    expect(fmtDuration('2026-05-01T10:00:00Z', '2026-05-01T10:30:00Z')).toBe('30m')
    expect(fmtDuration('2026-05-01T10:00:00Z', '2026-05-01T13:00:00Z')).toBe('3h')
  })

  it('formats time with 12-hour locale', () => {
    expect(fmtTime(undefined)).toBe('—')
    expect(fmtTime('not-a-date')).toBe('—')
    const result = fmtTime('2026-05-01T15:14:00Z')
    // Locale string is environment-dependent for tz offset, so just smoke
    // test that we got a non-empty time-like string with am/pm or 24h digit.
    expect(result).toMatch(/\d/) // contains a digit
  })

  it('formats short and long dates without crashing on bad input', () => {
    expect(fmtShortDate('not-a-date')).toBe('not-a-date')
    expect(fmtShortDate('2026-05-05')).toMatch(/May/)
  })

  it('formats relative time labels', () => {
    const justNow = new Date(Date.now() - 30_000).toISOString()
    expect(fmtRelative(justNow)).toBe('just now')

    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(fmtRelative(fiveMinAgo)).toBe('5m ago')

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    expect(fmtRelative(twoHoursAgo)).toBe('2h ago')

    const yesterday = new Date(Date.now() - 24 * 60 * 60_000 - 60_000).toISOString()
    expect(fmtRelative(yesterday)).toBe('yesterday')
  })
})

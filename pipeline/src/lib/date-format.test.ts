import { describe, it, expect } from 'vitest'
import {
  fmtDateTimeFullIST,
  fmtDateIST,
  fmtTimeFullIST,
  fmtTimeShortIST,
  fmtDateTimeReportIST,
  todayISTStr,
} from './date-format'

// Fixed UTC date: 2026-03-28T00:00:00Z = 2026-03-28 05:30:00 AM IST
const TEST_DATE = new Date('2026-03-28T00:00:00Z')

describe('fmtDateTimeFullIST', () => {
  it('formats Date in IST with full datetime', () => {
    const r = fmtDateTimeFullIST(TEST_DATE)
    expect(r).toContain('28/03/2026')
    expect(r).toMatch(/AM|PM/)
  })

  it('formats ISO string', () => {
    expect(fmtDateTimeFullIST('2026-03-28T00:00:00Z')).toContain('28/03/2026')
  })

  it('formats Firestore Timestamp-like object', () => {
    expect(fmtDateTimeFullIST({ toDate: () => TEST_DATE })).toContain('28/03/2026')
  })

  it('returns dash for null', () => {
    expect(fmtDateTimeFullIST(null)).toBe('-')
  })

  it('returns dash for undefined', () => {
    expect(fmtDateTimeFullIST(undefined)).toBe('-')
  })

  it('returns dash for invalid string', () => {
    expect(fmtDateTimeFullIST('not-a-date')).toBe('-')
  })
})

describe('fmtDateIST', () => {
  it('formats as DD/MM/YYYY', () => {
    expect(fmtDateIST(TEST_DATE)).toBe('28/03/2026')
  })

  it('formats ISO string', () => {
    expect(fmtDateIST('2026-01-15T10:00:00Z')).toBe('15/01/2026')
  })

  it('returns dash for null', () => {
    expect(fmtDateIST(null)).toBe('-')
  })

  it('returns dash for undefined', () => {
    expect(fmtDateIST(undefined)).toBe('-')
  })
})

describe('fmtTimeFullIST', () => {
  it('formats time with seconds and period', () => {
    expect(fmtTimeFullIST(TEST_DATE)).toMatch(/\d{2}:\d{2}:\d{2}\s(AM|PM)/)
  })

  it('returns dash for null', () => {
    expect(fmtTimeFullIST(null)).toBe('-')
  })
})

describe('fmtTimeShortIST', () => {
  it('formats time without seconds', () => {
    expect(fmtTimeShortIST(TEST_DATE)).toMatch(/\d{2}:\d{2}\s(AM|PM)/)
  })

  it('returns dash for null', () => {
    expect(fmtTimeShortIST(null)).toBe('-')
  })
})

describe('fmtDateTimeReportIST', () => {
  it('formats with dashes for reports', () => {
    const r = fmtDateTimeReportIST(TEST_DATE)
    expect(r).toContain('28-03-2026')
    expect(r).toMatch(/AM|PM/)
  })

  it('returns dash for null', () => {
    expect(fmtDateTimeReportIST(null)).toBe('-')
  })
})

describe('todayISTStr', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayISTStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

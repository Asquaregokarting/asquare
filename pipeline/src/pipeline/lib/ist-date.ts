/**
 * IST (India Standard Time — Asia/Kolkata) date utilities.
 *
 * All Billing & Accounting date calculations and display formatting
 * go through this module so timestamps are always IST-consistent,
 * regardless of the user's browser timezone.
 *
 * Storage timestamps remain UTC (via nowIso()); this module handles
 * the calculation and display layer only.
 */

const IST_TZ = 'Asia/Kolkata'

// ── Core helpers ────────────────────────────────────────────────────────────

/** Return true if d is a valid, finite Date. */
const isValidDate = (d: Date): boolean => d instanceof Date && !isNaN(d.getTime())

/** Extract date/time parts from a Date rendered in IST. */
const istParts = (date: Date, options: Intl.DateTimeFormatOptions): ((type: string) => string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    ...options,
  }).formatToParts(date)
  return (type: string) => parts.find((p) => p.type === type)?.value ?? ''
}

// ── Date string conversion ──────────────────────────────────────────────────

/** Returns YYYY-MM-DD in IST for the given (or current) instant. Returns "" for invalid dates. */
export const toISTDateStr = (date: Date = new Date()): string => {
  if (!isValidDate(date)) return ''
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `${g('year')}-${g('month')}-${g('day')}`
}

/** Returns YYYY-MM-DDTHH:mm in IST — suitable for `<input type="datetime-local">`. Returns "" for invalid dates. */
export const toISTDateTimeStr = (date: Date = new Date()): string => {
  if (!isValidDate(date)) return ''
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** Returns today's date as YYYY-MM-DD in IST. */
export const todayIST = (): string => toISTDateStr(new Date())

/**
 * Add `days` to a YYYY-MM-DD string and return the result in the same
 * format. Pure calendar arithmetic — independent of the browser's
 * timezone — so adding 1 to "2026-05-10" always returns "2026-05-11"
 * whether the user is in IST, UTC, or PT. Negative offsets work too
 * for "yesterday" / "last week" lookups.
 */
export const addDaysIST = (ymd: string, days: number): string => {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymd
  const [y, m, d] = parts
  const ts = Date.UTC(y, m - 1, d) + days * 86_400_000
  const dt = new Date(ts)
  if (!isValidDate(dt)) return ymd
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Returns IST date+time parts as individual strings.
 * Useful for invoice-number generation or other composite IDs.
 */
export const istDateTimeParts = (
  date: Date = new Date(),
): { year: string; month: string; day: string; hour: string; minute: string; second: string } => {
  if (!isValidDate(date)) return { year: '', month: '', day: '', hour: '', minute: '', second: '' }
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return {
    year: g('year'),
    month: g('month'),
    day: g('day'),
    hour: g('hour'),
    minute: g('minute'),
    second: g('second'),
  }
}

// ── Display formatters (delegated to shared module) ─────────────────────────

import { fmtDateIST, fmtDateTimeFullIST, fmtTimeShortIST } from '../../lib/date-format'

/** Format ISO string → date in IST: "DD/MM/YYYY" */
export const fmtDateShortIST = (iso: string): string => fmtDateIST(iso)

/** Format ISO string → date+time in IST: "DD/MM/YYYY, hh:mm:ss AM/PM" */
export const fmtDateTimeIST = (iso: string): string => fmtDateTimeFullIST(iso)

/** Format ISO string → time only in IST: "hh:mm AM/PM" */
export const fmtTimeIST = (iso: string): string => fmtTimeShortIST(iso)

/** Format ISO string → date in IST: "DD/MM/YYYY" */
export const fmtDateFullIST = (iso: string): string => fmtDateIST(iso)

/**
 * Centralized date/time display formatters — IST (Asia/Kolkata).
 *
 * Standard format: DD/MM/YYYY, hh:mm:ss AM/PM
 *
 * All display dates in both Customer App and Pipeline Admin
 * must go through this module so timestamps are always IST-consistent,
 * regardless of the user's browser timezone.
 *
 * Storage timestamps remain UTC (via nowIso()); this module handles
 * the display layer only.
 */

const IST_TZ = 'Asia/Kolkata'

type DateLike = Date | string | { toDate: () => Date } | undefined | null

/** Resolve any date-like value to a Date object. Returns null if invalid. */
const resolveDate = (value: DateLike): Date | null => {
  if (!value) return null
  try {
    const date =
      typeof value === 'string'
        ? new Date(value)
        : typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
          ? value.toDate()
          : (value as Date)
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}

/** Extract date/time parts from a Date rendered in IST. */
const istParts = (date: Date, options: Intl.DateTimeFormatOptions): ((type: string) => string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    ...options,
  }).formatToParts(date)
  return (type: string) => parts.find((p) => p.type === type)?.value ?? ''
}

/**
 * Full standard format: DD/MM/YYYY, hh:mm:ss AM/PM
 * Example: "28/03/2026, 05:30:00 AM"
 */
export const fmtDateTimeFullIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  return `${g('day')}/${g('month')}/${g('year')}, ${g('hour')}:${g('minute')}:${g('second')} ${g('dayPeriod').toUpperCase()}`
}

/**
 * Date-only format: DD/MM/YYYY
 * Example: "28/03/2026"
 */
export const fmtDateIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `${g('day')}/${g('month')}/${g('year')}`
}

/**
 * Time with seconds: hh:mm:ss AM/PM
 * Example: "05:30:00 AM"
 */
export const fmtTimeFullIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  return `${g('hour')}:${g('minute')}:${g('second')} ${g('dayPeriod').toUpperCase()}`
}

/**
 * Time without seconds: hh:mm AM/PM
 * Example: "05:30 AM"
 */
export const fmtTimeShortIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return `${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`
}

/**
 * Reports → Game Revenue display format: DD-MM-YYYY, hh:mm AM/PM (IST).
 * Distinct from fmtDateTimeFullIST (which uses slashes and includes seconds).
 * Example: "08-04-2026, 05:30 PM"
 */
export const fmtDateTimeReportIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
  return `${g('day')}-${g('month')}-${g('year')}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`
}

/**
 * Reports → Game Revenue date-only format: DD-MM-YYYY (IST).
 * For legacy date-only strings (YYYY-MM-DD) where there's no real time component.
 */
export const fmtDateReportIST = (value: DateLike): string => {
  const date = resolveDate(value)
  if (!date) return '-'
  const g = istParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `${g('day')}-${g('month')}-${g('year')}`
}

/**
 * `YYYY-MM-DD` (no time component). When a string in this shape is parsed
 * with `new Date(...)`, JS treats it as UTC midnight, which renders as
 * `05:30:00 AM` in IST. The smart formatters below detect this case and
 * render the date alone instead of inventing a fake time.
 */
const isDateOnlyString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * Smart full datetime formatter. Same as fmtDateTimeFullIST, except a bare
 * `YYYY-MM-DD` string falls back to date-only output (avoids the spurious
 * "05:30:00 AM" when the source has no time component).
 */
export const fmtSmartDateTimeIST = (value: DateLike): string => {
  if (isDateOnlyString(value)) return fmtDateIST(value)
  return fmtDateTimeFullIST(value)
}

/**
 * Smart report datetime formatter — same fallback rule as above, but emits
 * the DD-MM-YYYY style used by Game Revenue / accounting reports.
 */
export const fmtSmartDateTimeReportIST = (value: DateLike): string => {
  if (isDateOnlyString(value)) return fmtDateReportIST(value)
  return fmtDateTimeReportIST(value)
}

/**
 * Friendly long date for customer-facing contexts: "Sunday, 28 Mar"
 */
export const fmtDateLongIST = (value: DateLike): string => {
  if (!value) return 'Select Date'
  const date = resolveDate(value)
  if (!date) return 'Invalid Date'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(date)
}

/**
 * Returns today's date as YYYY-MM-DD in IST.
 * Use for date inputs, Firestore queries, and date computations.
 */
export const todayISTStr = (): string => {
  const g = istParts(new Date(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return `${g('year')}-${g('month')}-${g('day')}`
}

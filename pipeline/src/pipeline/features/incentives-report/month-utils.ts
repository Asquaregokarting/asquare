import { getWeekKey } from '../cashier-incentives/week-utils'

export const monthBounds = (monthKey: string): { fromDate: string; toDate: string } => {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  }
}

export const currentMonthKeyIST = (): string => {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const ist = new Date(utcMs + 5.5 * 60 * 60_000)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Returns the unique Sat→Fri week keys whose date range touches the given
 * calendar month. We walk day-by-day from the day before month-start to the
 * day after month-end so any week that overlaps the month boundary is captured.
 */
export const weekKeysOverlappingMonth = (monthKey: string): string[] => {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const seen = new Set<string>()
  for (let day = 0; day <= lastDay + 1; day++) {
    const d = new Date(Date.UTC(y, m - 1, day))
    seen.add(getWeekKey(d))
  }
  return Array.from(seen)
}

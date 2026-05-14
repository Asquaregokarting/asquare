/**
 * Week-key utilities for the Sat → Fri incentive week.
 *
 * The incentive week runs Saturday (start) through Friday (end).
 * Week keys follow "YYYY-WNN" format where NN is derived from the
 * Saturday that starts the week.
 */

const IST_TZ = 'Asia/Kolkata'

/** Get IST year/month/day/dayOfWeek for a Date. */
function istComponents(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))

  // JS weekday from Intl: Sun=0 … Sat=6
  const weekdayStr = get('weekday') // "Sun", "Mon", …, "Sat"
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const jsDay = dayMap[weekdayStr] ?? 0

  return { year, month, day, jsDay }
}

/**
 * Returns the Saturday that starts the Sat→Fri week containing the given IST date.
 * Maps JS day-of-week to a Sat-based offset:
 *   Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6
 */
function getWeekStartDate(date: Date): Date {
  const { year, month, day, jsDay } = istComponents(date)

  // Sat-based offset: how many days since the most recent Saturday
  const satOffset = jsDay === 6 ? 0 : jsDay + 1

  // Build a Date at IST midnight for the Saturday
  const satDate = new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`,
  )
  satDate.setDate(satDate.getDate() - satOffset)
  return satDate
}

/** Compute ISO week number for a given date (ISO 8601: week starts Monday). */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Returns the week key for a given Date in IST.
 * Format: "YYYY-WNN" based on the Saturday that starts the week.
 */
export function getWeekKey(date: Date = new Date()): string {
  const satDate = getWeekStartDate(date)
  const { year } = istComponents(satDate)
  const weekNum = isoWeekNumber(satDate)
  return `${year}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Returns the start (Saturday) and end (Friday) dates for a week key.
 * @returns { weekStart: "YYYY-MM-DD", weekEnd: "YYYY-MM-DD" }
 */
export function getWeekDateRange(weekKey: string): { weekStart: string; weekEnd: string } {
  // Parse "YYYY-WNN"
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/)
  if (!match) throw new Error(`Invalid weekKey: ${weekKey}`)

  const year = Number(match[1])
  const week = Number(match[2])

  // ISO week: find the Monday of that ISO week, then go back 2 days to get Saturday
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7 // Mon=1 … Sun=7
  const isoWeek1Monday = new Date(jan4)
  isoWeek1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1)

  const targetMonday = new Date(isoWeek1Monday)
  targetMonday.setUTCDate(isoWeek1Monday.getUTCDate() + (week - 1) * 7)

  // Saturday = Monday - 2 days
  const saturday = new Date(targetMonday)
  saturday.setUTCDate(targetMonday.getUTCDate() - 2)

  // Friday = Saturday + 6 days
  const friday = new Date(saturday)
  friday.setUTCDate(saturday.getUTCDate() + 6)

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

  return { weekStart: fmt(saturday), weekEnd: fmt(friday) }
}

/** Returns the current week key based on IST now. */
export function getCurrentWeekKey(): string {
  return getWeekKey(new Date())
}

/** Returns today's date string in IST (YYYY-MM-DD). */
export function todayIST(): string {
  const { year, month, day } = istComponents(new Date())
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

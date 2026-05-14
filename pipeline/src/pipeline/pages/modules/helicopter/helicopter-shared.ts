import { getAllLocations } from '../../../../lib/locations'
import type { HelicopterBookingView } from '../../../api/types'

export const currency = (value: number): string =>
  `INR ${Math.round(value || 0).toLocaleString('en-IN')}`

export const todayIst = (): string => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

export const branchOptions = () =>
  getAllLocations().map((l) => ({ value: l.branchId, label: l.displayName }))

export const branchNameFromId = (branchId: string): string => {
  const match = getAllLocations().find((l) => l.branchId === branchId)
  return match?.displayName ?? branchId
}

export const sumWeightKg = (booking: HelicopterBookingView): number => booking.totalWeightKg

export const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  const yy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export const nextNDates = (n: number, start: string = todayIst()): string[] => {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(addDaysIso(start, i))
  return out
}

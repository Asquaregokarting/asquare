import type { LeadStatus, LeadScoreLabel } from '../../api/types'
import { ALLOWED_TRANSITIONS } from './lead-constants'

/** Normalize phone to 10-digit Indian number. Strips +91, 0, spaces, dashes. */
export const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  if (digits.length === 10) return digits
  return digits.slice(-10)
}

/** Format phone for display: 98765 43210 */
export const formatPhone = (phone: string): string => {
  const d = normalizePhone(phone)
  if (d.length !== 10) return phone
  return `${d.slice(0, 5)} ${d.slice(5)}`
}

/** Check if a status transition is allowed. */
export const isTransitionAllowed = (
  from: LeadStatus,
  to: LeadStatus,
  isAdmin: boolean,
): boolean => {
  if (from === to) return false
  // Admin can reopen lost leads
  if (from === 'lost' && to === 'new' && isAdmin) return true
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** Derive score label from numeric score. */
export const getScoreLabel = (score: number, hotMin = 70, warmMin = 40): LeadScoreLabel => {
  if (score >= hotMin) return 'hot'
  if (score >= warmMin) return 'warm'
  return 'cold'
}

/** Format INR currency. */
export const formatINR = (amount: number): string =>
  `INR ${Math.round(amount).toLocaleString('en-IN')}`

/** Days between a date string and now (clamped at 0 — for staleness math, not display). */
export const daysSince = (isoDate: string): number => {
  const diff = Date.now() - new Date(isoDate).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

/** Hours between a date string and now (clamped at 0 — for staleness math, not display). */
export const hoursSince = (isoDate: string): number => {
  const diff = Date.now() - new Date(isoDate).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60)))
}

/**
 * Format relative time, granular and bidirectional.
 * Past: "just now", "42s ago", "12m ago", "3h ago", "2d ago", "3w ago", "5mo ago", "2y ago"
 * Future: "in 42s", "in 12m", "in 3h", "in 2d", "in 3w", "in 5mo", "in 2y"
 *
 * The previous version rounded everything sub-hour to "just now" and clamped
 * future-dated values to zero — so a 50-min-old lead read identically to a
 * 1-second-old lead, and a callback scheduled for tomorrow showed "just now".
 */
export const relativeTime = (isoDate: string): string => {
  const ms = Date.now() - new Date(isoDate).getTime()
  const future = ms < 0
  const abs = Math.abs(ms)
  const sec = Math.floor(abs / 1000)
  if (sec < 30) return 'just now'

  const wrap = (value: string): string => (future ? `in ${value}` : `${value} ago`)

  if (sec < 60) return wrap(`${sec}s`)
  const min = Math.floor(sec / 60)
  if (min < 60) return wrap(`${min}m`)
  const hours = Math.floor(min / 60)
  if (hours < 24) return wrap(`${hours}h`)
  const days = Math.floor(hours / 24)
  if (days < 7) return wrap(`${days}d`)
  if (days < 30) return wrap(`${Math.floor(days / 7)}w`)
  if (days < 365) return wrap(`${Math.floor(days / 30)}mo`)
  return wrap(`${Math.floor(days / 365)}y`)
}

/** Exact IST time for tooltips: "8 May 2026, 4:32 PM IST". */
export const formatExactTime = (isoDate: string): string => {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return ''
  const formatted = d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${formatted} IST`
}

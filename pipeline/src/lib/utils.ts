import { todayISTStr, fmtDateIST, fmtDateLongIST } from './date-format'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn-style className merger
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Get today's date as YYYY-MM-DD in IST
export function getLocalISODate(): string {
  return todayISTStr()
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Narrow `unknown` caught errors so call sites can read message/code without `any`.
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'string') return err || fallback
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message
    if (typeof msg === 'string') return msg || fallback
  }
  return fallback
}

export function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

// Haptic feedback utility
export function vibrate(pattern: number | number[] = 10) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern)
  }
}

// Format date in IST: DD/MM/YYYY
export function formatDate(date: Date | string, _options?: Intl.DateTimeFormatOptions): string {
  return fmtDateIST(date)
}

// Format date long in IST: Sunday, 15 Jan
export function formatDateLong(dateStr: string): string {
  return fmtDateLongIST(dateStr)
}

// Format time
export function formatTime(time: string): string {
  if (!time || !time.includes(':')) return time

  const parts = time.split(':')
  if (parts.length < 2) return time

  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)

  if (isNaN(hours) || isNaN(minutes)) return time

  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`
}

// Calculate countdown
export function getCountdown(targetDate: Date): {
  days: number
  hours: number
  minutes: number
  seconds: number
} {
  if (isNaN(targetDate.getTime())) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 }
  }

  const now = new Date().getTime()
  const target = targetDate.getTime()
  const diff = Math.max(0, target - now)

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  }
}

// Check if time is peak hours (weekends or 4PM-10PM)
export function isPeakHours(date: Date, time: string): boolean {
  const dayOfWeek = date.getDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  if (isWeekend) return true

  const [hours] = time.split(':').map(Number)
  return hours >= 16 && hours < 22
}

// Calculate discount percentage
export function calculateComboDiscount(itemCount: number): number {
  if (itemCount >= 5) return 20
  if (itemCount >= 3) return 10
  if (itemCount >= 2) return 5
  return 0
}

// Local storage helpers with expiry
export function setWithExpiry<T>(key: string, value: T, ttlMs: number): void {
  const item = {
    value,
    expiry: Date.now() + ttlMs,
  }
  localStorage.setItem(key, JSON.stringify(item))
}

export function getWithExpiry<T>(key: string): T | null {
  const itemStr = localStorage.getItem(key)
  if (!itemStr) return null

  try {
    const item = JSON.parse(itemStr)
    if (Date.now() > item.expiry) {
      localStorage.removeItem(key)
      return null
    }
    return item.value as T
  } catch {
    return null
  }
}

// Map location IDs to display names (delegates to centralized registry)
import { getLocationShortName } from './locations'

export function getLocationName(id: string | number): string {
  return getLocationShortName(String(id))
}

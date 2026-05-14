/**
 * Structured logger for the asquare app.
 *
 * Goals:
 * - Single facade for all logging so we can swap in Sentry / Crashlytics later
 *   without touching call sites.
 * - Suppress debug/info noise in production builds.
 * - Never serialize sensitive payloads (phone, OTP, payment objects) accidentally.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'  // or relative import
 *   logger.info('booking.created', { bookingId })
 *   logger.error('payment.failed', error, { orderId })
 *
 * To plug in Sentry or Crashlytics later, set the reporter via `setLogReporter`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  [key: string]: unknown
}

export interface LogReporter {
  capture(level: LogLevel, message: string, error?: unknown, context?: LogContext): void
}

const isProd = import.meta.env?.PROD === true

let externalReporter: LogReporter | null = null

export function setLogReporter(reporter: LogReporter | null): void {
  externalReporter = reporter
}

/**
 * Best-effort scrub of common sensitive keys before logging.
 * Not a security boundary - call sites should still avoid logging secrets.
 */
const SENSITIVE_KEYS = new Set([
  'phone',
  'phoneNumber',
  'otp',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'razorpayPaymentId',
  'razorpaySignature',
  'cardNumber',
  'cvv',
  'mobile',
  'contact',
  'contactNumber',
  'userPhone',
  'customerPhone',
  'razorpayOrderId',
  'secret',
  'apiKey',
  'pswd',
])

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  for (const s of SENSITIVE_KEYS) {
    if (lower === s.toLowerCase()) return true
  }
  return false
}

function scrub(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(scrub)
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? '[redacted]' : scrub(v)
  }
  return out
}

function scrubError(error: unknown): unknown {
  if (error === null || error === undefined) return error
  if (error instanceof Error) {
    const scrubbed = new Error(error.message)
    scrubbed.name = error.name
    scrubbed.stack = error.stack
    const extra = scrub(error) as Record<string, unknown>
    for (const [key, val] of Object.entries(extra)) {
      if (key !== 'message' && key !== 'name' && key !== 'stack') {
        ;(scrubbed as unknown as Record<string, unknown>)[key] = val
      }
    }
    return scrubbed
  }
  if (typeof error === 'object') return scrub(error)
  return error
}

function emit(level: LogLevel, message: string, error?: unknown, context?: LogContext): void {
  const safeContext = context ? (scrub(context) as LogContext) : undefined
  const safeError = error !== undefined ? scrubError(error) : undefined

  // Forward to external reporter (Sentry/Crashlytics) if installed.
  if (externalReporter) {
    try {
      externalReporter.capture(level, message, safeError, safeContext)
    } catch {
      // Reporter must never break the app.
    }
  }

  // Console output: suppress debug/info in production.
  if (isProd && (level === 'debug' || level === 'info')) return

  const args: unknown[] = [`[${level}] ${message}`]
  if (safeContext) args.push(safeContext)
  if (safeError !== undefined) args.push(safeError)

  switch (level) {
    case 'debug':
      console.debug(...args)
      break
    case 'info':
      console.info(...args)
      break
    case 'warn':
      console.warn(...args)
      break
    case 'error':
      console.error(...args)
      break
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    emit('debug', message, undefined, context)
  },
  info(message: string, context?: LogContext): void {
    emit('info', message, undefined, context)
  },
  warn(message: string, context?: LogContext): void {
    emit('warn', message, undefined, context)
  },
  error(message: string, error?: unknown, context?: LogContext): void {
    emit('error', message, error, context)
    // Record the last error for ticket auto-context capture. Dynamic import
    // avoids a circular static import between logger ↔ ticket-auto-context.
    import('../pipeline/api/ticket-auto-context')
      .then(({ recordLastError }) => {
        recordLastError(typeof message === 'string' ? message : String(message))
      })
      .catch(() => {
        /* dynamic import shouldn't fail; ignore if it does */
      })
  },
}

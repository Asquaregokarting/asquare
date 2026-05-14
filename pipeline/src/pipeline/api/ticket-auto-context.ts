import type { TicketAutoContext } from './types'

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'unknown'
const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'unknown'

let lastError: { message: string; at: string } | null = null

export function recordLastError(message: string): void {
  lastError = { message, at: new Date().toISOString() }
}

export function captureAutoContext(): TicketAutoContext {
  const ctx: TicketAutoContext = {
    appVersion: APP_VERSION,
    buildSha: BUILD_SHA,
  }
  if (typeof window !== 'undefined') {
    ctx.url = window.location.href
    ctx.userAgent = window.navigator.userAgent
  }
  if (lastError) {
    ctx.lastErrorMessage = lastError.message
    ctx.lastErrorAt = lastError.at
  }
  return ctx
}

import type { TicketStatus } from './types'

export interface TransitionContext {
  isReopen?: boolean // explicit reopen flow
  resolvedAt?: string | null // for the 48h reopen window
  now?: Date
}

export type TransitionResult = { ok: true } | { ok: false; reason: string }

export function validateStatusTransition(
  from: TicketStatus,
  to: TicketStatus,
  ctx: TransitionContext = {},
): TransitionResult {
  if (from === to) return { ok: false, reason: 'same status' }

  const legal: Record<TicketStatus, TicketStatus[]> = {
    Open: ['In Progress', 'Resolved', 'Closed'],
    'In Progress': ['Open', 'Resolved', 'Closed'],
    Resolved: ['Closed'],
    Closed: [],
  }

  if (legal[from].includes(to)) return { ok: true }

  // Reopen flow: Resolved → Open within 48h of resolvedAt
  if (from === 'Resolved' && to === 'Open' && ctx.isReopen) {
    if (!ctx.resolvedAt) return { ok: false, reason: 'resolvedAt unknown' }
    const resolvedMs = new Date(ctx.resolvedAt).getTime()
    const nowMs = (ctx.now ?? new Date()).getTime()
    const elapsed = nowMs - resolvedMs
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000
    if (elapsed > FORTY_EIGHT_HOURS) {
      return { ok: false, reason: 'reopen window expired (48h)' }
    }
    return { ok: true }
  }

  return { ok: false, reason: `${from} → ${to} not allowed` }
}

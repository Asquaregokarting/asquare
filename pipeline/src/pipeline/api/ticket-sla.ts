import type { TicketCategory, TicketSlaSnapshot } from './types'

export interface SlaResult {
  slaSnapshot: TicketSlaSnapshot
  responseDueAt: string | null
  resolveDueAt: string
}

export function computeSlaSnapshot(category: TicketCategory, now: Date = new Date()): SlaResult {
  const nowMs = now.getTime()
  const responseDueAt =
    category.responseSlaSeconds === null
      ? null
      : new Date(nowMs + category.responseSlaSeconds * 1000).toISOString()
  const resolveDueAt = new Date(nowMs + category.resolveSlaSeconds * 1000).toISOString()
  return {
    slaSnapshot: {
      responseSeconds: category.responseSlaSeconds,
      resolveSeconds: category.resolveSlaSeconds,
    },
    responseDueAt,
    resolveDueAt,
  }
}

import { describe, it, expect } from 'vitest'
import type { TicketCategory } from './types'
import { computeSlaSnapshot } from './ticket-sla'

const at = (iso: string): Date => new Date(iso)

const baseCat: TicketCategory = {
  id: 'x',
  label: 'X',
  priorityFloor: 'Normal',
  responseSlaSeconds: 3600,
  resolveSlaSeconds: 7200,
  routingChain: ['Incharge'],
  active: true,
  sortOrder: 0,
}

describe('computeSlaSnapshot', () => {
  it('computes both due-by timestamps from now + seconds', () => {
    const r = computeSlaSnapshot(baseCat, at('2026-04-27T10:00:00Z'))
    expect(r.responseDueAt).toBe('2026-04-27T11:00:00.000Z')
    expect(r.resolveDueAt).toBe('2026-04-27T12:00:00.000Z')
    expect(r.slaSnapshot).toEqual({ responseSeconds: 3600, resolveSeconds: 7200 })
  })

  it('returns responseDueAt = null when category has no response SLA', () => {
    const r = computeSlaSnapshot(
      { ...baseCat, responseSlaSeconds: null },
      at('2026-04-27T10:00:00Z'),
    )
    expect(r.responseDueAt).toBeNull()
    expect(r.slaSnapshot.responseSeconds).toBeNull()
  })
})

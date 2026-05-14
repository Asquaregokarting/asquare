import { describe, it, expect } from 'vitest'
import type { TicketCategory } from './types'
import { routeTicket, RoutingCandidate } from './ticket-routing'

const cat: TicketCategory = {
  id: 'billing-refund',
  label: 'Billing',
  priorityFloor: 'High',
  responseSlaSeconds: 3600,
  resolveSlaSeconds: 28800,
  routingChain: ['Cashier', 'Incharge', 'Admin'],
  active: true,
  sortOrder: 0,
}

const c = (over: Partial<RoutingCandidate>): RoutingCandidate => ({
  id: 'u',
  name: 'U',
  role: 'Cashier',
  branchId: 'vizag',
  active: true,
  lastAssignedAtMs: 0,
  ...over,
})

describe('routeTicket', () => {
  it('returns null when no candidates match the chain', () => {
    expect(routeTicket(cat, 'vizag', [c({ role: 'Editor' })])).toBeNull()
  })

  it('picks the first chain role with an active candidate at the branch', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'cashier-1', name: 'A' })])
    expect(r?.assigneeRole).toBe('Cashier')
    expect(r?.assigneeId).toBe('cashier-1')
    expect(r?.escalationChain).toEqual(['Incharge', 'Admin'])
  })

  it('round-robins by lastAssignedAtMs ascending, ties broken by id', () => {
    const r = routeTicket(cat, 'vizag', [
      c({ id: 'cashier-2', name: 'B', lastAssignedAtMs: 100 }),
      c({ id: 'cashier-1', name: 'A', lastAssignedAtMs: 50 }),
      c({ id: 'cashier-3', name: 'C', lastAssignedAtMs: 50 }),
    ])
    expect(r?.assigneeId).toBe('cashier-1')
  })

  it('falls back to next chain link when role is empty at branch', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'in-1', role: 'Incharge' })])
    expect(r?.assigneeRole).toBe('Incharge')
    expect(r?.escalationChain).toEqual(['Admin'])
  })

  it('falls back cross-branch when nobody at the branch is in the chain', () => {
    const r = routeTicket(cat, 'vizag', [c({ id: 'cashier-other', branchId: 'kakinada' })])
    expect(r?.assigneeId).toBe('cashier-other')
  })

  it('skips inactive users', () => {
    const r = routeTicket(cat, 'vizag', [
      c({ id: 'cashier-1', active: false }),
      c({ id: 'cashier-2' }),
    ])
    expect(r?.assigneeId).toBe('cashier-2')
  })
})

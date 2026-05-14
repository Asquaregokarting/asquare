import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildHistoryQueryConstraints,
  derivePresenceStatus,
  splitHistoryQueryForDisjunctionLimit,
} from './staff-presence-firestore'
import { normalizeLocationId } from '../../lib/locations'

// Capture what `where` is called with so we can assert constraint content (N3).
// The firebase mock returns {} for every where() call; we spy on those calls.
import * as firestore from 'firebase/firestore'

describe('derivePresenceStatus', () => {
  const now = new Date('2026-04-24T18:00:00Z').getTime()

  it('returns "online" when heartbeat is within 2 minutes', () => {
    const lastSeen = new Date(now - 60_000).toISOString() // 1m ago
    expect(derivePresenceStatus(lastSeen, now)).toBe('online')
  })

  it('returns "idle" when heartbeat is 2-5 minutes old', () => {
    const lastSeen = new Date(now - 3 * 60_000).toISOString() // 3m ago
    expect(derivePresenceStatus(lastSeen, now)).toBe('idle')
  })

  it('returns "offline" when heartbeat is older than 5 minutes', () => {
    const lastSeen = new Date(now - 6 * 60_000).toISOString()
    expect(derivePresenceStatus(lastSeen, now)).toBe('offline')
  })

  it('returns "offline" when lastSeenAt is missing or invalid', () => {
    expect(derivePresenceStatus('', now)).toBe('offline')
    expect(derivePresenceStatus('not-a-date', now)).toBe('offline')
  })
})

describe('buildHistoryQueryConstraints', () => {
  let whereSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Spy on the mocked where() so we can assert which field/op/value was passed.
    whereSpy = vi.spyOn(firestore, 'where')
  })

  it('returns a date-only constraint when no other filters', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
    })
    expect(constraints).toHaveLength(2)
  })

  it('adds role and branch filters when provided', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier'],
      branchIds: ['0'],
    })
    expect(constraints).toHaveLength(4)
  })

  it('uses `in` when multiple roles are requested', () => {
    const constraints = buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier', 'Telecaller'],
    })
    expect(constraints).toHaveLength(3) // fromDate, toDate, role-in
  })

  // N3 — constraint content: verify the correct fields, ops, and values are used.
  it('builds loginAt >= fromDate constraint with correct field and operator', () => {
    whereSpy.mockClear()
    buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
    })
    expect(whereSpy).toHaveBeenCalledWith('loginAt', '>=', '2026-04-20T00:00:00Z')
    expect(whereSpy).toHaveBeenCalledWith('loginAt', '<=', '2026-04-24T23:59:59Z')
  })

  it('builds role == filter for single role', () => {
    whereSpy.mockClear()
    buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier'],
    })
    expect(whereSpy).toHaveBeenCalledWith('role', '==', 'Cashier')
  })

  it('builds role in filter for multiple roles', () => {
    whereSpy.mockClear()
    buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      roles: ['Cashier', 'Telecaller'],
    })
    expect(whereSpy).toHaveBeenCalledWith('role', 'in', ['Cashier', 'Telecaller'])
  })

  it('builds branchId == filter for single branch', () => {
    whereSpy.mockClear()
    buildHistoryQueryConstraints({
      fromDateIso: '2026-04-20T00:00:00Z',
      toDateIso: '2026-04-24T23:59:59Z',
      branchIds: ['0'],
    })
    expect(whereSpy).toHaveBeenCalledWith('branchId', '==', '0')
  })
})

describe('splitHistoryQueryForDisjunctionLimit', () => {
  const baseInput = {
    fromDateIso: '2026-04-20T00:00:00Z',
    toDateIso: '2026-04-24T23:59:59Z',
  }

  it('returns the input unchanged when no `in` filter exists', () => {
    expect(splitHistoryQueryForDisjunctionLimit(baseInput)).toEqual([baseInput])
  })

  it('returns the input unchanged when product is at or under the limit', () => {
    const input = {
      ...baseInput,
      roles: ['Cashier' as const, 'Telecaller' as const],
      branchIds: ['0', '1', '2'],
    }
    expect(splitHistoryQueryForDisjunctionLimit(input, 30)).toEqual([input])
  })

  it('chunks the larger dimension when role × branch exceeds the limit', () => {
    const input = {
      ...baseInput,
      roles: [
        'Cashier' as const,
        'Telecaller' as const,
        'Incharge' as const,
        'TrackMarshall' as const,
      ],
      branchIds: ['0', '1', '2', '3', '4', '5', '6', '7'], // 4 × 8 = 32 > 30
    }
    const chunks = splitHistoryQueryForDisjunctionLimit(input, 30)
    // Branches (8) is the larger dimension, so we chunk branches with
    // chunkSize=floor(30/4)=7 → 2 chunks ([0..6], [7]). All 4 roles stay
    // in each chunk.
    expect(chunks.length).toBe(2)
    const allBranches = chunks.flatMap((c) => c.branchIds ?? [])
    expect(allBranches.sort()).toEqual([...input.branchIds].sort())
    for (const c of chunks) {
      expect(c.roles).toEqual(input.roles)
      expect((c.roles?.length ?? 1) * (c.branchIds?.length ?? 1)).toBeLessThanOrEqual(30)
    }
  })

  it('chunks by branch when branch is the larger dimension', () => {
    const input = {
      ...baseInput,
      roles: ['Cashier' as const, 'Telecaller' as const],
      branchIds: Array.from({ length: 40 }, (_, i) => `b${i}`), // single in > 30
    }
    const chunks = splitHistoryQueryForDisjunctionLimit(input, 30)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect((c.branchIds?.length ?? 1) * (c.roles?.length ?? 1)).toBeLessThanOrEqual(30)
      expect(c.roles).toEqual(input.roles)
    }
    const allBranches = chunks.flatMap((c) => c.branchIds ?? [])
    expect(allBranches.sort()).toEqual([...input.branchIds].sort())
  })
})

// C1 — slug→branchId normalization (the fix lives in auth-context, but we
// verify the normalizeLocationId function itself handles the slug correctly).
describe('normalizeLocationId (C1 slug→branchId)', () => {
  it('converts "visakhapatnam" slug to canonical branchId "0"', () => {
    expect(normalizeLocationId('visakhapatnam')).toBe('0')
  })

  it('converts "kakinada" slug to canonical branchId "1"', () => {
    expect(normalizeLocationId('kakinada')).toBe('1')
  })

  it('converts legacy alias "vizag" to canonical branchId "0"', () => {
    expect(normalizeLocationId('vizag')).toBe('0')
  })

  it('returns input unchanged for unknown values', () => {
    expect(normalizeLocationId('unknown-branch')).toBe('unknown-branch')
  })

  it('returns input unchanged for already-canonical branchIds', () => {
    expect(normalizeLocationId('0')).toBe('0')
    expect(normalizeLocationId('1')).toBe('1')
  })
})

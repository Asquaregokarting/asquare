import { describe, it, expect } from 'vitest'
import type { Ticket, TicketLinkedEntity } from './types'
import {
  aggregateByBranch,
  aggregateByCategory,
  computeMTTR,
  breachRate,
  heatmapMatrix,
  kartFailureReport,
  ticketsPerDay,
  mttrPerBranch,
  oldestUnresolved,
} from './ticket-analytics'

const baseTicket: Ticket = {
  id: 'TKT-1',
  schemaVersion: 2,
  title: 'sample',
  description: 'sample',
  categoryId: 'other',
  priority: 'Normal',
  tags: [],
  status: 'Open',
  role: 'Admin',
  raisedBy: 'u1',
  raisedByName: 'User One',
  raisedByKind: 'staff',
  branchId: 'vizag',
  branchDisplayName: 'Vizag',
  assignedTo: 'Developer',
  assigneeId: 'a1',
  assigneeRole: 'Admin',
  assigneeName: 'Assignee',
  watcherIds: [],
  attachments: [],
  linkedEntities: [],
  autoContext: {},
  slaSnapshot: null,
  responseDueAt: null,
  resolveDueAt: null,
  firstResponseAt: null,
  resolvedAt: null,
  resolutionNote: null,
  rootCauseTag: null,
  escalationLevel: 0,
  mergedInto: null,
  reopenedFrom: null,
  location: 'vizag',
  locationDisplayName: 'Vizag',
  issue: 'sample',
  assignedToId: 'a1',
  assignedToName: 'Assignee',
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
}

const t = (over: Partial<Ticket>): Ticket => ({ ...baseTicket, ...over })

describe('aggregateByBranch', () => {
  it('groups by branchId and sorts descending', () => {
    const result = aggregateByBranch([
      t({ id: '1', branchId: 'vizag', branchDisplayName: 'Vizag' }),
      t({ id: '2', branchId: 'vizag', branchDisplayName: 'Vizag' }),
      t({ id: '3', branchId: 'guntur', branchDisplayName: 'Guntur' }),
    ])
    expect(result).toEqual([
      { key: 'vizag', label: 'Vizag', count: 2 },
      { key: 'guntur', label: 'Guntur', count: 1 },
    ])
  })

  it('falls back to branchId when displayName is missing', () => {
    const result = aggregateByBranch([t({ branchId: 'kakinada', branchDisplayName: '' })])
    expect(result).toEqual([{ key: 'kakinada', label: 'kakinada', count: 1 }])
  })

  it('returns an empty list for no tickets', () => {
    expect(aggregateByBranch([])).toEqual([])
  })
})

describe('aggregateByCategory', () => {
  it('groups by categoryId', () => {
    const result = aggregateByCategory([
      t({ categoryId: 'track-safety' }),
      t({ categoryId: 'track-safety' }),
      t({ categoryId: 'billing-refund' }),
    ])
    expect(result[0]).toEqual({ key: 'track-safety', label: 'track-safety', count: 2 })
    expect(result[1]).toEqual({ key: 'billing-refund', label: 'billing-refund', count: 1 })
  })

  it('returns an empty list for no tickets', () => {
    expect(aggregateByCategory([])).toEqual([])
  })
})

describe('computeMTTR', () => {
  it('returns zeros when nothing is resolved', () => {
    expect(computeMTTR([t({ resolvedAt: null })])).toEqual({
      resolvedCount: 0,
      meanResolveSeconds: 0,
      medianResolveSeconds: 0,
    })
  })

  it('computes mean and median for one resolved ticket', () => {
    const result = computeMTTR([
      t({
        createdAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T11:00:00.000Z', // 1 hour
      }),
    ])
    expect(result.resolvedCount).toBe(1)
    expect(result.meanResolveSeconds).toBe(3600)
    expect(result.medianResolveSeconds).toBe(3600)
  })

  it('computes the median for an even count of resolved tickets', () => {
    const result = computeMTTR([
      t({
        id: 'a',
        createdAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T10:30:00.000Z', // 30 min = 1800s
      }),
      t({
        id: 'b',
        createdAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T11:00:00.000Z', // 1 hour = 3600s
      }),
    ])
    expect(result.resolvedCount).toBe(2)
    expect(result.meanResolveSeconds).toBe((1800 + 3600) / 2)
    expect(result.medianResolveSeconds).toBe((1800 + 3600) / 2)
  })

  it('drops non-positive durations', () => {
    expect(
      computeMTTR([
        t({
          createdAt: '2026-04-20T11:00:00.000Z',
          resolvedAt: '2026-04-20T10:00:00.000Z', // resolved before created (skew)
        }),
      ]),
    ).toEqual({ resolvedCount: 0, meanResolveSeconds: 0, medianResolveSeconds: 0 })
  })
})

describe('breachRate', () => {
  it('returns 0 when no tickets', () => {
    expect(breachRate([])).toBe(0)
  })

  it('flags resolved tickets that resolved after their due date', () => {
    const r = breachRate([
      t({
        resolveDueAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T11:00:00.000Z', // 1h late
      }),
    ])
    expect(r).toBe(1)
  })

  it('flags open tickets past their due date', () => {
    const r = breachRate([
      t({
        status: 'Open',
        resolveDueAt: '2020-01-01T00:00:00.000Z', // way in the past
        resolvedAt: null,
      }),
    ])
    expect(r).toBe(1)
  })

  it('does not flag closed tickets that never had a due date', () => {
    expect(breachRate([t({ status: 'Closed', resolveDueAt: null })])).toBe(0)
  })

  it('mixes breached and clean tickets correctly', () => {
    const r = breachRate([
      t({
        id: 'a',
        resolveDueAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T09:00:00.000Z', // on time
      }),
      t({
        id: 'b',
        resolveDueAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T11:00:00.000Z', // breach
      }),
    ])
    expect(r).toBe(0.5)
  })
})

describe('heatmapMatrix', () => {
  it('buckets by branch + category + IST hour', () => {
    // 04:30 UTC = 10:00 IST
    const cells = heatmapMatrix([
      t({
        branchId: 'vizag',
        categoryId: 'track-safety',
        createdAt: '2026-04-20T04:30:00.000Z',
      }),
      t({
        branchId: 'vizag',
        categoryId: 'track-safety',
        createdAt: '2026-04-20T04:45:00.000Z', // also 10 IST
      }),
      t({
        branchId: 'vizag',
        categoryId: 'track-safety',
        createdAt: '2026-04-20T05:30:00.000Z', // 11 IST
      }),
    ])
    const tenIst = cells.find((c) => c.hour === 10)
    const elevenIst = cells.find((c) => c.hour === 11)
    expect(tenIst?.count).toBe(2)
    expect(elevenIst?.count).toBe(1)
  })

  it('handles empty input', () => {
    expect(heatmapMatrix([])).toEqual([])
  })

  it('skips invalid timestamps', () => {
    expect(heatmapMatrix([t({ createdAt: 'not-a-date' })])).toEqual([])
  })
})

describe('kartFailureReport', () => {
  const kart = (id: string): TicketLinkedEntity => ({ type: 'kart', id, label: id })

  it('counts only track-safety tickets and aggregates per kart', () => {
    const result = kartFailureReport([
      t({
        id: 'a',
        categoryId: 'track-safety',
        linkedEntities: [kart('K-01')],
        createdAt: '2026-04-19T10:00:00.000Z',
      }),
      t({
        id: 'b',
        categoryId: 'track-safety',
        linkedEntities: [kart('K-01')],
        createdAt: '2026-04-20T10:00:00.000Z',
      }),
      t({
        id: 'c',
        categoryId: 'track-safety',
        linkedEntities: [kart('K-02')],
        createdAt: '2026-04-20T10:00:00.000Z',
      }),
      // Not a track-safety ticket — must be ignored.
      t({
        id: 'd',
        categoryId: 'billing-refund',
        linkedEntities: [kart('K-99')],
      }),
    ])
    expect(result).toEqual([
      { kartId: 'K-01', count: 2, lastIncidentAt: '2026-04-20T10:00:00.000Z' },
      { kartId: 'K-02', count: 1, lastIncidentAt: '2026-04-20T10:00:00.000Z' },
    ])
  })

  it('returns empty when there are no kart links', () => {
    expect(kartFailureReport([t({ categoryId: 'track-safety', linkedEntities: [] })])).toEqual([])
  })
})

describe('ticketsPerDay', () => {
  it('returns one bucket per requested day, oldest → newest', () => {
    const now = new Date('2026-04-22T05:00:00.000Z')
    const result = ticketsPerDay(
      [
        t({ createdAt: '2026-04-22T03:00:00.000Z' }),
        t({ createdAt: '2026-04-22T04:00:00.000Z' }),
        t({ createdAt: '2026-04-21T10:00:00.000Z' }),
      ],
      3,
      now,
    )
    expect(result).toEqual([
      { date: '2026-04-20', count: 0 },
      { date: '2026-04-21', count: 1 },
      { date: '2026-04-22', count: 2 },
    ])
  })

  it('returns empty when days = 0', () => {
    expect(ticketsPerDay([], 0)).toEqual([])
  })
})

describe('mttrPerBranch', () => {
  it('groups MTTR computation per branch', () => {
    const result = mttrPerBranch([
      t({
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        createdAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: '2026-04-20T11:00:00.000Z',
      }),
      t({
        branchId: 'guntur',
        branchDisplayName: 'Guntur',
        createdAt: '2026-04-20T10:00:00.000Z',
        resolvedAt: null,
      }),
    ])
    const vizag = result.find((r) => r.branchId === 'vizag')!
    const guntur = result.find((r) => r.branchId === 'guntur')!
    expect(vizag.mttr.resolvedCount).toBe(1)
    expect(vizag.mttr.meanResolveSeconds).toBe(3600)
    expect(guntur.mttr.resolvedCount).toBe(0)
  })

  it('returns empty for no tickets', () => {
    expect(mttrPerBranch([])).toEqual([])
  })
})

describe('oldestUnresolved', () => {
  it('returns the oldest open/in-progress ticket', () => {
    const result = oldestUnresolved([
      t({ id: 'a', status: 'Open', createdAt: '2026-04-20T10:00:00.000Z' }),
      t({ id: 'b', status: 'In Progress', createdAt: '2026-04-19T10:00:00.000Z' }),
      t({ id: 'c', status: 'Resolved', createdAt: '2026-04-18T10:00:00.000Z' }),
    ])
    expect(result?.id).toBe('b')
  })

  it('returns null when everything is resolved or closed', () => {
    expect(oldestUnresolved([t({ status: 'Resolved' }), t({ status: 'Closed' })])).toBeNull()
  })
})

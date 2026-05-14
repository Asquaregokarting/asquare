import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()

vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../lib/locations', () => ({
  branchIdToSlug: (id: string) => (id === '0' ? 'visakhapatnam' : id),
}))

import { getActiveEvent, listActiveEventsForLocation, getEventBySlug } from './eventService'

function makeFakeDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data }
}

describe('getActiveEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for empty results', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
    expect(await getActiveEvent('summer-splash')).toBeNull()
  })

  it('returns mapped event record when found', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-001', {
          title: 'Summer Splash',
          slug: 'summer-splash',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: ['visakhapatnam'],
          packages: [{ name: 'Basic' }],
          applicability: { showOnline: true, enableInBooking: true, enableInBilling: false },
        }),
      ],
    })
    const result = await getActiveEvent('summer-splash')
    expect(result).toBeTruthy()
    expect(result?.title).toBe('Summer Splash')
    expect(result?.id).toBe('evt-001')
    expect(result?.applicability.showOnline).toBe(true)
  })

  it('returns null if event has not started yet', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-002', {
          title: 'Future Event',
          slug: 'future',
          status: 'active',
          startDate: '2099-01-01',
          endDate: '2099-12-31',
          packages: [],
        }),
      ],
    })
    expect(await getActiveEvent('future')).toBeNull()
  })

  it('returns null if event has ended', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-003', {
          title: 'Past Event',
          slug: 'past',
          status: 'active',
          startDate: '2020-01-01',
          endDate: '2020-12-31',
          packages: [],
        }),
      ],
    })
    expect(await getActiveEvent('past')).toBeNull()
  })

  it('returns null on Firestore error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('permission-denied'))
    expect(await getActiveEvent('whatever')).toBeNull()
  })
})

describe('listActiveEventsForLocation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array for no events', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
    expect(await listActiveEventsForLocation('0')).toEqual([])
  })

  it('filters by showOnline applicability', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-1', {
          title: 'Online Event',
          slug: 'online',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: ['visakhapatnam'],
          packages: [{ name: 'Basic' }],
          applicability: { showOnline: true },
        }),
        makeFakeDoc('evt-2', {
          title: 'Hidden Event',
          slug: 'hidden',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: ['visakhapatnam'],
          packages: [{ name: 'Basic' }],
          applicability: { showOnline: false },
        }),
      ],
    })
    const results = await listActiveEventsForLocation('0')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Online Event')
  })

  it('filters by location keys', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-1', {
          title: 'Vizag Only',
          slug: 'vizag',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: ['visakhapatnam'],
          packages: [{ name: 'Basic' }],
          applicability: { showOnline: true },
        }),
        makeFakeDoc('evt-2', {
          title: 'Kakinada Only',
          slug: 'kkd',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: ['kakinada'],
          packages: [{ name: 'Basic' }],
          applicability: { showOnline: true },
        }),
      ],
    })
    // Location '0' maps to 'visakhapatnam'
    const results = await listActiveEventsForLocation('0')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Vizag Only')
  })

  it('filters out events with no games or packages', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-1', {
          title: 'No Content',
          slug: 'empty',
          status: 'active',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          locationKeys: [],
          packages: [],
          applicability: { showOnline: true },
        }),
      ],
    })
    expect(await listActiveEventsForLocation('0')).toEqual([])
  })

  it('returns empty on Firestore error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('network'))
    expect(await listActiveEventsForLocation('0')).toEqual([])
  })
})

describe('getEventBySlug', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for empty results', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] })
    expect(await getEventBySlug('nonexistent')).toBeNull()
  })

  it('returns event regardless of status', async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        makeFakeDoc('evt-ended', {
          title: 'Ended Event',
          slug: 'ended',
          status: 'ended',
          startDate: '2020-01-01',
          endDate: '2020-12-31',
          packages: [],
        }),
      ],
    })
    const result = await getEventBySlug('ended')
    expect(result).toBeTruthy()
    expect(result?.status).toBe('ended')
  })

  it('returns null on error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('fail'))
    expect(await getEventBySlug('test')).toBeNull()
  })
})

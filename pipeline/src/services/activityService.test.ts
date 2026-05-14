import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDocs = vi.fn()

vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../lib/platform', () => ({
  isPlatformAvailable: () => true,
}))
vi.mock('../pipeline/api/activities-firestore', () => ({
  listFirestoreActivityHierarchy: vi.fn(() => Promise.resolve([])),
}))

import { getGameTypes, getGames, getGameById, getHelicopterAvailableDates } from './activityService'

function makeActivityDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-001',
    data: () => ({
      Name: 'Go Karting Adult',
      Category: 'gokarting',
      Price: 500,
      Available: true,
      Description: 'Adult go-kart racing',
      GameTypeID: '2',
      platforms: ['web'],
      schedule: {},
      ...overrides,
    }),
  }
}

describe('getGameTypes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns categories from Firestore activities', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeActivityDoc({ Category: 'gokarting', GameTypeID: '2', Name: 'Go Karting Adult' }),
        makeActivityDoc({ Category: 'zipline', GameTypeID: '5', Name: 'Single Zipline' }),
      ],
    })
    const categories = await getGameTypes('0')
    expect(Array.isArray(categories)).toBe(true)
  })

  it('returns empty array on error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('offline'))
    const categories = await getGameTypes('0')
    expect(categories).toEqual([])
  })
})

describe('getGames', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns activities array', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [makeActivityDoc({ Name: 'Go Karting Adult', Price: 500 })],
    })
    const games = await getGames('0')
    expect(Array.isArray(games)).toBe(true)
  })

  it('returns empty array on error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('offline'))
    const games = await getGames('0')
    expect(games).toEqual([])
  })

  it('returns empty for no matching activities', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] })
    const games = await getGames('0')
    expect(games).toEqual([])
  })
})

describe('getGameById', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when activity not found', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] })
    const game = await getGameById('0', 'nonexistent')
    expect(game).toBeNull()
  })

  it('returns null on error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('offline'))
    const game = await getGameById('0', 'any')
    expect(game).toBeNull()
  })
})

describe('getHelicopterAvailableDates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns array of date strings', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [
        makeActivityDoc({
          Name: 'Helicopter Joy Ride',
          Category: 'helicopter',
          schedule: { '0': { dates: ['2026-05-01', '2026-05-02'] } },
        }),
      ],
    })
    const dates = await getHelicopterAvailableDates('0')
    expect(Array.isArray(dates)).toBe(true)
  })

  it('returns empty array on error', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('fail'))
    const dates = await getHelicopterAvailableDates('0')
    expect(dates).toEqual([])
  })

  it('returns empty when no helicopter activities', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] })
    const dates = await getHelicopterAvailableDates('0')
    expect(dates).toEqual([])
  })
})

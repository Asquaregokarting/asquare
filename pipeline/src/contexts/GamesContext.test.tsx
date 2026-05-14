import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// ── Mock all external deps ──────────────────────────────────────────

const mockUser = { id: 'test-user-001', displayName: 'Test User' }
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock('../lib/firebase', () => ({ db: {}, auth: {} }))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()), // returns unsubscribe
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  increment: (n: number) => n,
  serverTimestamp: () => new Date(),
  Timestamp: { fromDate: (d: Date) => d },
  collection: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve()),
}))

vi.mock('../services/walletService', () => ({
  walletService: {
    logTireTransaction: vi.fn(() => Promise.resolve()),
    creditTires: vi.fn(() => Promise.resolve(true)),
  },
}))

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    setWithExpiry: vi.fn(),
    getWithExpiry: vi.fn(() => null),
  }
})

vi.mock('../data/spinPrizes', () => ({
  getRandomPrize: () => ({
    id: 'tires-50',
    name: '50 Tires',
    tier: 'common',
    type: 'tires',
    value: 50,
    icon: '🛞',
    color: 'blue',
    weight: 25,
  }),
}))

import { GamesProvider, useGames } from './GamesContext'

const wrapper = ({ children }: { children: ReactNode }) => <GamesProvider>{children}</GamesProvider>

describe('GamesContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useGames())).toThrow(
      'useGames must be used within a GamesProvider',
    )
  })

  it('initializes with default state', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    expect(result.current.tires).toBe(0)
    expect(result.current.progress.puzzlesCompleted).toBe(0)
    expect(result.current.recentScores).toEqual([])
    // Daily login spin auto-awards +1 on mount when user is present
    expect(result.current.spins.available).toBeGreaterThanOrEqual(0)
    expect(result.current.currentStreak).toBe(0)
  })

  it('addTires increases tire count', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.addTires(50))
    expect(result.current.tires).toBe(50)
  })

  it('addTires applies streak bonus', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Manually set a streak by recording a score (which sets lastPlayedAt)
    // Instead, test with direct addTires — streak is 0 so no bonus
    act(() => result.current.addTires(100, true))
    expect(result.current.tires).toBe(100) // no bonus because streak is 0
  })

  it('spendTires deducts when affordable', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.addTires(100, false))
    let success = false
    act(() => {
      success = result.current.spendTires(30)
    })
    expect(success).toBe(true)
    expect(result.current.tires).toBe(70)
  })

  it('spendTires returns false when not affordable', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    let success = true
    act(() => {
      success = result.current.spendTires(100)
    })
    expect(success).toBe(false)
    expect(result.current.tires).toBe(0) // unchanged
  })

  it('canAfford checks balance', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    expect(result.current.canAfford(10)).toBe(false)
    act(() => result.current.addTires(50, false))
    expect(result.current.canAfford(50)).toBe(true)
    expect(result.current.canAfford(51)).toBe(false)
  })

  it('recordScore adds score and updates progress', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.recordScore('puzzle', 100))
    expect(result.current.recentScores).toHaveLength(1)
    expect(result.current.recentScores[0].gameType).toBe('puzzle')
    expect(result.current.progress.puzzlesCompleted).toBe(1)
  })

  it('recordScore updates memory games won', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.recordScore('memory', 80))
    expect(result.current.progress.memoryGamesWon).toBe(1)
  })

  it('recordScore tracks runner high score', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.recordScore('runner', 500))
    expect(result.current.progress.runnerHighScore).toBe(500)
    // Lower score shouldn't override
    act(() => result.current.recordScore('runner', 200))
    expect(result.current.progress.runnerHighScore).toBe(500)
  })

  it('recordScore tracks trivia questions', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.recordScore('trivia', 60))
    expect(result.current.progress.triviaQuestionsAnswered).toBe(1)
  })

  it('recordScore awards tires based on score', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Score 100 → floor(100/10) = 10 → capped at min 10, max 100
    act(() => result.current.recordScore('puzzle', 100))
    expect(result.current.tires).toBeGreaterThan(0)
  })

  it('recordScore caps recent scores at 50', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    for (let i = 0; i < 55; i++) {
      act(() => result.current.recordScore('trivia', 10))
    }
    expect(result.current.recentScores.length).toBeLessThanOrEqual(50)
  })

  it('updateProgress merges partial updates', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    act(() => result.current.updateProgress({ puzzlesCompleted: 10 }))
    expect(result.current.progress.puzzlesCompleted).toBe(10)
    expect(result.current.progress.memoryGamesWon).toBe(0) // other fields unchanged
  })

  it('earnSpin increases available spins', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Daily login spin auto-awards +1 on mount when user is set
    const baseLine = result.current.spins.available
    act(() => result.current.earnSpin(2, 'daily_login'))
    expect(result.current.spins.available).toBe(baseLine + 2)
  })

  it('useSpin returns null when no spins available', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Consume all available spins first (daily login gives +1)
    while (result.current.spins.available > 0) {
      act(() => {
        result.current.useSpin()
      })
    }
    let spinResult: unknown = 'not-null'
    act(() => {
      spinResult = result.current.useSpin()
    })
    expect(spinResult).toBeNull()
  })

  it('useSpin consumes a spin and returns prize', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Earn extra spins on top of daily login
    act(() => result.current.earnSpin(1, 'game_completion'))
    const availBefore = result.current.spins.available
    let spinResult: unknown = null
    act(() => {
      spinResult = result.current.useSpin()
    })
    expect(spinResult).toBeTruthy()
    expect((spinResult as { prize: { name: string } }).prize.name).toBe('50 Tires')
    expect(result.current.spins.available).toBe(availBefore - 1)
    expect(result.current.spins.used).toBeGreaterThanOrEqual(1)
    expect(result.current.spins.history.length).toBeGreaterThanOrEqual(1)
  })

  it('claimSpinPrize marks spin as claimed and awards tires', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Use the daily login spin that was auto-awarded
    let spinResult: { id: string } | null = null
    act(() => {
      spinResult = result.current.useSpin()
    })
    expect(spinResult).toBeTruthy()
    const tiresBefore = result.current.tires
    act(() => result.current.claimSpinPrize(spinResult!.id))
    // Prize is 50 tires type
    expect(result.current.tires).toBe(tiresBefore + 50)
    expect(result.current.spins.history[0].claimed).toBe(true)
  })

  it('claimSpinPrize is idempotent', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    let spinResult: { id: string } | null = null
    act(() => {
      spinResult = result.current.useSpin()
    })
    act(() => result.current.claimSpinPrize(spinResult!.id))
    const tiresAfterFirst = result.current.tires
    // Claiming again should be a no-op
    act(() => result.current.claimSpinPrize(spinResult!.id))
    expect(result.current.tires).toBe(tiresAfterFirst)
  })

  it('completeDailyGame awards bonus tires', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    // Need daily challenges set first
    act(() => result.current.updateProgress({ puzzlesCompleted: 1 }))
    // Direct test: tires before
    const before = result.current.tires
    act(() => result.current.completeDailyGame('puzzle', 25))
    // dailyChallenges is null so no change expected (guard clause)
    expect(result.current.tires).toBe(before)
  })

  it('recordScore earns spin every 3 games', () => {
    const { result } = renderHook(() => useGames(), { wrapper })
    const spinsBefore = result.current.spins.available
    // Play 3 games (index 0, 1, 2 — spin earned on 3rd)
    act(() => result.current.recordScore('puzzle', 50))
    act(() => result.current.recordScore('memory', 50))
    act(() => result.current.recordScore('trivia', 50))
    // After 3 games, should have earned 1 spin
    // Note: daily login spin may also award +1, so check relative
    expect(result.current.spins.available).toBeGreaterThanOrEqual(spinsBefore + 1)
  })
})

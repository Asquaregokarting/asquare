/**
 * Leaderboard service — aggregates user game scores into weekly / monthly /
 * all-time rankings. Lives outside of components per the dual-app rule
 * "no raw Firestore in components".
 *
 * Reads from the `leaderboards/runner` aggregate doc that is maintained by
 * the `onUserWriteSyncLeaderboard` Cloud Function trigger (see
 * `functions/triggers/on-user-write-leaderboard.js`). This is O(1) in
 * Firestore reads, regardless of user count.
 *
 * FALLBACK:
 *   If the aggregate doc does not exist yet (e.g. during the initial
 *   rollout window before the trigger has populated it), we fall back to
 *   the legacy full-collection scan. The fallback is cached by the
 *   existing in-memory cache below so the blast radius is contained.
 */

import { db } from '../lib/firebase'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { logger } from '../lib/logger'

export interface LeaderboardEntry {
  userId: string
  userName: string
  score: number
}

export interface RunnerLeaderboards {
  weekly: LeaderboardEntry[]
  monthly: LeaderboardEntry[]
  all: LeaderboardEntry[]
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const fn = (value as { toDate?: () => Date }).toDate
    if (typeof fn === 'function') return fn.call(value)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

// In-memory cache. Until the aggregate-doc refactor lands, this at least
// prevents the page-mount / tab-switch / focus-return storm of repeated
// full-collection scans. 3-minute TTL is a conservative freshness window
// (leaderboards don't need real-time accuracy).
const LEADERBOARD_TTL = 3 * 60 * 1000
let _leaderboardCache: { data: RunnerLeaderboards; timestamp: number } | null = null
let _leaderboardInflight: Promise<RunnerLeaderboards> | null = null

export const leaderboardService = {
  /**
   * Build runner-game leaderboards (weekly/monthly/all-time) from raw user
   * docs. Returns three already-sorted entry arrays — pages should not
   * post-process scores beyond rendering them.
   */
  async getRunnerLeaderboards(): Promise<RunnerLeaderboards> {
    if (_leaderboardCache && Date.now() - _leaderboardCache.timestamp < LEADERBOARD_TTL) {
      return _leaderboardCache.data
    }
    if (_leaderboardInflight) return _leaderboardInflight

    _leaderboardInflight = (async (): Promise<RunnerLeaderboards> => {
      try {
        const result = await buildLeaderboards()
        _leaderboardCache = { data: result, timestamp: Date.now() }
        return result
      } finally {
        _leaderboardInflight = null
      }
    })()
    return _leaderboardInflight
  },
}

/**
 * Preferred path: read the `leaderboards/runner` aggregate doc maintained
 * by the `onUserWriteSyncLeaderboard` Cloud Function trigger.
 * Returns null if the doc does not exist (triggering the legacy fallback).
 */
async function readAggregateDoc(): Promise<RunnerLeaderboards | null> {
  try {
    const snap = await getDoc(doc(db, 'leaderboards', 'runner'))
    if (!snap.exists()) return null
    const data = snap.data() as { entries?: Record<string, unknown> } | undefined
    const entriesObj = data?.entries
    if (!entriesObj || typeof entriesObj !== 'object') return null

    const now = new Date()
    const weeklyCutoff = new Date(now)
    weeklyCutoff.setDate(weeklyCutoff.getDate() - 7)
    const monthlyCutoff = new Date(now)
    monthlyCutoff.setDate(monthlyCutoff.getDate() - 30)

    const all: LeaderboardEntry[] = []
    const weekly: LeaderboardEntry[] = []
    const monthly: LeaderboardEntry[] = []

    for (const [userId, rawEntry] of Object.entries(entriesObj)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue
      const row = rawEntry as Record<string, unknown>

      const rawScore = row.score
      const parsedScore = typeof rawScore === 'number' ? rawScore : Number(rawScore)
      const score = Number.isFinite(parsedScore) ? Math.max(0, Math.floor(parsedScore)) : 0
      if (score <= 0) continue

      const userName = (typeof row.userName === 'string' && row.userName.trim()) || 'Player'
      const lastPlayedAt = toDate(row.lastPlayedAt)

      const entry: LeaderboardEntry = { userId, userName, score }
      all.push(entry)
      if (lastPlayedAt && lastPlayedAt >= weeklyCutoff) weekly.push(entry)
      if (lastPlayedAt && lastPlayedAt >= monthlyCutoff) monthly.push(entry)
    }

    const sortDesc = (a: LeaderboardEntry, b: LeaderboardEntry) => b.score - a.score
    all.sort(sortDesc)
    weekly.sort(sortDesc)
    monthly.sort(sortDesc)

    return { all, weekly, monthly }
  } catch (err) {
    logger.warn('leaderboard.aggregate_read_failed', { error: err })
    return null
  }
}

async function buildLeaderboards(): Promise<RunnerLeaderboards> {
  // Preferred: aggregate doc maintained by Cloud Function trigger.
  const fromAggregate = await readAggregateDoc()
  if (fromAggregate) return fromAggregate

  // Fallback: legacy full-collection scan. This keeps the page working
  // during the rollout window before the trigger has fully populated the
  // aggregate doc. Still cached by the outer TTL cache.
  try {
    const usersSnap = await getDocs(collection(db, 'users'))
    const now = new Date()
    const weeklyCutoff = new Date(now)
    weeklyCutoff.setDate(weeklyCutoff.getDate() - 7)
    const monthlyCutoff = new Date(now)
    monthlyCutoff.setDate(monthlyCutoff.getDate() - 30)

    const all: LeaderboardEntry[] = []
    const weekly: LeaderboardEntry[] = []
    const monthly: LeaderboardEntry[] = []

    usersSnap.docs.forEach((userDoc) => {
      const data = userDoc.data() as Record<string, unknown>
      const progress =
        typeof data.progress === 'object' && data.progress !== null
          ? (data.progress as Record<string, unknown>)
          : null

      const scoreRaw = progress?.runnerHighScore ?? data.runnerHighScore ?? 0
      const parsedScore = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw)
      const score = Number.isFinite(parsedScore) ? Math.max(0, Math.floor(parsedScore)) : 0
      if (score <= 0) return

      const displayName =
        (typeof data.displayName === 'string' && data.displayName.trim()) ||
        (typeof data.email === 'string' && data.email.trim()) ||
        (typeof data.phone === 'string' && data.phone.trim()) ||
        'Player'

      const lastPlayedAt =
        toDate(progress?.lastPlayedAt) ||
        toDate(data.lastPlayedAt) ||
        toDate(data.updatedAt) ||
        toDate(data.lastLoginAt)

      const entry: LeaderboardEntry = {
        userId: userDoc.id,
        userName: displayName,
        score,
      }

      all.push(entry)
      if (lastPlayedAt && lastPlayedAt >= weeklyCutoff) weekly.push(entry)
      if (lastPlayedAt && lastPlayedAt >= monthlyCutoff) monthly.push(entry)
    })

    return { all, weekly, monthly }
  } catch (err) {
    logger.error('leaderboard.fetch_failed', err)
    throw err
  }
}

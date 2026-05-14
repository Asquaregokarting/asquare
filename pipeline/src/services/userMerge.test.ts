/**
 * userMerge unit tests
 *
 * Exhaustive coverage for `pickCanonical` — the selection algorithm that
 * decides which duplicate user doc wins a merge. Wrong picks here directly
 * cause misattributed wallet balances, so every tier and edge case is locked
 * down.
 */

import { describe, it, expect } from 'vitest'
import {
  pickCanonical,
  normalizePhone,
  isFirebaseAuthUidShape,
  type CandidateUserDoc,
} from './userMerge'

const FIREBASE_UID = 'kAlCvaGMbSh4S70fIU40rkEg4903'
const FIREBASE_UID_2 = 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6'

function doc(partial: Partial<CandidateUserDoc> & { id: string }): CandidateUserDoc {
  return { phone: '9985590477', ...partial }
}

describe('normalizePhone', () => {
  it('strips non-digits and keeps last 10', () => {
    expect(normalizePhone('+91 9985590477')).toBe('9985590477')
    expect(normalizePhone('919985590477')).toBe('9985590477')
    expect(normalizePhone('  99855-90477 ')).toBe('9985590477')
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone(undefined)).toBe('')
    expect(normalizePhone('')).toBe('')
  })
})

describe('isFirebaseAuthUidShape', () => {
  it('accepts typical Firebase Auth UIDs', () => {
    expect(isFirebaseAuthUidShape(FIREBASE_UID)).toBe(true)
    expect(isFirebaseAuthUidShape(FIREBASE_UID_2)).toBe(true)
  })

  it('rejects legacy numeric ids', () => {
    expect(isFirebaseAuthUidShape('65697')).toBe(false)
    expect(isFirebaseAuthUidShape('9985590477')).toBe(false)
  })

  it('rejects known non-UID prefixes', () => {
    expect(isFirebaseAuthUidShape('offline_9985590477')).toBe(false)
    expect(isFirebaseAuthUidShape('guest-1712345678901')).toBe(false)
    expect(isFirebaseAuthUidShape('mock-user-id-123')).toBe(false)
    expect(isFirebaseAuthUidShape('member_9985590477')).toBe(false)
  })

  it('rejects custom slugs shorter than 20 chars', () => {
    expect(isFirebaseAuthUidShape('ironman')).toBe(false)
    expect(isFirebaseAuthUidShape('admin-1')).toBe(false)
  })

  it('rejects empty and garbage', () => {
    expect(isFirebaseAuthUidShape('')).toBe(false)
    expect(isFirebaseAuthUidShape('has spaces here too')).toBe(false)
  })
})

describe('pickCanonical', () => {
  describe('skip / error cases', () => {
    it('returns skip-no-customers on empty input', () => {
      const result = pickCanonical([])
      expect(result.kind).toBe('skip-no-customers')
    })

    it('returns skip-staff-only when every doc has a role', () => {
      const result = pickCanonical([
        doc({ id: 'ironman', role: 'Owner' }),
        doc({ id: 'admin-1', role: 'Admin' }),
      ])
      expect(result.kind).toBe('skip-staff-only')
    })

    it('returns error when a staff doc carries a wallet balance', () => {
      const result = pickCanonical([
        doc({ id: 'ironman', role: 'Owner', walletBalance: 500 }),
        doc({ id: FIREBASE_UID, walletBalance: 20 }),
      ])
      expect(result.kind).toBe('error-role-has-wallet')
      if (result.kind === 'error-role-has-wallet') {
        expect(result.offenders.map((o) => o.id)).toEqual(['ironman'])
      }
    })
  })

  describe('trivial cases', () => {
    it('single customer doc wins with no duplicates', () => {
      const only = doc({ id: FIREBASE_UID, walletBalance: 20 })
      const result = pickCanonical([only])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID)
        expect(result.duplicates).toEqual([])
      }
    })

    it('skips staff while promoting the lone customer', () => {
      const result = pickCanonical([
        doc({ id: 'ironman', role: 'Admin' }),
        doc({ id: FIREBASE_UID, walletBalance: 20 }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID)
        expect(result.duplicates).toEqual([])
      }
    })
  })

  describe('tier 1 — Firebase Auth UID wins', () => {
    it('picks the Firebase UID over legacy numeric and phone-id docs', () => {
      const result = pickCanonical([
        doc({ id: '65697', walletBalance: 5000 }),
        doc({ id: '9985590477' }),
        doc({ id: 'offline_9985590477' }),
        doc({
          id: FIREBASE_UID,
          walletBalance: 20,
          lastLoginAt: new Date('2026-04-01'),
        }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID)
        expect(result.duplicates.map((d) => d.id).sort()).toEqual([
          '65697',
          '9985590477',
          'offline_9985590477',
        ])
      }
    })

    it('picks the most-recent Firebase UID when user re-registered', () => {
      const older = doc({
        id: FIREBASE_UID,
        walletBalance: 100,
        lastLoginAt: new Date('2025-06-01'),
      })
      const newer = doc({
        id: FIREBASE_UID_2,
        walletBalance: 5,
        lastLoginAt: new Date('2026-03-15'),
      })
      const result = pickCanonical([older, newer])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID_2)
        expect(result.duplicates.map((d) => d.id)).toEqual([FIREBASE_UID])
      }
    })

    it('falls back through lastLoginAt → updatedAt → createdAt', () => {
      const onlyCreated = doc({
        id: FIREBASE_UID,
        createdAt: new Date('2025-01-01'),
      })
      const onlyUpdated = doc({
        id: FIREBASE_UID_2,
        updatedAt: new Date('2026-01-01'),
      })
      const result = pickCanonical([onlyCreated, onlyUpdated])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID_2)
      }
    })
  })

  describe('tier 2 — phone-as-id wins when no Firebase UID exists', () => {
    it('picks users/{cleanPhone} over legacy numeric and prefixed', () => {
      const result = pickCanonical([
        doc({ id: '65697', walletBalance: 5000 }),
        doc({
          id: '9985590477',
          updatedAt: new Date('2026-03-01'),
        }),
        doc({ id: 'offline_9985590477' }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe('9985590477')
        expect(result.duplicates.map((d) => d.id).sort()).toEqual(['65697', 'offline_9985590477'])
      }
    })

    it('phone-id only matches when doc id equals the normalized phone', () => {
      // '65697' is numeric but does not equal the normalized phone → tier 3
      const result = pickCanonical([
        doc({ id: '65697', walletBalance: 5000, phone: '9985590477' }),
        doc({ id: 'offline_9985590477' }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe('65697')
      }
    })
  })

  describe('tier 3 — richest wallet wins among legacy/offline/guest', () => {
    it('picks the doc with the highest wallet balance', () => {
      const result = pickCanonical([
        doc({ id: '65697', walletBalance: 5000 }),
        doc({ id: 'offline_9985590477', walletBalance: 10 }),
        doc({ id: 'guest-1712345678901', walletBalance: 0 }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe('65697')
        expect(result.duplicates).toHaveLength(2)
      }
    })

    it('breaks wallet tie by recency', () => {
      const result = pickCanonical([
        doc({
          id: '65697',
          walletBalance: 100,
          updatedAt: new Date('2024-01-01'),
        }),
        doc({
          id: 'offline_9985590477',
          walletBalance: 100,
          updatedAt: new Date('2026-01-01'),
        }),
      ])
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe('offline_9985590477')
      }
    })
  })

  describe('the real 9985590477 scenario', () => {
    it('picks the Firebase UID (website doc) and marks the other 4 for merge', () => {
      const docs = [
        doc({ id: '9985590477' }),
        doc({
          id: '65697',
          walletBalance: 5000,
          createdAt: new Date('2026-01-17'),
          updatedAt: new Date('2026-01-24'),
        }),
        doc({ id: 'ironman', role: undefined }),
        doc({
          id: FIREBASE_UID,
          walletBalance: 20,
          updatedAt: new Date('2026-03-29'),
        }),
        doc({
          id: 'offline_9985590477',
          createdAt: new Date('2026-04-04'),
        }),
      ]
      const result = pickCanonical(docs)
      expect(result.kind).toBe('picked')
      if (result.kind === 'picked') {
        expect(result.canonical.id).toBe(FIREBASE_UID)
        expect(result.duplicates.map((d) => d.id).sort()).toEqual([
          '65697',
          '9985590477',
          'ironman',
          'offline_9985590477',
        ])
      }
    })
  })
})

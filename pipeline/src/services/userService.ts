/**
 * userService — read/write the `users/{uid}` document.
 *
 * Pages must NOT call `doc(db, 'users', uid)` directly. Use this service so
 * the dual-app rule "no raw Firestore in components" stays enforced and so
 * future changes (caching, offline write queue, validation) only need to
 * happen in one place.
 *
 * Note: Wallet balance and tire balance live in subcollections and have
 * their own services (`walletService`). This file is for the top-level
 * profile fields only.
 */

import { db } from '../lib/firebase'
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  limit,
  runTransaction,
  type FieldValue,
} from 'firebase/firestore'
import { logger } from '../lib/logger'
import { normalizePhone } from './userMerge'

export type UserDocUpdate = Record<string, unknown> & {
  // serverTimestamp() values are allowed but typed as FieldValue.
  updatedAt?: FieldValue
  createdAt?: FieldValue
  tasksUpdatedAt?: FieldValue
}

export const userService = {
  /**
   * Read the raw user document. Returns null when missing.
   * Caller is responsible for shaping the returned data.
   */
  async getUserDoc(userId: string): Promise<Record<string, unknown> | null> {
    if (!userId) return null
    try {
      const snap = await getDoc(doc(db, 'users', userId))
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null
    } catch (err) {
      logger.error('user.read_failed', err, { userId })
      return null
    }
  },

  /**
   * Merge an update into the user doc. `updatedAt` is stamped automatically
   * if not supplied so callers don't have to remember.
   */
  async mergeUserDoc(userId: string, updates: UserDocUpdate): Promise<boolean> {
    if (!userId) return false
    try {
      const payload: UserDocUpdate = {
        ...updates,
        updatedAt: updates.updatedAt ?? serverTimestamp(),
      }
      await setDoc(doc(db, 'users', userId), payload, { merge: true })
      return true
    } catch (err) {
      logger.error('user.write_failed', err, { userId })
      return false
    }
  },

  /**
   * Resolve the canonical user doc for a (firebaseUid, phone) pair and
   * ensure it exists. This is the ONE place in the client app that decides
   * which `users/{id}` document a login session should read from. Every auth
   * path (phone OTP, Google, verifyOTP fallback, loginWithPhone fallback)
   * must route through this — direct `doc(db, 'users', uid)` writes from
   * AuthContext are what created the five-duplicates-per-phone mess in the
   * first place.
   *
   * Invariant: `phoneToUid/{cleanPhone}` is the single source of truth. If
   * it exists, the session uses that uid regardless of what Firebase Auth
   * currently says. If it doesn't, we create it pointing at the Firebase
   * UID (or clean phone fallback) and create the user doc.
   *
   * This helper does NOT attempt cross-document merges from the client. If
   * the Firebase UID conflicts with `phoneToUid`, we log a warning and route
   * the session to the `phoneToUid` target (where the wallet actually
   * lives). The server-side dedup script handles the eventual merge.
   */
  async resolveOrCreateUserDoc(params: {
    firebaseUid: string | null
    phone: string | null
    displayName?: string
    email?: string
  }): Promise<{ canonicalId: string; created: boolean; reconciled: boolean }> {
    const { firebaseUid, phone, displayName, email } = params
    const cleanPhone = normalizePhone(phone)

    // No phone → cannot index. Fall back to firebaseUid-only flow (Google
    // without phone, email mock, etc.). Still goes through this helper so
    // the write side has one choke point.
    if (!cleanPhone) {
      if (!firebaseUid) {
        throw new Error('resolveOrCreateUserDoc: neither firebaseUid nor phone')
      }
      await this.mergeUserDoc(firebaseUid, {
        displayName: displayName ?? undefined,
        email: email ?? undefined,
        lastLoginAt: serverTimestamp(),
      })
      return { canonicalId: firebaseUid, created: false, reconciled: false }
    }

    const indexRef = doc(db, 'phoneToUid', cleanPhone)

    const decision = await runTransaction(db, async (tx) => {
      const indexSnap = await tx.get(indexRef)
      if (indexSnap.exists()) {
        const mappedUid = (indexSnap.data()?.uid as string) ?? null
        if (!mappedUid) {
          // Corrupt index entry — rewrite it.
          const canonicalId = firebaseUid || cleanPhone
          tx.set(indexRef, {
            uid: canonicalId,
            source: 'auth-repair',
            createdAt: serverTimestamp(),
          })
          return { canonicalId, created: true, reconciled: false }
        }
        const reconciled = !!firebaseUid && firebaseUid !== mappedUid
        return { canonicalId: mappedUid, created: false, reconciled }
      }
      const canonicalId = firebaseUid || cleanPhone
      tx.set(indexRef, {
        uid: canonicalId,
        source: 'auth-create',
        createdAt: serverTimestamp(),
      })
      return { canonicalId, created: true, reconciled: false }
    })

    if (decision.reconciled) {
      logger.warn('auth.phone.uid_mismatch', {
        cleanPhone,
        firebaseUid,
        mappedUid: decision.canonicalId,
        hint: 'session routed to phoneToUid target; server dedup script will merge',
      })
    }

    await this.mergeUserDoc(decision.canonicalId, {
      phone: cleanPhone,
      phoneNumber: `+91${cleanPhone}`,
      displayName: displayName || undefined,
      email: email || undefined,
      lastLoginAt: serverTimestamp(),
    })

    return decision
  },

  /**
   * Look up a user by their `referralCode` field. Returns null when no match.
   * Used to validate that a `referredBy` code entered in Profile actually
   * belongs to a real user before persisting.
   */
  async findUserByReferralCode(
    code: string,
  ): Promise<{ id: string; data: Record<string, unknown> } | null> {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return null
    try {
      const q = query(collection(db, 'users'), where('referralCode', '==', trimmed), limit(1))
      const snap = await getDocs(q)
      if (snap.empty) return null
      const docSnap = snap.docs[0]
      return { id: docSnap.id, data: docSnap.data() as Record<string, unknown> }
    } catch (err) {
      logger.error('user.referral_lookup_failed', err, { code: trimmed })
      return null
    }
  },

  /**
   * Create the user doc if it doesn't exist. No-op when already present.
   */
  async ensureUserDoc(userId: string, initialData: UserDocUpdate): Promise<boolean> {
    if (!userId) return false
    try {
      const existing = await getDoc(doc(db, 'users', userId))
      if (existing.exists()) return true
      await setDoc(
        doc(db, 'users', userId),
        {
          ...initialData,
          createdAt: initialData.createdAt ?? serverTimestamp(),
          updatedAt: initialData.updatedAt ?? serverTimestamp(),
        },
        { merge: true },
      )
      return true
    } catch (err) {
      logger.error('user.create_failed', err, { userId })
      return false
    }
  },
}

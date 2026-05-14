/**
 * Customer Controls — Owner-only API for managing customer account flags
 * and wallet adjustments. All functions require the caller to be Owner.
 *
 * Flags (lock, verified, influencer) are direct Firestore writes.
 * Blacklist requires a Cloud Function (Auth custom claims).
 * Wallet adjustments call the customer-app walletService with ownerOverride.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  orderBy,
  limit,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { normalizePhone } from '../features/leads/lead-utils'
import { logger } from '../../lib/logger'
import { auth } from '../../lib/firebase'

// ─── Customer Lookup ─────────────────────────────────────────────────

export interface CustomerControlsData {
  userId: string
  displayName: string
  phone: string
  email: string
  walletBalance: number
  locked: boolean
  blacklisted: boolean
  verified: boolean
  influencer: boolean
  accountFlags?: Record<string, unknown>
}

/**
 * Look up a customer by phone number. Uses phoneToUid index first,
 * falls back to users collection scan (skipping staff docs).
 */
export const lookupCustomerByPhone = async (
  phone: string,
): Promise<CustomerControlsData | null> => {
  const firestore = initializeFirestore()
  if (!firestore) return null

  const normalized = normalizePhone(phone)
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]

  // Route through phoneToUid index first
  let userId: string | null = null
  try {
    const indexSnap = await getDoc(doc(firestore, 'phoneToUid', normalized))
    if (indexSnap.exists()) {
      const mapped = (indexSnap.data() as Record<string, unknown>).uid
      if (typeof mapped === 'string' && mapped.length > 0) userId = mapped
    }
  } catch {
    /* fall through */
  }

  // Fallback: scan users collection
  if (!userId) {
    for (const variant of variants) {
      if (userId) break
      try {
        const q = query(collection(firestore, 'users'), where('phone', '==', variant))
        const snap = await getDocs(q)
        for (const candidate of snap.docs) {
          const data = candidate.data() as Record<string, unknown>
          if (data.role) continue // skip staff
          userId = candidate.id
          break
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!userId) return null

  const userSnap = await getDoc(doc(firestore, 'users', userId))
  if (!userSnap.exists()) return null

  const data = userSnap.data() as Record<string, unknown>
  if (data.role) return null

  return {
    userId,
    displayName: String(data.displayName || data.name || 'Unknown'),
    phone: String(data.phone || normalized),
    email: String(data.email || ''),
    walletBalance: Number(data.walletBalance || 0),
    locked: data.locked === true,
    blacklisted: data.blacklisted === true,
    verified: data.verified === true,
    influencer: data.influencer === true,
    accountFlags: (data.accountFlags as Record<string, unknown>) || undefined,
  }
}

// ─── Toggle Flags (direct Firestore writes) ───────────────────────────

export const toggleCustomerLock = async (
  userId: string,
  locked: boolean,
  owner: { id: string; name: string },
): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')

  const now = new Date().toISOString()
  const flagUpdate = locked
    ? { lockedAt: now, lockedBy: owner.id, lockedByName: owner.name }
    : { unlockedAt: now, unlockedBy: owner.id, unlockedByName: owner.name }

  await setDoc(
    doc(firestore, 'users', userId),
    { locked, accountFlags: flagUpdate },
    { merge: true },
  )
}

export const toggleCustomerVerified = async (userId: string, verified: boolean): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  await setDoc(doc(firestore, 'users', userId), { verified }, { merge: true })
}

export const toggleCustomerInfluencer = async (
  userId: string,
  influencer: boolean,
): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  await setDoc(doc(firestore, 'users', userId), { influencer }, { merge: true })
}

// ─── Blacklist (via Cloud Function) ──────────────────────────────────

const BLACKLIST_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/toggleCustomerBlacklist'

export const toggleCustomerBlacklist = async (
  customerId: string,
  blacklist: boolean,
  reason?: string,
): Promise<{ ok: boolean; message: string }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {
    throw new Error('Could not get auth token')
  }

  const res = await fetch(BLACKLIST_FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ customerId, blacklist, reason }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.message || 'Blacklist toggle failed')
  return result
}

// ─── Wallet History (for the controls panel) ─────────────────────────

export interface WalletTransaction {
  id: string
  type: string
  amount: number
  description: string
  timestamp: unknown
}

export const getCustomerWalletHistory = async (
  userId: string,
  count = 20,
): Promise<WalletTransaction[]> => {
  const firestore = initializeFirestore()
  if (!firestore) return []

  try {
    const q = query(
      collection(firestore, 'users', userId, 'wallet_transactions'),
      orderBy('timestamp', 'desc'),
      limit(count),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WalletTransaction)
  } catch (err) {
    logger.error('customer_controls.wallet_history_failed', err)
    return []
  }
}

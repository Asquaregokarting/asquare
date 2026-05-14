import { db } from '../lib/firebase'
import type { Timestamp } from 'firebase/firestore'
import {
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore'
import { logger } from '../lib/logger'

export interface Transaction {
  id: string
  type: 'credit' | 'debit' | 'owner_credit' | 'owner_debit' | 'tire_credit' | 'tire_debit'
  amount: number
  description: string
  /** Always a Firestore Timestamp when read; written via `serverTimestamp()`. */
  timestamp: Timestamp
}

export const walletService = {
  // Get wallet balance
  async getBalance(userId: string): Promise<number> {
    try {
      if (!userId) return 0
      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const walletDoc = await getDoc(walletRef)

      if (walletDoc.exists()) {
        return walletDoc.data().balance || 0
      }
      return 0
    } catch (error) {
      logger.error('wallet.get_balance_failed', error)
      return 0
    }
  },

  // Initialize wallet for new user.
  //
  // We also stamp `users/{id}.walletBalance = 0` on the root doc. That root
  // field is a denormalized mirror of `users/{id}/wallet/data.balance` kept
  // in sync by every write below. It exists because the pipeline admin UI
  // reads from the root field for its list/detail views (see parseCustomer
  // in src/pipeline/api/asquare-customers.ts). Before this change the
  // customer-app side only wrote the subcollection and the admin displayed
  // whatever stale root value happened to be there — often wrong.
  //
  // The two writes (subcollection + root mirror) are wrapped in a single
  // runTransaction so a concurrent debit cannot observe one of them updated
  // while the other still reads as 0 — that race made the admin briefly
  // show walletBalance=0 right after a top-up.
  async initializeWallet(userId: string): Promise<void> {
    try {
      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const rootRef = doc(db, 'users', userId)

      await runTransaction(db, async (txn) => {
        const walletSnap = await txn.get(walletRef)
        const balance = walletSnap.exists() ? (walletSnap.data()?.balance ?? 0) : 0

        if (!walletSnap.exists()) {
          txn.set(walletRef, {
            balance: 0,
            lastUpdated: serverTimestamp(),
          })
        }

        // Mirror to root — always merge so we never clobber unrelated fields.
        txn.set(rootRef, { walletBalance: balance }, { merge: true })
      })
    } catch (error) {
      logger.error('wallet.init_failed', error)
    }
  },

  // Deduct balance from user wallet (atomic transaction).
  //
  // Writes `users/{id}/wallet/data.balance`, the audit tx log entry, AND the
  // root `users/{id}.walletBalance` mirror in a single transaction so the
  // admin view and customer view can never disagree.
  //
  // Refuses to operate when `users/{id}.walletFrozen === true` — the freeze
  // flag is set by scripts/freeze-wallet.cjs after a wallet is flagged as
  // abused. Both deduct and addBalance honor it so a frozen wallet cannot be
  // used for new bookings nor credited by any client-side auto-refund path.
  async deductBalance(
    userId: string,
    amount: number,
    description: string,
    options?: { ownerOverride?: boolean },
  ): Promise<boolean> {
    try {
      if (!userId || amount <= 0) return false

      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const userRef = doc(db, 'users', userId)

      return await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userRef)
        if (!options?.ownerOverride) {
          if (userDoc.exists() && userDoc.data().walletFrozen === true) {
            throw new Error('Wallet is frozen')
          }
          if (userDoc.exists() && userDoc.data().locked === true) {
            throw new Error('Account is locked')
          }
        }
        const walletDoc = await transaction.get(walletRef)

        if (!walletDoc.exists()) {
          throw new Error('Wallet not found')
        }

        const currentBalance = walletDoc.data().balance || 0
        if (currentBalance < amount) {
          throw new Error('Insufficient balance')
        }

        const newBalance = currentBalance - amount
        transaction.update(walletRef, {
          balance: newBalance,
          lastUpdated: serverTimestamp(),
        })

        // Keep the admin-visible root mirror in lock-step.
        // Use the computed value (not increment) since we're inside a
        // transaction that already read the balance — Firestore retries
        // the entire handler on contention, so the re-read gives us the
        // correct currentBalance each time.
        transaction.set(userRef, { walletBalance: newBalance }, { merge: true })

        // Log transaction
        const txRef = doc(collection(db, 'users', userId, 'wallet_transactions'))
        transaction.set(txRef, {
          type: 'debit',
          amount: -amount,
          description,
          timestamp: serverTimestamp(),
        })

        return true
      })
    } catch (error) {
      logger.error('wallet.deduction_failed', error)
      return false
    }
  },

  // Add balance to user wallet (atomic transaction).
  //
  // Same two-writes-in-one-tx pattern as deductBalance: subcollection +
  // root mirror + audit tx. Previously this path used separate non-atomic
  // writes for the create-vs-update branches, so a crash between writes
  // could leave the tx log out of sync; rolling both paths into a single
  // transaction is a strict improvement.
  //
  // Optional `idempotencyKey` — when provided, the audit log entry is
  // written at a deterministic doc ID derived from the key. A second
  // call with the same key sees the existing entry and returns true
  // WITHOUT crediting again. This is the defense-in-depth that stops
  // the multi-tab auto-refund race exploit even if a future Checkout.tsx
  // change re-introduces the "refund on failed payment" bug.
  async addBalance(
    userId: string,
    amount: number,
    description: string = 'Credit',
    idempotencyKey?: string,
    options?: { ownerOverride?: boolean },
  ): Promise<boolean> {
    try {
      if (!userId || amount <= 0) return false

      const walletRef = doc(db, 'users', userId, 'wallet', 'data')
      const userRef = doc(db, 'users', userId)
      // Deterministic audit doc ID when a key is supplied, random otherwise.
      const txRef = idempotencyKey
        ? doc(db, 'users', userId, 'wallet_transactions', `idem_${idempotencyKey}`)
        : doc(collection(db, 'users', userId, 'wallet_transactions'))

      return await runTransaction(db, async (transaction) => {
        // Check freeze flag first — a frozen wallet can't be credited either.
        // Blocks the Checkout.tsx auto-refund path from re-crediting after
        // a fraud-flag freeze.
        const userDoc = await transaction.get(userRef)
        if (!options?.ownerOverride) {
          if (userDoc.exists() && userDoc.data().walletFrozen === true) {
            throw new Error('Wallet is frozen')
          }
          if (userDoc.exists() && userDoc.data().locked === true) {
            throw new Error('Account is locked')
          }
        }

        // Idempotency short-circuit: if an audit entry at this deterministic
        // ID already exists, we've already credited for this key. Return true
        // without re-crediting so retries are safe but duplicates don't double.
        if (idempotencyKey) {
          const existing = await transaction.get(txRef)
          if (existing.exists()) {
            return true
          }
        }

        const walletDoc = await transaction.get(walletRef)

        const currentBalance = walletDoc.exists() ? walletDoc.data().balance || 0 : 0
        const newBalance = currentBalance + amount

        if (walletDoc.exists()) {
          transaction.update(walletRef, {
            balance: newBalance,
            lastUpdated: serverTimestamp(),
          })
        } else {
          transaction.set(walletRef, {
            balance: newBalance,
            lastUpdated: serverTimestamp(),
          })
        }

        // Use the computed value (not increment) — same pattern as
        // deductBalance: we're inside a transaction that read the doc,
        // so Firestore retries give us fresh reads each time.
        transaction.set(userRef, { walletBalance: newBalance }, { merge: true })

        transaction.set(txRef, {
          type: 'credit',
          amount,
          description,
          timestamp: serverTimestamp(),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        })

        return true
      })
    } catch (error) {
      logger.error('wallet.topup_failed', error)
      return false
    }
  },

  // Log Tire Transaction
  async logTireTransaction(
    userId: string,
    amount: number,
    description: string,
    type: 'tire_credit' | 'tire_debit' = 'tire_credit',
  ): Promise<void> {
    try {
      if (!userId) return
      const txRef = doc(collection(db, 'users', userId, 'tire_transactions'))
      await setDoc(txRef, {
        type,
        amount,
        description,
        timestamp: serverTimestamp(),
      })
    } catch (error) {
      logger.error('wallet.tire_transaction_log_failed', error)
    }
  },

  // Atomic + idempotent tire credit. Mirrors addBalance:
  //   - root users/{id}.tires bumped via computed value (transaction-safe)
  //   - tire_transactions audit entry written in same tx
  //   - when idempotencyKey is supplied, the tx doc lives at a deterministic
  //     ID so retries (multi-tab, double-click, page reload) short-circuit
  //     instead of double-crediting.
  // Use this for any tires award that must NOT double-credit on retry, such
  // as daily-task rewards.
  async creditTires(
    userId: string,
    amount: number,
    description: string,
    idempotencyKey?: string,
  ): Promise<boolean> {
    try {
      if (!userId || amount <= 0) return false

      const userRef = doc(db, 'users', userId)
      const txRef = idempotencyKey
        ? doc(db, 'users', userId, 'tire_transactions', `idem_${idempotencyKey}`)
        : doc(collection(db, 'users', userId, 'tire_transactions'))

      return await runTransaction(db, async (transaction) => {
        if (idempotencyKey) {
          const existing = await transaction.get(txRef)
          if (existing.exists()) return true
        }

        const userDoc = await transaction.get(userRef)
        const currentTires = userDoc.exists() ? Number(userDoc.data().tires || 0) : 0
        const newTires = currentTires + amount

        transaction.set(userRef, { tires: newTires, updatedAt: serverTimestamp() }, { merge: true })

        transaction.set(txRef, {
          type: 'tire_credit',
          amount,
          description,
          timestamp: serverTimestamp(),
          ...(idempotencyKey ? { idempotencyKey } : {}),
        })

        return true
      })
    } catch (error) {
      logger.error('wallet.tire_credit_failed', error)
      return false
    }
  },

  // Get Wallet Transaction History
  async getWalletHistory(userId: string): Promise<Transaction[]> {
    try {
      if (!userId) return []
      const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore')
      const q = query(
        collection(db, 'users', userId, 'wallet_transactions'),
        orderBy('timestamp', 'desc'),
        limit(50),
      )
      const snapshot = await getDocs(q)
      return snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as Transaction,
      )
    } catch (error) {
      logger.error('wallet.fetch_history_failed', error)
      return []
    }
  },

  // Get Tire Transaction History
  async getTireHistory(userId: string): Promise<Transaction[]> {
    try {
      if (!userId) return []
      const { collection, getDocs, query, orderBy, limit } = await import('firebase/firestore')
      const q = query(
        collection(db, 'users', userId, 'tire_transactions'),
        orderBy('timestamp', 'desc'),
        limit(50),
      )
      const snapshot = await getDocs(q)
      return snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
          }) as Transaction,
      )
    } catch (error) {
      logger.error('wallet.fetch_tire_history_failed', error)
      return []
    }
  },
}

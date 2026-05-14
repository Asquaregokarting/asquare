/**
 * walletService unit tests
 *
 * Focus: the transactional balance logic — the audit's highest-risk piece of
 * customer-facing financial code. We exercise the happy path and the two
 * critical failure modes (insufficient balance, missing wallet) plus input
 * guards. All Firestore calls are mocked in src/test/setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { walletService } from './walletService'
import * as firestore from 'firebase/firestore'
import { createFakeDocSnapshot } from '../test/mocks/firebase'

const mockedFirestore = vi.mocked(firestore)

describe('walletService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBalance', () => {
    it('returns 0 when userId is empty', async () => {
      const balance = await walletService.getBalance('')
      expect(balance).toBe(0)
    })

    it('returns 0 when wallet doc does not exist', async () => {
      mockedFirestore.getDoc.mockResolvedValueOnce(createFakeDocSnapshot(undefined) as never)
      const balance = await walletService.getBalance('user-1')
      expect(balance).toBe(0)
    })

    it('returns the stored balance when wallet doc exists', async () => {
      mockedFirestore.getDoc.mockResolvedValueOnce(
        createFakeDocSnapshot({ balance: 1234 }) as never,
      )
      const balance = await walletService.getBalance('user-1')
      expect(balance).toBe(1234)
    })

    it('treats missing balance field as 0 (does not crash)', async () => {
      mockedFirestore.getDoc.mockResolvedValueOnce(createFakeDocSnapshot({}) as never)
      const balance = await walletService.getBalance('user-1')
      expect(balance).toBe(0)
    })
  })

  describe('deductBalance', () => {
    it('rejects empty userId', async () => {
      const ok = await walletService.deductBalance('', 100, 'test')
      expect(ok).toBe(false)
    })

    it('rejects non-positive amount', async () => {
      expect(await walletService.deductBalance('u', 0, 'test')).toBe(false)
      expect(await walletService.deductBalance('u', -50, 'test')).toBe(false)
    })

    it('runs inside a Firestore transaction (atomic)', async () => {
      // Stub the transaction so the wallet has 500 and the deduction succeeds.
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 500 })),
            set: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )

      const ok = await walletService.deductBalance('user-1', 200, 'spin-and-win')
      expect(ok).toBe(true)
      expect(mockedFirestore.runTransaction).toHaveBeenCalledTimes(1)
    })

    it('returns false when wallet does not exist', async () => {
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot(undefined)),
            set: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.deductBalance('user-1', 50, 'test')
      expect(ok).toBe(false)
    })

    it('returns false when balance is insufficient', async () => {
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 100 })),
            set: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.deductBalance('user-1', 500, 'test')
      expect(ok).toBe(false)
    })
  })

  describe('addBalance', () => {
    it('rejects empty userId or non-positive amount', async () => {
      expect(await walletService.addBalance('', 100)).toBe(false)
      expect(await walletService.addBalance('u', 0)).toBe(false)
      expect(await walletService.addBalance('u', -10)).toBe(false)
    })

    it('creates wallet doc when missing, writes credit tx, and mirrors balance to the root user doc', async () => {
      const txnSet = vi.fn()
      const txnUpdate = vi.fn()
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot(undefined)),
            set: txnSet,
            update: txnUpdate,
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.addBalance('user-1', 250, 'top-up')
      expect(ok).toBe(true)
      // Inside the tx: set wallet/data, set root mirror, set tx log → 3 sets.
      expect(txnSet).toHaveBeenCalledTimes(3)
      expect(txnUpdate).not.toHaveBeenCalled()
    })

    it('increments existing wallet, mirrors balance to the root user doc, and logs transaction', async () => {
      const txnSet = vi.fn()
      const txnUpdate = vi.fn()
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 100 })),
            set: txnSet,
            update: txnUpdate,
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.addBalance('user-1', 50, 'refund')
      expect(ok).toBe(true)
      // Inside the tx: increment wallet/data, set root mirror, set tx log.
      expect(txnUpdate).toHaveBeenCalledTimes(1)
      expect(txnSet).toHaveBeenCalledTimes(2)
    })
  })

  describe('walletFrozen enforcement', () => {
    it('addBalance refuses to credit a frozen wallet', async () => {
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          // First get() returns the user doc with walletFrozen=true.
          const txn = {
            get: vi.fn().mockResolvedValueOnce(createFakeDocSnapshot({ walletFrozen: true })),
            set: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.addBalance('user-1', 100, 'test')
      expect(ok).toBe(false)
    })

    it('deductBalance refuses to debit a frozen wallet', async () => {
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValueOnce(createFakeDocSnapshot({ walletFrozen: true })),
            set: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.deductBalance('user-1', 100, 'test')
      expect(ok).toBe(false)
    })
  })

  describe('addBalance idempotency key', () => {
    it('short-circuits without crediting when audit entry for the key already exists', async () => {
      const txnSet = vi.fn()
      const txnUpdate = vi.fn()
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          // get() call sequence: userDoc (not frozen), existing audit entry (EXISTS).
          const getMock = vi
            .fn()
            .mockResolvedValueOnce(createFakeDocSnapshot({ balance: 500 })) // userDoc
            .mockResolvedValueOnce(createFakeDocSnapshot({ type: 'credit', amount: 100 })) // existing audit
          const txn = { get: getMock, set: txnSet, update: txnUpdate, delete: vi.fn() }
          return cb(txn)
        },
      )
      const ok = await walletService.addBalance('user-1', 100, 'refund', 'refund-ORD123')
      expect(ok).toBe(true) // reports success so caller's retry logic is idempotent
      expect(txnSet).not.toHaveBeenCalled() // but no credit written
      expect(txnUpdate).not.toHaveBeenCalled()
    })

    it('credits normally when no prior audit entry exists for the key', async () => {
      const txnSet = vi.fn()
      const txnUpdate = vi.fn()
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const getMock = vi
            .fn()
            .mockResolvedValueOnce(createFakeDocSnapshot({ balance: 500 })) // userDoc (not frozen)
            .mockResolvedValueOnce(createFakeDocSnapshot(undefined)) // audit entry missing
            .mockResolvedValueOnce(createFakeDocSnapshot({ balance: 500 })) // walletDoc
          const txn = { get: getMock, set: txnSet, update: txnUpdate, delete: vi.fn() }
          return cb(txn)
        },
      )
      const ok = await walletService.addBalance('user-1', 100, 'refund', 'refund-ORD456')
      expect(ok).toBe(true)
      // wallet update + root mirror set + audit set = 1 update + 2 sets
      expect(txnUpdate).toHaveBeenCalledTimes(1)
      expect(txnSet).toHaveBeenCalledTimes(2)
    })
  })

  describe('root walletBalance mirror', () => {
    it('deductBalance writes the root mirror inside the same transaction', async () => {
      const txnSet = vi.fn()
      const txnUpdate = vi.fn()
      mockedFirestore.runTransaction.mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (_db: unknown, cb: any) => {
          const txn = {
            get: vi.fn().mockResolvedValue(createFakeDocSnapshot({ balance: 500 })),
            set: txnSet,
            update: txnUpdate,
            delete: vi.fn(),
          }
          return cb(txn)
        },
      )
      const ok = await walletService.deductBalance('user-1', 200, 'checkout')
      expect(ok).toBe(true)
      // Decrement wallet/data (update) + set root mirror + set tx log.
      expect(txnUpdate).toHaveBeenCalledTimes(1)
      expect(txnSet).toHaveBeenCalledTimes(2)
    })
  })
})

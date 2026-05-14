import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDoc = vi.fn()
const mockSetDoc = vi.fn(() => Promise.resolve())
const mockRunTransaction = vi.fn()

vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  runTransaction: (_db: unknown, fn: (t: unknown) => Promise<unknown>) =>
    mockRunTransaction(_db, fn),
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('./userMerge', () => ({
  normalizePhone: (p: string | null) => (p ? p.replace(/\D/g, '').slice(-10) : ''),
}))

import { userService } from './userService'

describe('userService.getUserDoc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for empty userId', async () => {
    expect(await userService.getUserDoc('')).toBeNull()
  })

  it('returns data when doc exists', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ displayName: 'Test User', phone: '9876543210' }),
    })
    const result = await userService.getUserDoc('user-001')
    expect(result).toEqual({ displayName: 'Test User', phone: '9876543210' })
  })

  it('returns null when doc does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false })
    expect(await userService.getUserDoc('user-missing')).toBeNull()
  })

  it('returns null on Firestore error', async () => {
    mockGetDoc.mockRejectedValueOnce(new Error('permission-denied'))
    expect(await userService.getUserDoc('user-err')).toBeNull()
  })
})

describe('userService.mergeUserDoc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns false for empty userId', async () => {
    expect(await userService.mergeUserDoc('', { name: 'X' })).toBe(false)
  })

  it('writes with merge and auto-stamps updatedAt', async () => {
    const result = await userService.mergeUserDoc('user-001', { displayName: 'New' })
    expect(result).toBe(true)
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        displayName: 'New',
        updatedAt: 'SERVER_TIMESTAMP',
      }),
      { merge: true },
    )
  })

  it('preserves caller-supplied updatedAt', async () => {
    const customTs = 'CUSTOM_TS'
    await userService.mergeUserDoc('user-001', { updatedAt: customTs as never })
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ updatedAt: customTs }),
      { merge: true },
    )
  })

  it('returns false on Firestore error', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('write-failed'))
    const result = await userService.mergeUserDoc('user-001', { x: 1 })
    expect(result).toBe(false)
  })
})

describe('userService.resolveOrCreateUserDoc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('falls back to firebaseUid when no phone', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true })
    const result = await userService.resolveOrCreateUserDoc({
      firebaseUid: 'fb-uid-001',
      phone: null,
    })
    expect(result.canonicalId).toBe('fb-uid-001')
    expect(result.created).toBe(false)
  })

  it('throws when no phone and no firebaseUid', async () => {
    await expect(
      userService.resolveOrCreateUserDoc({
        firebaseUid: null,
        phone: null,
      }),
    ).rejects.toThrow()
  })
})

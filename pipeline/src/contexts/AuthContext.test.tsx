import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// ── Mock all external deps ──────────────────────────────────────────

let authStateCallback: ((user: unknown) => void) | null = null
const mockSignOut = vi.fn(() => Promise.resolve())

vi.mock('../lib/firebase', () => ({
  db: {},
  auth: {
    currentUser: null,
    signOut: () => mockSignOut(),
  },
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authStateCallback = cb
    return vi.fn() // unsubscribe
  },
  RecaptchaVerifier: vi.fn(),
  signInWithPhoneNumber: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()), // returns unsubscribe
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
}))

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../lib/utils', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual }
})

const mockResolveOrCreate = vi.fn(() => Promise.resolve({ canonicalId: 'resolved-user-001' }))
const mockMergeUserDoc = vi.fn(() => Promise.resolve())

vi.mock('../services/userService', () => ({
  userService: {
    resolveOrCreateUserDoc: (...args: unknown[]) => mockResolveOrCreate(...args),
    mergeUserDoc: (...args: unknown[]) => mockMergeUserDoc(...args),
  },
}))

vi.mock('../services/userMerge', () => ({
  normalizePhone: (p: string) => p.replace(/\D/g, '').slice(-10),
}))

vi.mock('../services/bookingService', () => ({
  bookingService: {},
}))

vi.mock('../lib/storage', () => ({
  storage: {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  },
}))

import { AuthProvider, useAuth } from './AuthContext'
import { storage } from '../lib/storage'

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authStateCallback = null
  })

  it('throws when used outside provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider')
  })

  it('starts in loading state', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.loading).toBe(true)
    expect(result.current.user).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets loading false after auth state resolves (no user)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    // Simulate Firebase reporting no user
    await act(async () => {
      authStateCallback?.(null)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('restores user from storage when Firebase has user but no stored data', async () => {
    const storedUser = JSON.stringify({
      id: 'stored-001',
      displayName: 'Stored User',
      phone: '9876543210',
      tires: 10,
      walletBalance: 100,
      tier: 'silver',
    })
    vi.mocked(storage.get).mockResolvedValueOnce(storedUser)

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {
      authStateCallback?.({ uid: 'firebase-001', phoneNumber: '+919876543210' })
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.id).toBe('stored-001')
    expect(result.current.user?.displayName).toBe('Stored User')
  })

  it('clearError resets error state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.(null))

    // Force an error via loginWithPhone failing
    mockResolveOrCreate.mockRejectedValueOnce(new Error('network'))
    await act(async () => {
      try {
        await result.current.loginWithPhone('+919999999999')
      } catch {
        // expected
      }
    })
    expect(result.current.error).toBeTruthy()

    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it('loginWithPhone creates fallback user on API failure', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.(null))

    mockResolveOrCreate.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await result.current.loginWithPhone('+919123456789')
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    // Fallback user created with clean phone as ID
    expect(result.current.user).toBeTruthy()
    expect(result.current.user?.phone).toBe('9123456789')
    expect(result.current.user?.tier).toBe('bronze')
  })

  it('loginAsGuest creates minimal user on sync failure', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.(null))

    mockResolveOrCreate.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await result.current.loginAsGuest('+919876543210')
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeTruthy()
    expect(result.current.user?.displayName).toBe('Guest User')
  })

  it('logout clears user and storage', async () => {
    // Suppress location.reload
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    })

    const storedUser = JSON.stringify({ id: 'u1', displayName: 'User' })
    vi.mocked(storage.get).mockResolvedValueOnce(storedUser)
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.({ uid: 'fb1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.logout()
    })

    expect(mockSignOut).toHaveBeenCalled()
    expect(storage.remove).toHaveBeenCalledWith('mock_user')
  })

  it('updateUserProfile updates user state', async () => {
    const storedUser = JSON.stringify({
      id: 'u1',
      displayName: 'Old Name',
      phone: '9876543210',
      email: 'old@test.com',
      tires: 0,
      walletBalance: 0,
      tier: 'bronze',
      referralCode: 'TEST',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    vi.mocked(storage.get).mockResolvedValueOnce(storedUser)
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.({ uid: 'fb1' }))
    await waitFor(() => expect(result.current.user).toBeTruthy())

    await act(async () => {
      await result.current.updateUserProfile({ displayName: 'New Name' })
    })

    expect(result.current.user?.displayName).toBe('New Name')
    expect(mockMergeUserDoc).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        displayName: 'New Name',
      }),
    )
  })

  it('updateUserProfile throws if mobile is missing', async () => {
    const storedUser = JSON.stringify({
      id: 'u1',
      displayName: 'Test',
      phone: '',
      tires: 0,
      walletBalance: 0,
      tier: 'bronze',
    })
    vi.mocked(storage.get).mockResolvedValueOnce(storedUser)
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => authStateCallback?.({ uid: 'fb1' }))
    await waitFor(() => expect(result.current.user).toBeTruthy())

    await expect(
      act(async () => {
        await result.current.updateUserProfile({ phone: '' })
      }),
    ).rejects.toThrow('Mobile number is required')
  })
})

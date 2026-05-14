/**
 * Firebase Module Mocks — PRODUCTION SAFETY
 *
 * All Firebase SDK imports are replaced with these no-op stubs.
 * - ZERO network calls — no Firestore, no Auth, no Storage connections
 * - ZERO writes to any database — setDoc, updateDoc, addDoc are no-ops
 * - ZERO reads from production — getDoc, getDocs return empty fake snapshots
 * - Uses fake environment variables (not your real .env keys)
 *
 * Each mock is a vi.fn() that can be overridden per-test for specific scenarios.
 */

import { vi } from 'vitest'

// ── Fake snapshot factories ─────────────────────────────────────────

export const createFakeDocSnapshot = (data?: Record<string, unknown>, id = 'fake-doc-id') => ({
  exists: () => !!data,
  data: () => data ?? undefined,
  id,
  ref: { id, path: `fake-collection/${id}` },
  get: (field: string) => data?.[field],
})

export const createFakeQuerySnapshot = (docs: Record<string, unknown>[] = []) => ({
  docs: docs.map((data, i) => createFakeDocSnapshot(data, `doc-${i}`)),
  empty: docs.length === 0,
  size: docs.length,
  forEach: (cb: (doc: ReturnType<typeof createFakeDocSnapshot>) => void) => {
    docs.forEach((data, i) => cb(createFakeDocSnapshot(data, `doc-${i}`)))
  },
})

// ── firebase/app ────────────────────────────────────────────────────

export const mockInitializeApp = vi.fn(() => ({ name: '[DEFAULT]', options: {} }))

export const firebaseAppMock = {
  initializeApp: mockInitializeApp,
  getApp: vi.fn(() => ({ name: '[DEFAULT]', options: {} })),
  getApps: vi.fn(() => []),
}

// ── firebase/auth ───────────────────────────────────────────────────

export const mockAuth = {
  currentUser: null,
  onAuthStateChanged: vi.fn((_cb: unknown) => vi.fn()), // returns unsubscribe
  signOut: vi.fn(() => Promise.resolve()),
}

export const firebaseAuthMock = {
  getAuth: vi.fn(() => mockAuth),
  onAuthStateChanged: vi.fn((_auth: unknown, cb: (user: null) => void) => {
    cb(null)
    return vi.fn() // unsubscribe
  }),
  signInWithEmailAndPassword: vi.fn(() => Promise.resolve({ user: { uid: 'test-uid' } })),
  createUserWithEmailAndPassword: vi.fn(() => Promise.resolve({ user: { uid: 'test-uid' } })),
  signInWithPopup: vi.fn(() => Promise.resolve({ user: { uid: 'test-uid' } })),
  signInWithPhoneNumber: vi.fn(() => Promise.resolve({ verificationId: 'test-verification' })),
  signOut: vi.fn(() => Promise.resolve()),
  setPersistence: vi.fn(() => Promise.resolve()),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  GoogleAuthProvider: vi.fn(),
  RecaptchaVerifier: vi.fn(),
  PhoneAuthProvider: vi.fn(),
}

// ── firebase/firestore ──────────────────────────────────────────────
// ALL writes are no-ops. ALL reads return empty data.

export const firebaseFirestoreMock = {
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  collectionGroup: vi.fn(() => ({})),
  doc: vi.fn(() => ({ id: 'fake-doc-id', path: 'fake-collection/fake-doc-id' })),
  getDoc: vi.fn(() => Promise.resolve(createFakeDocSnapshot())),
  getDocs: vi.fn(() => Promise.resolve(createFakeQuerySnapshot())),
  setDoc: vi.fn(() => Promise.resolve()),       // NO-OP — writes nothing
  updateDoc: vi.fn(() => Promise.resolve()),     // NO-OP — writes nothing
  addDoc: vi.fn(() => Promise.resolve({ id: 'new-fake-id' })), // NO-OP
  deleteDoc: vi.fn(() => Promise.resolve()),     // NO-OP — deletes nothing
  runTransaction: vi.fn((_db: unknown, cb: (txn: unknown) => Promise<unknown>) =>
    cb({
      get: vi.fn(() => Promise.resolve(createFakeDocSnapshot())),
      set: vi.fn(),     // NO-OP
      update: vi.fn(),  // NO-OP
      delete: vi.fn(),  // NO-OP
    })
  ),
  onSnapshot: vi.fn(() => vi.fn()), // returns unsubscribe
  query: vi.fn((...args: unknown[]) => args[0]),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  startAfter: vi.fn(() => ({})),
  endBefore: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => new Date()),
  increment: vi.fn((n: number) => n),
  arrayUnion: vi.fn((...args: unknown[]) => args),
  arrayRemove: vi.fn((...args: unknown[]) => args),
  Timestamp: {
    now: vi.fn(() => ({ toDate: () => new Date(), seconds: Date.now() / 1000 })),
    fromDate: vi.fn((d: Date) => ({ toDate: () => d, seconds: d.getTime() / 1000 })),
  },
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
}

// ── firebase/storage ────────────────────────────────────────────────

export const firebaseStorageMock = {
  getStorage: vi.fn(() => ({})),
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(() => Promise.resolve({ ref: {} })),
  getDownloadURL: vi.fn(() => Promise.resolve('https://fake-storage.example.com/file.png')),
  deleteObject: vi.fn(() => Promise.resolve()),
}

// ── Register all mocks ──────────────────────────────────────────────

export function registerFirebaseMocks() {
  vi.mock('firebase/app', () => firebaseAppMock)
  vi.mock('firebase/auth', () => firebaseAuthMock)
  vi.mock('firebase/firestore', () => firebaseFirestoreMock)
  vi.mock('firebase/storage', () => firebaseStorageMock)
}

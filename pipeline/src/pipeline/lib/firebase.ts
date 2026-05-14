import { FirebaseApp, FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import {
  Firestore,
  getFirestore,
  initializeFirestore as initializeFirestoreSdk,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { logger } from '../../lib/logger'

const DEFAULT_PROJECT_ID = 'a-square-6720c'
const DEFAULT_MESSAGING_SENDER_ID = '1042048485512'
const DEFAULT_FIRESTORE_DATABASE_ID = 'asquare-app-db'
const DEFAULT_API_KEY = 'AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo'
const DEFAULT_APP_ID = '1:1042048485512:web:9a6d606470c29729aef73d'

let firebaseApp: FirebaseApp | null = null
let firestoreDb: Firestore | null = null
let missingFirebaseEnv: string[] = []
let authReadyPromise: Promise<void> | null = null

const isMissing = (value?: string): boolean => !value || value.trim() === ''

const buildFirebaseConfig = (): FirebaseOptions | null => {
  const apiKey = (import.meta.env.VITE_FIREBASE_API_KEY ?? DEFAULT_API_KEY).trim()
  const appId = (import.meta.env.VITE_FIREBASE_APP_ID ?? DEFAULT_APP_ID).trim()
  const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? DEFAULT_PROJECT_ID).trim()
  const messagingSenderId = (
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? DEFAULT_MESSAGING_SENDER_ID
  ).trim()
  const authDomain = (
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`
  ).trim()
  const storageBucket = (
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`
  ).trim()

  const missing: string[] = []
  if (isMissing(apiKey)) missing.push('VITE_FIREBASE_API_KEY')
  if (isMissing(appId)) missing.push('VITE_FIREBASE_APP_ID')
  if (isMissing(projectId)) missing.push('VITE_FIREBASE_PROJECT_ID')
  if (isMissing(messagingSenderId)) missing.push('VITE_FIREBASE_MESSAGING_SENDER_ID')

  missingFirebaseEnv = missing
  if (missing.length > 0) {
    return null
  }

  return {
    apiKey,
    appId,
    projectId,
    messagingSenderId,
    authDomain,
    storageBucket,
  }
}

const ensureFirebaseApp = (): FirebaseApp | null => {
  if (firebaseApp) {
    return firebaseApp
  }

  const config = buildFirebaseConfig()
  if (!config) {
    return null
  }

  firebaseApp = getApps().length > 0 ? getApp() : initializeApp(config)
  return firebaseApp
}

export const initializeFirebaseApp = (): FirebaseApp | null => ensureFirebaseApp()

export const initializeFirestore = (): Firestore | null => {
  if (firestoreDb) {
    return firestoreDb
  }

  const app = ensureFirebaseApp()
  if (!app) {
    return null
  }

  const databaseId =
    (import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ?? DEFAULT_FIRESTORE_DATABASE_ID).trim() ||
    '(default)'
  // Persistent IndexedDB cache: queries serve cached results on a warm
  // page load while the SDK refreshes from the server in the background.
  // Multi-tab safe — if the Owner has Bookings + Invoices open in two
  // tabs, both share one IndexedDB cache, so a write on one tab updates
  // the other instantly without a server round-trip.
  //
  // First load is unchanged (cold cache → server). Subsequent loads
  // serve from cache in ~10–30 ms while the network refresh fires
  // alongside. This is what unlocks the <200 ms warm path the team
  // wants — without it, every page reload pays full Firestore RTT.
  //
  // Falls back to vanilla `getFirestore` if `initializeFirestore` has
  // already been called for this app (e.g. by a sibling module). That
  // branch keeps the previous behavior so we don't crash, just don't
  // get the cache benefit on that one race.
  // Long-polling is forced as a stop-gap for `INTERNAL ASSERTION FAILED
  // (ID: ca9 / b815)`. The WebSocket watch-stream aggregator was tripping
  // under heavy listener churn + StrictMode + multi-tab. Long-polling
  // bypasses that aggregator entirely.
  try {
    firestoreDb = initializeFirestoreSdk(
      app,
      {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      databaseId,
    )
  } catch (err) {
    // `initializeFirestoreSdk` throws when `getFirestore` was already called
    // for this app+database elsewhere (typically src/lib/firebase.ts). Retry
    // without the persistent cache config, since long-polling is the
    // higher-priority setting; if even that fails, fall back to plain
    // getFirestore which returns whichever instance already exists.
    logger.warn('pipeline_firebase.persistent_cache_unavailable', {
      reason: err instanceof Error ? err.message : String(err),
    })
    try {
      firestoreDb = initializeFirestoreSdk(app, { experimentalForceLongPolling: true }, databaseId)
    } catch {
      firestoreDb = getFirestore(app, databaseId)
    }
  }

  // Kick off anonymous auth eagerly. The authReadyPromise resolves
  // once Firebase Auth state is settled (signed in or failed).
  const auth = getAuth(app)
  if (!authReadyPromise) {
    authReadyPromise = new Promise<void>((resolve) => {
      // onAuthStateChanged fires once auth state is determined
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe()
        if (user) {
          resolve()
        } else {
          // No user yet — trigger anonymous sign-in and wait
          signInAnonymously(auth)
            .then(() => resolve())
            .catch(() => resolve())
        }
      })
    })
  }

  return firestoreDb
}

/**
 * Ensures Firebase Auth is ready (anonymous sign-in completed) before
 * any Firestore operation. Await this before reads/writes.
 */
export const ensureAnonymousAuth = async (): Promise<void> => {
  initializeFirestore()
  if (authReadyPromise) {
    await authReadyPromise
  }
}

export const getMissingFirebaseEnv = (): string[] => {
  buildFirebaseConfig()
  return [...missingFirebaseEnv]
}

export const logFirebaseStartupStatus = (): void => {
  if (!import.meta.env.DEV) {
    return
  }

  const database = initializeFirestore()
  if (database) {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? DEFAULT_PROJECT_ID
    const databaseId =
      import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ?? DEFAULT_FIRESTORE_DATABASE_ID
    logger.info('pipeline_firebase.firestore_ready', { projectId, databaseId })
    return
  }

  const missing = getMissingFirebaseEnv()
  if (missing.length > 0) {
    logger.warn('pipeline_firebase.firestore_not_initialized', { missing })
  }
}

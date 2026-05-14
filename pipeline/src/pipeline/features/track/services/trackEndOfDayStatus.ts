import { doc, getDoc, onSnapshot, Unsubscribe } from 'firebase/firestore'
import { initializeFirestore } from '../../../lib/firebase'
import { todayIST } from '../../../lib/ist-date'
import { resolveLocationDocId } from './kartReportService'

// ─── Types ────────────────────────────────────────────────────────────────

export interface TrackEndOfDayStatus {
  /** True when today's deep clean assignment exists AND `cleaned === true`. */
  deepCleanComplete: boolean
  /**
   * True when the scanner shift doc for this location has today's `shiftDate`
   * AND all 5 `endVerificationPhotos` fields (selfie + 4 directional track
   * photos) are non-empty strings.
   */
  endShiftPhotosComplete: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────

const SHIFTS_COLLECTION = 'shifts'
const LOCATIONS_COLLECTION = 'locations'
const DEEP_CLEAN_ASSIGNMENTS = 'deepCleanAssignments'
const REQUIRED_END_PHOTO_KEYS = [
  'selfie',
  'track_north',
  'track_south',
  'track_east',
  'track_west',
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────
//
// Location resolution is shared with kartReportService — both services need
// the same slug-shaped doc id (e.g. "visakhapatnam") regardless of whether
// they receive a display name, a static-fallback slug, or a live-registry
// numeric slug. See `resolveLocationDocId` in kartReportService.ts for the
// full reasoning behind the three resolution paths.

const isDeepCleanDocComplete = (data: Record<string, unknown> | undefined): boolean => {
  if (!data) return false
  return data.cleaned === true
}

const isEndShiftPhotosDocComplete = (
  data: Record<string, unknown> | undefined,
  todayDateStr: string,
): boolean => {
  if (!data) return false
  if (typeof data.shiftDate !== 'string' || data.shiftDate !== todayDateStr) {
    return false
  }
  const photos = data.endVerificationPhotos as Record<string, unknown> | undefined
  if (!photos || typeof photos !== 'object') return false
  return REQUIRED_END_PHOTO_KEYS.every((key) => {
    const value = photos[key]
    return typeof value === 'string' && value.length > 0
  })
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Build the user-facing block message based on which Track Marshall
 * tasks are still missing for the day. Returns null when both tasks
 * are complete (i.e. nothing is blocking the cashier).
 *
 * Wording is exact per the operations requirement.
 */
export const buildTrackTaskBlockMessage = (status: TrackEndOfDayStatus): string | null => {
  const { deepCleanComplete, endShiftPhotosComplete } = status
  if (deepCleanComplete && endShiftPhotosComplete) return null
  if (!deepCleanComplete && !endShiftPhotosComplete) {
    return 'Deep cleaning and end shift photos are not completed. Please wait for Track Marshall to complete all required tasks.'
  }
  if (!deepCleanComplete) {
    return 'Deep cleaning is not completed. Please wait for Track Marshall to complete the kart cleaning.'
  }
  return 'End shift photos are not uploaded. Please wait for Track Marshall to upload all required track photos.'
}

/**
 * One-shot fetch — used by the server-side gate in
 * `endFirestoreShiftWithSettlement`. Never throws on Firestore errors;
 * fails closed by returning `{ false, false }` so that a transient
 * network issue blocks the cashier rather than letting them through.
 */
export const getTrackEndOfDayStatus = async (
  locationOrSlug: string,
): Promise<TrackEndOfDayStatus> => {
  const db = initializeFirestore()
  if (!db) {
    return { deepCleanComplete: false, endShiftPhotosComplete: false }
  }

  const locationDocId = resolveLocationDocId(locationOrSlug)
  if (!locationDocId) {
    return { deepCleanComplete: false, endShiftPhotosComplete: false }
  }

  const todayStr = todayIST()

  try {
    const [deepCleanSnap, scannerShiftSnap] = await Promise.all([
      getDoc(doc(db, LOCATIONS_COLLECTION, locationDocId, DEEP_CLEAN_ASSIGNMENTS, todayStr)),
      getDoc(doc(db, SHIFTS_COLLECTION, locationDocId)),
    ])

    const deepCleanComplete = deepCleanSnap.exists()
      ? isDeepCleanDocComplete(deepCleanSnap.data() as Record<string, unknown>)
      : false

    const endShiftPhotosComplete = scannerShiftSnap.exists()
      ? isEndShiftPhotosDocComplete(scannerShiftSnap.data() as Record<string, unknown>, todayStr)
      : false

    return { deepCleanComplete, endShiftPhotosComplete }
  } catch {
    return { deepCleanComplete: false, endShiftPhotosComplete: false }
  }
}

/**
 * Real-time subscription — used by the client-side preflight in
 * `BillingModule`. Combines two `onSnapshot` listeners (deep clean
 * assignment + scanner shift) and emits a fresh combined status
 * whenever either underlying doc changes.
 */
export const subscribeTrackEndOfDayStatus = (
  locationOrSlug: string,
  onData: (status: TrackEndOfDayStatus) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData({ deepCleanComplete: false, endShiftPhotosComplete: false })
    return () => undefined
  }

  const locationDocId = resolveLocationDocId(locationOrSlug)
  if (!locationDocId) {
    onData({ deepCleanComplete: false, endShiftPhotosComplete: false })
    return () => undefined
  }

  const todayStr = todayIST()

  let deepCleanComplete = false
  let endShiftPhotosComplete = false
  let receivedDeepClean = false
  let receivedScannerShift = false

  const emitIfReady = () => {
    // Wait for both listeners to fire at least once before emitting,
    // so the consumer doesn't briefly see "all blocked" while one
    // listener is still warming up.
    if (receivedDeepClean && receivedScannerShift) {
      onData({ deepCleanComplete, endShiftPhotosComplete })
    }
  }

  const handleError = (reason: unknown) => {
    onError?.(reason as Error)
  }

  const unsubscribeDeepClean = onSnapshot(
    doc(db, LOCATIONS_COLLECTION, locationDocId, DEEP_CLEAN_ASSIGNMENTS, todayStr),
    (snap) => {
      deepCleanComplete = snap.exists()
        ? isDeepCleanDocComplete(snap.data() as Record<string, unknown>)
        : false
      receivedDeepClean = true
      emitIfReady()
    },
    handleError,
  )

  const unsubscribeScannerShift = onSnapshot(
    doc(db, SHIFTS_COLLECTION, locationDocId),
    (snap) => {
      endShiftPhotosComplete = snap.exists()
        ? isEndShiftPhotosDocComplete(snap.data() as Record<string, unknown>, todayStr)
        : false
      receivedScannerShift = true
      emitIfReady()
    },
    handleError,
  )

  return () => {
    unsubscribeDeepClean()
    unsubscribeScannerShift()
  }
}

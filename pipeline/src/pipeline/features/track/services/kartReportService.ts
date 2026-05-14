import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore'
import { initializeFirestore } from '../../../lib/firebase'
import { ensureFirebaseAuthForStorage } from '../../../lib/firebase-auth'
import { resolveLocation } from '../../../../lib/locations'
import { todayIST } from '../../../lib/ist-date'
import { SCANNER_LOCATION_DOC_IDS, ScannerLocation } from '../scanner/types/scanner.types'
import { KartCondition, KartEngineStatus, KartRecord, KartStatus, KartType } from './kartService'

// ─── Constants ────────────────────────────────────────────────────────────
const KART_REPORTS_COLLECTION = 'kartReports'
const KARTS_SUBCOLLECTION = 'karts'

// ─── Types ────────────────────────────────────────────────────────────────

export type KartReportStatus = 'draft' | 'submitted'

export interface KartReportEntry {
  kartId: string
  kartNumber: string
  kartType: KartType
  condition: KartCondition
  engineStatus: KartEngineStatus
  status: KartStatus
  lastDeepCleanDate?: string
  notes?: string
}

export interface KartReportSummary {
  total: number
  good: number
  underRepair: number
  engineFail: number
  critical: number
}

export interface KartReportRecord {
  id: string
  locationDocId: string
  locationName: ScannerLocation
  reportDate: string
  status: KartReportStatus
  submittedBy: string
  submittedByUid: string
  submittedAt?: { toDate: () => Date } | null
  notes?: string
  karts: KartReportEntry[]
  summary: KartReportSummary
}

export interface SubmitKartReportInput {
  location: ScannerLocation
  entries: KartReportEntry[]
  notes?: string
  submittedBy: string
  submittedByUid: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const normalizeRole = (role: string): string =>
  String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

export const canSubmitKartReportRole = (role: string): boolean => {
  const normalized = normalizeRole(role)
  return ['owner', 'admin', 'developer', 'track_marshall', 'trackmarshall'].includes(normalized)
}

export const canViewAllKartReportsRole = (role: string): boolean => {
  const normalized = normalizeRole(role)
  return ['owner', 'admin', 'developer'].includes(normalized)
}

/**
 * Resolves any location identifier (display name OR live-registry slug
 * OR branchId) to the doc-ID segment used by the kartReports collection
 * — which is the slug-shaped value from the STATIC `SCANNER_LOCATION_DOC_IDS`
 * map (e.g. "visakhapatnam", not "0").
 *
 * Why this is non-trivial: there are two parallel slug systems in this
 * codebase. The static `SCANNER_LOCATION_DOC_IDS` (built at module load
 * from FALLBACK_LOCATIONS) maps display name → slug-shaped IDs like
 * "visakhapatnam". The live registry (after `fetchLocationsFromFirestore`)
 * returns numeric slugs like "0", "1", "2" because the actual Firestore
 * `locations/{id}` docs have `locationKey: "0"`. Kart report / karts /
 * scanner-shift docs are all written using the static slug-shaped IDs,
 * but cashier user profiles store `allowedLocations` using the live
 * numeric IDs. Without going through this resolver, those two never line
 * up and reads return null.
 *
 * Exported so callers (server gates, viewers, preflight subscriptions)
 * compute the same doc-id string as `submitKartReport` did at write time.
 */
export const resolveLocationDocId = (locationOrSlug: string): string => {
  if (!locationOrSlug) return ''
  // Path 1: input is already a display name in the static map.
  const direct = SCANNER_LOCATION_DOC_IDS[locationOrSlug]
  if (direct) return direct
  // Path 2: input is already a slug-shaped value in the static map.
  const matchedBySlug = Object.values(SCANNER_LOCATION_DOC_IDS).find(
    (slug) => slug === locationOrSlug.toLowerCase(),
  )
  if (matchedBySlug) return matchedBySlug
  // Path 3: input is a live-registry slug ("0", "1") or a branchId.
  // Resolve via the live registry to get the display name, then come
  // back through the static map so the result matches what the karts
  // and kart-report write paths use.
  const resolved = resolveLocation(locationOrSlug)
  if (resolved?.displayName) {
    const fromDisplayName = SCANNER_LOCATION_DOC_IDS[resolved.displayName]
    if (fromDisplayName) return fromDisplayName
  }
  // Last-resort fallback: return the lowercased input as-is.
  return locationOrSlug.toLowerCase()
}

export const buildKartReportDocId = (locationOrSlug: string, dateStr: string): string =>
  `${resolveLocationDocId(locationOrSlug)}_${dateStr}`

const computeSummary = (entries: KartReportEntry[]): KartReportSummary => {
  let good = 0
  let underRepair = 0
  let engineFail = 0
  let critical = 0
  for (const entry of entries) {
    if (entry.condition === 'good') good += 1
    if (entry.status === 'under_repair') underRepair += 1
    if (entry.engineStatus === 'engine_fail') engineFail += 1
    if (entry.condition === 'damaged' || entry.engineStatus === 'engine_fail') {
      critical += 1
    }
  }
  return { total: entries.length, good, underRepair, engineFail, critical }
}

const mapDocToReport = (id: string, data: Record<string, unknown>): KartReportRecord => {
  const rawEntries = Array.isArray(data.karts) ? (data.karts as KartReportEntry[]) : []
  const summary = (data.summary as KartReportSummary | undefined) ?? computeSummary(rawEntries)
  return {
    id,
    locationDocId: String(data.locationDocId ?? ''),
    locationName: String(data.locationName ?? '') as ScannerLocation,
    reportDate: String(data.reportDate ?? ''),
    status: (data.status as KartReportStatus | undefined) ?? 'submitted',
    submittedBy: String(data.submittedBy ?? ''),
    submittedByUid: String(data.submittedByUid ?? ''),
    submittedAt: (data.submittedAt as KartReportRecord['submittedAt']) ?? null,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    karts: rawEntries,
    summary,
  }
}

// ─── Read APIs ────────────────────────────────────────────────────────────

/**
 * Subscribe to a single deterministic kart-report doc for the given location
 * and date. Calls onData(null) if the report doesn't exist yet.
 */
export const subscribeKartReport = (
  locationOrSlug: string,
  dateStr: string,
  onData: (record: KartReportRecord | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData(null)
    return () => undefined
  }

  const docId = buildKartReportDocId(locationOrSlug, dateStr)
  const ref = doc(db, KART_REPORTS_COLLECTION, docId)
  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null)
        return
      }
      onData(mapDocToReport(snapshot.id, snapshot.data() as Record<string, unknown>))
    },
    (reason) => onError?.(reason as Error),
  )
}

/**
 * One-shot fetch used by the cashier shift-start gate. Never throws on a
 * missing doc — returns null instead.
 */
export const getKartReportForDate = async (
  locationOrSlug: string,
  dateStr: string,
): Promise<KartReportRecord | null> => {
  const db = initializeFirestore()
  if (!db) return null
  try {
    const docId = buildKartReportDocId(locationOrSlug, dateStr)
    const ref = doc(db, KART_REPORTS_COLLECTION, docId)
    const snapshot = await getDoc(ref)
    if (!snapshot.exists()) return null
    return mapDocToReport(snapshot.id, snapshot.data() as Record<string, unknown>)
  } catch {
    return null
  }
}

export interface KartReportFilters {
  date?: string
  locationDocId?: string
}

/**
 * Subscribe to all kart reports matching the supplied filters. Used by the
 * Owner/Admin viewer. Reports are returned sorted by reportDate descending.
 */
export const subscribeAllKartReports = (
  filters: KartReportFilters,
  onData: (records: KartReportRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const db = initializeFirestore()
  if (!db) {
    onData([])
    return () => undefined
  }

  // NOTE: We deliberately do NOT use Firestore orderBy here. Combining
  // multiple equality where-clauses with orderBy on a separate field
  // requires a composite index in Firestore. Sorting in the client keeps
  // the query indexable by Firestore's automatic single-field indexes.
  const constraints = []
  if (filters.date) {
    constraints.push(where('reportDate', '==', filters.date))
  }
  if (filters.locationDocId) {
    constraints.push(where('locationDocId', '==', filters.locationDocId))
  }

  const reportsQuery = query(collection(db, KART_REPORTS_COLLECTION), ...constraints)
  return onSnapshot(
    reportsQuery,
    (snapshot) => {
      const records = snapshot.docs.map((item) =>
        mapDocToReport(item.id, item.data() as Record<string, unknown>),
      )
      // Sort newest-first by reportDate, then by locationDocId for stable order.
      records.sort((a, b) => {
        if (a.reportDate !== b.reportDate) return a.reportDate < b.reportDate ? 1 : -1
        return a.locationDocId.localeCompare(b.locationDocId)
      })
      onData(records)
    },
    (reason) => onError?.(reason as Error),
  )
}

// ─── Write API ────────────────────────────────────────────────────────────

/**
 * Submit today's kart report for a location. This is an atomic operation:
 *   1. Idempotency guard — refuses to overwrite an already-submitted report.
 *   2. Writes the report doc with status="submitted" and serverTimestamp.
 *   3. Updates each kart in locations/{locationDocId}/karts/{kartId} with
 *      the new condition / engineStatus / status / notes.
 * The report doc plus the kart updates are committed together via writeBatch.
 */
export const submitKartReport = async ({
  location,
  entries,
  notes,
  submittedBy,
  submittedByUid,
}: SubmitKartReportInput): Promise<KartReportRecord> => {
  const db = initializeFirestore()
  if (!db) {
    throw new Error('Firestore is not configured.')
  }

  if (!location) {
    throw new Error('Location is required to submit a kart report.')
  }
  if (!entries || entries.length === 0) {
    throw new Error('Cannot submit a report with no karts.')
  }

  await ensureFirebaseAuthForStorage()

  const locationDocId = resolveLocationDocId(location)
  if (!locationDocId) {
    throw new Error(`Unknown location: ${location}`)
  }

  const reportDate = todayIST()
  const docId = `${locationDocId}_${reportDate}`
  const reportRef = doc(db, KART_REPORTS_COLLECTION, docId)

  // Idempotency guard — don't overwrite a submitted report.
  const existing = await getDoc(reportRef)
  if (existing.exists()) {
    const data = existing.data() as Record<string, unknown>
    if (data.status === 'submitted') {
      throw new Error("Today's kart report has already been submitted for this location.")
    }
  }

  const summary = computeSummary(entries)
  const sanitizedEntries: KartReportEntry[] = entries.map((entry) => {
    const sanitized: KartReportEntry = {
      kartId: entry.kartId,
      kartNumber: entry.kartNumber,
      kartType: entry.kartType,
      condition: entry.condition,
      engineStatus: entry.engineStatus,
      status: entry.status,
    }
    if (entry.lastDeepCleanDate) {
      sanitized.lastDeepCleanDate = entry.lastDeepCleanDate
    }
    if (entry.notes && entry.notes.trim()) {
      sanitized.notes = entry.notes.trim()
    }
    return sanitized
  })

  const payload = {
    locationDocId,
    locationName: location,
    reportDate,
    status: 'submitted' as KartReportStatus,
    submittedBy,
    submittedByUid,
    submittedAt: serverTimestamp(),
    notes: notes && notes.trim() ? notes.trim() : '',
    karts: sanitizedEntries,
    summary,
  }

  const batch = writeBatch(db)
  batch.set(reportRef, payload)

  // Write-through to live karts collection so KartList stays accurate.
  for (const entry of sanitizedEntries) {
    const kartRef = doc(db, 'locations', locationDocId, KARTS_SUBCOLLECTION, entry.kartId)
    batch.update(kartRef, {
      condition: entry.condition,
      engineStatus: entry.engineStatus,
      status: entry.status,
      ...(entry.notes ? { complaint: entry.notes } : {}),
      updatedAt: serverTimestamp(),
    })
  }

  await batch.commit()

  return {
    id: docId,
    locationDocId,
    locationName: location,
    reportDate,
    status: 'submitted',
    submittedBy,
    submittedByUid,
    submittedAt: null,
    notes: payload.notes,
    karts: sanitizedEntries,
    summary,
  }
}

// ─── Convenience: build entries from KartRecord[] ─────────────────────────

/**
 * Seeds report entries from the live karts list. Used by the modal when
 * opening for the first time so the form starts pre-filled with each kart's
 * current state.
 */
export const seedEntriesFromKarts = (karts: KartRecord[]): KartReportEntry[] =>
  karts.map((kart) => ({
    kartId: kart.id,
    kartNumber: kart.kartNumber,
    kartType: kart.kartType,
    condition: kart.condition,
    engineStatus: kart.engineStatus,
    status: kart.status,
    lastDeepCleanDate: kart.lastDeepCleanDate,
    notes: kart.complaint,
  }))

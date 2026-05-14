/**
 * feedback-calls-firestore.ts
 *
 * TypeScript-side data layer for the daily Feedback Calls workflow.
 *
 * The actual nightly distribution is run by the Cloud Function in
 * functions/api/feedback-calls-cron.js. This file handles every other
 * interaction the pipeline admin UI needs:
 *
 *   - Reading the queue (telecaller inbox or owner cross-telecaller view)
 *   - Single-record fetch for the detail slide-over
 *   - Status transitions (pending → in_progress → no_answer / call_later)
 *   - Feedback submission (rating + experience + issues + willVisitAgain)
 *   - Owner-triggered manual distribution (mirrors the cron logic in TS so
 *     it doesn't require Firebase Auth ID tokens — uses session tokens like
 *     every other -firestore.ts module in this codebase)
 *   - Run-summary fetch for the "View last run" Owner modal
 *   - Aggregated metrics for the Owner dashboard
 *
 * Permissions are enforced application-layer via getFirestoreSessionUser:
 *   - Telecaller: can only read/mutate calls assigned to themselves
 *   - Owner / Admin / Developer: full access plus distribution + metrics
 */

import type { DocumentData, UpdateData } from 'firebase/firestore'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, stripUndefined, toOptionalString } from './firestore-utils'
import { normalizePhone } from '../features/leads/lead-utils'
import { todayIST } from '../lib/ist-date'
import {
  FEEDBACK_CALLS_PAGE_SIZE,
  isNegativeFeedback,
  MAX_EXPERIENCE_LENGTH,
  MAX_FEEDBACK_NOTES_LENGTH,
} from '../features/feedback-calls/feedback-call-constants'
import { getAllLocations, getLocationDisplayName } from '../../lib/locations'
import type {
  FeedbackCallBookingSource,
  FeedbackCallIssue,
  FeedbackCallMetrics,
  FeedbackCallRecord,
  FeedbackCallRunSummary,
  FeedbackCallStatus,
  FeedbackIssueCategory,
  FeedbackRating,
  ListFeedbackCallsFilter,
  Role,
  SubmitFeedbackPayload,
  UserRecord,
} from './types'

// ─── Constants ───────────────────────────────────────────────────

const FEEDBACK_CALLS_COLLECTION = 'feedbackCalls'
const FEEDBACK_CONFIG_COLLECTION = 'feedbackConfig'
const FEEDBACK_CALL_RUNS_COLLECTION = 'feedbackCallRuns'
const ROUND_ROBIN_DOC_ID = 'roundRobin'

const PRIVILEGED_DISTRIBUTION_ROLES: Role[] = ['Owner', 'Admin', 'Developer']

// ─── Helpers ─────────────────────────────────────────────────────

const getFs = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

const callsCol = () => collection(getFs(), FEEDBACK_CALLS_COLLECTION)
const callRef = (id: string) => doc(getFs(), FEEDBACK_CALLS_COLLECTION, id)
const runsCol = () => collection(getFs(), FEEDBACK_CALL_RUNS_COLLECTION)
const runRef = (id: string) => doc(getFs(), FEEDBACK_CALL_RUNS_COLLECTION, id)
const roundRobinRef = () => doc(getFs(), FEEDBACK_CONFIG_COLLECTION, ROUND_ROBIN_DOC_ID)

const isFeedbackCallStatus = (value: unknown): value is FeedbackCallStatus =>
  value === 'pending' ||
  value === 'in_progress' ||
  value === 'completed' ||
  value === 'no_answer' ||
  value === 'call_later'

const isFeedbackRating = (value: unknown): value is FeedbackRating =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

const isFeedbackIssueCategory = (value: unknown): value is FeedbackIssueCategory =>
  value === 'kart_quality' ||
  value === 'service' ||
  value === 'wait_time' ||
  value === 'cleanliness' ||
  value === 'pricing' ||
  value === 'safety' ||
  value === 'other'

const sanitizeIssues = (issues: FeedbackCallIssue[] | undefined): FeedbackCallIssue[] => {
  if (!Array.isArray(issues)) return []
  return issues
    .filter(
      (issue): issue is FeedbackCallIssue =>
        Boolean(issue) && isFeedbackIssueCategory(issue.category),
    )
    .map((issue) => {
      // Omit `detail` entirely when empty — Firestore rejects nested
      // undefined inside arrays, and `stripUndefined` only walks the
      // top-level keys. The most common path through the form is users
      // ticking an issue category checkbox without typing a detail
      // string, so this matters in practice.
      const detail = toOptionalString(issue.detail)
      const sanitized: FeedbackCallIssue = { category: issue.category }
      if (detail) sanitized.detail = detail
      return sanitized
    })
}

const mapFeedbackCallRecord = (id: string, data: Record<string, unknown>): FeedbackCallRecord => {
  const createdAt = String(data.createdAt ?? nowIso())
  const updatedAt = String(data.updatedAt ?? createdAt)
  const status = isFeedbackCallStatus(data.status) ? data.status : 'pending'
  const rawIssues = Array.isArray(data.issues) ? (data.issues as FeedbackCallIssue[]) : undefined
  const rating = isFeedbackRating(data.rating) ? data.rating : undefined

  return {
    id,
    bookingId: String(data.bookingId ?? ''),
    bookingSource: (data.bookingSource as FeedbackCallBookingSource | undefined) ?? undefined,
    customerName: String(data.customerName ?? ''),
    customerPhone: String(data.customerPhone ?? ''),
    customerEmail: toOptionalString(data.customerEmail),
    branchId: String(data.branchId ?? ''),
    branchName: String(data.branchName ?? ''),
    visitDate: String(data.visitDate ?? ''),
    callDate: String(data.callDate ?? ''),
    assignedTo: String(data.assignedTo ?? ''),
    assignedAt: String(data.assignedAt ?? createdAt),
    assignedBy: String(data.assignedBy ?? ''),
    status,
    callAttempts: Number(data.callAttempts ?? 0),
    lastCallAttemptAt: toOptionalString(data.lastCallAttemptAt),
    nextAttemptAt: toOptionalString(data.nextAttemptAt),
    rating,
    experience: toOptionalString(data.experience),
    issues: rawIssues ? sanitizeIssues(rawIssues) : undefined,
    willVisitAgain: typeof data.willVisitAgain === 'boolean' ? data.willVisitAgain : undefined,
    feedbackSubmittedAt: toOptionalString(data.feedbackSubmittedAt),
    feedbackSubmittedBy: toOptionalString(data.feedbackSubmittedBy),
    feedbackNotes: toOptionalString(data.feedbackNotes),
    createdAt,
    createdBy: String(data.createdBy ?? ''),
    updatedAt,
  }
}

const mapRunSummary = (id: string, data: Record<string, unknown>): FeedbackCallRunSummary => ({
  runDate: String(data.runDate ?? id),
  visitDate: String(data.visitDate ?? ''),
  totalCustomers: Number(data.totalCustomers ?? 0),
  distributed: Number(data.distributed ?? 0),
  skippedDuplicates: Number(data.skippedDuplicates ?? 0),
  skippedNoTelecaller: Number(data.skippedNoTelecaller ?? 0),
  perBranch: (data.perBranch as FeedbackCallRunSummary['perBranch']) ?? {},
  perTelecaller: (data.perTelecaller as Record<string, number>) ?? {},
  durationMs: Number(data.durationMs ?? 0),
  trigger: data.trigger === 'manual' ? 'manual' : 'cron',
  triggeredBy: toOptionalString(data.triggeredBy),
  createdAt: String(data.createdAt ?? nowIso()),
  error: toOptionalString(data.error),
})

// ─── Permission helpers ──────────────────────────────────────────

const ensureCallVisibleTo = (call: FeedbackCallRecord, user: UserRecord): void => {
  if (isPrivilegedRole(user.role) || user.role === 'Developer') return
  if (call.assignedTo === user.id) return
  throw new Error('You are not assigned to this feedback call.')
}

const ensureDistributionRole = (user: UserRecord): void => {
  if (!PRIVILEGED_DISTRIBUTION_ROLES.includes(user.role)) {
    throw new Error('Only Owner / Admin / Developer can run feedback distribution.')
  }
}

// ─── Read APIs ───────────────────────────────────────────────────

export const listFirestoreFeedbackCalls = async (
  token: string,
  filter?: ListFeedbackCallsFilter,
): Promise<{ calls: FeedbackCallRecord[]; hasMore: boolean }> => {
  const user = await getFirestoreSessionUser(token)

  // Telecallers are forced to see only their own calls — even if the caller
  // forgets to pass `assignedTo`. This matches the leads inbox behavior.
  let assignedFilter = filter?.assignedTo
  if (!isPrivilegedRole(user.role) && user.role !== 'Developer') {
    assignedFilter = user.id
  }

  const constraints: QueryConstraint[] = [orderBy('callDate', 'desc')]

  if (assignedFilter) {
    constraints.unshift(where('assignedTo', '==', assignedFilter))
  }
  if (filter?.status) {
    constraints.unshift(where('status', '==', filter.status))
  }
  if (filter?.branchId) {
    constraints.unshift(where('branchId', '==', filter.branchId))
  }

  const size = filter?.pageSize ?? FEEDBACK_CALLS_PAGE_SIZE
  constraints.push(limit(size + 1))

  if (filter?.cursor) {
    constraints.push(startAfter(filter.cursor))
  }

  const q = query(callsCol(), ...constraints)
  const snap = await getDocs(q)
  let docs = snap.docs.map((d) => mapFeedbackCallRecord(d.id, d.data() as UpdateData<DocumentData>))

  // Client-side date range filter on callDate
  if (filter?.fromDate) {
    docs = docs.filter((c) => c.callDate >= filter.fromDate!)
  }
  if (filter?.toDate) {
    docs = docs.filter((c) => c.callDate <= filter.toDate!)
  }

  const hasMore = docs.length > size
  if (hasMore) docs.pop()

  return { calls: docs, hasMore }
}

export const getFirestoreFeedbackCall = async (
  token: string,
  callId: string,
): Promise<FeedbackCallRecord> => {
  const user = await getFirestoreSessionUser(token)
  const snap = await getDoc(callRef(callId))
  if (!snap.exists()) throw new Error('Feedback call not found.')
  const record = mapFeedbackCallRecord(snap.id, snap.data() as UpdateData<DocumentData>)
  ensureCallVisibleTo(record, user)
  return record
}

// ─── Status transitions ──────────────────────────────────────────

export type FeedbackCallTransition = 'in_progress' | 'no_answer' | 'call_later'

const isAllowedTransition = (next: string): next is FeedbackCallTransition =>
  next === 'in_progress' || next === 'no_answer' || next === 'call_later'

export const updateFeedbackCallStatus = async (
  token: string,
  callId: string,
  nextStatus: FeedbackCallTransition,
  meta?: { nextAttemptAt?: string },
): Promise<FeedbackCallRecord> => {
  const user = await getFirestoreSessionUser(token)
  if (!isAllowedTransition(nextStatus)) {
    throw new Error(`Invalid status transition: ${String(nextStatus)}`)
  }

  const ref = callRef(callId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Feedback call not found.')
  const current = mapFeedbackCallRecord(snap.id, snap.data() as UpdateData<DocumentData>)
  ensureCallVisibleTo(current, user)

  if (current.status === 'completed') {
    throw new Error('This feedback call is already completed.')
  }

  const now = nowIso()
  const updates: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: now,
    lastCallAttemptAt: now,
  }

  if (nextStatus === 'no_answer') {
    updates.callAttempts = current.callAttempts + 1
    updates.nextAttemptAt = null
  } else if (nextStatus === 'call_later') {
    if (meta?.nextAttemptAt) {
      updates.nextAttemptAt = meta.nextAttemptAt
    } else {
      updates.nextAttemptAt = null
    }
  } else if (nextStatus === 'in_progress') {
    updates.nextAttemptAt = null
  }

  await updateDoc(ref, stripUndefined(updates) as UpdateData<DocumentData>)
  const updated = await getDoc(ref)
  return mapFeedbackCallRecord(updated.id, updated.data() as UpdateData<DocumentData>)
}

// ─── Feedback submission ─────────────────────────────────────────

export const submitFeedbackCallResult = async (
  token: string,
  callId: string,
  payload: SubmitFeedbackPayload,
): Promise<FeedbackCallRecord> => {
  const user = await getFirestoreSessionUser(token)

  if (!isFeedbackRating(payload.rating)) {
    throw new Error('Rating must be a whole number from 1 to 5.')
  }
  const experience = String(payload.experience ?? '').trim()
  if (!experience) {
    throw new Error('Experience is required.')
  }
  if (experience.length > MAX_EXPERIENCE_LENGTH) {
    throw new Error(`Experience must be ${MAX_EXPERIENCE_LENGTH} characters or fewer.`)
  }
  const feedbackNotes = payload.feedbackNotes ? String(payload.feedbackNotes).trim() : ''
  if (feedbackNotes.length > MAX_FEEDBACK_NOTES_LENGTH) {
    throw new Error(`Notes must be ${MAX_FEEDBACK_NOTES_LENGTH} characters or fewer.`)
  }
  const issues = sanitizeIssues(payload.issues)

  const ref = callRef(callId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Feedback call not found.')
  const current = mapFeedbackCallRecord(snap.id, snap.data() as UpdateData<DocumentData>)
  ensureCallVisibleTo(current, user)

  if (current.status === 'completed') {
    throw new Error('Feedback has already been submitted for this call.')
  }

  const now = nowIso()
  const updates: Record<string, unknown> = {
    status: 'completed',
    rating: payload.rating,
    experience,
    issues,
    willVisitAgain: Boolean(payload.willVisitAgain),
    feedbackNotes: feedbackNotes || null,
    feedbackSubmittedAt: now,
    feedbackSubmittedBy: user.id,
    lastCallAttemptAt: now,
    nextAttemptAt: null,
    updatedAt: now,
  }

  await updateDoc(ref, stripUndefined(updates) as UpdateData<DocumentData>)
  const updated = await getDoc(ref)
  return mapFeedbackCallRecord(updated.id, updated.data() as UpdateData<DocumentData>)
}

// ─── Run summary fetch (Owner "View last run" modal) ─────────────

export const getFirestoreFeedbackCallRun = async (
  token: string,
  runDate: string,
): Promise<FeedbackCallRunSummary | null> => {
  const user = await getFirestoreSessionUser(token)
  ensureDistributionRole(user)
  const snap = await getDoc(runRef(runDate))
  if (!snap.exists()) return null
  return mapRunSummary(snap.id, snap.data() as UpdateData<DocumentData>)
}

export const listFirestoreFeedbackCallRuns = async (
  token: string,
  pageSize = 30,
): Promise<FeedbackCallRunSummary[]> => {
  const user = await getFirestoreSessionUser(token)
  ensureDistributionRole(user)
  const q = query(runsCol(), orderBy('runDate', 'desc'), limit(pageSize))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapRunSummary(d.id, d.data() as UpdateData<DocumentData>))
}

// ─── Manual distribution trigger ─────────────────────────────────
//
// Mirrors `functions/lib/feedback-call-helpers.js → distributeFeedbackCalls`
// in TypeScript so the Owner UI can run it directly via the standard
// session-token auth path used by every other -firestore.ts module — no
// CORS, no Firebase Auth ID token, no Cloud Function call from the browser.
//
// The scheduled cron in functions/api/feedback-calls-cron.js still owns
// the daily 09:00 IST run; this is the "Run distribution now" button path.

interface DistributionCustomer {
  bookingId: string
  bookingSource?: FeedbackCallBookingSource
  name: string
  phone: string
  email: string | null
  branchId: string // canonical slug
  branchName: string
  transactionDate: string
}

const isCanonicalBranchSlug = (slug: string): boolean =>
  getAllLocations().some((l) => l.slug === slug)

const resolveBranchSlugForCall = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const lower = raw.trim().toLowerCase()
  if (!lower) return null
  if (isCanonicalBranchSlug(lower)) return lower
  const locations = getAllLocations()
  const match = locations.find(
    (l) =>
      l.slug === lower ||
      l.branchId === lower ||
      l.displayName.toLowerCase() === lower ||
      l.shortName.toLowerCase() === lower,
  )
  return match ? match.slug : null
}

const collectIfEligible = (doc: {
  id: string
  data: () => Record<string, unknown> | undefined
}): DistributionCustomer | null => {
  const data = doc.data() || {}
  // Soft-deleted bookings should never seed feedback calls — the customer
  // didn't actually complete the visit (the trash usually means refund or
  // duplicate cleanup), and calling them would be confusing.
  if (data.deletedAt) return null
  const status = String(data.bookingStatus ?? '').toLowerCase()
  if (status !== 'confirmed' && status !== 'completed') return null
  const rawPhone = String(data.customerPhone ?? data.userPhone ?? '')
  const phone = normalizePhone(rawPhone)
  if (!phone || phone.length !== 10) return null
  const name = String(data.customerName ?? data.userDisplayName ?? '').trim()
  if (!name) return null
  const branchId = resolveBranchSlugForCall(data.locationId)
  if (!branchId) return null
  const bookingSource = data.source as FeedbackCallBookingSource | undefined
  return {
    bookingId: doc.id,
    bookingSource:
      bookingSource &&
      (bookingSource === 'APP_BOOKING' ||
        bookingSource === 'ADMIN_BOOKING' ||
        bookingSource === 'POS')
        ? bookingSource
        : undefined,
    name,
    phone,
    email: toOptionalString(data.customerEmail) ?? null,
    branchId,
    branchName: getLocationDisplayName(branchId),
    transactionDate: String(data.transactionDate ?? ''),
  }
}

const fetchEligibleCustomers = async (visitDate: string): Promise<DistributionCustomer[]> => {
  const fs = getFs()
  const seen = new Set<string>()
  const customers: DistributionCustomer[] = []

  const consume = (snap: {
    docs: Array<{ id: string; data: () => Record<string, unknown> | undefined }>
  }): void => {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      const customer = collectIfEligible(d)
      if (customer) customers.push(customer)
    }
  }

  const path1 = await getDocs(
    query(
      collection(fs, 'bookings'),
      where('visitDate', '==', visitDate),
      where('paymentStatus', '==', 'completed'),
    ),
  )
  consume(path1)

  const path2 = await getDocs(
    query(
      collection(fs, 'bookings'),
      where('transactionDate', '==', visitDate),
      where('paymentStatus', '==', 'completed'),
    ),
  )
  consume(path2)

  return customers
}

const dedupeByPhone = (customers: DistributionCustomer[]): DistributionCustomer[] => {
  const byPhone = new Map<string, DistributionCustomer>()
  for (const c of customers) {
    const existing = byPhone.get(c.phone)
    if (!existing) {
      byPhone.set(c.phone, c)
      continue
    }
    if ((c.transactionDate || '') > (existing.transactionDate || '')) {
      byPhone.set(c.phone, c)
    }
  }
  return Array.from(byPhone.values())
}

interface ActiveTelecaller {
  id: string
  name: string
}

const getActiveTelecallersForBranch = async (
  branchSlug: string,
  todayStr: string,
): Promise<ActiveTelecaller[]> => {
  const fs = getFs()
  const usersSnap = await getDocs(
    query(
      collection(fs, 'users'),
      where('role', '==', 'Telecaller'),
      where('isActive', '==', true),
    ),
  )
  if (usersSnap.empty) return []

  const branchId = (() => {
    const loc = getAllLocations().find((l) => l.slug === branchSlug)
    return loc?.branchId ?? null
  })()

  let candidates = usersSnap.docs.map((d) => {
    const data = d.data() || {}
    return {
      id: d.id,
      name: String(data.name ?? data.fullName ?? d.id),
      allowedLocations: Array.isArray(data.allowedLocations)
        ? (data.allowedLocations as string[])
        : null,
    }
  })

  const branchFiltered = candidates.filter((u) => {
    const allowed = u.allowedLocations
    if (!Array.isArray(allowed) || allowed.length === 0) return true
    return allowed.includes(branchSlug) || (branchId !== null && allowed.includes(branchId))
  })
  if (branchFiltered.length > 0) candidates = branchFiltered

  const shiftsSnap = await getDocs(
    query(
      collection(fs, 'shifts'),
      where('shiftDate', '==', todayStr),
      where('role', '==', 'Telecaller'),
    ),
  )
  const onShiftIds = new Set<string>()
  for (const sd of shiftsSnap.docs) {
    const data = sd.data() || {}
    if (!data.endTime) onShiftIds.add(String(data.userId ?? ''))
  }
  const onShiftCandidates = candidates.filter((c) => onShiftIds.has(c.id))
  const pool = onShiftCandidates.length > 0 ? onShiftCandidates : candidates
  return pool.map((c) => ({ id: c.id, name: c.name }))
}

const pickNextTelecaller = async (
  branchSlug: string,
  telecallers: ActiveTelecaller[],
): Promise<ActiveTelecaller> => {
  const pool = [...telecallers].sort((a, b) => a.id.localeCompare(b.id))
  const ref = roundRobinRef()
  const snap = await getDoc(ref)
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {}
  const branchCounters = {
    ...((data.branchCounters as Record<string, number>) ?? {}),
  }
  const lastIndex = typeof branchCounters[branchSlug] === 'number' ? branchCounters[branchSlug] : -1
  const nextIndex = (lastIndex + 1) % pool.length
  branchCounters[branchSlug] = nextIndex
  await setDoc(ref, { branchCounters, updatedAt: nowIso() }, { merge: true })
  return pool[nextIndex]
}

const yesterdayIstString = (): string => {
  const utcMs = Date.now()
  const istMs = utcMs - 24 * 60 * 60 * 1000 + 5.5 * 60 * 60 * 1000
  const ist = new Date(istMs)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const triggerFeedbackCallsDistribution = async (
  token: string,
  options?: { forDate?: string },
): Promise<FeedbackCallRunSummary> => {
  const user = await getFirestoreSessionUser(token)
  ensureDistributionRole(user)

  const visitDate = options?.forDate?.trim() || yesterdayIstString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
    throw new Error('forDate must be a YYYY-MM-DD string.')
  }
  const callDate = todayIST()
  const startedAt = Date.now()

  const rawCustomers = await fetchEligibleCustomers(visitDate)
  const customers = dedupeByPhone(rawCustomers)

  // Group by branch
  const byBranch = new Map<string, DistributionCustomer[]>()
  for (const c of customers) {
    if (!byBranch.has(c.branchId)) byBranch.set(c.branchId, [])
    byBranch.get(c.branchId)!.push(c)
  }

  let totalDistributed = 0
  let totalSkippedDup = 0
  let totalSkippedNoTel = 0
  const perBranch: Record<string, { distributed: number; skipped: number }> = {}
  const perTelecaller: Record<string, number> = {}

  for (const [branchSlug, customersForBranch] of byBranch.entries()) {
    const telecallers = await getActiveTelecallersForBranch(branchSlug, callDate)
    if (telecallers.length === 0) {
      totalSkippedNoTel += customersForBranch.length
      perBranch[branchSlug] = { distributed: 0, skipped: customersForBranch.length }
      continue
    }

    let distributed = 0
    let skippedDup = 0
    for (const customer of customersForBranch) {
      try {
        const telecaller = await pickNextTelecaller(branchSlug, telecallers)
        const docId = `${branchSlug}_${customer.phone}_${callDate}`
        const ref = callRef(docId)

        const existing = await getDoc(ref)
        if (existing.exists()) {
          skippedDup++
          totalSkippedDup++
          continue
        }

        const now = nowIso()
        await setDoc(
          ref,
          stripUndefined({
            bookingId: customer.bookingId,
            bookingSource: customer.bookingSource ?? null,
            customerName: customer.name,
            customerPhone: customer.phone,
            customerEmail: customer.email,
            branchId: branchSlug,
            branchName: customer.branchName,
            visitDate,
            callDate,
            assignedTo: telecaller.id,
            assignedAt: now,
            assignedBy: user.id,
            status: 'pending',
            callAttempts: 0,
            createdAt: now,
            createdBy: user.id,
            updatedAt: now,
          }),
        )

        distributed++
        totalDistributed++
        perTelecaller[telecaller.id] = (perTelecaller[telecaller.id] ?? 0) + 1
      } catch {
        // Per-customer failures don't abort the run
      }
    }
    perBranch[branchSlug] = { distributed, skipped: skippedDup }
  }

  const summary: FeedbackCallRunSummary = {
    runDate: callDate,
    visitDate,
    totalCustomers: customers.length,
    distributed: totalDistributed,
    skippedDuplicates: totalSkippedDup,
    skippedNoTelecaller: totalSkippedNoTel,
    perBranch,
    perTelecaller,
    durationMs: Date.now() - startedAt,
    trigger: 'manual',
    triggeredBy: user.id,
    createdAt: nowIso(),
  }

  try {
    await setDoc(runRef(callDate), summary, { merge: true })
  } catch {
    // Audit-write failure is non-blocking
  }

  return summary
}

// ─── Metrics ─────────────────────────────────────────────────────

export interface FeedbackMetricsFilter {
  fromDate?: string
  toDate?: string
  branchId?: string
}

const emptyPerRating = (): Record<FeedbackRating, number> => ({
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
})

const emptyPerIssue = (): Record<FeedbackIssueCategory, number> => ({
  kart_quality: 0,
  service: 0,
  wait_time: 0,
  cleanliness: 0,
  pricing: 0,
  safety: 0,
  other: 0,
})

export const getFirestoreFeedbackCallMetrics = async (
  token: string,
  filter?: FeedbackMetricsFilter,
): Promise<FeedbackCallMetrics> => {
  const user = await getFirestoreSessionUser(token)
  ensureDistributionRole(user)

  // Build the query — no client-side text filter, this is a pure aggregation
  const constraints: QueryConstraint[] = [orderBy('callDate', 'desc')]
  if (filter?.branchId) constraints.unshift(where('branchId', '==', filter.branchId))
  // Date range goes through the index naturally because callDate is the
  // orderBy field. We use cursor-style range filters server-side.
  if (filter?.fromDate) constraints.unshift(where('callDate', '>=', filter.fromDate))
  if (filter?.toDate) constraints.unshift(where('callDate', '<=', filter.toDate))

  const snap = await getDocs(query(callsCol(), ...constraints))

  const records = snap.docs.map((d) =>
    mapFeedbackCallRecord(d.id, d.data() as UpdateData<DocumentData>),
  )

  let total = 0
  let completed = 0
  let pending = 0
  let noAnswer = 0
  let callLater = 0
  let ratingSum = 0
  let ratingCount = 0
  let negativeCount = 0

  const perRating = emptyPerRating()
  const perIssue = emptyPerIssue()

  // Per-telecaller / per-branch aggregations
  type TelecallerAgg = {
    telecallerId: string
    telecallerName: string
    total: number
    completed: number
    ratingSum: number
    ratingCount: number
    negative: number
  }
  type BranchAgg = {
    branchId: string
    branchName: string
    total: number
    completed: number
    ratingSum: number
    ratingCount: number
    negative: number
  }
  const telecallerMap = new Map<string, TelecallerAgg>()
  const branchMap = new Map<string, BranchAgg>()

  for (const r of records) {
    total++
    if (r.status === 'completed') completed++
    else if (r.status === 'pending') pending++
    else if (r.status === 'no_answer') noAnswer++
    else if (r.status === 'call_later') callLater++

    const issuesCount = Array.isArray(r.issues) ? r.issues.length : 0
    const isNegative = isNegativeFeedback(r.rating, issuesCount)
    if (isNegative) negativeCount++

    if (typeof r.rating === 'number') {
      ratingSum += r.rating
      ratingCount++
      perRating[r.rating] = (perRating[r.rating] ?? 0) + 1
    }
    if (Array.isArray(r.issues)) {
      for (const issue of r.issues) {
        if (issue && isFeedbackIssueCategory(issue.category)) {
          perIssue[issue.category] = (perIssue[issue.category] ?? 0) + 1
        }
      }
    }

    // Per-telecaller
    if (r.assignedTo) {
      let agg = telecallerMap.get(r.assignedTo)
      if (!agg) {
        agg = {
          telecallerId: r.assignedTo,
          telecallerName: r.assignedTo, // resolved client-side from a users map
          total: 0,
          completed: 0,
          ratingSum: 0,
          ratingCount: 0,
          negative: 0,
        }
        telecallerMap.set(r.assignedTo, agg)
      }
      agg.total++
      if (r.status === 'completed') agg.completed++
      if (typeof r.rating === 'number') {
        agg.ratingSum += r.rating
        agg.ratingCount++
      }
      if (isNegative) agg.negative++
    }

    // Per-branch
    if (r.branchId) {
      let agg = branchMap.get(r.branchId)
      if (!agg) {
        agg = {
          branchId: r.branchId,
          branchName: r.branchName || getLocationDisplayName(r.branchId),
          total: 0,
          completed: 0,
          ratingSum: 0,
          ratingCount: 0,
          negative: 0,
        }
        branchMap.set(r.branchId, agg)
      }
      agg.total++
      if (r.status === 'completed') agg.completed++
      if (typeof r.rating === 'number') {
        agg.ratingSum += r.rating
        agg.ratingCount++
      }
      if (isNegative) agg.negative++
    }
  }

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
  const averageRating = ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : 0

  const perTelecaller = Array.from(telecallerMap.values())
    .map((t) => ({
      telecallerId: t.telecallerId,
      telecallerName: t.telecallerName,
      total: t.total,
      completed: t.completed,
      averageRating: t.ratingCount > 0 ? Number((t.ratingSum / t.ratingCount).toFixed(2)) : 0,
      negative: t.negative,
      completionRate: t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0,
    }))
    .sort((a, b) => b.completionRate - a.completionRate || b.total - a.total)

  const perBranch = Array.from(branchMap.values())
    .map((b) => ({
      branchId: b.branchId,
      branchName: b.branchName,
      total: b.total,
      completed: b.completed,
      averageRating: b.ratingCount > 0 ? Number((b.ratingSum / b.ratingCount).toFixed(2)) : 0,
      negative: b.negative,
    }))
    .sort((a, b) => b.total - a.total)

  return {
    total,
    completed,
    pending,
    noAnswer,
    callLater,
    completionRate,
    averageRating,
    negativeCount,
    perTelecaller,
    perBranch,
    perRating,
    perIssue,
  }
}

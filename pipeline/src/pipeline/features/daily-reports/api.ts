/**
 * Daily Reports — data layer.
 *
 * Reads `shifts` for the date/branch scope, derives per-method discrepancies,
 * and provides comment + review write paths against a `shifts/{id}/comments`
 * subcollection plus root-level review fields on the shift document.
 *
 * Keeps Firestore writes thin — every mutation here is a single `setDoc`
 * or `addDoc` that the hub layer calls optimistically.
 */

import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { initializeFirestore } from '../../lib/firebase'
import { getFirestoreSessionUser } from '../../api/firestore-session'
import { listFirestoreShifts } from '../../api/shifts-firestore'
import {
  getEnabledLocations,
  getLocationDisplayName,
  normalizeLocationSlug,
} from '../../../lib/locations'
import { logger } from '../../../lib/logger'
import type { ShiftRecord } from '../../api/shifts'
import type {
  AuditShift,
  BranchRollup,
  DiscrepancyTone,
  MethodDiscrepancy,
  ShiftCommentRecord,
  ShiftReviewState,
} from './types'

const SHIFTS_COLLECTION = 'shifts'

const toMethodDiff = (entered: number, actual: number): MethodDiscrepancy => ({
  entered,
  actual,
  diff: entered - actual,
})

const toneFor = (entered: number, actual: number, hasSettlement: boolean): DiscrepancyTone => {
  if (!hasSettlement) return 'pending'
  const diff = entered - actual
  if (diff === 0) return 'settled'
  return diff > 0 ? 'excess' : 'shortage'
}

/**
 * Roles allowed to perform shift-audit actions (Mark reviewed, Clear flag).
 * Owner / Admin / Developer were original; Accountant added because they
 * own the books and are accountable for shift reconciliation; HR added
 * because shift discipline (settlement accuracy, flagging suspicious
 * counts) is also a workforce-management concern.
 */
const isPrivilegedRoleString = (role: string): boolean =>
  role === 'Owner' ||
  role === 'Admin' ||
  role === 'Developer' ||
  role === 'Accountant' ||
  role === 'HR'

/**
 * Loads every shift on `date` and decorates it with comment counts + review
 * state. Reads comments and review state in parallel so the ledger can render
 * fully populated without follow-up roundtrips.
 */
export const listAuditShiftsForDate = async (
  token: string,
  date: string,
  options?: { userIdScope?: string; cashierOnly?: boolean },
): Promise<AuditShift[]> => {
  const shifts = await listFirestoreShifts(token, {
    from: date,
    to: date,
    role: options?.cashierOnly ? 'Cashier' : undefined,
    userId: options?.userIdScope,
  })

  // Hydrate each shift with its review-state and comments in parallel.
  const decorated = await Promise.all(
    shifts.map(async (shift) => {
      const [reviewState, commentSummary] = await Promise.all([
        readShiftReviewState(shift.id),
        countShiftComments(shift.id),
      ])
      return decorateShift(shift, reviewState, commentSummary)
    }),
  )
  return decorated.sort(
    (a, b) =>
      a.branchDisplayName.localeCompare(b.branchDisplayName) ||
      a.cashierDisplayName.localeCompare(b.cashierDisplayName),
  )
}

/**
 * Loads every shift over a date range. Used by `/shifts/reports` (date-range
 * mode) — does NOT hydrate comments/reviews to keep wide ranges performant.
 */
export const listAuditShiftsForRange = async (
  token: string,
  from: string,
  to: string,
  options?: { userIdScope?: string; cashierOnly?: boolean },
): Promise<AuditShift[]> => {
  const shifts = await listFirestoreShifts(token, {
    from,
    to,
    role: options?.cashierOnly ? 'Cashier' : undefined,
    userId: options?.userIdScope,
  })
  return shifts.map((shift) => decorateShift(shift, emptyReviewState(), { count: 0, flagCount: 0 }))
}

const emptyReviewState = (): ShiftReviewState => ({ flagged: false })

const decorateShift = (
  shift: ShiftRecord,
  review: ShiftReviewState,
  commentSummary: { count: number; flagCount: number },
): AuditShift => {
  const settlement = shift.settlement
  const cash = toMethodDiff(settlement?.cashEntered ?? 0, settlement?.cashActual ?? 0)
  const card = toMethodDiff(settlement?.cardEntered ?? 0, settlement?.cardActual ?? 0)
  const upi = toMethodDiff(settlement?.upiEntered ?? 0, settlement?.upiActual ?? 0)
  const totalEntered = cash.entered + card.entered + upi.entered
  const totalActual = cash.actual + card.actual + upi.actual
  const tone = toneFor(totalEntered, totalActual, Boolean(settlement))
  // Canonicalize locationId → slug at read time. The 2026-05-12 shifts
  // backfill normalized historical data, but a write that lands as
  // numeric ("0", "1", ...) or alias ("vizag") would otherwise re-break
  // the rollup that keys its tile map by slug.
  const branchSlug = normalizeLocationSlug(shift.locationId)
  return {
    shift,
    cash,
    card,
    upi,
    totalEntered,
    totalActual,
    totalDiff: totalEntered - totalActual,
    tone,
    branchSlug,
    branchDisplayName: shift.locationName || getLocationDisplayName(branchSlug),
    cashierDisplayName: shift.userId, // ShiftRecord doesn't carry display name; ledger merges it via a names map below.
    commentCount: commentSummary.count,
    flagCount: commentSummary.flagCount,
    review,
  }
}

/**
 * Display-merge multiple same-day shifts for the same cashier+branch into a
 * single row. The 2026-05-11 check-in/check-out bug left clusters of shift
 * docs (one per failed checkout attempt) — they're all individually correct
 * in Firestore (audit trail preserved) but show up as visual noise in the
 * ledger. Grouping key: `userId + branchSlug + shiftDate`.
 *
 * Roll-up rules:
 * - Primary sub-shift is the earliest startTime; its id drives selection.
 * - Times: earliest startTime, latest endTime across the group.
 * - Settlement: per-method `entered` / `actual` sum across all sub-shifts
 *   that carry a settlement; diffs recompute from the merged sums so they
 *   stay consistent with what the cashier physically counted.
 * - Comment / flag counts: sum.
 * - Review state: any reviewed → merged is reviewed; any flagged → flagged.
 * - Tone: recomputed from merged totals.
 *
 * A group of size 1 round-trips unchanged (`subShifts` left undefined) so
 * downstream consumers can opt-into the "this row is merged" branch only
 * when there's actually something to drill into.
 */
export const mergeAuditShifts = (audits: AuditShift[]): AuditShift[] => {
  const groups = new Map<string, AuditShift[]>()
  for (const audit of audits) {
    const key = `${audit.shift.userId}::${audit.branchSlug}::${audit.shift.shiftDate}`
    const existing = groups.get(key)
    if (existing) existing.push(audit)
    else groups.set(key, [audit])
  }

  const merged: AuditShift[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }
    merged.push(buildMergedAudit(group))
  }

  // Match the existing sort order from listAuditShiftsForDate.
  return merged.sort(
    (a, b) =>
      a.branchDisplayName.localeCompare(b.branchDisplayName) ||
      a.cashierDisplayName.localeCompare(b.cashierDisplayName),
  )
}

const buildMergedAudit = (group: AuditShift[]): AuditShift => {
  const sorted = [...group].sort((a, b) =>
    a.shift.startTime.localeCompare(b.shift.startTime),
  )
  const primary = sorted[0]
  const last = sorted[sorted.length - 1]

  const sumSettlement = (key: 'cash' | 'card' | 'upi'): MethodDiscrepancy => {
    let entered = 0
    let actual = 0
    for (const a of group) {
      entered += a[key].entered
      actual += a[key].actual
    }
    return { entered, actual, diff: entered - actual }
  }

  const cash = sumSettlement('cash')
  const card = sumSettlement('card')
  const upi = sumSettlement('upi')
  const totalEntered = cash.entered + card.entered + upi.entered
  const totalActual = cash.actual + card.actual + upi.actual
  const totalDiff = totalEntered - totalActual

  // A merged settlement exists if any sub-shift had one. Tone falls back
  // to 'pending' otherwise (e.g. all sub-shifts are still in-progress).
  const hasSettlement = group.some((a) => Boolean(a.shift.settlement))
  const tone = hasSettlement
    ? totalDiff === 0
      ? 'settled'
      : totalDiff > 0
        ? 'excess'
        : 'shortage'
    : ('pending' as DiscrepancyTone)

  const totalTransactions = group.reduce(
    (acc, a) => acc + (a.shift.settlement?.totalTransactions ?? 0),
    0,
  )
  // The merged shift's display time spans the earliest start → latest end.
  // We mint a synthetic ShiftRecord whose id keeps the primary sub-shift's
  // id so downstream selection logic continues to work.
  const mergedShift = {
    ...primary.shift,
    startTime: primary.shift.startTime,
    endTime: last.shift.endTime ?? primary.shift.endTime,
    settlement: hasSettlement
      ? {
          ...primary.shift.settlement,
          cashEntered: cash.entered,
          cardEntered: card.entered,
          upiEntered: upi.entered,
          cashActual: cash.actual,
          cardActual: card.actual,
          upiActual: upi.actual,
          totalTransactions,
          settledAt:
            sorted.find((a) => a.shift.settlement?.settledAt)?.shift.settlement?.settledAt ?? '',
          locationId: primary.shift.locationId,
        }
      : undefined,
  } as typeof primary.shift

  const reviewedSrc = group.find((a) => a.review.reviewedAt)
  const flaggedSrc = group.find((a) => a.review.flagged || a.review.flaggedAt)

  return {
    shift: mergedShift,
    cash,
    card,
    upi,
    totalEntered,
    totalActual,
    totalDiff,
    tone,
    branchSlug: primary.branchSlug,
    branchDisplayName: primary.branchDisplayName,
    cashierDisplayName: primary.cashierDisplayName,
    commentCount: group.reduce((acc, a) => acc + a.commentCount, 0),
    flagCount: group.reduce((acc, a) => acc + a.flagCount, 0),
    review: {
      flagged: Boolean(flaggedSrc),
      flaggedAt: flaggedSrc?.review.flaggedAt,
      flaggedBy: flaggedSrc?.review.flaggedBy,
      flaggedByName: flaggedSrc?.review.flaggedByName,
      reviewedAt: reviewedSrc?.review.reviewedAt,
      reviewedBy: reviewedSrc?.review.reviewedBy,
      reviewedByName: reviewedSrc?.review.reviewedByName,
    },
    subShifts: sorted,
  }
}

/** Roll the shift list up by branch — drives the Discrepancy Strip tiles. */
export const rollupByBranch = (audits: AuditShift[]): BranchRollup[] => {
  const enabledBranches = getEnabledLocations()
  const byBranch = new Map<string, BranchRollup>()
  for (const branch of enabledBranches) {
    byBranch.set(branch.slug, {
      branchSlug: branch.slug,
      branchDisplayName: branch.displayName,
      shiftCount: 0,
      reviewedCount: 0,
      flaggedCount: 0,
      totalEntered: 0,
      totalActual: 0,
      totalDiff: 0,
      tone: 'settled',
      excessAmount: 0,
      shortageAmount: 0,
      excessShifts: 0,
      shortageShifts: 0,
    })
  }
  for (const audit of audits) {
    const tile =
      byBranch.get(audit.branchSlug) ??
      byBranch.get(getEnabledLocations().find((b) => b.slug === audit.branchSlug)?.slug ?? '')
    if (!tile) continue
    tile.shiftCount += 1
    if (audit.review.reviewedAt) tile.reviewedCount += 1
    if (audit.review.flagged || audit.flagCount > 0) tile.flaggedCount += 1
    tile.totalEntered += audit.totalEntered
    tile.totalActual += audit.totalActual
    tile.totalDiff += audit.totalDiff
    if (audit.tone === 'excess') {
      tile.excessAmount += audit.totalDiff
      tile.excessShifts += 1
    } else if (audit.tone === 'shortage') {
      tile.shortageAmount += Math.abs(audit.totalDiff)
      tile.shortageShifts += 1
    }
  }
  for (const tile of byBranch.values()) {
    if (tile.shiftCount === 0) {
      tile.tone = 'pending'
    } else if (tile.totalDiff === 0) {
      tile.tone = 'settled'
    } else if (tile.totalDiff > 0) {
      tile.tone = 'excess'
    } else {
      tile.tone = 'shortage'
    }
  }
  return [...byBranch.values()].sort((a, b) =>
    a.branchDisplayName.localeCompare(b.branchDisplayName),
  )
}

// ─── Comments ──────────────────────────────────────────────────────────────

const commentsCollection = (shiftId: string) => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, SHIFTS_COLLECTION, shiftId, 'comments')
}

export const listShiftComments = async (shiftId: string): Promise<ShiftCommentRecord[]> => {
  const ref = commentsCollection(shiftId)
  if (!ref) return []
  const snap = await getDocs(query(ref, orderBy('createdAt', 'asc')))
  return snap.docs.map((d) => mapComment(shiftId, d.id, d.data() as Record<string, unknown>))
}

const mapComment = (
  shiftId: string,
  id: string,
  data: Record<string, unknown>,
): ShiftCommentRecord => ({
  id,
  shiftId,
  authorId: String(data.authorId ?? ''),
  authorName: String(data.authorName ?? 'Unknown'),
  authorRole: String(data.authorRole ?? 'unknown'),
  body: String(data.body ?? ''),
  severity: data.severity === 'flag' ? 'flag' : 'comment',
  createdAt:
    data.createdAt instanceof Timestamp
      ? data.createdAt.toDate().toISOString()
      : String(data.createdAt ?? new Date().toISOString()),
  parentId: data.parentId ? String(data.parentId) : undefined,
})

const countShiftComments = async (
  shiftId: string,
): Promise<{ count: number; flagCount: number }> => {
  const ref = commentsCollection(shiftId)
  if (!ref) return { count: 0, flagCount: 0 }
  try {
    const snap = await getDocs(ref)
    let count = 0
    let flagCount = 0
    snap.forEach((d) => {
      count += 1
      const data = d.data() as Record<string, unknown>
      if (data.severity === 'flag') flagCount += 1
    })
    return { count, flagCount }
  } catch {
    return { count: 0, flagCount: 0 }
  }
}

export const addShiftComment = async (
  token: string,
  shiftId: string,
  body: string,
  severity: 'comment' | 'flag' = 'comment',
  parentId?: string,
): Promise<ShiftCommentRecord> => {
  const ref = commentsCollection(shiftId)
  if (!ref) throw new Error('Firestore is not configured.')
  const session = await getFirestoreSessionUser(token)
  const trimmed = body.trim()
  if (trimmed.length < 1) throw new Error('Comment body cannot be empty.')
  if (severity === 'flag' && trimmed.length < 10) {
    throw new Error('A flag must include at least 10 characters explaining why.')
  }
  const created = new Date().toISOString()
  const doc = await addDoc(ref, {
    authorId: session.id,
    authorName: session.name,
    authorRole: session.role,
    body: trimmed,
    severity,
    parentId: parentId ?? null,
    createdAt: created,
  })
  // Mirror the latest flag onto the shift root for cheap ledger reads.
  if (severity === 'flag') {
    try {
      const firestore = initializeFirestore()
      if (firestore) {
        await setDoc(
          firestoreDoc(firestore, shiftId),
          {
            flagged: true,
            flaggedAt: created,
            flaggedBy: session.id,
            flaggedByName: session.name,
          },
          { merge: true },
        )
      }
    } catch (err) {
      logger.warn('daily_reports.flag_mirror_failed', { shiftId })
      void err
    }
  }
  return {
    id: doc.id,
    shiftId,
    authorId: session.id,
    authorName: session.name,
    authorRole: session.role,
    body: trimmed,
    severity,
    createdAt: created,
    parentId,
  }
}

export const deleteShiftComment = async (shiftId: string, commentId: string): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  await deleteDoc(doc(firestore, SHIFTS_COLLECTION, shiftId, 'comments', commentId))
}

// ─── Review state ──────────────────────────────────────────────────────────

const firestoreDoc = (
  firestore: ReturnType<typeof initializeFirestore>,
  shiftId: string,
): ReturnType<typeof doc> => {
  if (!firestore) throw new Error('Firestore not configured.')
  return doc(firestore, SHIFTS_COLLECTION, shiftId)
}

const readShiftReviewState = async (shiftId: string): Promise<ShiftReviewState> => {
  const firestore = initializeFirestore()
  if (!firestore) return emptyReviewState()
  try {
    const snap = await getDoc(doc(firestore, SHIFTS_COLLECTION, shiftId))
    if (!snap.exists()) return emptyReviewState()
    const data = snap.data() as Record<string, unknown>
    return {
      flagged: data.flagged === true,
      flaggedAt: data.flaggedAt ? String(data.flaggedAt) : undefined,
      flaggedBy: data.flaggedBy ? String(data.flaggedBy) : undefined,
      flaggedByName: data.flaggedByName ? String(data.flaggedByName) : undefined,
      reviewedAt: data.reviewedAt ? String(data.reviewedAt) : undefined,
      reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
      reviewedByName: data.reviewedByName ? String(data.reviewedByName) : undefined,
    }
  } catch {
    return emptyReviewState()
  }
}

export const setShiftReviewed = async (
  token: string,
  shiftId: string,
  reviewed: boolean,
): Promise<ShiftReviewState> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const session = await getFirestoreSessionUser(token)
  if (!isPrivilegedRoleString(session.role)) {
    throw new Error('Only Owner/Admin can mark shifts as reviewed.')
  }
  const now = new Date().toISOString()
  const updates = reviewed
    ? {
        reviewedAt: now,
        reviewedBy: session.id,
        reviewedByName: session.name,
      }
    : {
        reviewedAt: null,
        reviewedBy: null,
        reviewedByName: null,
      }
  await setDoc(firestoreDoc(firestore, shiftId), updates, { merge: true })
  return reviewed
    ? {
        flagged: false,
        reviewedAt: now,
        reviewedBy: session.id,
        reviewedByName: session.name,
      }
    : emptyReviewState()
}

export const clearShiftFlag = async (token: string, shiftId: string): Promise<void> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')
  const session = await getFirestoreSessionUser(token)
  if (!isPrivilegedRoleString(session.role)) {
    throw new Error('Only Owner/Admin can clear flags.')
  }
  await setDoc(
    firestoreDoc(firestore, shiftId),
    { flagged: false, flaggedAt: null, flaggedBy: null, flaggedByName: null },
    { merge: true },
  )
}

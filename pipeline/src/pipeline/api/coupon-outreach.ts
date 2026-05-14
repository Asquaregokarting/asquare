/**
 * Coupon Outreach — pipeline client API.
 *
 * Reads/writes the four collections owned by the daily 600-member outreach
 * feature. This module is fully isolated from the existing leads pipeline:
 * it never imports from src/pipeline/api/leads* or src/services/coupon*.
 *
 *   couponOutreachBatches/{date}                — batch header
 *   couponOutreachBatches/{date}/items/{phone}  — per-member assignment
 *   couponOutreachConfig/automation             — admin-tunable config
 *   telecallerLeave/{date}/users/{userId}       — admin-marked leave
 */

import type { DocumentData, QueryConstraint, UpdateData } from 'firebase/firestore'
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  limit as firestoreLimit,
  startAfter,
  deleteDoc,
} from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso } from './firestore-utils'
import { logger } from '../../lib/logger'
import { roundRobinPartition } from '../features/coupon-outreach/coupon-outreach-utils'

// ─── Types ──────────────────────────────────────────────────────────

export type CouponOutreachStatus = 'pending' | 'contacted' | 'done' | 'skipped'

export type CustomerValueTier = 'high' | 'mid' | 'low'

export interface CouponMemberSnapshot {
  totalVisits: number
  totalBillAmount: number
  coupons150Redeemed: number
  coupons150Available: number
  membership: string
  starStatus: string
  lastVisitDate: string | null
  lastVisitLocation: string | null
  customerValueTier: CustomerValueTier
}

export interface CouponOutreachItem {
  phone: string
  name: string
  email: string
  assignedTo: string
  assignedAt: string
  assignedBy: string
  status: CouponOutreachStatus
  note?: string
  snapshot: CouponMemberSnapshot
  createdAt: string
  updatedAt: string
  reassignedAt?: string
  reassignedReason?: string
  previousAssignedTo?: string
  contactedAt?: string
  contactedBy?: string
}

export interface CouponOutreachBatch {
  date: string
  createdAt: string
  createdBy: string
  totalCount: number
  eligibleScanned: number
  skippedByCooldown: number
  telecallerIds: string[]
  distribution: Record<string, number>
  status: 'active' | 'no_telecallers' | 'archived'
  lastRedistributedAt?: string
  lastRedistributedFrom?: string
}

export interface CouponOutreachConfig {
  enabled: boolean
  dailyBatchSize: number
  cooldownDays: number
  tierHighSpend: number
  tierHighVisits: number
  tierMidSpend: number
}

export const DEFAULT_COUPON_OUTREACH_CONFIG: CouponOutreachConfig = {
  enabled: true,
  dailyBatchSize: 600,
  cooldownDays: 7,
  tierHighSpend: 10000,
  tierHighVisits: 10,
  tierMidSpend: 3000,
}

// ─── Internals ──────────────────────────────────────────────────────

const BATCHES_COLLECTION = 'couponOutreachBatches'
const ITEMS_SUBCOLLECTION = 'items'
const CONFIG_COLLECTION = 'couponOutreachConfig'
const CONFIG_DOC_ID = 'automation'
const LEAVE_COLLECTION = 'telecallerLeave'

/** YYYY-MM-DD in IST regardless of the browser timezone. */
export const istDateString = (date = new Date()): string => {
  const istMillis = date.getTime() + 5.5 * 60 * 60 * 1000
  const ist = new Date(istMillis)
  const y = ist.getUTCFullYear()
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0')
  const d = String(ist.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const requireFirestore = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

const parseSnapshot = (raw: unknown): CouponMemberSnapshot => {
  const data = (raw ?? {}) as Record<string, unknown>
  const tierRaw = String(data.customerValueTier ?? 'low')
  const customerValueTier: CustomerValueTier =
    tierRaw === 'high' || tierRaw === 'mid' ? tierRaw : 'low'
  return {
    totalVisits: Number(data.totalVisits ?? 0),
    totalBillAmount: Number(data.totalBillAmount ?? 0),
    coupons150Redeemed: Number(data.coupons150Redeemed ?? 0),
    coupons150Available: Number(data.coupons150Available ?? 0),
    membership: String(data.membership ?? 'Silver'),
    starStatus: String(data.starStatus ?? '0'),
    lastVisitDate: data.lastVisitDate ? String(data.lastVisitDate) : null,
    lastVisitLocation: data.lastVisitLocation ? String(data.lastVisitLocation) : null,
    customerValueTier,
  }
}

const parseItem = (id: string, raw: unknown): CouponOutreachItem => {
  const data = (raw ?? {}) as Record<string, unknown>
  const statusRaw = String(data.status ?? 'pending')
  const status: CouponOutreachStatus =
    statusRaw === 'contacted' || statusRaw === 'done' || statusRaw === 'skipped'
      ? statusRaw
      : 'pending'
  return {
    phone: String(data.phone ?? id),
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    assignedTo: String(data.assignedTo ?? ''),
    assignedAt: String(data.assignedAt ?? ''),
    assignedBy: String(data.assignedBy ?? ''),
    status,
    note: data.note ? String(data.note) : undefined,
    snapshot: parseSnapshot(data.snapshot),
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    reassignedAt: data.reassignedAt ? String(data.reassignedAt) : undefined,
    reassignedReason: data.reassignedReason ? String(data.reassignedReason) : undefined,
    previousAssignedTo: data.previousAssignedTo ? String(data.previousAssignedTo) : undefined,
    contactedAt: data.contactedAt ? String(data.contactedAt) : undefined,
    contactedBy: data.contactedBy ? String(data.contactedBy) : undefined,
  }
}

const parseBatch = (id: string, raw: unknown): CouponOutreachBatch => {
  const data = (raw ?? {}) as Record<string, unknown>
  const statusRaw = String(data.status ?? 'active')
  const status: CouponOutreachBatch['status'] =
    statusRaw === 'no_telecallers' || statusRaw === 'archived' ? statusRaw : 'active'
  return {
    date: String(data.date ?? id),
    createdAt: String(data.createdAt ?? ''),
    createdBy: String(data.createdBy ?? ''),
    totalCount: Number(data.totalCount ?? 0),
    eligibleScanned: Number(data.eligibleScanned ?? 0),
    skippedByCooldown: Number(data.skippedByCooldown ?? 0),
    telecallerIds: Array.isArray(data.telecallerIds)
      ? (data.telecallerIds as unknown[]).map((v) => String(v))
      : [],
    distribution: (data.distribution as Record<string, number>) ?? {},
    status,
    lastRedistributedAt: data.lastRedistributedAt ? String(data.lastRedistributedAt) : undefined,
    lastRedistributedFrom: data.lastRedistributedFrom
      ? String(data.lastRedistributedFrom)
      : undefined,
  }
}

// ─── Public API ─────────────────────────────────────────────────────

export const couponOutreachApi = {
  /** All items assigned to the current user for the given date (defaults to today IST). */
  async listMyAssignments(
    token: string,
    dateStr?: string,
  ): Promise<{ batch: CouponOutreachBatch | null; items: CouponOutreachItem[] }> {
    const user = await getFirestoreSessionUser(token)
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()

    const batchRef = doc(fs, BATCHES_COLLECTION, date)
    const batchSnap = await getDoc(batchRef)
    if (!batchSnap.exists()) {
      return { batch: null, items: [] }
    }
    const batch = parseBatch(batchSnap.id, batchSnap.data())

    const itemsCol = collection(batchRef, ITEMS_SUBCOLLECTION)
    const itemsSnap = await getDocs(query(itemsCol, where('assignedTo', '==', user.id)))
    const items = itemsSnap.docs.map((d) => parseItem(d.id, d.data()))

    // Most recently updated first so contacted items sink to the bottom
    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

    logger.info('coupon_outreach.list_my_assignments', {
      date,
      userId: user.id,
      count: items.length,
    })
    return { batch, items }
  },

  /** Single item by phone (for the slide-over). */
  async getItem(token: string, dateStr: string, phone: string): Promise<CouponOutreachItem | null> {
    await getFirestoreSessionUser(token)
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const itemRef = doc(fs, BATCHES_COLLECTION, dateStr, ITEMS_SUBCOLLECTION, phone)
    const snap = await getDoc(itemRef)
    if (!snap.exists()) return null
    return parseItem(snap.id, snap.data())
  },

  /** Update item status (telecaller's call outcome). */
  async updateItemStatus(
    token: string,
    dateStr: string,
    phone: string,
    status: CouponOutreachStatus,
    note?: string,
  ): Promise<CouponOutreachItem> {
    const user = await getFirestoreSessionUser(token)
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const itemRef = doc(fs, BATCHES_COLLECTION, dateStr, ITEMS_SUBCOLLECTION, phone)
    const updatedAt = nowIso()

    const result = await runTransaction(fs, async (tx) => {
      const snap = await tx.get(itemRef)
      if (!snap.exists()) {
        throw new Error(`Outreach item ${phone} not found for ${dateStr}`)
      }
      const current = parseItem(snap.id, snap.data())
      // Telecallers may only mutate their own items
      if (current.assignedTo && current.assignedTo !== user.id) {
        if (!isPrivilegedRole(user.role)) {
          throw new Error('This call is assigned to another telecaller.')
        }
      }
      const patch: Record<string, unknown> = {
        status,
        updatedAt,
      }
      if (note !== undefined) patch.note = note
      if (status === 'contacted' || status === 'done') {
        patch.contactedAt = updatedAt
        patch.contactedBy = user.id
      }
      tx.update(itemRef, patch as UpdateData<DocumentData>)
      return { ...current, ...patch } as CouponOutreachItem
    })

    logger.info('coupon_outreach.item_status_updated', {
      dateStr,
      phone,
      status,
      userId: user.id,
    })
    return result
  },

  /** Admin: distribution + counts for the given date. */
  async getBatchSummary(
    token: string,
    dateStr?: string,
  ): Promise<{
    batch: CouponOutreachBatch | null
    perTelecaller: Array<{
      telecallerId: string
      total: number
      pending: number
      contacted: number
      done: number
      skipped: number
    }>
  }> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can view the batch summary.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()
    const batchRef = doc(fs, BATCHES_COLLECTION, date)
    const batchSnap = await getDoc(batchRef)
    if (!batchSnap.exists()) {
      return { batch: null, perTelecaller: [] }
    }
    const batch = parseBatch(batchSnap.id, batchSnap.data())

    const itemsSnap = await getDocs(collection(batchRef, ITEMS_SUBCOLLECTION))
    const counts = new Map<
      string,
      { total: number; pending: number; contacted: number; done: number; skipped: number }
    >()
    itemsSnap.docs.forEach((d) => {
      const item = parseItem(d.id, d.data())
      const key = item.assignedTo || '(unassigned)'
      const row = counts.get(key) ?? { total: 0, pending: 0, contacted: 0, done: 0, skipped: 0 }
      row.total += 1
      row[item.status] += 1
      counts.set(key, row)
    })

    const perTelecaller = Array.from(counts.entries()).map(([id, row]) => ({
      telecallerId: id,
      ...row,
    }))
    perTelecaller.sort((a, b) => b.total - a.total)

    return { batch, perTelecaller }
  },

  /** Admin: list past batches (most recent first). */
  async listRecentBatches(token: string, max = 30): Promise<CouponOutreachBatch[]> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can view batch history.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const snap = await getDocs(
      query(collection(fs, BATCHES_COLLECTION), orderBy('date', 'desc'), firestoreLimit(max)),
    )
    return snap.docs.map((d) => parseBatch(d.id, d.data()))
  },

  /** Admin: mark a telecaller as on leave for a date. */
  async markTelecallerOnLeave(
    token: string,
    leavingUserId: string,
    dateStr?: string,
    reason?: string,
  ): Promise<void> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can mark telecallers on leave.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()
    await setDoc(
      doc(fs, LEAVE_COLLECTION, date, 'users', leavingUserId),
      {
        userId: leavingUserId,
        date,
        reason: reason ?? null,
        markedAt: nowIso(),
        markedBy: user.id,
      },
      { merge: true },
    )
    logger.info('coupon_outreach.leave_marked', {
      date,
      leavingUserId,
      markedBy: user.id,
    })
  },

  /** Admin: clear the leave flag (telecaller back from leave). */
  async clearTelecallerLeave(
    token: string,
    leavingUserId: string,
    dateStr?: string,
  ): Promise<void> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can clear leave.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()
    await deleteDoc(doc(fs, LEAVE_COLLECTION, date, 'users', leavingUserId))
    logger.info('coupon_outreach.leave_cleared', {
      date,
      leavingUserId,
      clearedBy: user.id,
    })
  },

  /** Admin: list users currently marked on leave for a date. */
  async listOnLeaveTelecallers(token: string, dateStr?: string): Promise<string[]> {
    await getFirestoreSessionUser(token)
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()
    const snap = await getDocs(collection(fs, LEAVE_COLLECTION, date, 'users'))
    return snap.docs.map((d) => d.id)
  },

  /** Read config doc (anyone with a valid session can read). */
  async getConfig(token: string): Promise<CouponOutreachConfig> {
    await getFirestoreSessionUser(token)
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const snap = await getDoc(doc(fs, CONFIG_COLLECTION, CONFIG_DOC_ID))
    if (!snap.exists()) return { ...DEFAULT_COUPON_OUTREACH_CONFIG }
    const data = snap.data() as Record<string, unknown>
    return {
      enabled: data.enabled !== false,
      dailyBatchSize: Number(data.dailyBatchSize ?? DEFAULT_COUPON_OUTREACH_CONFIG.dailyBatchSize),
      cooldownDays: Number(data.cooldownDays ?? DEFAULT_COUPON_OUTREACH_CONFIG.cooldownDays),
      tierHighSpend: Number(data.tierHighSpend ?? DEFAULT_COUPON_OUTREACH_CONFIG.tierHighSpend),
      tierHighVisits: Number(data.tierHighVisits ?? DEFAULT_COUPON_OUTREACH_CONFIG.tierHighVisits),
      tierMidSpend: Number(data.tierMidSpend ?? DEFAULT_COUPON_OUTREACH_CONFIG.tierMidSpend),
    }
  },

  /** Admin: update config. */
  async updateConfig(
    token: string,
    patch: Partial<CouponOutreachConfig>,
  ): Promise<CouponOutreachConfig> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can update coupon outreach config.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const current = await this.getConfig(token)
    const next: CouponOutreachConfig = { ...current, ...patch }
    await setDoc(doc(fs, CONFIG_COLLECTION, CONFIG_DOC_ID), next)
    return next
  },

  // ── Client-side cron + redistribute ─────────────────────────────────
  //
  // The scheduled Cloud Function (functions/api/coupon-outreach-cron.js)
  // runs at 10:30 AM IST every day in production. The two methods below
  // are admin-only manual overrides that do the same work in the browser
  // so the UI works without waiting for `firebase deploy`. They mirror the
  // server logic in functions/lib/coupon-outreach-helpers.js exactly.

  /**
   * Admin: build today's batch right now from the current `members`
   * snapshot. Honors the same config + cooldown rules as the cron.
   */
  async runDailyBatchNow(
    token: string,
    options?: { dateStr?: string },
  ): Promise<{
    dateStr: string
    eligibleScanned: number
    skippedByCooldown: number
    assigned: number
    distribution: Record<string, number>
  }> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can run the daily batch.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const dateStr = options?.dateStr ?? istDateString()

    const config = await this.getConfig(token)
    if (!config.enabled) {
      throw new Error('Coupon outreach is disabled in config. Enable it before running.')
    }

    // 1. Active telecallers (users + shifts + leave)
    const telecallers = await loadActiveTelecallersClient(fs, dateStr)
    if (telecallers.length === 0) {
      // Header doc so the UI explains the empty day
      await setDoc(doc(fs, BATCHES_COLLECTION, dateStr), {
        date: dateStr,
        createdAt: nowIso(),
        createdBy: `manual:${user.id}`,
        totalCount: 0,
        eligibleScanned: 0,
        skippedByCooldown: 0,
        telecallerIds: [],
        distribution: {},
        status: 'no_telecallers',
      })
      logger.warn('coupon_outreach.run_now_no_telecallers', { dateStr })
      return {
        dateStr,
        eligibleScanned: 0,
        skippedByCooldown: 0,
        assigned: 0,
        distribution: {},
      }
    }

    // 2. Eligible members
    const eligibleAll = await fetchEligibleMembersClient(fs)
    const eligibleScanned = eligibleAll.length

    // 3. Cooldown filter
    const eligibleAfterCooldown = await filterByCooldownClient(
      fs,
      eligibleAll,
      config.cooldownDays,
      dateStr,
    )
    const skippedByCooldown = eligibleScanned - eligibleAfterCooldown.length

    // 4. Sort: most coupons available DESC, then most recent visit DESC
    eligibleAfterCooldown.sort((a, b) => {
      if (b.coupons150Available !== a.coupons150Available) {
        return b.coupons150Available - a.coupons150Available
      }
      const aDate = a.lastVisitDate ? new Date(a.lastVisitDate).getTime() : 0
      const bDate = b.lastVisitDate ? new Date(b.lastVisitDate).getTime() : 0
      return bDate - aDate
    })

    // 5. Take top N + stamp tier
    const top = eligibleAfterCooldown.slice(0, config.dailyBatchSize).map((m) => ({
      ...m,
      customerValueTier: clientComputeTier(m.totalBillAmount, m.totalVisits, config),
    }))

    // 6. Round-robin partition
    const partitions = roundRobinPartition(
      top,
      telecallers.map((t) => t.id),
    )

    // 7. Persist (chunked writes)
    const distribution: Record<string, number> = {}
    for (const [uid, list] of partitions.entries()) {
      distribution[uid] = list.length
    }
    await persistBatchClient(fs, dateStr, top, partitions, {
      eligibleScanned,
      skippedByCooldown,
      createdBy: `manual:${user.id}`,
      distribution,
      telecallerIds: Array.from(partitions.keys()),
    })

    logger.info('coupon_outreach.run_now_complete', {
      dateStr,
      eligibleScanned,
      skippedByCooldown,
      assigned: top.length,
      telecallerCount: telecallers.length,
    })

    return {
      dateStr,
      eligibleScanned,
      skippedByCooldown,
      assigned: top.length,
      distribution,
    }
  },

  /**
   * Admin: redistribute a leaving telecaller's *pending* items in today's
   * batch across the remaining active telecallers. Items already past
   * pending stay with the original owner so call history is preserved.
   */
  async redistribute(
    token: string,
    leavingUserId: string,
    dateStr?: string,
  ): Promise<{ moved: number; remaining: number }> {
    const user = await getFirestoreSessionUser(token)
    if (!isPrivilegedRole(user.role)) {
      throw new Error('Only admins can redistribute outreach items.')
    }
    await ensureAnonymousAuth()
    const fs = requireFirestore()
    const date = dateStr ?? istDateString()

    const batchRef = doc(fs, BATCHES_COLLECTION, date)
    const batchSnap = await getDoc(batchRef)
    if (!batchSnap.exists()) {
      throw new Error(`No batch for ${date}`)
    }

    // 1. Pending items belonging to the leaving user
    const itemsCol = collection(batchRef, ITEMS_SUBCOLLECTION)
    const pendingSnap = await getDocs(
      query(itemsCol, where('assignedTo', '==', leavingUserId), where('status', '==', 'pending')),
    )
    if (pendingSnap.empty) {
      logger.info('coupon_outreach.redistribute_noop', { date, leavingUserId })
      return { moved: 0, remaining: 0 }
    }

    // 2. Active telecallers minus the leaving user
    const active = await loadActiveTelecallersClient(fs, date)
    const remaining = active.filter((t) => t.id !== leavingUserId)
    if (remaining.length === 0) {
      throw new Error('No remaining active telecallers to receive the items.')
    }

    // 3. Round-robin partition
    const items = pendingSnap.docs.map((d) => ({ id: d.id, ref: d.ref }))
    const partitions = roundRobinPartition(
      items,
      remaining.map((t) => t.id),
    )

    // 4. Chunked update writes (≤ 450 ops per batch to leave headroom)
    const reassignedAt = nowIso()
    let opsInBatch = 0
    let writer = writeBatch(fs)
    const flush = async () => {
      if (opsInBatch === 0) return
      await writer.commit()
      writer = writeBatch(fs)
      opsInBatch = 0
    }

    let moved = 0
    for (const [newOwner, list] of partitions.entries()) {
      for (const item of list) {
        writer.update(item.ref, {
          assignedTo: newOwner,
          previousAssignedTo: leavingUserId,
          reassignedAt,
          reassignedReason: 'telecaller_leave',
          updatedAt: reassignedAt,
        } as UpdateData<DocumentData>)
        opsInBatch += 1
        moved += 1
        if (opsInBatch >= 450) await flush()
      }
    }
    await flush()

    // 5. Refresh distribution counts on the batch header
    const refreshed = await getDocs(itemsCol)
    const distribution: Record<string, number> = {}
    refreshed.docs.forEach((d) => {
      const owner = String((d.data() || {}).assignedTo || '')
      if (!owner) return
      distribution[owner] = (distribution[owner] || 0) + 1
    })

    await setDoc(
      batchRef,
      {
        distribution,
        telecallerIds: Object.keys(distribution),
        lastRedistributedAt: reassignedAt,
        lastRedistributedFrom: leavingUserId,
      },
      { merge: true },
    )

    logger.info('coupon_outreach.redistribute_complete', {
      date,
      leavingUserId,
      moved,
      remaining: remaining.length,
    })

    return { moved, remaining: remaining.length }
  },
}

// ─── Internal helpers (mirror functions/lib/coupon-outreach-helpers.js) ──

interface ActiveTelecaller {
  id: string
  name: string
}

interface EligibleMemberSnapshot {
  phone: string
  name: string
  email: string
  totalVisits: number
  totalBillAmount: number
  coupons150Redeemed: number
  coupons150Available: number
  membership: string
  starStatus: string
  lastVisitDate: string | null
  lastVisitLocation: string | null
}

const COUPON_EARN_THRESHOLD = 600
const MEMBERS_PAGE_SIZE = 1000

const clientComputeTier = (
  totalBillAmount: number,
  totalVisits: number,
  cfg: CouponOutreachConfig,
): CustomerValueTier => {
  const spend = Math.max(0, totalBillAmount)
  const visits = Math.max(0, totalVisits)
  if (spend >= cfg.tierHighSpend || visits >= cfg.tierHighVisits) return 'high'
  if (spend >= cfg.tierMidSpend) return 'mid'
  return 'low'
}

const loadActiveTelecallersClient = async (
  fs: ReturnType<typeof initializeFirestore>,
  dateStr: string,
): Promise<ActiveTelecaller[]> => {
  if (!fs) return []

  // 1. Telecaller users
  const usersSnap = await getDocs(
    query(
      collection(fs, 'users'),
      where('role', '==', 'Telecaller'),
      where('isActive', '==', true),
    ),
  )
  if (usersSnap.empty) return []
  const candidates: ActiveTelecaller[] = usersSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>
    return {
      id: d.id,
      name: String(data.name || data.displayName || d.id),
    }
  })

  // 2. Open shifts today
  const shiftsSnap = await getDocs(
    query(
      collection(fs, 'shifts'),
      where('shiftDate', '==', dateStr),
      where('role', '==', 'Telecaller'),
    ),
  )
  const onShiftIds = new Set<string>()
  shiftsSnap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    if (!data.endTime && data.userId) onShiftIds.add(String(data.userId))
  })

  // 3. Subtract on-leave users
  const leaveSnap = await getDocs(collection(fs, LEAVE_COLLECTION, dateStr, 'users'))
  const onLeaveIds = new Set(leaveSnap.docs.map((d) => d.id))

  const active = candidates.filter((c) => onShiftIds.has(c.id) && !onLeaveIds.has(c.id))
  active.sort((a, b) => a.id.localeCompare(b.id))
  return active
}

const fetchEligibleMembersClient = async (
  fs: ReturnType<typeof initializeFirestore>,
): Promise<EligibleMemberSnapshot[]> => {
  if (!fs) return []

  const eligible: EligibleMemberSnapshot[] = []
  const membersCol = collection(fs, 'members')
  let cursor: DocumentData | null = null
  let scanned = 0

  const baseConstraints: QueryConstraint[] = [
    orderBy(documentId()),
    firestoreLimit(MEMBERS_PAGE_SIZE),
  ]
  while (true) {
    const constraints: QueryConstraint[] = cursor
      ? [...baseConstraints, startAfter(cursor)]
      : baseConstraints
    const snap = await getDocs(query(membersCol, ...constraints))
    if (snap.empty) break

    for (const d of snap.docs) {
      scanned += 1
      const data = d.data() as Record<string, unknown>
      const phoneRaw = String(data.mobile || data.id || d.id || '')
      const phone = phoneRaw.replace(/\D/g, '').slice(-10)
      if (phone.length !== 10) continue

      const totalBillAmount = Number(data.totalBillAmount || 0)
      const redeemed = Number(data.coupons150Redeemed || 0)
      const earned = Math.floor(Math.max(0, totalBillAmount) / COUPON_EARN_THRESHOLD)
      const available = Math.max(0, earned - Math.max(0, redeemed))
      if (available < 1) continue

      eligible.push({
        phone,
        name: String(data.name || ''),
        email: String(data.email || ''),
        totalVisits: Number(data.totalVisits || 0),
        totalBillAmount,
        coupons150Redeemed: redeemed,
        coupons150Available: available,
        membership: String(data.membership || 'Silver'),
        starStatus: String(data.starStatus || '0'),
        lastVisitDate: data.lastVisitDate ? String(data.lastVisitDate) : null,
        lastVisitLocation: data.lastVisitLocation ? String(data.lastVisitLocation) : null,
      })
    }

    if (snap.size < MEMBERS_PAGE_SIZE) break
    cursor = snap.docs[snap.docs.length - 1]
  }

  logger.info('coupon_outreach.client_scan_complete', {
    scanned,
    eligible: eligible.length,
  })
  return eligible
}

const filterByCooldownClient = async (
  fs: ReturnType<typeof initializeFirestore>,
  members: EligibleMemberSnapshot[],
  cooldownDays: number,
  todayIst: string,
): Promise<EligibleMemberSnapshot[]> => {
  if (!fs || cooldownDays <= 0 || members.length === 0) return members

  const todayMs = new Date(`${todayIst}T00:00:00Z`).getTime()
  const cutoffMs = todayMs - cooldownDays * 24 * 60 * 60 * 1000

  const ledgerCol = collection(fs, 'couponOutreachLedger')
  const blocked = new Set<string>()
  const phones = members.map((m) => m.phone)

  // Firestore web SDK `in` query supports up to 30 values per call
  for (let i = 0; i < phones.length; i += 30) {
    const chunk = phones.slice(i, i + 30)
    const snap = await getDocs(query(ledgerCol, where(documentId(), 'in', chunk)))
    snap.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>
      const last = data.lastAssignedAt
      if (!last) return
      const ms = new Date(String(last)).getTime()
      if (Number.isFinite(ms) && ms >= cutoffMs) blocked.add(d.id)
    })
  }
  return members.filter((m) => !blocked.has(m.phone))
}

const persistBatchClient = async (
  fs: ReturnType<typeof initializeFirestore>,
  dateStr: string,
  items: Array<EligibleMemberSnapshot & { customerValueTier: CustomerValueTier }>,
  partitions: Map<string, Array<EligibleMemberSnapshot & { customerValueTier: CustomerValueTier }>>,
  summary: {
    eligibleScanned: number
    skippedByCooldown: number
    createdBy: string
    distribution: Record<string, number>
    telecallerIds: string[]
  },
): Promise<void> => {
  if (!fs) return
  const createdAt = nowIso()
  const batchRef = doc(fs, BATCHES_COLLECTION, dateStr)
  const itemsCol = collection(batchRef, ITEMS_SUBCOLLECTION)
  const ledgerCol = collection(fs, 'couponOutreachLedger')

  // 1. Header doc
  await setDoc(batchRef, {
    date: dateStr,
    createdAt,
    createdBy: summary.createdBy,
    totalCount: items.length,
    eligibleScanned: summary.eligibleScanned,
    skippedByCooldown: summary.skippedByCooldown,
    telecallerIds: summary.telecallerIds,
    distribution: summary.distribution,
    status: 'active',
  })

  // 2. Items + ledger writes — chunked
  const ownerByPhone = new Map<string, string>()
  for (const [uid, list] of partitions.entries()) {
    for (const item of list) ownerByPhone.set(item.phone, uid)
  }

  let opsInBatch = 0
  let writer = writeBatch(fs)
  const flush = async () => {
    if (opsInBatch === 0) return
    await writer.commit()
    writer = writeBatch(fs)
    opsInBatch = 0
  }

  for (const item of items) {
    const owner = ownerByPhone.get(item.phone)
    if (!owner) continue

    writer.set(doc(itemsCol, item.phone), {
      phone: item.phone,
      name: item.name,
      email: item.email,
      assignedTo: owner,
      assignedAt: createdAt,
      assignedBy: summary.createdBy,
      status: 'pending',
      snapshot: {
        totalVisits: item.totalVisits,
        totalBillAmount: item.totalBillAmount,
        coupons150Redeemed: item.coupons150Redeemed,
        coupons150Available: item.coupons150Available,
        membership: item.membership,
        starStatus: item.starStatus,
        lastVisitDate: item.lastVisitDate,
        lastVisitLocation: item.lastVisitLocation,
        customerValueTier: item.customerValueTier,
      },
      createdAt,
      updatedAt: createdAt,
    })
    opsInBatch += 1

    writer.set(
      doc(ledgerCol, item.phone),
      {
        phone: item.phone,
        lastAssignedAt: createdAt,
        lastAssignedBatch: dateStr,
        lastAssignedTo: owner,
      },
      { merge: true },
    )
    opsInBatch += 1

    if (opsInBatch >= 450) await flush()
  }
  await flush()
}

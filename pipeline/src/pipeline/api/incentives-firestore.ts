/**
 * Cashier Incentive System — Firestore API layer.
 *
 * Collections:
 *   incentiveConfig/global          — singleton config document
 *   weeklyGameReports/{weekKey}     — immutable weekly snapshots
 *   cashierIncentives/{id}          — per-item incentive records
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso } from './firestore-utils'
import type { CashierIncentiveRecord, IncentiveConfig, WeeklyGameReport } from './types'

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_COLLECTION = 'incentiveConfig'
const CONFIG_DOC_ID = 'global'
const WEEKLY_REPORTS_COLLECTION = 'weeklyGameReports'
const INCENTIVES_COLLECTION = 'cashierIncentives'

export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = {
  defaultMultiplier: 40,
  globalMultiplier: null,
  incentivePercent: 2,
  goKartLapThreshold: 12,
  perGameOverrides: {},
  updatedAt: new Date().toISOString(),
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const getFirestore = () => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  return firestore
}

const getConfigRef = () => doc(getFirestore(), CONFIG_COLLECTION, CONFIG_DOC_ID)

const getWeeklyReportsCol = () => collection(getFirestore(), WEEKLY_REPORTS_COLLECTION)

const getIncentivesCol = () => collection(getFirestore(), INCENTIVES_COLLECTION)

// ─── Config CRUD ────────────────────────────────────────────────────────────

export const getIncentiveConfig = async (): Promise<IncentiveConfig> => {
  try {
    const snap = await getDoc(getConfigRef())
    if (!snap.exists()) return { ...DEFAULT_INCENTIVE_CONFIG }
    const data = snap.data() as Record<string, unknown>
    return {
      defaultMultiplier: Number(
        data.defaultMultiplier ?? DEFAULT_INCENTIVE_CONFIG.defaultMultiplier,
      ),
      globalMultiplier: data.globalMultiplier != null ? Number(data.globalMultiplier) : null,
      incentivePercent: Number(data.incentivePercent ?? DEFAULT_INCENTIVE_CONFIG.incentivePercent),
      goKartLapThreshold: Number(
        data.goKartLapThreshold ?? DEFAULT_INCENTIVE_CONFIG.goKartLapThreshold,
      ),
      perGameOverrides: (data.perGameOverrides as IncentiveConfig['perGameOverrides']) ?? {},
      updatedAt: String(data.updatedAt ?? ''),
      updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    }
  } catch {
    return { ...DEFAULT_INCENTIVE_CONFIG }
  }
}

export const updateIncentiveConfig = async (
  token: string,
  patch: Partial<IncentiveConfig>,
): Promise<IncentiveConfig> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner/Admin can update incentive config.')
  }
  const current = await getIncentiveConfig()
  const updated: IncentiveConfig = {
    ...current,
    ...patch,
    perGameOverrides: {
      ...current.perGameOverrides,
      ...(patch.perGameOverrides ?? {}),
    },
    updatedAt: nowIso(),
    updatedBy: user.id,
  }
  await setDoc(getConfigRef(), updated)
  return updated
}

// ─── Weekly Reports ─────────────────────────────────────────────────────────

export const getWeeklyGameReport = async (weekKey: string): Promise<WeeklyGameReport | null> => {
  const snap = await getDoc(doc(getWeeklyReportsCol(), weekKey))
  if (!snap.exists()) return null
  return snap.data() as WeeklyGameReport
}

export const listWeeklyGameReports = async (maxResults = 12): Promise<WeeklyGameReport[]> => {
  const q = query(getWeeklyReportsCol(), orderBy('weekStart', 'desc'), limit(maxResults))
  const snap = await getDocs(q)
  return snap.docs.map((d) => d.data() as WeeklyGameReport)
}

// ─── Cashier Incentive Records ──────────────────────────────────────────────

export interface IncentiveFilters {
  cashierId?: string
  locationId?: string
  weekKey?: string
  fromDate?: string
  toDate?: string
  status?: 'active' | 'reversed'
}

export const listCashierIncentives = async (
  filters: IncentiveFilters,
): Promise<CashierIncentiveRecord[]> => {
  const col = getIncentivesCol()
  const whereConditions = []

  if (filters.cashierId) whereConditions.push(where('cashierId', '==', filters.cashierId))
  if (filters.locationId) whereConditions.push(where('locationId', '==', filters.locationId))
  if (filters.weekKey) whereConditions.push(where('weekKey', '==', filters.weekKey))
  if (filters.status) whereConditions.push(where('status', '==', filters.status))

  const q = query(col, ...whereConditions, orderBy('createdAt', 'desc'), limit(500))
  const snap = await getDocs(q)
  let results = snap.docs.map((d) => d.data() as CashierIncentiveRecord)

  // Client-side date filtering (transactionDate is stored as ISO string)
  if (filters.fromDate) {
    results = results.filter((r) => r.transactionDate >= filters.fromDate!)
  }
  if (filters.toDate) {
    results = results.filter((r) => r.transactionDate <= filters.toDate! + 'T23:59:59')
  }

  return results
}

export interface IncentiveSummary {
  totalIncentiveAmount: number
  activeCount: number
  reversedCount: number
  byReason: Record<string, number>
  byCashier: Array<{
    cashierId: string
    cashierName: string
    totalAmount: number
    count: number
  }>
}

export const getCashierIncentiveSummary = async (
  filters: IncentiveFilters,
): Promise<IncentiveSummary> => {
  const records = await listCashierIncentives(filters)

  const summary: IncentiveSummary = {
    totalIncentiveAmount: 0,
    activeCount: 0,
    reversedCount: 0,
    byReason: {},
    byCashier: [],
  }

  const cashierMap = new Map<string, { name: string; total: number; count: number }>()

  for (const r of records) {
    if (r.status === 'active') {
      summary.activeCount++
      summary.totalIncentiveAmount += r.incentiveAmount
      summary.byReason[r.reason] = (summary.byReason[r.reason] ?? 0) + r.incentiveAmount
    } else {
      summary.reversedCount++
    }

    const existing = cashierMap.get(r.cashierId) ?? { name: r.cashierName, total: 0, count: 0 }
    if (r.status === 'active') {
      existing.total += r.incentiveAmount
      existing.count++
    }
    cashierMap.set(r.cashierId, existing)
  }

  summary.byCashier = Array.from(cashierMap.entries())
    .map(([cashierId, v]) => ({
      cashierId,
      cashierName: v.name,
      totalAmount: v.total,
      count: v.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)

  return summary
}

// ─── Reversal ───────────────────────────────────────────────────────────────

/**
 * Reverse all active incentives for a booking (on refund/cancel).
 * Returns the count of reversed records.
 */
export const reverseCashierIncentives = async (
  bookingId: string,
  reason: string,
): Promise<number> => {
  const col = getIncentivesCol()
  const q = query(col, where('bookingId', '==', bookingId), where('status', '==', 'active'))
  const snap = await getDocs(q)

  if (snap.empty) return 0

  const now = nowIso()
  let count = 0
  for (const d of snap.docs) {
    await updateDoc(doc(col, d.id), {
      status: 'reversed',
      reversedAt: now,
      reversedReason: reason,
    })
    count++
  }

  return count
}

// ─── Write (used at billing time) ───────────────────────────────────────────

export const writeCashierIncentiveRecord = async (
  record: CashierIncentiveRecord,
): Promise<void> => {
  const col = getIncentivesCol()
  await setDoc(doc(col, record.id), record)
}

import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  UpdateData,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import {
  HRPayrollRun,
  HRPayrollSlip,
  PayrollComponent,
  PayrollRunStatus,
  Role,
} from './types'

const RUNS_COLLECTION = 'hrPayrollRuns'
const SLIPS_COLLECTION = 'hrPayrollSlips'

const toStatus = (value: unknown): PayrollRunStatus => {
  if (
    value === 'review' ||
    value === 'approved' ||
    value === 'paid' ||
    value === 'cancelled'
  ) {
    return value
  }
  return 'draft'
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const toComponents = (value: unknown): PayrollComponent[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const data = (item ?? {}) as Record<string, unknown>
    return {
      label: String(data.label ?? ''),
      amount: toNumber(data.amount),
      kind: data.kind === 'deduction' ? 'deduction' : 'earning',
    }
  })
}

const initialize = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return firestore
}

const getRunsCollection = () => {
  const firestore = initialize()
  return firestore ? collection(firestore, RUNS_COLLECTION) : null
}

const getSlipsCollection = () => {
  const firestore = initialize()
  return firestore ? collection(firestore, SLIPS_COLLECTION) : null
}

const mapRun = (id: string, data: Record<string, unknown>): HRPayrollRun => ({
  id,
  monthIso: String(data.monthIso ?? ''),
  label: String(data.label ?? ''),
  branchId: toOptionalString(data.branchId),
  status: toStatus(data.status),
  totalEmployees: Math.round(toNumber(data.totalEmployees)),
  totalGross: toNumber(data.totalGross),
  totalDeductions: toNumber(data.totalDeductions),
  totalNet: toNumber(data.totalNet),
  totalLopDays: toNumber(data.totalLopDays),
  createdBy: String(data.createdBy ?? ''),
  createdByName: String(data.createdByName ?? ''),
  createdAt: String(data.createdAt ?? nowIso()),
  approvedBy: toOptionalString(data.approvedBy),
  approvedAt: toOptionalString(data.approvedAt),
  paidAt: toOptionalString(data.paidAt),
  notes: toOptionalString(data.notes),
})

const mapSlip = (id: string, data: Record<string, unknown>): HRPayrollSlip => ({
  id,
  runId: String(data.runId ?? ''),
  employeeId: String(data.employeeId ?? ''),
  employeeName: String(data.employeeName ?? ''),
  employeeRole: (data.employeeRole as Role) ?? 'Cashier',
  branchId: toOptionalString(data.branchId),
  monthIso: String(data.monthIso ?? ''),
  baseSalary: toNumber(data.baseSalary),
  workingDays: toNumber(data.workingDays),
  presentDays: toNumber(data.presentDays),
  lopDays: toNumber(data.lopDays),
  overtimeHours: toNumber(data.overtimeHours),
  earnings: toComponents(data.earnings),
  deductions: toComponents(data.deductions),
  incentiveAmount: toNumber(data.incentiveAmount),
  grossPay: toNumber(data.grossPay),
  totalDeductions: toNumber(data.totalDeductions),
  netPay: toNumber(data.netPay),
  status: toStatus(data.status),
  generatedAt: String(data.generatedAt ?? nowIso()),
  generatedBy: String(data.generatedBy ?? ''),
  paidAt: toOptionalString(data.paidAt),
  notes: toOptionalString(data.notes),
})

export const listPayrollRuns = async (filter?: {
  branchId?: string
  status?: PayrollRunStatus
}): Promise<HRPayrollRun[]> => {
  const coll = getRunsCollection()
  if (!coll) throw new Error('Firestore HR payroll is not configured.')
  const constraints = []
  if (filter?.branchId) constraints.push(where('branchId', '==', filter.branchId))
  if (filter?.status) constraints.push(where('status', '==', filter.status))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(120))
  const snapshot = await getDocs(query(coll, ...constraints))
  return snapshot.docs.map((item) => mapRun(item.id, item.data() as Record<string, unknown>))
}

export const getPayrollRun = async (id: string): Promise<HRPayrollRun | null> => {
  const coll = getRunsCollection()
  if (!coll) return null
  const snapshot = await getDoc(doc(coll, id))
  if (!snapshot.exists()) return null
  return mapRun(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export const listPayrollSlips = async (runId: string): Promise<HRPayrollSlip[]> => {
  const coll = getSlipsCollection()
  if (!coll) throw new Error('Firestore HR payroll slips is not configured.')
  const snapshot = await getDocs(
    query(coll, where('runId', '==', runId), orderBy('employeeName'), limit(500)),
  )
  return snapshot.docs.map((item) => mapSlip(item.id, item.data() as Record<string, unknown>))
}

export const createPayrollRun = async (
  token: string,
  payload: {
    monthIso: string
    label: string
    branchId?: string
    notes?: string
  },
): Promise<HRPayrollRun> => {
  const coll = getRunsCollection()
  if (!coll) throw new Error('Firestore HR payroll is not configured.')
  const sessionUser = await getFirestoreSessionUser(token)
  const id = `payroll-run-${payload.monthIso}-${Date.now().toString(36)}`
  const run: HRPayrollRun = {
    id,
    monthIso: payload.monthIso,
    label: payload.label,
    branchId: payload.branchId,
    status: 'draft',
    totalEmployees: 0,
    totalGross: 0,
    totalDeductions: 0,
    totalNet: 0,
    totalLopDays: 0,
    createdBy: sessionUser.id,
    createdByName: sessionUser.name,
    createdAt: nowIso(),
    notes: payload.notes,
  }
  await setDoc(doc(coll, id), run)
  return run
}

export const upsertPayrollSlip = async (
  token: string,
  slip: Omit<HRPayrollSlip, 'id' | 'generatedAt' | 'generatedBy' | 'status'> & {
    id?: string
    status?: PayrollRunStatus
  },
): Promise<HRPayrollSlip> => {
  const coll = getSlipsCollection()
  if (!coll) throw new Error('Firestore HR payroll slips is not configured.')
  const sessionUser = await getFirestoreSessionUser(token)
  const id =
    slip.id ?? `payroll-slip-${slip.runId}-${slip.employeeId}-${Date.now().toString(36)}`
  const record: HRPayrollSlip = {
    ...slip,
    id,
    status: slip.status ?? 'draft',
    generatedAt: nowIso(),
    generatedBy: sessionUser.id,
  }
  await setDoc(doc(coll, id), record)
  await refreshRunTotals(slip.runId)
  return record
}

const refreshRunTotals = async (runId: string): Promise<void> => {
  const runs = getRunsCollection()
  if (!runs) return
  const slips = await listPayrollSlips(runId)
  // Exclude cancelled slips from totals — they're effectively voided and
  // counting them inflates gross/net even though no payment will occur.
  const activeSlips = slips.filter((slip) => slip.status !== 'cancelled')
  const totals = activeSlips.reduce(
    (acc, slip) => {
      acc.totalEmployees += 1
      acc.totalGross += slip.grossPay
      acc.totalDeductions += slip.totalDeductions
      acc.totalNet += slip.netPay
      acc.totalLopDays += slip.lopDays
      return acc
    },
    { totalEmployees: 0, totalGross: 0, totalDeductions: 0, totalNet: 0, totalLopDays: 0 },
  )
  await updateDoc(doc(runs, runId), totals)
}

export const updatePayrollRunStatus = async (
  token: string,
  id: string,
  status: PayrollRunStatus,
): Promise<void> => {
  const coll = getRunsCollection()
  if (!coll) throw new Error('Firestore HR payroll is not configured.')
  const sessionUser = await getFirestoreSessionUser(token)
  const updates: Record<string, unknown> = { status }
  if (status === 'approved') {
    updates.approvedBy = sessionUser.id
    updates.approvedAt = nowIso()
  }
  if (status === 'paid') updates.paidAt = nowIso()
  await updateDoc(doc(coll, id), updates as UpdateData<DocumentData>)

  const slipsCollection = getSlipsCollection()
  if (slipsCollection) {
    const slipsSnap = await getDocs(query(slipsCollection, where('runId', '==', id)))
    const firestore = initialize()
    if (firestore && slipsSnap.size > 0) {
      const batch = writeBatch(firestore)
      slipsSnap.docs.forEach((slipDoc) => {
        batch.update(slipDoc.ref, { status })
      })
      await batch.commit()
    }
  }

  // After slip statuses change (e.g. mass-cancel via 'cancelled'), the run
  // totals stop matching reality unless we re-sum the active slips. Bug-
  // finder swarm 2026-05-13 caught this drift on review→approved transitions.
  await refreshRunTotals(id)
}

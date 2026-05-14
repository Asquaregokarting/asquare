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
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import {
  AppraisalGoal,
  AppraisalRating,
  AppraisalStage,
  HRAppraisal,
  Role,
} from './types'

const APPRAISALS_COLLECTION = 'hrAppraisals'

const toStage = (value: unknown): AppraisalStage => {
  if (value === 'manager' || value === 'hr' || value === 'closed') return value
  return 'self'
}

const toRating = (value: unknown): AppraisalRating | undefined => {
  if (typeof value === 'number' && value >= 1 && value <= 5) {
    return Math.round(value) as AppraisalRating
  }
  return undefined
}

const toGoals = (value: unknown): AppraisalGoal[] => {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const data = (item ?? {}) as Record<string, unknown>
    return {
      id: String(data.id ?? `goal-${index}`),
      title: String(data.title ?? ''),
      weight: typeof data.weight === 'number' ? data.weight : 0,
      selfRating: toRating(data.selfRating),
      selfComment: toOptionalString(data.selfComment),
      managerRating: toRating(data.managerRating),
      managerComment: toOptionalString(data.managerComment),
    }
  })
}

const getCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, APPRAISALS_COLLECTION)
}

const mapAppraisal = (id: string, data: Record<string, unknown>): HRAppraisal => ({
  id,
  cycleLabel: String(data.cycleLabel ?? ''),
  employeeId: String(data.employeeId ?? ''),
  employeeName: String(data.employeeName ?? ''),
  employeeRole: (data.employeeRole as Role) ?? 'Cashier',
  managerId: toOptionalString(data.managerId),
  managerName: toOptionalString(data.managerName),
  stage: toStage(data.stage),
  selfRating: toRating(data.selfRating),
  selfSummary: toOptionalString(data.selfSummary),
  selfSubmittedAt: toOptionalString(data.selfSubmittedAt),
  managerRating: toRating(data.managerRating),
  managerSummary: toOptionalString(data.managerSummary),
  managerSubmittedAt: toOptionalString(data.managerSubmittedAt),
  finalRating: toRating(data.finalRating),
  finalSummary: toOptionalString(data.finalSummary),
  hrSignedOffAt: toOptionalString(data.hrSignedOffAt),
  hrSignedOffBy: toOptionalString(data.hrSignedOffBy),
  goals: toGoals(data.goals),
  branchId: toOptionalString(data.branchId),
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
  deletedAt: toOptionalString(data.deletedAt),
})

export const listHRAppraisals = async (filter?: {
  cycleLabel?: string
  employeeId?: string
  stage?: AppraisalStage
}): Promise<HRAppraisal[]> => {
  const coll = getCollection()
  if (!coll) throw new Error('Firestore HR appraisals is not configured.')
  const constraints = []
  if (filter?.cycleLabel) constraints.push(where('cycleLabel', '==', filter.cycleLabel))
  if (filter?.employeeId) constraints.push(where('employeeId', '==', filter.employeeId))
  if (filter?.stage) constraints.push(where('stage', '==', filter.stage))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(500))
  const snapshot = await getDocs(query(coll, ...constraints))
  return snapshot.docs
    .map((item) => mapAppraisal(item.id, item.data() as Record<string, unknown>))
    .filter((appraisal) => !appraisal.deletedAt)
}

export const getHRAppraisal = async (id: string): Promise<HRAppraisal | null> => {
  const coll = getCollection()
  if (!coll) return null
  const snapshot = await getDoc(doc(coll, id))
  if (!snapshot.exists()) return null
  return mapAppraisal(snapshot.id, snapshot.data() as Record<string, unknown>)
}

export const createHRAppraisal = async (
  token: string,
  payload: {
    cycleLabel: string
    employeeId: string
    employeeName: string
    employeeRole: Role
    managerId?: string
    managerName?: string
    goals?: AppraisalGoal[]
    branchId?: string
  },
): Promise<HRAppraisal> => {
  const coll = getCollection()
  if (!coll) throw new Error('Firestore HR appraisals is not configured.')
  await getFirestoreSessionUser(token)
  const id = `appraisal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const now = nowIso()
  const record: HRAppraisal = {
    id,
    cycleLabel: payload.cycleLabel,
    employeeId: payload.employeeId,
    employeeName: payload.employeeName,
    employeeRole: payload.employeeRole,
    managerId: payload.managerId,
    managerName: payload.managerName,
    stage: 'self',
    goals: payload.goals ?? [],
    branchId: payload.branchId,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(doc(coll, id), record)
  return record
}

export const updateHRAppraisalStage = async (
  token: string,
  id: string,
  payload: {
    stage: AppraisalStage
    selfRating?: AppraisalRating
    selfSummary?: string
    managerRating?: AppraisalRating
    managerSummary?: string
    finalRating?: AppraisalRating
    finalSummary?: string
    goals?: AppraisalGoal[]
  },
): Promise<void> => {
  const coll = getCollection()
  if (!coll) throw new Error('Firestore HR appraisals is not configured.')
  const sessionUser = await getFirestoreSessionUser(token)
  const updates: Record<string, unknown> = {
    stage: payload.stage,
    updatedAt: nowIso(),
  }
  if (payload.selfRating !== undefined) updates.selfRating = payload.selfRating
  if (payload.selfSummary !== undefined) updates.selfSummary = payload.selfSummary
  if (payload.stage === 'manager') updates.selfSubmittedAt = nowIso()
  if (payload.managerRating !== undefined) updates.managerRating = payload.managerRating
  if (payload.managerSummary !== undefined) updates.managerSummary = payload.managerSummary
  if (payload.stage === 'hr') updates.managerSubmittedAt = nowIso()
  if (payload.finalRating !== undefined) updates.finalRating = payload.finalRating
  if (payload.finalSummary !== undefined) updates.finalSummary = payload.finalSummary
  if (payload.stage === 'closed') {
    updates.hrSignedOffAt = nowIso()
    updates.hrSignedOffBy = sessionUser.id
  }
  if (payload.goals) updates.goals = payload.goals
  await updateDoc(doc(coll, id), updates as UpdateData<DocumentData>)
}

export const softDeleteHRAppraisal = async (id: string): Promise<void> => {
  const coll = getCollection()
  if (!coll) throw new Error('Firestore HR appraisals is not configured.')
  await updateDoc(doc(coll, id), { deletedAt: nowIso(), updatedAt: nowIso() })
}

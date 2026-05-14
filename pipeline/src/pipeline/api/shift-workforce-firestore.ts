import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import type {
  EmployeeShiftRole,
  LeaveRequestRecord,
  LeaveRequestStatus,
  OvertimeRequestRecord,
  OvertimeRequestStatus,
  ShiftIssueRecord,
  ShiftIssueStatus,
} from './shift-workforce'
import { nowIso, toOptionalString } from './firestore-utils'

const USE_FIRESTORE_SHIFT_WORKFORCE = import.meta.env.VITE_USE_FIRESTORE_SHIFTS !== 'false'
const LEAVE_REQUESTS_COLLECTION = 'leaveRequests'
const OVERTIME_REQUESTS_COLLECTION = 'overtimeRequests'
const SHIFT_ISSUES_COLLECTION = 'shiftIssues'

const EMPLOYEE_ROLES: EmployeeShiftRole[] = ['Telecaller', 'Cashier', 'TrackMarshall', 'Editor']
// HR added to both — leave + overtime approvals are HR's primary
// workflow. Without these, HR sees zero leave/overtime requests and
// the dashboard KPI counts stay at 0 even when there's a queue.
const REVIEWER_ROLES = ['Owner', 'Admin', 'Developer', 'HR'] as const
const APPROVER_ROLES = ['Owner', 'Admin', 'HR'] as const
const LEAVE_STATUSES: LeaveRequestStatus[] = ['Pending', 'Approved', 'Rejected']
const OVERTIME_STATUSES: OvertimeRequestStatus[] = ['Pending', 'Approved', 'Rejected']
const ISSUE_STATUSES: ShiftIssueStatus[] = ['Open', 'UnderReview', 'Resolved']

const asIsoDate = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Date is required.')
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid date.')
  }
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const isEmployeeRole = (value: unknown): value is EmployeeShiftRole =>
  typeof value === 'string' && EMPLOYEE_ROLES.includes(value as EmployeeShiftRole)

const isReviewerRole = (value: unknown): value is (typeof REVIEWER_ROLES)[number] =>
  typeof value === 'string' && REVIEWER_ROLES.includes(value as (typeof REVIEWER_ROLES)[number])

const isApproverRole = (value: unknown): value is (typeof APPROVER_ROLES)[number] =>
  typeof value === 'string' && APPROVER_ROLES.includes(value as (typeof APPROVER_ROLES)[number])

const isLeaveStatus = (value: unknown): value is LeaveRequestStatus =>
  typeof value === 'string' && LEAVE_STATUSES.includes(value as LeaveRequestStatus)

const isOvertimeStatus = (value: unknown): value is OvertimeRequestStatus =>
  typeof value === 'string' && OVERTIME_STATUSES.includes(value as OvertimeRequestStatus)

const isIssueStatus = (value: unknown): value is ShiftIssueStatus =>
  typeof value === 'string' && ISSUE_STATUSES.includes(value as ShiftIssueStatus)

const getCollectionRef = (name: string) => {
  if (!USE_FIRESTORE_SHIFT_WORKFORCE) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, name)
}

const getLeaveRequestsCollection = () => getCollectionRef(LEAVE_REQUESTS_COLLECTION)
const getOvertimeRequestsCollection = () => getCollectionRef(OVERTIME_REQUESTS_COLLECTION)
const getShiftIssuesCollection = () => getCollectionRef(SHIFT_ISSUES_COLLECTION)

const mapLeaveRequestRecord = (id: string, data: Record<string, unknown>): LeaveRequestRecord => ({
  id,
  userId: String(data.userId ?? ''),
  userName: String(data.userName ?? 'Employee'),
  role: isEmployeeRole(data.role) ? data.role : 'Telecaller',
  reason: String(data.reason ?? ''),
  fromDate: String(data.fromDate ?? ''),
  toDate: String(data.toDate ?? ''),
  status: isLeaveStatus(data.status) ? data.status : 'Pending',
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
  reviewedBy: toOptionalString(data.reviewedBy),
  reviewerRole: toOptionalString(data.reviewerRole),
  reviewedAt: toOptionalString(data.reviewedAt),
  reviewNote: toOptionalString(data.reviewNote),
})

const mapOvertimeRequestRecord = (
  id: string,
  data: Record<string, unknown>,
): OvertimeRequestRecord => ({
  id,
  userId: String(data.userId ?? ''),
  userName: String(data.userName ?? 'Employee'),
  role: isEmployeeRole(data.role) ? data.role : 'Telecaller',
  requestDate: String(data.requestDate ?? ''),
  hours: Number(data.hours ?? 0),
  reason: String(data.reason ?? ''),
  status: isOvertimeStatus(data.status) ? data.status : 'Pending',
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
})

const mapShiftIssueRecord = (id: string, data: Record<string, unknown>): ShiftIssueRecord => ({
  id,
  userId: String(data.userId ?? ''),
  userName: String(data.userName ?? 'Employee'),
  role: isEmployeeRole(data.role) ? data.role : 'Telecaller',
  issueType: String(data.issueType ?? 'General'),
  description: String(data.description ?? ''),
  issueDate: String(data.issueDate ?? ''),
  status: isIssueStatus(data.status) ? data.status : 'Open',
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
})

const sortByCreatedAtDesc = <T extends { createdAt: string; id: string }>(rows: T[]): T[] =>
  [...rows].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return right.id.localeCompare(left.id)
    }
    return right.createdAt.localeCompare(left.createdAt)
  })

export const isFirestoreShiftWorkforceActive = (): boolean =>
  Boolean(
    getLeaveRequestsCollection() && getOvertimeRequestsCollection() && getShiftIssuesCollection(),
  )

export const listFirestoreLeaveRequests = async (
  token: string,
  query?: { status?: LeaveRequestStatus; userId?: string },
): Promise<LeaveRequestRecord[]> => {
  const collectionRef = getLeaveRequestsCollection()
  if (!collectionRef) {
    throw new Error('Firestore leave requests is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const canReview = isReviewerRole(user.role)
  const requestedUserId = toOptionalString(query?.userId)?.trim()
  if (!canReview && requestedUserId && requestedUserId !== user.id) {
    throw new Error("You are not allowed to view other employees' leave requests.")
  }

  const snapshot = await getDocs(collectionRef)
  const rows = snapshot.docs.map((row) =>
    mapLeaveRequestRecord(row.id, row.data() as Record<string, unknown>),
  )
  const filtered = rows.filter((row) => {
    if (!canReview && row.userId !== user.id) {
      return false
    }
    if (requestedUserId && row.userId !== requestedUserId) {
      return false
    }
    if (query?.status && row.status !== query.status) {
      return false
    }
    return true
  })
  return sortByCreatedAtDesc(filtered)
}

export const createFirestoreLeaveRequest = async (
  token: string,
  payload: { reason: string; fromDate: string; toDate: string },
): Promise<LeaveRequestRecord> => {
  const collectionRef = getLeaveRequestsCollection()
  if (!collectionRef) {
    throw new Error('Firestore leave requests is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isEmployeeRole(user.role)) {
    throw new Error('Only employees can apply for leave.')
  }

  const reason = payload.reason.trim()
  if (!reason) {
    throw new Error('Leave reason is required.')
  }
  const fromDate = asIsoDate(payload.fromDate)
  const toDate = asIsoDate(payload.toDate)
  if (toDate < fromDate) {
    throw new Error('To date cannot be before from date.')
  }

  const createdAt = nowIso()
  const body = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    reason,
    fromDate,
    toDate,
    status: 'Pending' as LeaveRequestStatus,
    createdAt,
    updatedAt: createdAt,
  }
  const created = await addDoc(collectionRef, body)
  return mapLeaveRequestRecord(created.id, body)
}

export const reviewFirestoreLeaveRequest = async (
  token: string,
  leaveId: string,
  payload: { status: Exclude<LeaveRequestStatus, 'Pending'>; reviewNote?: string },
): Promise<LeaveRequestRecord> => {
  const collectionRef = getLeaveRequestsCollection()
  if (!collectionRef) {
    throw new Error('Firestore leave requests is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isApproverRole(user.role)) {
    throw new Error('Only Admin and Owner can approve or reject leave requests.')
  }

  const leaveRef = doc(collectionRef, leaveId)
  const snapshot = await getDoc(leaveRef)
  if (!snapshot.exists()) {
    throw new Error('Leave request not found.')
  }

  const current = mapLeaveRequestRecord(snapshot.id, snapshot.data() as Record<string, unknown>)
  if (current.status !== 'Pending') {
    throw new Error('This leave request is already reviewed.')
  }

  const reviewedAt = nowIso()
  const updates: {
    status: Exclude<LeaveRequestStatus, 'Pending'>
    updatedAt: string
    reviewedBy: string
    reviewerRole: string
    reviewedAt: string
    reviewNote?: string
  } = {
    status: payload.status,
    updatedAt: reviewedAt,
    reviewedBy: user.id,
    reviewerRole: user.role,
    reviewedAt,
  }
  const reviewNote = toOptionalString(payload.reviewNote)
  if (reviewNote !== undefined) {
    updates.reviewNote = reviewNote
  }
  await updateDoc(leaveRef, updates)
  return {
    ...current,
    ...updates,
  }
}

export const listFirestoreOvertimeRequests = async (
  token: string,
  query?: { userId?: string; status?: OvertimeRequestStatus },
): Promise<OvertimeRequestRecord[]> => {
  const collectionRef = getOvertimeRequestsCollection()
  if (!collectionRef) {
    throw new Error('Firestore overtime requests is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const canReview = isReviewerRole(user.role)
  const requestedUserId = toOptionalString(query?.userId)?.trim()
  if (!canReview && requestedUserId && requestedUserId !== user.id) {
    throw new Error("You are not allowed to view other employees' overtime requests.")
  }

  const snapshot = await getDocs(collectionRef)
  const rows = snapshot.docs.map((row) =>
    mapOvertimeRequestRecord(row.id, row.data() as Record<string, unknown>),
  )
  const filtered = rows.filter((row) => {
    if (!canReview && row.userId !== user.id) {
      return false
    }
    if (requestedUserId && row.userId !== requestedUserId) {
      return false
    }
    if (query?.status && row.status !== query.status) {
      return false
    }
    return true
  })

  return sortByCreatedAtDesc(filtered)
}

export const createFirestoreOvertimeRequest = async (
  token: string,
  payload: { requestDate: string; hours: number; reason: string },
): Promise<OvertimeRequestRecord> => {
  const collectionRef = getOvertimeRequestsCollection()
  if (!collectionRef) {
    throw new Error('Firestore overtime requests is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isEmployeeRole(user.role)) {
    throw new Error('Only employees can request overtime.')
  }

  const requestDate = asIsoDate(payload.requestDate)
  const hours = Number(payload.hours)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('Overtime hours must be greater than 0.')
  }

  const reason = payload.reason.trim()
  if (!reason) {
    throw new Error('Overtime reason is required.')
  }

  const createdAt = nowIso()
  const body = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    requestDate,
    hours: Number(hours.toFixed(2)),
    reason,
    status: 'Pending' as OvertimeRequestStatus,
    createdAt,
    updatedAt: createdAt,
  }
  const created = await addDoc(collectionRef, body)
  return mapOvertimeRequestRecord(created.id, body)
}

export const listFirestoreShiftIssues = async (
  token: string,
  query?: { userId?: string; status?: ShiftIssueStatus },
): Promise<ShiftIssueRecord[]> => {
  const collectionRef = getShiftIssuesCollection()
  if (!collectionRef) {
    throw new Error('Firestore shift issues is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  const canReview = isReviewerRole(user.role)
  const requestedUserId = toOptionalString(query?.userId)?.trim()
  if (!canReview && requestedUserId && requestedUserId !== user.id) {
    throw new Error("You are not allowed to view other employees' issues.")
  }

  const snapshot = await getDocs(collectionRef)
  const rows = snapshot.docs.map((row) =>
    mapShiftIssueRecord(row.id, row.data() as Record<string, unknown>),
  )
  const filtered = rows.filter((row) => {
    if (!canReview && row.userId !== user.id) {
      return false
    }
    if (requestedUserId && row.userId !== requestedUserId) {
      return false
    }
    if (query?.status && row.status !== query.status) {
      return false
    }
    return true
  })

  return sortByCreatedAtDesc(filtered)
}

export const createFirestoreShiftIssue = async (
  token: string,
  payload: { issueType: string; description: string; issueDate: string },
): Promise<ShiftIssueRecord> => {
  const collectionRef = getShiftIssuesCollection()
  if (!collectionRef) {
    throw new Error('Firestore shift issues is not configured.')
  }

  const user = await getFirestoreSessionUser(token)
  if (!isEmployeeRole(user.role)) {
    throw new Error('Only employees can report shift issues.')
  }

  const issueType = payload.issueType.trim()
  if (!issueType) {
    throw new Error('Issue type is required.')
  }
  const description = payload.description.trim()
  if (!description) {
    throw new Error('Issue description is required.')
  }

  const issueDate = asIsoDate(payload.issueDate)
  const createdAt = nowIso()
  const body = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    issueType,
    description,
    issueDate,
    status: 'Open' as ShiftIssueStatus,
    createdAt,
    updatedAt: createdAt,
  }
  const created = await addDoc(collectionRef, body)
  return mapShiftIssueRecord(created.id, body)
}

/** Real-time subscription for recent leave requests (all statuses). Returns unsubscribe fn. */
export const subscribeRecentLeaveRequests = (
  onData: (rows: LeaveRequestRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getLeaveRequestsCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  const cutoffISO = cutoff.toISOString()
  return onSnapshot(
    query(col, where('createdAt', '>=', cutoffISO), orderBy('createdAt', 'desc'), limit(20)),
    (snapshot) => {
      const rows = snapshot.docs.map((row) =>
        mapLeaveRequestRecord(row.id, row.data() as Record<string, unknown>),
      )
      onData(rows)
    },
    onError,
  )
}

/** Real-time subscription for recent overtime requests (all statuses). Returns unsubscribe fn. */
export const subscribeRecentOvertimeRequests = (
  onData: (rows: OvertimeRequestRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getOvertimeRequestsCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  const cutoffISO = cutoff.toISOString()
  return onSnapshot(
    query(col, where('createdAt', '>=', cutoffISO), orderBy('createdAt', 'desc'), limit(20)),
    (snapshot) => {
      const rows = snapshot.docs.map((row) =>
        mapOvertimeRequestRecord(row.id, row.data() as Record<string, unknown>),
      )
      onData(rows)
    },
    onError,
  )
}

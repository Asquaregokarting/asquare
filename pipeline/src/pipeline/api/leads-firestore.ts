import type { UpdateData, DocumentData } from 'firebase/firestore'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso, toOptionalString, stripUndefined } from './firestore-utils'
import { computeLeadScore } from './lead-scoring'
import { getLeadAutomationConfig } from './lead-config-firestore'
import { normalizePhone } from '../features/leads/lead-utils'
import { LEADS_PAGE_SIZE } from '../features/leads/lead-constants'
import { getAllLocations } from '../../lib/locations'
import type {
  LeadRecord,
  LeadScoreFactors,
  LeadSource,
  LeadStatus,
  LeadSubStatus,
  LeadTimelineEvent,
  TimelineAction,
} from './types'

// ─── Helpers ─────────────────────────────────────────────────────

const getFirestore = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

const leadsCol = () => collection(getFirestore(), 'leads')
const leadRef = (id: string) => doc(getFirestore(), 'leads', id)
const timelineCol = (leadId: string) => collection(getFirestore(), 'leads', leadId, 'timeline')

const mapLeadRecord = (id: string, data: Record<string, unknown>): LeadRecord => {
  const createdAt = String(data.createdAt ?? nowIso())
  const scoreFactors = (data.scoreFactors as LeadScoreFactors) ?? {
    recencyDays: 0,
    visitCount: 0,
    totalSpend: 0,
  }
  return {
    id,
    customerName: String(data.customerName ?? ''),
    customerPhone: String(data.customerPhone ?? ''),
    customerEmail: toOptionalString(data.customerEmail),
    source: (data.source as LeadSource) ?? 'manual',
    sourceRef: toOptionalString(data.sourceRef),
    sourceChannel: toOptionalString(data.sourceChannel),
    status: (data.status as LeadStatus) ?? 'new',
    subStatus: (data.subStatus as LeadSubStatus) ?? undefined,
    score: Number(data.score ?? 0),
    scoreLabel: (data.scoreLabel as LeadRecord['scoreLabel']) ?? 'cold',
    scoreFactors,
    assignedTo: toOptionalString(data.assignedTo),
    assignedAt: toOptionalString(data.assignedAt),
    assignedBy: toOptionalString(data.assignedBy),
    branchId: String(data.branchId ?? getAllLocations()[0]?.branchId ?? '0'),
    branchName: String(data.branchName ?? ''),
    consecutiveNoAnswer: Number(data.consecutiveNoAnswer ?? 0),
    whatsappSentAt: toOptionalString(data.whatsappSentAt),
    lastContactedAt: toOptionalString(data.lastContactedAt),
    lastActivityAt: String(data.lastActivityAt ?? createdAt),
    callbackScheduledAt: toOptionalString(data.callbackScheduledAt),
    feedbackNotes: toOptionalString(data.feedbackNotes),
    feedbackSubmittedAt: toOptionalString(data.feedbackSubmittedAt),
    feedbackSubmittedBy: toOptionalString(data.feedbackSubmittedBy),
    convertedBookingId: toOptionalString(data.convertedBookingId),
    convertedAt: toOptionalString(data.convertedAt),
    viewedBy: toOptionalString(data.viewedBy),
    viewedAt: toOptionalString(data.viewedAt),
    createdAt,
    updatedAt: String(data.updatedAt ?? createdAt),
    createdBy: String(data.createdBy ?? ''),
    importBatchId: toOptionalString(data.importBatchId),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : undefined,
    notes: toOptionalString(data.notes),
  }
}

const mapTimelineEvent = (id: string, data: Record<string, unknown>): LeadTimelineEvent => ({
  id,
  leadId: String(data.leadId ?? ''),
  action: (data.action as TimelineAction) ?? 'created',
  actorId: String(data.actorId ?? ''),
  actorName: String(data.actorName ?? ''),
  detail: String(data.detail ?? ''),
  metadata: (data.metadata as UpdateData<DocumentData>) ?? undefined,
  createdAt: String(data.createdAt ?? nowIso()),
})

// ─── Timeline ────────────────────────────────────────────────────

const writeTimelineEvent = async (
  leadId: string,
  action: TimelineAction,
  actorId: string,
  actorName: string,
  detail: string,
  metadata?: Record<string, unknown>,
): Promise<void> => {
  await addDoc(timelineCol(leadId), {
    leadId,
    action,
    actorId,
    actorName,
    detail,
    metadata: metadata ? stripUndefined(metadata) : null,
    createdAt: nowIso(),
  })
}

// ─── Check Active Lead by Phone ──────────────────────────────────

const hasActiveLeadForPhone = async (phone: string): Promise<string | null> => {
  const normalized = normalizePhone(phone)
  const q = query(leadsCol(), where('customerPhone', '==', normalized))
  const snap = await getDocs(q)
  for (const d of snap.docs) {
    const status = String(d.data().status ?? '')
    if (status !== 'closed' && status !== 'lost') {
      return d.id
    }
  }
  return null
}

// ─── CRUD ────────────────────────────────────────────────────────

export interface CreateLeadPayload {
  customerName: string
  customerPhone: string
  customerEmail?: string
  source: LeadSource
  sourceRef?: string
  sourceChannel?: string
  branchId: string
  branchName: string
  assignedTo?: string
  assignedBy?: string
  notes?: string
  tags?: string[]
  scoreFactors?: Partial<LeadScoreFactors>
  importBatchId?: string
}

export const createFirestoreLead = async (
  token: string,
  payload: CreateLeadPayload,
): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  const phone = normalizePhone(payload.customerPhone)
  if (!phone || phone.length !== 10) throw new Error('Valid 10-digit phone required.')
  if (!payload.customerName.trim()) throw new Error('Customer name is required.')

  // Deduplicate
  const existingId = await hasActiveLeadForPhone(phone)
  if (existingId) throw new Error(`Active lead already exists for this phone (${existingId}).`)

  const config = await getLeadAutomationConfig()
  const factors: LeadScoreFactors = {
    recencyDays: 0,
    visitCount: 0,
    totalSpend: 0,
    ...payload.scoreFactors,
  }
  const { score, scoreLabel } = computeLeadScore(payload.source, factors, config)

  const now = nowIso()
  const body: Record<string, unknown> = {
    customerName: payload.customerName.trim(),
    customerPhone: phone,
    customerEmail: toOptionalString(payload.customerEmail),
    source: payload.source,
    sourceRef: toOptionalString(payload.sourceRef),
    sourceChannel: toOptionalString(payload.sourceChannel),
    status: 'new',
    score,
    scoreLabel,
    scoreFactors: factors,
    branchId: payload.branchId,
    branchName: payload.branchName,
    consecutiveNoAnswer: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: user.id,
    notes: toOptionalString(payload.notes),
    tags: payload.tags ?? null,
    importBatchId: toOptionalString(payload.importBatchId),
  }

  if (payload.assignedTo) {
    body.assignedTo = payload.assignedTo
    body.assignedAt = now
    body.assignedBy = payload.assignedBy ?? user.id
    body.status = 'new' // still new until telecaller contacts
  }

  const created = await addDoc(leadsCol(), stripUndefined(body))

  await writeTimelineEvent(
    created.id,
    'created',
    user.id,
    user.name,
    `Lead created from ${payload.source}`,
  )
  if (payload.assignedTo) {
    await writeTimelineEvent(created.id, 'assigned', user.id, user.name, `Assigned to telecaller`)
  }

  // Auto-assign if no manual assignment was specified and auto-assign is enabled
  if (!payload.assignedTo && config.enableAutoAssign) {
    try {
      const { autoAssignLead } = await import('./lead-auto-assign')
      const assignedTo = await autoAssignLead(created.id, payload.branchId)
      if (assignedTo) {
        body.assignedTo = assignedTo
        body.assignedAt = nowIso()
        body.assignedBy = 'auto-assign'
      }
    } catch {
      // Auto-assign failure is non-blocking — lead stays unassigned
    }
  }

  return mapLeadRecord(created.id, body)
}

export const getFirestoreLead = async (token: string, leadId: string): Promise<LeadRecord> => {
  await getFirestoreSessionUser(token)
  const snap = await getDoc(leadRef(leadId))
  if (!snap.exists()) throw new Error('Lead not found.')
  return mapLeadRecord(snap.id, snap.data() as UpdateData<DocumentData>)
}

export interface ListLeadsFilter {
  status?: LeadStatus
  assignedTo?: string
  branchId?: string
  source?: LeadSource
  scoreLabel?: LeadRecord['scoreLabel']
  cursor?: string // createdAt ISO of last doc
  pageSize?: number
}

export const listFirestoreLeads = async (
  token: string,
  filter?: ListLeadsFilter,
): Promise<{ leads: LeadRecord[]; hasMore: boolean }> => {
  await getFirestoreSessionUser(token)
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')]

  if (filter?.status) constraints.unshift(where('status', '==', filter.status))
  if (filter?.assignedTo) constraints.unshift(where('assignedTo', '==', filter.assignedTo))
  if (filter?.branchId) constraints.unshift(where('branchId', '==', filter.branchId))
  if (filter?.source) constraints.unshift(where('source', '==', filter.source))
  if (filter?.scoreLabel) constraints.unshift(where('scoreLabel', '==', filter.scoreLabel))

  const size = filter?.pageSize ?? LEADS_PAGE_SIZE
  constraints.push(limit(size + 1))

  if (filter?.cursor) {
    constraints.push(startAfter(filter.cursor))
  }

  const q = query(leadsCol(), ...constraints)
  const snap = await getDocs(q)
  const docs = snap.docs.map((d) => mapLeadRecord(d.id, d.data() as UpdateData<DocumentData>))
  const hasMore = docs.length > size
  if (hasMore) docs.pop()

  return { leads: docs, hasMore }
}

export const updateFirestoreLead = async (
  token: string,
  leadId: string,
  updates: Partial<LeadRecord>,
): Promise<LeadRecord> => {
  await getFirestoreSessionUser(token)
  const ref = leadRef(leadId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Lead not found.')

  const payload: Record<string, unknown> = {
    ...updates,
    updatedAt: nowIso(),
    lastActivityAt: nowIso(),
  }
  delete payload.id
  delete payload.createdAt
  delete payload.createdBy

  await updateDoc(ref, payload as UpdateData<DocumentData>)
  const updated = await getDoc(ref)
  return mapLeadRecord(updated.id, updated.data() as UpdateData<DocumentData>)
}

export const deleteFirestoreLead = async (token: string, leadId: string): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) throw new Error('Only admins can delete leads.')
  await deleteDoc(leadRef(leadId))
}

// ─── Claim / Assign ──────────────────────────────────────────────

export const claimFirestoreLead = async (token: string, leadId: string): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  const fs = getFirestore()
  const ref = doc(fs, 'leads', leadId)

  await runTransaction(fs, async (txn) => {
    const snap = await txn.get(ref)
    if (!snap.exists()) throw new Error('Lead not found.')
    const data = snap.data()
    if (data.assignedTo) throw new Error(`Lead already claimed.`)
    txn.update(ref, {
      assignedTo: user.id,
      assignedAt: nowIso(),
      assignedBy: user.id,
      updatedAt: nowIso(),
      lastActivityAt: nowIso(),
    })
  })

  await writeTimelineEvent(leadId, 'claimed', user.id, user.name, 'Claimed lead')
  return getFirestoreLead(token, leadId)
}

export const assignFirestoreLead = async (
  token: string,
  leadId: string,
  assignToUserId: string,
): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) throw new Error('Only admins can assign leads.')

  const now = nowIso()
  await updateDoc(leadRef(leadId), {
    assignedTo: assignToUserId,
    assignedAt: now,
    assignedBy: user.id,
    updatedAt: now,
    lastActivityAt: now,
  })

  await writeTimelineEvent(leadId, 'assigned', user.id, user.name, `Assigned to ${assignToUserId}`)
  return getFirestoreLead(token, leadId)
}

// ─── Status Update ───────────────────────────────────────────────

export const updateLeadStatus = async (
  token: string,
  leadId: string,
  newStatus: LeadStatus,
  subStatus?: LeadSubStatus,
): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  const current = await getFirestoreLead(token, leadId)

  const now = nowIso()
  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
    lastActivityAt: now,
    lastContactedAt: now,
  }
  if (subStatus) updates.subStatus = subStatus

  // Stamp the conversion timestamp the first time the lead enters
  // 'booked'. Without this, getLeadPerformanceMetrics can't tell when
  // the conversion happened, so every booked lead falls outside its
  // [fromDate, toDate] window and the Conversion % always reads 0.
  // The `current.status !== 'booked'` guard preserves the original
  // timestamp if someone re-clicks Booked on an already-booked lead.
  if (newStatus === 'booked' && current.status !== 'booked') {
    updates.convertedAt = now
  }

  // Track consecutive no-answers for WhatsApp automation
  if (subStatus === 'no_answer') {
    updates.consecutiveNoAnswer = current.consecutiveNoAnswer + 1
  } else if (newStatus !== current.status) {
    updates.consecutiveNoAnswer = 0
  }

  await updateDoc(leadRef(leadId), updates as UpdateData<DocumentData>)
  await writeTimelineEvent(
    leadId,
    'status_changed',
    user.id,
    user.name,
    `Status: ${current.status} → ${newStatus}${subStatus ? ` (${subStatus})` : ''}`,
    { previousStatus: current.status, newStatus, ...(subStatus ? { subStatus } : {}) },
  )

  // Check WhatsApp automation
  if (subStatus === 'no_answer') {
    const config = await getLeadAutomationConfig()
    const noAnswerCount = current.consecutiveNoAnswer + 1
    if (config.enableAutoWhatsapp && noAnswerCount >= config.noAnswerWhatsappThreshold) {
      try {
        await triggerWhatsAppFollowUp(leadId, current.customerName, current.customerPhone)
        await updateDoc(leadRef(leadId), { whatsappSentAt: now })
        await writeTimelineEvent(
          leadId,
          'whatsapp_sent',
          user.id,
          user.name,
          `Auto WhatsApp after ${noAnswerCount} no-answers`,
        )
      } catch {
        // Non-blocking
      }
    }
  }

  return getFirestoreLead(token, leadId)
}

// ─── Feedback ────────────────────────────────────────────────────

export const submitLeadFeedback = async (
  token: string,
  leadId: string,
  notes: string,
): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  const now = nowIso()
  await updateDoc(leadRef(leadId), {
    feedbackNotes: notes.trim(),
    feedbackSubmittedAt: now,
    feedbackSubmittedBy: user.id,
    updatedAt: now,
    lastActivityAt: now,
  })
  await writeTimelineEvent(leadId, 'feedback_submitted', user.id, user.name, 'Feedback submitted')
  return getFirestoreLead(token, leadId)
}

// ─── Notes ───────────────────────────────────────────────────────

export const addLeadNote = async (token: string, leadId: string, text: string): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const now = nowIso()
  const current = await getFirestoreLead(token, leadId)
  const existingNotes = current.notes ? `${current.notes}\n---\n${text.trim()}` : text.trim()
  await updateDoc(leadRef(leadId), { notes: existingNotes, updatedAt: now, lastActivityAt: now })
  await writeTimelineEvent(leadId, 'note_added', user.id, user.name, text.trim())
}

// ─── Callback ────────────────────────────────────────────────────

export const scheduleLeadCallback = async (
  token: string,
  leadId: string,
  callbackDate: string,
): Promise<LeadRecord> => {
  const user = await getFirestoreSessionUser(token)
  const now = nowIso()
  await updateDoc(leadRef(leadId), {
    callbackScheduledAt: callbackDate,
    subStatus: 'callback_requested',
    updatedAt: now,
    lastActivityAt: now,
  })
  await writeTimelineEvent(
    leadId,
    'callback_scheduled',
    user.id,
    user.name,
    `Callback scheduled for ${callbackDate}`,
  )
  return getFirestoreLead(token, leadId)
}

// ─── Presence ────────────────────────────────────────────────────

export const setLeadPresence = async (token: string, leadId: string): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  await updateDoc(leadRef(leadId), { viewedBy: user.id, viewedAt: nowIso() })
}

export const clearLeadPresence = async (token: string, leadId: string): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const snap = await getDoc(leadRef(leadId))
  if (snap.exists() && snap.data().viewedBy === user.id) {
    await updateDoc(leadRef(leadId), { viewedBy: null, viewedAt: null })
  }
}

// ─── Timeline Read ───────────────────────────────────────────────

export const getLeadTimeline = async (
  token: string,
  leadId: string,
): Promise<LeadTimelineEvent[]> => {
  await getFirestoreSessionUser(token)
  const q = query(timelineCol(leadId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapTimelineEvent(d.id, d.data() as UpdateData<DocumentData>))
}

// ─── Metrics ─────────────────────────────────────────────────────

export interface LeadMetricsResult {
  total: number
  byStatus: Record<LeadStatus, number>
  bySource: Record<string, number>
  byScoreLabel: Record<string, number>
  conversionRate: number
}

export const getLeadMetrics = async (token: string): Promise<LeadMetricsResult> => {
  await getFirestoreSessionUser(token)
  const snap = await getDocs(leadsCol())
  const byStatus: Record<string, number> = {
    new: 0,
    contacted: 0,
    interested: 0,
    follow_up_pending: 0,
    booked: 0,
    closed: 0,
    lost: 0,
  }
  const bySource: Record<string, number> = {}
  const byScoreLabel: Record<string, number> = { hot: 0, warm: 0, cold: 0 }

  for (const d of snap.docs) {
    const data = d.data()
    const status = String(data.status ?? 'new')
    const source = String(data.source ?? 'manual')
    const label = String(data.scoreLabel ?? 'cold')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    bySource[source] = (bySource[source] ?? 0) + 1
    byScoreLabel[label] = (byScoreLabel[label] ?? 0) + 1
  }

  const total = snap.docs.length
  const booked = byStatus.booked ?? 0
  const conversionRate = total > 0 ? Math.round((booked / total) * 100) : 0

  return {
    total,
    byStatus: byStatus as Record<LeadStatus, number>,
    bySource,
    byScoreLabel,
    conversionRate,
  }
}

// ─── Abandoned Cart Recovery ─────────────────────────────────────

export const recoverAbandonedCarts = async (
  token: string,
  branchId?: string,
): Promise<{ created: number; skipped: number }> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) throw new Error('Only admins can recover abandoned carts.')

  const config = await getLeadAutomationConfig()
  const cutoff = new Date(Date.now() - config.abandonedCartHours * 60 * 60 * 1000)

  // Query pending bookings from asquare-app-db
  const fs = getFirestore()
  const bookingsCol = collection(fs, 'bookings')
  const constraints = [
    where('paymentStatus', '==', 'pending'),
    where('bookingStatus', '==', 'pending'),
  ]
  if (branchId) constraints.push(where('locationId', '==', branchId))
  const q = query(bookingsCol, ...constraints)
  const snap = await getDocs(q)

  let created = 0
  let skipped = 0

  for (const d of snap.docs) {
    const data = d.data()
    // Soft-deleted bookings should not become abandoned-cart leads —
    // the booking was intentionally trashed (refund, duplicate cleanup),
    // not abandoned by the customer.
    if (data.deletedAt) {
      skipped++
      continue
    }
    const createdAt = data.createdAt?.toDate?.() ?? new Date(String(data.createdAt ?? ''))
    if (createdAt > cutoff) {
      skipped++
      continue
    } // Too recent

    const phone = normalizePhone(String(data.userPhone ?? data.phone ?? ''))
    if (!phone || phone.length !== 10) {
      skipped++
      continue
    }

    const existing = await hasActiveLeadForPhone(phone)
    if (existing) {
      skipped++
      continue
    }

    const name = String(data.userDisplayName ?? data.customerName ?? 'Customer')
    const amount = Number(data.finalAmount ?? data.totalAmount ?? 0)

    await createFirestoreLead(token, {
      customerName: name,
      customerPhone: phone,
      source: 'abandoned_cart',
      sourceRef: d.id,
      branchId: String(data.locationId ?? getAllLocations()[0]?.branchId ?? '0'),
      branchName: String(data.branchName ?? ''),
      scoreFactors: {
        recencyDays: Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        visitCount: 0,
        totalSpend: 0,
        abandonedCartValue: amount,
        abandonedBookingId: d.id,
      },
    })
    created++
  }

  return { created, skipped }
}

// ─── Quick Call Outcome Logging ──────────────────────────────────

export const logCallOutcome = async (
  token: string,
  leadId: string,
  outcome: import('./types').CallOutcome,
  callbackDate?: string,
  _notes?: string,
): Promise<LeadRecord> => {
  await getFirestoreSessionUser(token)

  switch (outcome) {
    case 'connected':
      return updateLeadStatus(token, leadId, 'contacted')
    case 'no_answer':
      return updateLeadStatus(token, leadId, 'contacted', 'no_answer')
    case 'callback': {
      const lead = await updateLeadStatus(token, leadId, 'contacted', 'callback_requested')
      if (callbackDate) {
        await scheduleLeadCallback(token, leadId, callbackDate)
      }
      return lead
    }
    case 'not_interested':
      return updateLeadStatus(token, leadId, 'contacted', 'not_interested')
    default:
      throw new Error(`Unknown call outcome: ${outcome}`)
  }
}

// ─── WhatsApp Follow-up (fire-and-forget) ────────────────────────

const WHATSAPP_FUNCTION_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendLeadFollowUpWhatsApp'

const triggerWhatsAppFollowUp = async (
  leadId: string,
  customerName: string,
  customerPhone: string,
): Promise<void> => {
  await fetch(WHATSAPP_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, customerName, customerPhone }),
  })
}

// ─── Bulk Import ─────────────────────────────────────────────────

export const importLeadsBatch = async (
  token: string,
  leads: CreateLeadPayload[],
  batchMeta: { fileName: string; columnMapping: Record<string, string> },
): Promise<{
  batchId: string
  created: number
  errors: Array<{ row: number; message: string }>
}> => {
  const user = await getFirestoreSessionUser(token)
  const fs = getFirestore()
  const batchRef = await addDoc(collection(fs, 'leadImportBatches'), {
    fileName: batchMeta.fileName,
    totalRows: leads.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
    columnMapping: batchMeta.columnMapping,
    importedBy: user.id,
    importedByName: user.name,
    createdAt: nowIso(),
  })

  let created = 0
  const errors: Array<{ row: number; message: string }> = []

  for (let i = 0; i < leads.length; i++) {
    try {
      await createFirestoreLead(token, { ...leads[i], importBatchId: batchRef.id })
      created++
    } catch (err) {
      errors.push({ row: i + 1, message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  await updateDoc(batchRef, { successCount: created, errorCount: errors.length, errors })
  return { batchId: batchRef.id, created, errors }
}

// ─── Lead Performance Metrics ─────────────────────────────────────────────

export interface LeadPerformanceFilters {
  fromDate: string
  toDate: string
  branchId?: string
  assignedTo?: string
}

export const getLeadPerformanceMetrics = async (
  token: string,
  filters: LeadPerformanceFilters,
): Promise<import('./types').LeadPerformanceMetrics> => {
  await getFirestoreSessionUser(token)

  const constraints: QueryConstraint[] = []
  if (filters.branchId) constraints.push(where('branchId', '==', filters.branchId))
  if (filters.assignedTo) constraints.push(where('assignedTo', '==', filters.assignedTo))

  const q = query(leadsCol(), ...constraints, orderBy('createdAt', 'desc'), limit(2000))
  const snap = await getDocs(q)

  const byStatus: Record<string, number> = {
    new: 0,
    contacted: 0,
    interested: 0,
    follow_up_pending: 0,
    booked: 0,
    closed: 0,
    lost: 0,
  }

  let totalConversions = 0
  let pendingFollowUps = 0
  const telecallerMap = new Map<
    string,
    {
      name: string
      assigned: number
      contacted: number
      followUpsPending: number
      conversions: number
      revenue: number
    }
  >()

  // Load telecaller names
  const { listFirestoreUsers } = await import('./users-firestore')
  const telecallers = await listFirestoreUsers({ role: 'Telecaller' })
  const nameMap = new Map(telecallers.map((u) => [u.id, u.name]))

  for (const d of snap.docs) {
    const data = d.data()
    const status = String(data.status ?? 'new')
    const lastActivity = String(data.lastActivityAt ?? data.createdAt ?? '')
    const assignedTo = String(data.assignedTo ?? '')

    // Date range filter: include if lead was active within the date range
    // A lead is "active in range" if lastActivityAt falls within [fromDate, toDate]
    const activityDate = lastActivity.substring(0, 10)
    if (activityDate < filters.fromDate || activityDate > filters.toDate) continue

    byStatus[status] = (byStatus[status] ?? 0) + 1

    if (status === 'booked') {
      const convertedAt = String(data.convertedAt ?? '').substring(0, 10)
      if (convertedAt >= filters.fromDate && convertedAt <= filters.toDate) {
        totalConversions++
      }
    }

    if (status === 'follow_up_pending') {
      pendingFollowUps++
    }

    // Per-telecaller aggregation
    if (assignedTo) {
      const agg = telecallerMap.get(assignedTo) ?? {
        name: nameMap.get(assignedTo) ?? assignedTo,
        assigned: 0,
        contacted: 0,
        followUpsPending: 0,
        conversions: 0,
        revenue: 0,
      }
      agg.assigned++
      if (
        status === 'contacted' ||
        status === 'interested' ||
        status === 'follow_up_pending' ||
        status === 'booked' ||
        status === 'closed'
      ) {
        agg.contacted++
      }
      if (status === 'follow_up_pending') {
        agg.followUpsPending++
      }
      if (status === 'booked') {
        const convertedAt = String(data.convertedAt ?? '').substring(0, 10)
        if (convertedAt >= filters.fromDate && convertedAt <= filters.toDate) {
          agg.conversions++
          agg.revenue += Number(data.convertedBookingAmount ?? 0)
        }
      }
      telecallerMap.set(assignedTo, agg)
    }
  }

  const totalActive = Object.values(byStatus).reduce((s, n) => s + n, 0)

  const perTelecaller = Array.from(telecallerMap.entries())
    .map(([id, agg]) => ({
      telecallerId: id,
      telecallerName: agg.name,
      leadsAssigned: agg.assigned,
      leadsContacted: agg.contacted,
      followUpsPending: agg.followUpsPending,
      conversions: agg.conversions,
      conversionPercent: agg.assigned > 0 ? Math.round((agg.conversions / agg.assigned) * 100) : 0,
      revenue: agg.revenue,
    }))
    .sort((a, b) => b.conversions - a.conversions || b.conversionPercent - a.conversionPercent)

  return {
    totalLeads: totalActive,
    byStatus: byStatus as Record<import('./types').LeadStatus, number>,
    totalConversions,
    conversionPercent: totalActive > 0 ? Math.round((totalConversions / totalActive) * 100) : 0,
    pendingFollowUps,
    perTelecaller,
  }
}

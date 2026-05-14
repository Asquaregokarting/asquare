import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type {
  Ticket,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  CreateTicketPayload,
  TicketAttachment,
  TicketLinkedEntity,
  TicketAutoContext,
  TicketSlaSnapshot,
  TicketRootCauseTag,
  UserRecord,
} from './types'
import { DEFAULT_TICKET_CATEGORIES } from './types'
import { listFirestoreUsers } from './users-firestore'
import { routeTicket, type RoutingCandidate } from './ticket-routing'
import { computeSlaSnapshot } from './ticket-sla'
import { validateStatusTransition } from './ticket-status-machine'
import { recordActivity } from './ticket-activity-firestore'
import { logger } from '../../lib/logger'

const COLLECTION = 'pipeline-tickets'
const CATEGORIES_COLLECTION = 'pipeline-ticket-categories'
const USERS_COLLECTION = 'users'

const getTicketsCollection = () => collection(getAsquareFirestore(), COLLECTION)

function priorityRank(p: TicketPriority): number {
  switch (p) {
    case 'Low':
      return 0
    case 'Normal':
      return 1
    case 'High':
      return 2
    case 'Critical':
      return 3
  }
}

function getDefaultCategory(id: string): TicketCategory {
  return (
    DEFAULT_TICKET_CATEGORIES.find((c) => c.id === id) ??
    DEFAULT_TICKET_CATEGORIES.find((c) => c.id === 'other')!
  )
}

function mapCategoryDoc(id: string, data: Record<string, unknown>): TicketCategory {
  return {
    id,
    label: typeof data.label === 'string' ? data.label : id,
    priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
    responseSlaSeconds:
      typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
    resolveSlaSeconds:
      typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
    routingChain: Array.isArray(data.routingChain)
      ? (data.routingChain as TicketCategory['routingChain'])
      : ['Incharge'],
    active: data.active !== false,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
  }
}

async function loadCategory(categoryId: string): Promise<TicketCategory> {
  try {
    const ref = doc(getAsquareFirestore(), CATEGORIES_COLLECTION, categoryId)
    const snap = await getDoc(ref)
    if (snap.exists()) {
      return mapCategoryDoc(snap.id, snap.data() as Record<string, unknown>)
    }
  } catch (err) {
    logger.warn('ticket.category_load_failed', {
      categoryId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return getDefaultCategory('other')
}

function userToCandidate(user: UserRecord): RoutingCandidate {
  let lastAssignedAtMs = 0
  if (user.lastAssignedTicketAt) {
    const t = Date.parse(user.lastAssignedTicketAt)
    if (!Number.isNaN(t)) lastAssignedAtMs = t
  }
  const branchId =
    user.branchId ??
    (Array.isArray(user.allowedLocations) && user.allowedLocations.length === 1
      ? user.allowedLocations[0]
      : '')
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    branchId,
    active: user.isActive !== false,
    lastAssignedAtMs,
  }
}

const generateTicketId = (): string => `TKT-${Math.random().toString(36).slice(2, 10)}`

function mapTicket(id: string, data: Record<string, unknown>): Ticket {
  const toISO = (val: unknown): string => {
    if (!val) return new Date().toISOString()
    if (typeof val === 'string') return val
    if (typeof val === 'object' && val !== null && 'toDate' in val) {
      return (val as { toDate: () => Date }).toDate().toISOString()
    }
    return new Date().toISOString()
  }

  const toISOOrNull = (val: unknown): string | null => {
    if (val === null || val === undefined) return null
    return toISO(val)
  }

  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
  const arrStr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const arrObj = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

  const schemaVersion = data.schemaVersion === 2 ? 2 : 1

  const issue = str(data.issue)
  const description = str(data.description, issue)
  const title = str(data.title, issue.slice(0, 80) || 'Untitled ticket')

  const branchId = str(data.branchId, str(data.location))
  const branchDisplayName = str(data.branchDisplayName, str(data.locationDisplayName, branchId))

  const assigneeId = str(data.assigneeId, str(data.assignedToId))
  const assigneeName = str(data.assigneeName, str(data.assignedToName, 'Developer'))
  const assigneeRole = (data.assigneeRole as Ticket['assigneeRole']) ?? 'Developer'

  return {
    id,
    schemaVersion,
    title,
    description,
    categoryId: str(data.categoryId, 'other'),
    priority: (data.priority as Ticket['priority']) ?? 'Normal',
    tags: arrStr(data.tags),
    status: (data.status as TicketStatus) ?? 'Open',

    role: (data.role as Ticket['role']) ?? 'Admin',
    raisedBy: str(data.raisedBy),
    raisedByName: str(data.raisedByName),
    raisedByKind: (data.raisedByKind as Ticket['raisedByKind']) ?? 'staff',
    branchId,
    branchDisplayName,

    assignedTo: 'Developer',
    assigneeId,
    assigneeRole,
    assigneeName,
    watcherIds: arrStr(data.watcherIds),

    attachments: arrObj<TicketAttachment>(data.attachments),
    linkedEntities: arrObj<TicketLinkedEntity>(data.linkedEntities),
    autoContext: (data.autoContext as TicketAutoContext) ?? {},

    slaSnapshot: (data.slaSnapshot as TicketSlaSnapshot | null) ?? null,
    responseDueAt: toISOOrNull(data.responseDueAt),
    resolveDueAt: toISOOrNull(data.resolveDueAt),
    firstResponseAt: toISOOrNull(data.firstResponseAt),
    resolvedAt: toISOOrNull(data.resolvedAt),
    resolutionNote: (data.resolutionNote as string | null) ?? null,
    rootCauseTag: (data.rootCauseTag as string | null) ?? null,

    escalationLevel: typeof data.escalationLevel === 'number' ? data.escalationLevel : 0,
    mergedInto: (data.mergedInto as string | null) ?? null,
    reopenedFrom: (data.reopenedFrom as string | null) ?? null,

    location: str(data.location, branchId),
    locationDisplayName: str(data.locationDisplayName, branchDisplayName),
    issue,
    assignedToId: str(data.assignedToId, assigneeId),
    assignedToName: str(data.assignedToName, assigneeName),

    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
  }
}

// Test-only export. Not part of the public API.
export const mapTicketForTest = mapTicket

async function getFirstActiveDeveloper(): Promise<{ id: string; name: string }> {
  try {
    const users = await listFirestoreUsers({ role: 'Developer', status: 'Active' })
    if (users.length > 0) return { id: users[0].id, name: users[0].name }
    logger.warn('ticket.developer_lookup_empty', { role: 'Developer', status: 'Active' })
  } catch (err) {
    logger.error(
      'ticket.developer_lookup_failed',
      err instanceof Error ? err : new Error(String(err)),
    )
  }
  // TODO(phase-2): real category-based routing replaces this fallback.
  return { id: '', name: 'Developer' }
}

export async function createTicket(payload: CreateTicketPayload): Promise<string> {
  const id = generateTicketId()

  // 1. Load the category (with fallback to 'other').
  const category = await loadCategory(payload.categoryId)

  // 2. Compute effective priority — clamp the override up to the floor.
  const overrideRank = payload.priorityOverride ? priorityRank(payload.priorityOverride) : -1
  const floorRank = priorityRank(category.priorityFloor)
  const effectivePriority: TicketPriority =
    overrideRank >= floorRank && payload.priorityOverride
      ? payload.priorityOverride
      : category.priorityFloor

  // 3. Load active candidates and route.
  let candidates: RoutingCandidate[] = []
  try {
    const users = await listFirestoreUsers({ status: 'Active' })
    candidates = users.map(userToCandidate)
  } catch (err) {
    logger.warn('ticket.candidate_load_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const routed = routeTicket(category, payload.location, candidates)
  let assigneeId: string
  let assigneeRole: Ticket['assigneeRole']
  let assigneeName: string
  let escalationChainRemaining: Ticket['assigneeRole'][] = []
  if (routed) {
    assigneeId = routed.assigneeId
    assigneeRole = routed.assigneeRole
    assigneeName = routed.assigneeName
    escalationChainRemaining = routed.escalationChain
  } else {
    const fallback = await getFirstActiveDeveloper()
    assigneeId = fallback.id
    assigneeRole = 'Developer'
    assigneeName = fallback.name
  }

  // 4. Compute SLA snapshot.
  const sla = computeSlaSnapshot(category)

  const raisedByKind = payload.raisedByKind ?? 'staff'
  const title = payload.title ?? (payload.issue.slice(0, 80) || 'Untitled ticket')

  const ref = doc(getTicketsCollection(), id)
  await setDoc(ref, {
    schemaVersion: 2,

    title,
    description: payload.issue,
    issue: payload.issue, // keep v1 mirror until Phase 4 cleanup
    categoryId: category.id,
    priority: effectivePriority,
    tags: [],
    status: 'Open' as TicketStatus,

    role: payload.role,
    raisedBy: payload.raisedBy,
    raisedByName: payload.raisedByName,
    raisedByKind,

    branchId: payload.location,
    branchDisplayName: payload.locationDisplayName,
    location: payload.location, // v1 mirror
    locationDisplayName: payload.locationDisplayName, // v1 mirror

    assignedTo: 'Developer', // v1 literal — preserved for backward compat
    assigneeId,
    assigneeRole,
    assigneeName,
    assignedToId: assigneeId, // v1 mirror — now points at the real assignee
    assignedToName: assigneeName, // v1 mirror — now points at the real assignee
    watcherIds: [],

    attachments: payload.attachments ?? [],
    linkedEntities: payload.linkedEntities ?? [],
    autoContext: payload.autoContext ?? {},

    slaSnapshot: sla.slaSnapshot,
    responseDueAt: sla.responseDueAt,
    resolveDueAt: sla.resolveDueAt,
    firstResponseAt: null,
    resolvedAt: null,
    resolutionNote: null,
    rootCauseTag: null,

    escalationLevel: 0,
    escalationChainRemaining,
    mergedInto: null,
    reopenedFrom: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // 5. Fire-and-forget: stamp the chosen user's lastAssignedTicketAt for round-robin.
  if (assigneeId) {
    void updateDoc(doc(getAsquareFirestore(), USERS_COLLECTION, assigneeId), {
      lastAssignedTicketAt: serverTimestamp(),
    }).catch((err) => {
      logger.warn('ticket.assignee_lastAssignedAt_update_failed', {
        assigneeId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  logger.info('ticket.created', {
    ticketId: id,
    assignedTo: assigneeName,
    assigneeRole,
    categoryId: category.id,
    priority: effectivePriority,
    location: payload.location,
  })
  return id
}

export function subscribeToTickets(
  onData: (tickets: Ticket[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(getTicketsCollection(), orderBy('createdAt', 'desc')),
    (snapshot) => {
      const tickets = snapshot.docs.map((d) => mapTicket(d.id, d.data() as Record<string, unknown>))
      onData(tickets)
    },
    onError,
  )
}

export function subscribeRecentTickets(
  onData: (tickets: Ticket[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)

  return onSnapshot(
    query(
      getTicketsCollection(),
      where('createdAt', '>=', cutoff),
      orderBy('createdAt', 'desc'),
      limit(20),
    ),
    (snapshot) => {
      const tickets = snapshot.docs.map((d) => mapTicket(d.id, d.data() as Record<string, unknown>))
      onData(tickets)
    },
    onError,
  )
}

export async function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<void> {
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { status, updatedAt: serverTimestamp() })
  logger.info('ticket.status_updated', { ticketId, status })
}

export function subscribeToTicket(
  ticketId: string,
  onData: (ticket: Ticket | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  const ref = doc(getTicketsCollection(), ticketId)
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null)
        return
      }
      onData(mapTicket(snap.id, snap.data() as Record<string, unknown>))
    },
    onError,
  )
}

// ── Phase 4 resolution-workspace operations ──────────────────────────────────

export interface ActorIdentity {
  id: string
  name: string
}

export async function transitionStatus(
  ticketId: string,
  from: TicketStatus,
  to: TicketStatus,
  actor: ActorIdentity,
): Promise<void> {
  const result = validateStatusTransition(from, to, {})
  if (!result.ok) throw new Error(`Cannot transition ${from} → ${to}: ${result.reason}`)
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { status: to, updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'status_changed',
    actorId: actor.id,
    actorName: actor.name,
    payload: { from, to },
  })
}

export interface ResolveTicketInput {
  ticketId: string
  fromStatus: TicketStatus
  resolutionNote: string
  rootCauseTag: TicketRootCauseTag
  actor: ActorIdentity
}

export async function resolveTicket(input: ResolveTicketInput): Promise<void> {
  const result = validateStatusTransition(input.fromStatus, 'Resolved', {})
  if (!result.ok) throw new Error(`Cannot resolve from ${input.fromStatus}: ${result.reason}`)
  if (!input.resolutionNote.trim()) throw new Error('resolution note required')
  const ref = doc(getTicketsCollection(), input.ticketId)
  const now = new Date().toISOString()
  await updateDoc(ref, {
    status: 'Resolved',
    resolvedAt: now,
    resolutionNote: input.resolutionNote.trim(),
    rootCauseTag: input.rootCauseTag,
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: input.ticketId,
    type: 'resolved',
    actorId: input.actor.id,
    actorName: input.actor.name,
    payload: { rootCauseTag: input.rootCauseTag },
  })
}

export interface ReopenTicketInput {
  ticketId: string
  resolvedAt: string | null
  reason: string
  actor: ActorIdentity
}

export async function reopenTicket(input: ReopenTicketInput): Promise<void> {
  const result = validateStatusTransition('Resolved', 'Open', {
    isReopen: true,
    resolvedAt: input.resolvedAt,
  })
  if (!result.ok) throw new Error(result.reason)
  if (!input.reason.trim()) throw new Error('reopen reason required')
  const ref = doc(getTicketsCollection(), input.ticketId)
  await updateDoc(ref, {
    status: 'Open',
    reopenedFrom: input.ticketId, // self-reference; full reopen-as-new-ticket lands in Phase 8
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: input.ticketId,
    type: 'reopened',
    actorId: input.actor.id,
    actorName: input.actor.name,
    payload: { reason: input.reason.trim() },
  })
}

export async function mergeTicketInto(
  sourceId: string,
  targetId: string,
  actor: ActorIdentity,
): Promise<void> {
  if (sourceId === targetId) throw new Error('cannot merge ticket into itself')
  const ref = doc(getTicketsCollection(), sourceId)
  await updateDoc(ref, {
    mergedInto: targetId,
    status: 'Closed',
    updatedAt: serverTimestamp(),
  })
  await recordActivity({
    ticketId: sourceId,
    type: 'merged',
    actorId: actor.id,
    actorName: actor.name,
    payload: { targetId },
  })
  await recordActivity({
    ticketId: targetId,
    type: 'merged',
    actorId: actor.id,
    actorName: actor.name,
    payload: { sourceId, direction: 'received' },
  })
}

export async function setTicketTags(
  ticketId: string,
  tags: string[],
  actor: ActorIdentity,
): Promise<void> {
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { tags, updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'tags_changed',
    actorId: actor.id,
    actorName: actor.name,
    payload: { tags },
  })
}

export async function addTicketLinkedEntity(
  ticketId: string,
  entity: TicketLinkedEntity,
  actor: ActorIdentity,
): Promise<void> {
  const ref = doc(getTicketsCollection(), ticketId)
  await updateDoc(ref, { linkedEntities: arrayUnion(entity), updatedAt: serverTimestamp() })
  await recordActivity({
    ticketId,
    type: 'linked_entity_added',
    actorId: actor.id,
    actorName: actor.name,
    payload: { type: entity.type, id: entity.id },
  })
}

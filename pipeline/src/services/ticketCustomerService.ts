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
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'
import { assertCustomerUnderRateLimit } from '../pipeline/api/ticket-rate-limit'
import type {
  Ticket,
  TicketComment,
  CreateTicketCommentPayload,
  TicketCategory,
  TicketKbArticle,
} from '../types'

const TICKETS = 'pipeline-tickets'
const CATEGORIES = 'pipeline-ticket-categories'
const COMMENTS = 'pipeline-ticket-comments'
const KB_ARTICLES = 'pipeline-ticket-kb'

function asISO(val: unknown): string {
  if (typeof val === 'string') return val
  if (val && typeof val === 'object' && 'toDate' in val)
    return (val as { toDate: () => Date }).toDate().toISOString()
  return new Date().toISOString()
}

function mapTicket(id: string, data: Record<string, unknown>): Ticket {
  // Mirror enough of the pipeline mapTicket to render in the customer app.
  // Only the fields the customer UI needs are preserved.
  return {
    id,
    schemaVersion: data.schemaVersion === 2 ? 2 : 1,
    title: String(data.title ?? data.issue ?? ''),
    description: String(data.description ?? data.issue ?? ''),
    categoryId: String(data.categoryId ?? 'other'),
    priority: (data.priority as Ticket['priority']) ?? 'Normal',
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    status: (data.status as Ticket['status']) ?? 'Open',
    role: (data.role as Ticket['role']) ?? 'ThirdParty',
    raisedBy: String(data.raisedBy ?? ''),
    raisedByName: String(data.raisedByName ?? ''),
    raisedByKind: (data.raisedByKind as Ticket['raisedByKind']) ?? 'customer',
    branchId: String(data.branchId ?? data.location ?? ''),
    branchDisplayName: String(data.branchDisplayName ?? data.locationDisplayName ?? ''),
    assignedTo: 'Developer' as const,
    assigneeId: String(data.assigneeId ?? data.assignedToId ?? ''),
    assigneeRole: (data.assigneeRole as Ticket['assigneeRole']) ?? 'Developer',
    assigneeName: String(data.assigneeName ?? data.assignedToName ?? ''),
    watcherIds: Array.isArray(data.watcherIds) ? (data.watcherIds as string[]) : [],
    attachments: Array.isArray(data.attachments) ? (data.attachments as Ticket['attachments']) : [],
    linkedEntities: Array.isArray(data.linkedEntities)
      ? (data.linkedEntities as Ticket['linkedEntities'])
      : [],
    autoContext: (data.autoContext as Ticket['autoContext']) ?? {},
    slaSnapshot: (data.slaSnapshot as Ticket['slaSnapshot']) ?? null,
    responseDueAt: (data.responseDueAt as string | null) ?? null,
    resolveDueAt: (data.resolveDueAt as string | null) ?? null,
    firstResponseAt: (data.firstResponseAt as string | null) ?? null,
    resolvedAt: (data.resolvedAt as string | null) ?? null,
    resolutionNote: (data.resolutionNote as string | null) ?? null,
    rootCauseTag: (data.rootCauseTag as string | null) ?? null,
    escalationLevel: typeof data.escalationLevel === 'number' ? data.escalationLevel : 0,
    mergedInto: (data.mergedInto as string | null) ?? null,
    reopenedFrom: (data.reopenedFrom as string | null) ?? null,
    location: String(data.location ?? data.branchId ?? ''),
    locationDisplayName: String(data.locationDisplayName ?? data.branchDisplayName ?? ''),
    issue: String(data.issue ?? data.description ?? ''),
    assignedToId: String(data.assignedToId ?? data.assigneeId ?? ''),
    assignedToName: String(data.assignedToName ?? data.assigneeName ?? ''),
    createdAt: asISO(data.createdAt),
    updatedAt: asISO(data.updatedAt),
  }
}

const generateTicketId = (): string => `TKT-${Math.random().toString(36).slice(2, 10)}`

export interface CustomerCreateTicketInput {
  userId: string
  userName: string
  branchId: string
  branchDisplayName: string
  categoryId: string
  title: string
  description: string
  bookingId?: string
}

interface CategoryDefaults {
  id: string
  priorityFloor: TicketCategory['priorityFloor']
  responseSlaSeconds: number | null
  resolveSlaSeconds: number
  routingChain: TicketCategory['routingChain']
}

const DEFAULT_OTHER_CATEGORY: CategoryDefaults = {
  id: 'other',
  priorityFloor: 'Normal',
  responseSlaSeconds: 4 * 60 * 60,
  resolveSlaSeconds: 24 * 60 * 60,
  routingChain: ['Incharge'],
}

async function loadCategoryClientSide(id: string): Promise<CategoryDefaults> {
  const snap = await getDoc(doc(db, CATEGORIES, id))
  if (!snap.exists()) return DEFAULT_OTHER_CATEGORY
  const data = snap.data() || {}
  return {
    id,
    priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
    responseSlaSeconds:
      typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
    resolveSlaSeconds:
      typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
    routingChain: Array.isArray(data.routingChain)
      ? (data.routingChain as TicketCategory['routingChain'])
      : ['Incharge'],
  }
}

export const ticketCustomerService = {
  async createTicket(input: CustomerCreateTicketInput): Promise<string> {
    // Customer-side abuse guard: 5 tickets / 24h per user.
    await assertCustomerUnderRateLimit(input.userId)

    if (!input.title.trim()) throw new Error('title required')
    if (input.description.trim().length < 10) throw new Error('description must be ≥ 10 chars')

    const id = generateTicketId()
    const cat = await loadCategoryClientSide(input.categoryId || 'other')
    const now = new Date()
    const responseDueAt =
      cat.responseSlaSeconds === null
        ? null
        : new Date(now.getTime() + cat.responseSlaSeconds * 1000).toISOString()
    const resolveDueAt = new Date(now.getTime() + cat.resolveSlaSeconds * 1000).toISOString()

    await addDoc(collection(db, TICKETS), {
      // Server-side onTicketWrite will pick routing/assignee from the chain on first save —
      // for now just write the ticket with no assignee and let the trigger populate.
      // The trigger uses `escalationChainRemaining` to know the chain.
      schemaVersion: 2,
      title: input.title.trim().slice(0, 120),
      description: input.description.trim(),
      issue: input.description.trim(),
      categoryId: input.categoryId || 'other',
      priority: cat.priorityFloor,
      tags: [],
      status: 'Open',
      role: 'ThirdParty',
      raisedBy: input.userId,
      raisedByName: input.userName,
      raisedByKind: 'customer',
      branchId: input.branchId,
      branchDisplayName: input.branchDisplayName,
      location: input.branchId,
      locationDisplayName: input.branchDisplayName,
      assignedTo: 'Developer',
      assigneeId: '',
      assigneeRole: 'Developer',
      assigneeName: '',
      assignedToId: '',
      assignedToName: '',
      watcherIds: [],
      attachments: [],
      linkedEntities: input.bookingId
        ? [{ type: 'booking', id: input.bookingId, label: `Booking ${input.bookingId}` }]
        : [],
      autoContext: {
        appVersion: 'customer-app',
      },
      slaSnapshot: {
        responseSeconds: cat.responseSlaSeconds,
        resolveSeconds: cat.resolveSlaSeconds,
      },
      responseDueAt,
      resolveDueAt,
      firstResponseAt: null,
      resolvedAt: null,
      resolutionNote: null,
      rootCauseTag: null,
      escalationLevel: 0,
      escalationChainRemaining: cat.routingChain,
      mergedInto: null,
      reopenedFrom: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    logger.info('customer.ticket.created', { id, categoryId: input.categoryId })
    return id
  },

  subscribeToMyTickets(
    userId: string,
    onData: (rows: Ticket[]) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(
        collection(db, TICKETS),
        where('raisedBy', '==', userId),
        where('raisedByKind', '==', 'customer'),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
      (snap) => onData(snap.docs.map((d) => mapTicket(d.id, d.data() as Record<string, unknown>))),
      onError,
    )
  },

  subscribeToTicket(
    ticketId: string,
    userId: string,
    onData: (t: Ticket | null) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(db, TICKETS, ticketId),
      (snap) => {
        if (!snap.exists()) {
          onData(null)
          return
        }
        const t = mapTicket(snap.id, snap.data() as Record<string, unknown>)
        // Authorization: customer can only see tickets they raised.
        if (t.raisedBy !== userId) {
          onData(null)
          return
        }
        onData(t)
      },
      onError,
    )
  },

  subscribeToComments(
    ticketId: string,
    onData: (rows: TicketComment[]) => void,
    onError: (err: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(
        collection(db, COMMENTS),
        where('ticketId', '==', ticketId),
        where('internal', '==', false),
        orderBy('createdAt', 'asc'),
      ),
      (snap) =>
        onData(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>
            return {
              id: d.id,
              ticketId: String(data.ticketId ?? ''),
              authorId: String(data.authorId ?? ''),
              authorName: String(data.authorName ?? ''),
              authorKind: (data.authorKind as TicketComment['authorKind']) ?? 'staff',
              body: String(data.body ?? ''),
              internal: false,
              mentions: Array.isArray(data.mentions) ? (data.mentions as string[]) : [],
              createdAt: asISO(data.createdAt),
              updatedAt: asISO(data.updatedAt),
            }
          }),
        ),
      onError,
    )
  },

  async addComment(
    payload: Omit<CreateTicketCommentPayload, 'authorKind' | 'internal'>,
  ): Promise<string> {
    const ref = await addDoc(collection(db, COMMENTS), {
      ...payload,
      authorKind: 'customer',
      internal: false,
      mentions: payload.mentions ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return ref.id
  },

  async listActiveCategories(): Promise<TicketCategory[]> {
    const snap = await getDocs(query(collection(db, CATEGORIES), orderBy('sortOrder', 'asc')))
    return snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          label: String(data.label ?? d.id),
          priorityFloor: (data.priorityFloor as TicketCategory['priorityFloor']) ?? 'Normal',
          responseSlaSeconds:
            typeof data.responseSlaSeconds === 'number' ? data.responseSlaSeconds : null,
          resolveSlaSeconds:
            typeof data.resolveSlaSeconds === 'number' ? data.resolveSlaSeconds : 24 * 60 * 60,
          routingChain: (Array.isArray(data.routingChain)
            ? data.routingChain
            : ['Incharge']) as TicketCategory['routingChain'],
          active: data.active !== false,
          sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
        }
      })
      .filter((c) => c.active)
  },

  /**
   * One-shot read of customer-visible, active KB articles. Used to render
   * the FAQ section on the customer Help page. Reads `pipeline-ticket-kb`
   * directly via the shared `db` so the customer app stays free of any
   * `src/pipeline/*` UI imports.
   */
  async getCustomerKbArticles(): Promise<TicketKbArticle[]> {
    const snap = await getDocs(
      query(
        collection(db, KB_ARTICLES),
        where('visibility', '==', 'customer'),
        where('active', '==', true),
        orderBy('sortOrder', 'asc'),
      ),
    )
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>
      return {
        id: d.id,
        title: String(data.title ?? d.id),
        body: String(data.body ?? ''),
        tags: Array.isArray(data.tags)
          ? data.tags.filter((x): x is string => typeof x === 'string')
          : [],
        visibility: 'customer',
        active: true,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 99,
        createdAt: asISO(data.createdAt),
        updatedAt: asISO(data.updatedAt),
      }
    })
  },
}

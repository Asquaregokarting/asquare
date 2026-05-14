import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'

const setDocMock = vi.fn()
const onSnapshotMock = vi.fn()
const docMock = vi.fn(() => ({ id: 'TKT-test1234' }))
const getDocMock = vi.fn()
const updateDocMock = vi.fn()
const listFirestoreUsersMock = vi.fn()

vi.mock('firebase/firestore', async (orig) => {
  const actual = await orig<typeof import('firebase/firestore')>()
  return {
    ...actual,
    collection: vi.fn(() => ({})),
    doc: (...args: unknown[]) => docMock(...args),
    setDoc: (...args: unknown[]) => setDocMock(...args),
    getDoc: (...args: unknown[]) => getDocMock(...args),
    updateDoc: (...args: unknown[]) => updateDocMock(...args),
    onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
    serverTimestamp: () => '__server_ts__',
    getFirestore: vi.fn(() => ({})),
  }
})

vi.mock('./asquare-firestore', () => ({
  getAsquareFirestore: vi.fn(() => ({})),
}))

vi.mock('./users-firestore', () => ({
  listFirestoreUsers: (...args: unknown[]) => listFirestoreUsersMock(...args),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { createTicket, mapTicketForTest, subscribeToTicket } from './tickets-firestore'

describe('mapTicket', () => {
  const v1Doc = {
    role: 'Cashier',
    raisedBy: 'user-1',
    raisedByName: 'Alice',
    location: 'vizag',
    locationDisplayName: 'Vizag',
    issue: 'Printer is jammed',
    status: 'Open',
    assignedTo: 'Developer',
    assignedToId: 'dev-1',
    assignedToName: 'Bob',
    createdAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
    updatedAt: Timestamp.fromDate(new Date('2026-04-20T10:00:00Z')),
  }

  it('maps a v1 document to v2 shape with defaults', () => {
    const t = mapTicketForTest('TKT-abc12345', v1Doc)
    expect(t.schemaVersion).toBe(1)
    expect(t.title).toBe('Printer is jammed')
    expect(t.description).toBe('Printer is jammed')
    expect(t.issue).toBe('Printer is jammed')
    expect(t.categoryId).toBe('other')
    expect(t.priority).toBe('Normal')
    expect(t.branchId).toBe('vizag')
    expect(t.branchDisplayName).toBe('Vizag')
    expect(t.raisedByKind).toBe('staff')
    expect(t.assigneeId).toBe('dev-1')
    expect(t.assigneeName).toBe('Bob')
    expect(t.assigneeRole).toBe('Developer')
    expect(t.attachments).toEqual([])
    expect(t.linkedEntities).toEqual([])
    expect(t.tags).toEqual([])
    expect(t.watcherIds).toEqual([])
    expect(t.escalationLevel).toBe(0)
    expect(t.mergedInto).toBeNull()
    expect(t.reopenedFrom).toBeNull()
    expect(t.slaSnapshot).toBeNull()
  })

  it('preserves v2 fields when present', () => {
    const v2Doc = {
      ...v1Doc,
      schemaVersion: 2,
      title: 'Custom title',
      description: 'Long description',
      categoryId: 'billing',
      priority: 'High',
      branchId: 'kakinada',
      branchDisplayName: 'Kakinada',
      raisedByKind: 'customer',
      assigneeId: 'cashier-1',
      assigneeName: 'Cara',
      assigneeRole: 'Cashier',
      tags: ['refund'],
      watcherIds: ['user-2'],
      escalationLevel: 1,
      attachments: [],
      linkedEntities: [{ type: 'booking', id: 'BK-1', label: 'Booking BK-1' }],
    }
    const t = mapTicketForTest('TKT-xyz', v2Doc)
    expect(t.schemaVersion).toBe(2)
    expect(t.title).toBe('Custom title')
    expect(t.description).toBe('Long description')
    expect(t.categoryId).toBe('billing')
    expect(t.priority).toBe('High')
    expect(t.branchId).toBe('kakinada')
    expect(t.assigneeRole).toBe('Cashier')
    expect(t.tags).toEqual(['refund'])
    expect(t.linkedEntities[0].id).toBe('BK-1')
    expect(t.escalationLevel).toBe(1)
  })
})

describe('createTicket', () => {
  beforeEach(() => {
    setDocMock.mockReset()
    getDocMock.mockReset()
    updateDocMock.mockReset()
    listFirestoreUsersMock.mockReset()
    setDocMock.mockResolvedValue(undefined)
    updateDocMock.mockResolvedValue(undefined)
    // Default: category doc missing → falls back to 'other' from defaults.
    getDocMock.mockResolvedValue({ exists: () => false })
    // Default: a single Developer with no branchId so cross-branch fallback finds them.
    listFirestoreUsersMock.mockResolvedValue([
      { id: 'dev-1', name: 'Dev One', role: 'Developer', isActive: true },
    ])
  })

  it('writes a v2-shaped document with v1 mirrors', async () => {
    await createTicket({
      role: 'Cashier',
      location: 'vizag',
      locationDisplayName: 'Vizag',
      issue: 'Receipt printer offline',
      raisedBy: 'user-1',
      raisedByName: 'Alice',
      categoryId: 'other',
    })

    expect(setDocMock).toHaveBeenCalledTimes(1)
    const written = setDocMock.mock.calls[0][1] as Record<string, unknown>

    // v2 fields
    expect(written.schemaVersion).toBe(2)
    expect(written.title).toBe('Receipt printer offline')
    expect(written.description).toBe('Receipt printer offline')
    expect(written.categoryId).toBe('other')
    expect(written.priority).toBe('Normal')
    expect(written.tags).toEqual([])
    expect(written.status).toBe('Open')
    expect(written.raisedByKind).toBe('staff')
    expect(written.branchId).toBe('vizag')
    expect(written.branchDisplayName).toBe('Vizag')
    // The default-mock user is a Developer; the 'other' category routes to
    // ['Incharge', 'Admin'] so the cross-branch fallback in routeTicket picks
    // nobody and createTicket falls back to getFirstActiveDeveloper().
    expect(written.assigneeId).toBe('dev-1')
    expect(written.assigneeRole).toBe('Developer')
    expect(written.assigneeName).toBe('Dev One')
    expect(written.watcherIds).toEqual([])
    expect(written.attachments).toEqual([])
    expect(written.linkedEntities).toEqual([])
    expect(written.escalationLevel).toBe(0)
    expect(written.mergedInto).toBeNull()
    expect(written.reopenedFrom).toBeNull()
    // 'other' has a resolveSlaSeconds defined so the snapshot is non-null.
    expect(written.slaSnapshot).not.toBeNull()

    // v1 mirrors
    expect(written.issue).toBe('Receipt printer offline')
    expect(written.location).toBe('vizag')
    expect(written.locationDisplayName).toBe('Vizag')
    expect(written.assignedToId).toBe('dev-1')
    expect(written.assignedToName).toBe('Dev One')
  })

  it('truncates very long issue text to an 80-char title', async () => {
    const longIssue = 'a'.repeat(200)
    await createTicket({
      role: 'Cashier',
      location: 'vizag',
      locationDisplayName: 'Vizag',
      issue: longIssue,
      raisedBy: 'user-1',
      raisedByName: 'Alice',
      categoryId: 'other',
    })
    const written = setDocMock.mock.calls[0][1] as Record<string, unknown>
    expect((written.title as string).length).toBe(80)
    expect(written.description).toBe(longIssue)
  })

  it('uses category routing and SLA when category is found', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'billing-refund',
      data: () => ({
        label: 'Billing / Refund',
        priorityFloor: 'High',
        responseSlaSeconds: 3600,
        resolveSlaSeconds: 8 * 3600,
        routingChain: ['Cashier', 'Incharge'],
        active: true,
        sortOrder: 20,
      }),
    })
    listFirestoreUsersMock.mockResolvedValueOnce([
      {
        id: 'cashier-1',
        name: 'Cassie',
        role: 'Cashier',
        isActive: true,
        branchId: 'vizag',
      },
      {
        id: 'incharge-1',
        name: 'Inco',
        role: 'Incharge',
        isActive: true,
        branchId: 'vizag',
      },
    ])

    await createTicket({
      role: 'Cashier',
      location: 'vizag',
      locationDisplayName: 'Vizag',
      issue: 'Refund needed',
      raisedBy: 'user-1',
      raisedByName: 'Alice',
      categoryId: 'billing-refund',
    })

    expect(setDocMock).toHaveBeenCalledTimes(1)
    const written = setDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(written.categoryId).toBe('billing-refund')
    expect(written.priority).toBe('High')
    expect(written.assigneeRole).toBe('Cashier')
    expect(written.assigneeId).toBe('cashier-1')
    expect(written.assigneeName).toBe('Cassie')
    const snap = written.slaSnapshot as { responseSeconds: number; resolveSeconds: number }
    expect(snap.responseSeconds).toBe(3600)
    expect(snap.resolveSeconds).toBe(8 * 3600)
    expect(typeof written.responseDueAt).toBe('string')
    expect(typeof written.resolveDueAt).toBe('string')
    expect(written.responseDueAt).not.toBeNull()
    expect(written.resolveDueAt).not.toBeNull()
    // v1 mirrors point at the routed assignee, not necessarily a developer.
    expect(written.assignedToId).toBe('cashier-1')
    expect(written.assignedToName).toBe('Cassie')
  })

  it("falls back to 'other' when category doc is missing", async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false })
    await createTicket({
      role: 'Cashier',
      location: 'vizag',
      locationDisplayName: 'Vizag',
      issue: 'Something is off',
      raisedBy: 'user-1',
      raisedByName: 'Alice',
      categoryId: 'does-not-exist',
    })
    const written = setDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(written.categoryId).toBe('other')
    expect(written.priority).toBe('Normal')
  })

  it('clamps priority to category floor when override is lower', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'billing-refund',
      data: () => ({
        label: 'Billing / Refund',
        priorityFloor: 'High',
        responseSlaSeconds: 3600,
        resolveSlaSeconds: 8 * 3600,
        routingChain: ['Cashier'],
        active: true,
        sortOrder: 20,
      }),
    })
    listFirestoreUsersMock.mockResolvedValueOnce([
      {
        id: 'cashier-1',
        name: 'Cassie',
        role: 'Cashier',
        isActive: true,
        branchId: 'vizag',
      },
    ])

    await createTicket({
      role: 'Cashier',
      location: 'vizag',
      locationDisplayName: 'Vizag',
      issue: 'Low priority but refund category',
      raisedBy: 'user-1',
      raisedByName: 'Alice',
      categoryId: 'billing-refund',
      priorityOverride: 'Low',
    })
    const written = setDocMock.mock.calls[0][1] as Record<string, unknown>
    expect(written.priority).toBe('High')
  })
})

describe('subscribeToTicket', () => {
  beforeEach(() => {
    onSnapshotMock.mockReset()
  })

  it('calls onData(null) when the document does not exist', () => {
    let capturedOnNext: ((snap: unknown) => void) | undefined
    onSnapshotMock.mockImplementation((_ref, onNext) => {
      capturedOnNext = onNext
      return () => {}
    })

    const onData = vi.fn()
    const onError = vi.fn()
    const unsub = subscribeToTicket('TKT-missing', onData, onError)

    expect(typeof unsub).toBe('function')
    capturedOnNext!({ exists: () => false, id: 'TKT-missing', data: () => ({}) })
    expect(onData).toHaveBeenCalledWith(null)
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onData with mapped ticket when the document exists', () => {
    let capturedOnNext: ((snap: unknown) => void) | undefined
    onSnapshotMock.mockImplementation((_ref, onNext) => {
      capturedOnNext = onNext
      return () => {}
    })

    const onData = vi.fn()
    const onError = vi.fn()
    subscribeToTicket('TKT-real1234', onData, onError)

    capturedOnNext!({
      exists: () => true,
      id: 'TKT-real1234',
      data: () => ({
        schemaVersion: 2,
        issue: 'old field',
        description: 'real desc',
        title: 'real title',
        location: 'vizag',
        locationDisplayName: 'Vizag',
        status: 'Open',
        role: 'Admin',
        raisedBy: 'u',
        raisedByName: 'U',
      }),
    })

    expect(onData).toHaveBeenCalledTimes(1)
    const ticket = onData.mock.calls[0][0]
    expect(ticket).not.toBeNull()
    expect(ticket.id).toBe('TKT-real1234')
    expect(ticket.title).toBe('real title')
    expect(ticket.description).toBe('real desc')
  })
})

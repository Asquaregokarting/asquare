import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sortLeadsByCallQueue, groupByPriority, type QueuedLead } from './lead-queue-sort'
import type { LeadRecord } from '../../api/types'

const baseLead: LeadRecord = {
  id: 'lead-1',
  customerName: 'Test',
  customerPhone: '9876543210',
  customerEmail: '',
  source: 'website_inquiry',
  sourceRef: '',
  sourceChannel: '',
  status: 'new',
  subStatus: '',
  score: 50,
  scoreLabel: 'warm',
  scoreFactors: { recencyDays: 0, visitCount: 0, totalSpend: 0 },
  assignedTo: '',
  assignedAt: '',
  assignedBy: '',
  branchId: '0',
  branchName: 'Vizag',
  consecutiveNoAnswer: 0,
  whatsappSentAt: '',
  lastContactedAt: '',
  lastActivityAt: '2026-04-13T10:00:00Z',
  callbackScheduledAt: '',
  feedbackNotes: '',
  feedbackSubmittedAt: '',
  feedbackSubmittedBy: '',
  convertedBookingId: '',
  convertedAt: '',
  viewedBy: '',
  viewedAt: '',
  createdAt: '2026-04-10T10:00:00Z',
  updatedAt: '2026-04-13T10:00:00Z',
  createdBy: 'system',
  importBatchId: '',
  tags: [],
  notes: '',
}

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return { ...baseLead, ...overrides }
}

describe('sortLeadsByCallQueue', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-04-13T12:00:00Z') }))
  afterEach(() => vi.useRealTimers())

  it('overdue callbacks come first', () => {
    const leads = [
      makeLead({ id: 'cold', scoreLabel: 'cold', score: 10 }),
      makeLead({
        id: 'overdue',
        subStatus: 'callback_requested',
        callbackScheduledAt: '2026-04-13T10:00:00Z', // 2 hours ago
      }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].id).toBe('overdue')
    expect(sorted[0].queuePriority).toBe('overdue_callback')
  })

  it('upcoming callbacks come after overdue but before hot', () => {
    const leads = [
      makeLead({ id: 'hot', scoreLabel: 'hot', score: 90 }),
      makeLead({
        id: 'upcoming',
        subStatus: 'callback_requested',
        callbackScheduledAt: '2026-04-13T12:30:00Z', // 30 min from now
      }),
      makeLead({
        id: 'overdue',
        subStatus: 'callback_requested',
        callbackScheduledAt: '2026-04-13T11:00:00Z', // 1 hour ago
      }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].id).toBe('overdue')
    expect(sorted[1].id).toBe('upcoming')
    expect(sorted[2].id).toBe('hot')
  })

  it('hot leads come before warm', () => {
    const leads = [
      makeLead({ id: 'warm', scoreLabel: 'warm', score: 50 }),
      makeLead({ id: 'hot', scoreLabel: 'hot', score: 85 }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].id).toBe('hot')
    expect(sorted[1].id).toBe('warm')
  })

  it('within same tier, higher score first', () => {
    const leads = [
      makeLead({ id: 'low', scoreLabel: 'hot', score: 72 }),
      makeLead({ id: 'high', scoreLabel: 'hot', score: 95 }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].id).toBe('high')
  })

  it('cold leads come last', () => {
    const leads = [
      makeLead({ id: 'cold', scoreLabel: 'cold', score: 10 }),
      makeLead({ id: 'warm', scoreLabel: 'warm', score: 50 }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[sorted.length - 1].id).toBe('cold')
  })

  it('marks overdue callback correctly', () => {
    const leads = [
      makeLead({
        id: 'overdue',
        subStatus: 'callback_requested',
        callbackScheduledAt: '2026-04-13T10:00:00Z',
      }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].isCallbackOverdue).toBe(true)
    expect(sorted[0].isCallbackUpcoming).toBe(false)
  })

  it('marks upcoming callback correctly', () => {
    const leads = [
      makeLead({
        id: 'upcoming',
        subStatus: 'callback_requested',
        callbackScheduledAt: '2026-04-13T12:45:00Z',
      }),
    ]
    const sorted = sortLeadsByCallQueue(leads)
    expect(sorted[0].isCallbackOverdue).toBe(false)
    expect(sorted[0].isCallbackUpcoming).toBe(true)
  })

  it('handles empty array', () => {
    expect(sortLeadsByCallQueue([])).toEqual([])
  })
})

describe('groupByPriority', () => {
  it('groups queued leads by priority', () => {
    const queued: QueuedLead[] = [
      {
        ...baseLead,
        id: 'a',
        queuePriority: 'hot',
        isCallbackOverdue: false,
        isCallbackUpcoming: false,
      },
      {
        ...baseLead,
        id: 'b',
        queuePriority: 'cold',
        isCallbackOverdue: false,
        isCallbackUpcoming: false,
      },
      {
        ...baseLead,
        id: 'c',
        queuePriority: 'hot',
        isCallbackOverdue: false,
        isCallbackUpcoming: false,
      },
    ]
    const groups = groupByPriority(queued)
    expect(groups.hot).toHaveLength(2)
    expect(groups.cold).toHaveLength(1)
    expect(groups.warm).toHaveLength(0)
    expect(groups.overdue_callback).toHaveLength(0)
  })

  it('handles empty array', () => {
    const groups = groupByPriority([])
    expect(groups.hot).toHaveLength(0)
    expect(groups.cold).toHaveLength(0)
  })
})

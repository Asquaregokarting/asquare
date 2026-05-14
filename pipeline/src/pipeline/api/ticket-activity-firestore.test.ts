import { describe, it, expect } from 'vitest'
import { mapActivityForTest } from './ticket-activity-firestore'

describe('mapActivity', () => {
  it('maps a populated activity row', () => {
    const a = mapActivityForTest('a', {
      ticketId: 't',
      type: 'resolved',
      actorId: 'u',
      actorName: 'U',
      payload: { rootCauseTag: 'hardware-fault' },
    })
    expect(a.id).toBe('a')
    expect(a.ticketId).toBe('t')
    expect(a.type).toBe('resolved')
    expect(a.actorId).toBe('u')
    expect(a.actorName).toBe('U')
    expect(a.payload).toEqual({ rootCauseTag: 'hardware-fault' })
    expect(typeof a.createdAt).toBe('string')
  })

  it("falls back to 'created' type, empty payload, and current ISO timestamp", () => {
    const a = mapActivityForTest('a', {})
    expect(a.id).toBe('a')
    expect(a.ticketId).toBe('')
    expect(a.type).toBe('created')
    expect(a.actorId).toBe('')
    expect(a.actorName).toBe('')
    expect(a.payload).toEqual({})
    expect(typeof a.createdAt).toBe('string')
    expect(a.createdAt.length).toBeGreaterThan(0)
  })
})

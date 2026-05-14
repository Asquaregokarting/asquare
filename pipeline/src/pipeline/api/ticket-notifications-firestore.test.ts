import { describe, it, expect } from 'vitest'
import { mapNotificationForTest } from './ticket-notifications-firestore'

describe('mapNotification', () => {
  it('uses safe defaults for missing fields', () => {
    const n = mapNotificationForTest('n1', {})
    expect(n.id).toBe('n1')
    expect(n.recipientId).toBe('')
    expect(n.ticketId).toBe('')
    expect(n.ticketTitle).toBe('')
    expect(n.kind).toBe('status_changed')
    expect(n.priority).toBe('Normal')
    expect(n.body).toBe('')
    expect(n.read).toBe(false)
    // createdAt falls back to a fresh ISO timestamp
    expect(typeof n.createdAt).toBe('string')
    expect(Number.isNaN(Date.parse(n.createdAt))).toBe(false)
  })

  it('preserves provided fields', () => {
    const n = mapNotificationForTest('n2', {
      recipientId: 'user-1',
      ticketId: 'TKT-abc',
      ticketTitle: 'Lights flickering',
      kind: 'assigned_to_me',
      priority: 'Critical',
      body: 'New Critical ticket: Lights flickering',
      read: true,
      createdAt: '2026-04-27T08:00:00.000Z',
    })
    expect(n.recipientId).toBe('user-1')
    expect(n.ticketId).toBe('TKT-abc')
    expect(n.ticketTitle).toBe('Lights flickering')
    expect(n.kind).toBe('assigned_to_me')
    expect(n.priority).toBe('Critical')
    expect(n.body).toBe('New Critical ticket: Lights flickering')
    expect(n.read).toBe(true)
    expect(n.createdAt).toBe('2026-04-27T08:00:00.000Z')
  })
})

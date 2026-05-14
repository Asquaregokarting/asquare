import { describe, it, expect } from 'vitest'
import { mapCommentForTest } from './ticket-comments-firestore'

describe('mapComment', () => {
  it('preserves all fields when present', () => {
    const c = mapCommentForTest('c', {
      ticketId: 't',
      authorId: 'u',
      authorName: 'U',
      authorKind: 'staff',
      body: 'Hello',
      internal: true,
      mentions: ['x', 'y'],
    })
    expect(c.id).toBe('c')
    expect(c.ticketId).toBe('t')
    expect(c.authorId).toBe('u')
    expect(c.authorName).toBe('U')
    expect(c.authorKind).toBe('staff')
    expect(c.body).toBe('Hello')
    expect(c.internal).toBe(true)
    expect(c.mentions).toEqual(['x', 'y'])
  })

  it('uses safe defaults when fields are missing', () => {
    const c = mapCommentForTest('c', {})
    expect(c.id).toBe('c')
    expect(c.ticketId).toBe('')
    expect(c.authorId).toBe('')
    expect(c.authorName).toBe('')
    expect(c.authorKind).toBe('staff')
    expect(c.body).toBe('')
    expect(c.internal).toBe(false)
    expect(c.mentions).toEqual([])
    expect(typeof c.createdAt).toBe('string')
    expect(typeof c.updatedAt).toBe('string')
  })
})

import { describe, it, expect } from 'vitest'
import { mapCannedForTest } from './ticket-canned-firestore'

describe('mapCanned', () => {
  it('uses safe defaults for missing fields', () => {
    const c = mapCannedForTest('greet', {})
    expect(c.id).toBe('greet')
    expect(c.title).toBe('greet')
    expect(c.body).toBe('')
    expect(c.categoryIds).toEqual([])
    expect(c.active).toBe(true)
    expect(c.sortOrder).toBe(99)
    expect(typeof c.createdAt).toBe('string')
    expect(typeof c.updatedAt).toBe('string')
  })

  it('preserves provided fields', () => {
    const c = mapCannedForTest('refund', {
      title: 'Refund timeline',
      body: 'Refunds take 5-7 business days.',
      categoryIds: ['payment', 'billing'],
      active: false,
      sortOrder: 4,
    })
    expect(c.title).toBe('Refund timeline')
    expect(c.body).toMatch(/Refunds/)
    expect(c.categoryIds).toEqual(['payment', 'billing'])
    expect(c.active).toBe(false)
    expect(c.sortOrder).toBe(4)
  })
})

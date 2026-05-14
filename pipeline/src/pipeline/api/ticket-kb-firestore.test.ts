import { describe, it, expect } from 'vitest'
import { mapKbArticleForTest } from './ticket-kb-firestore'

describe('mapKbArticle', () => {
  it('uses safe defaults for missing fields', () => {
    const a = mapKbArticleForTest('faq-1', {})
    expect(a.id).toBe('faq-1')
    expect(a.title).toBe('faq-1')
    expect(a.body).toBe('')
    expect(a.tags).toEqual([])
    expect(a.visibility).toBe('internal')
    expect(a.active).toBe(true)
    expect(a.sortOrder).toBe(99)
    expect(typeof a.createdAt).toBe('string')
    expect(typeof a.updatedAt).toBe('string')
  })

  it('preserves provided fields', () => {
    const a = mapKbArticleForTest('faq-2', {
      title: 'Reschedule policy',
      body: 'You can reschedule up to 2 hours before…',
      tags: ['booking', 'policy'],
      visibility: 'customer',
      active: false,
      sortOrder: 3,
    })
    expect(a.title).toBe('Reschedule policy')
    expect(a.body).toMatch(/reschedule/i)
    expect(a.tags).toEqual(['booking', 'policy'])
    expect(a.visibility).toBe('customer')
    expect(a.active).toBe(false)
    expect(a.sortOrder).toBe(3)
  })
})

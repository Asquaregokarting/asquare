import { describe, it, expect } from 'vitest'
import { mapCategoryForTest } from './ticket-categories-firestore'

describe('mapCategory', () => {
  it('uses safe defaults for missing fields', () => {
    const c = mapCategoryForTest('x', {})
    expect(c.label).toBe('x')
    expect(c.priorityFloor).toBe('Normal')
    expect(c.responseSlaSeconds).toBeNull()
    expect(c.resolveSlaSeconds).toBe(24 * 60 * 60)
    expect(c.routingChain).toEqual(['Incharge'])
    expect(c.active).toBe(true)
    expect(c.sortOrder).toBe(99)
  })

  it('preserves provided fields', () => {
    const c = mapCategoryForTest('a', {
      label: 'Alpha',
      priorityFloor: 'High',
      responseSlaSeconds: 3600,
      resolveSlaSeconds: 7200,
      routingChain: ['Cashier', 'Admin'],
      active: false,
      sortOrder: 5,
    })
    expect(c.label).toBe('Alpha')
    expect(c.priorityFloor).toBe('High')
    expect(c.responseSlaSeconds).toBe(3600)
    expect(c.resolveSlaSeconds).toBe(7200)
    expect(c.routingChain).toEqual(['Cashier', 'Admin'])
    expect(c.active).toBe(false)
    expect(c.sortOrder).toBe(5)
  })
})

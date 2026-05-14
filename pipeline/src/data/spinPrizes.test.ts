import { describe, it, expect } from 'vitest'
import { spinPrizes, getRandomPrize } from './spinPrizes'

describe('spinPrizes data', () => {
  it('has at least 5 prizes', () => {
    expect(spinPrizes.length).toBeGreaterThanOrEqual(5)
  })

  it('all prizes have required fields', () => {
    for (const prize of spinPrizes) {
      expect(prize.id).toBeTruthy()
      expect(prize.name).toBeTruthy()
      expect(prize.tier).toBeTruthy()
      expect(prize.type).toBeTruthy()
      expect(prize.weight).toBeGreaterThan(0)
      expect(prize.value).toBeGreaterThanOrEqual(0)
    }
  })

  it('has unique IDs', () => {
    const ids = spinPrizes.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all tiers are non-empty strings', () => {
    for (const prize of spinPrizes) {
      expect(typeof prize.tier).toBe('string')
      expect(prize.tier.length).toBeGreaterThan(0)
    }
  })

  it('types are valid', () => {
    const validTypes = ['tires', 'discount', 'freebie', 'addon']
    for (const prize of spinPrizes) {
      expect(validTypes).toContain(prize.type)
    }
  })

  it('weights sum to a positive total', () => {
    const total = spinPrizes.reduce((sum, p) => sum + p.weight, 0)
    expect(total).toBeGreaterThan(0)
  })

  it('common prizes have higher weight than rare', () => {
    const commonWeights = spinPrizes.filter((p) => p.tier === 'common').map((p) => p.weight)
    const rareWeights = spinPrizes.filter((p) => p.tier === 'rare').map((p) => p.weight)
    if (commonWeights.length > 0 && rareWeights.length > 0) {
      const avgCommon = commonWeights.reduce((a, b) => a + b, 0) / commonWeights.length
      const avgRare = rareWeights.reduce((a, b) => a + b, 0) / rareWeights.length
      expect(avgCommon).toBeGreaterThan(avgRare)
    }
  })
})

describe('getRandomPrize', () => {
  it('always returns a valid prize', () => {
    for (let i = 0; i < 50; i++) {
      const prize = getRandomPrize()
      expect(prize).toBeTruthy()
      expect(prize.id).toBeTruthy()
      expect(prize.name).toBeTruthy()
    }
  })

  it('returns prizes from the pool', () => {
    const validIds = new Set(spinPrizes.map((p) => p.id))
    for (let i = 0; i < 50; i++) {
      expect(validIds).toContain(getRandomPrize().id)
    }
  })

  it('distribution covers multiple prizes (not always the same)', () => {
    const results = new Set<string>()
    for (let i = 0; i < 100; i++) {
      results.add(getRandomPrize().id)
    }
    // With 100 draws, should hit at least 3 different prizes
    expect(results.size).toBeGreaterThanOrEqual(3)
  })
})

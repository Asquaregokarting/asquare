import { describe, it, expect } from 'vitest'
import { tokenize, jaccardSimilarity } from './ticket-duplicates'

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords and short tokens', () => {
    expect(tokenize('The Card Reader is BROKEN at counter 2!')).toEqual([
      'card',
      'reader',
      'broken',
      'counter',
    ])
  })

  it('returns empty array for blank input', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('jaccardSimilarity', () => {
  it('is 1 for identical token sets', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(1)
  })

  it('is 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0)
  })

  it('matches partial overlap', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4)
  })

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity([], [])).toBe(0)
  })
})

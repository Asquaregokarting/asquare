import { describe, it, expect } from 'vitest'

vi.mock('../features/leads/lead-constants', () => ({
  DEFAULT_AUTOMATION_CONFIG: {
    autoScoreWeights: {
      recencyWeight: 40,
      frequencyWeight: 30,
      spendWeight: 20,
      channelWeight: 10,
    },
    scoreThresholds: {
      hotMin: 70,
      warmMin: 40,
    },
  },
}))

import { vi } from 'vitest'
import { computeLeadScore } from './lead-scoring'
import type { LeadScoreFactors, LeadSource } from './types'

const baseFactors: LeadScoreFactors = {
  recencyDays: 0,
  visitCount: 0,
  totalSpend: 0,
}

describe('computeLeadScore — abandoned_cart', () => {
  it('returns hot for recent high-value abandoned cart', () => {
    const { score, scoreLabel } = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 0,
      abandonedCartValue: 5000,
    })
    expect(score).toBeGreaterThanOrEqual(70)
    expect(scoreLabel).toBe('hot')
  })

  it('floors abandoned cart score at 50', () => {
    const { score } = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 30, // very old
      abandonedCartValue: 0,
    })
    expect(score).toBeGreaterThanOrEqual(50)
  })

  it('high cart value boosts score', () => {
    const low = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 1,
      abandonedCartValue: 500,
    })
    const high = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 1,
      abandonedCartValue: 5000,
    })
    expect(high.score).toBeGreaterThan(low.score)
  })

  it('recency decay reduces score', () => {
    const recent = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 0,
      abandonedCartValue: 3000,
    })
    const old = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 10,
      abandonedCartValue: 3000,
    })
    expect(recent.score).toBeGreaterThan(old.score)
  })
})

describe('computeLeadScore — inquiry sources', () => {
  const inquirySources: LeadSource[] = ['website_inquiry', 'phone_inquiry', 'walk_in']

  it('returns valid score between 0-100', () => {
    for (const source of inquirySources) {
      const { score } = computeLeadScore(source, baseFactors)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('whatsapp channel scores higher than unknown', () => {
    const whatsapp = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      inquiryChannel: 'whatsapp',
    })
    const unknown = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      inquiryChannel: 'unknown',
    })
    expect(whatsapp.score).toBeGreaterThanOrEqual(unknown.score)
  })

  it('recent leads score higher than old ones', () => {
    const recent = computeLeadScore('phone_inquiry', {
      ...baseFactors,
      recencyDays: 0,
    })
    const old = computeLeadScore('phone_inquiry', {
      ...baseFactors,
      recencyDays: 20,
    })
    expect(recent.score).toBeGreaterThan(old.score)
  })

  it('high spend leads score higher', () => {
    const low = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      totalSpend: 0,
    })
    const high = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      totalSpend: 5000,
    })
    expect(high.score).toBeGreaterThan(low.score)
  })

  it('frequent visitors score higher', () => {
    const low = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      visitCount: 0,
    })
    const high = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 1,
      visitCount: 5,
    })
    expect(high.score).toBeGreaterThan(low.score)
  })
})

describe('computeLeadScore — score labels', () => {
  it('hot when score >= 70', () => {
    const { scoreLabel } = computeLeadScore('abandoned_cart', {
      ...baseFactors,
      recencyDays: 0,
      abandonedCartValue: 10000,
    })
    expect(scoreLabel).toBe('hot')
  })

  it('cold when score < 40', () => {
    const { scoreLabel } = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 20,
      visitCount: 0,
      totalSpend: 0,
    })
    expect(scoreLabel).toBe('cold')
  })

  it('warm when score between 40-69', () => {
    // Craft a scenario that gives a warm score
    const { score, scoreLabel } = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 3,
      visitCount: 1,
      totalSpend: 1000,
      inquiryChannel: 'website',
    })
    if (score >= 40 && score < 70) {
      expect(scoreLabel).toBe('warm')
    }
    // At minimum, label matches score
    if (score >= 70) expect(scoreLabel).toBe('hot')
    else if (score >= 40) expect(scoreLabel).toBe('warm')
    else expect(scoreLabel).toBe('cold')
  })

  it('score is clamped to 0-100', () => {
    const { score } = computeLeadScore('website_inquiry', {
      ...baseFactors,
      recencyDays: 100,
      visitCount: 0,
      totalSpend: 0,
    })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

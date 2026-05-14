import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/locations', () => ({
  getBranchIdToDisplayNameMap: () => ({ '0': 'Vizag', '1': 'Kakinada' }),
}))

import {
  ALLOWED_TRANSITIONS,
  KANBAN_COLUMNS,
  DEFAULT_AUTOMATION_CONFIG,
  LEADS_PAGE_SIZE,
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
} from './lead-constants'

describe('ALLOWED_TRANSITIONS', () => {
  it('new → contacted is allowed', () => {
    expect(ALLOWED_TRANSITIONS.new).toContain('contacted')
  })

  it('new → lost is allowed', () => {
    expect(ALLOWED_TRANSITIONS.new).toContain('lost')
  })

  it('new → booked is NOT allowed (must go through contacted/interested)', () => {
    expect(ALLOWED_TRANSITIONS.new).not.toContain('booked')
  })

  it('contacted → interested is allowed', () => {
    expect(ALLOWED_TRANSITIONS.contacted).toContain('interested')
  })

  it('interested → booked is allowed', () => {
    expect(ALLOWED_TRANSITIONS.interested).toContain('booked')
  })

  it('booked → closed is the only transition', () => {
    expect(ALLOWED_TRANSITIONS.booked).toEqual(['closed'])
  })

  it('closed has no outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS.closed).toEqual([])
  })

  it('lost → new is allowed (admin reopen)', () => {
    expect(ALLOWED_TRANSITIONS.lost).toContain('new')
  })

  it('every status in KANBAN_COLUMNS has a transitions entry', () => {
    for (const status of KANBAN_COLUMNS) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(status)
    }
  })

  it('all target statuses are valid statuses', () => {
    const allStatuses = new Set(Object.keys(ALLOWED_TRANSITIONS))
    for (const [, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const target of targets) {
        expect(allStatuses).toContain(target)
      }
    }
  })
})

describe('KANBAN_COLUMNS', () => {
  it('has 6 columns', () => {
    expect(KANBAN_COLUMNS).toHaveLength(6)
  })

  it('starts with new and ends with closed', () => {
    expect(KANBAN_COLUMNS[0]).toBe('new')
    expect(KANBAN_COLUMNS[KANBAN_COLUMNS.length - 1]).toBe('closed')
  })

  it('does not include lost (separate from kanban)', () => {
    expect(KANBAN_COLUMNS).not.toContain('lost')
  })
})

describe('DEFAULT_AUTOMATION_CONFIG', () => {
  it('score weights sum to 100', () => {
    const w = DEFAULT_AUTOMATION_CONFIG.autoScoreWeights
    expect(w.recencyWeight + w.frequencyWeight + w.spendWeight + w.channelWeight).toBe(100)
  })

  it('hot threshold > warm threshold', () => {
    expect(DEFAULT_AUTOMATION_CONFIG.scoreThresholds.hotMin).toBeGreaterThan(
      DEFAULT_AUTOMATION_CONFIG.scoreThresholds.warmMin,
    )
  })

  it('warm threshold > 0', () => {
    expect(DEFAULT_AUTOMATION_CONFIG.scoreThresholds.warmMin).toBeGreaterThan(0)
  })
})

describe('LEADS_PAGE_SIZE', () => {
  it('is a reasonable number', () => {
    expect(LEADS_PAGE_SIZE).toBeGreaterThanOrEqual(20)
    expect(LEADS_PAGE_SIZE).toBeLessThanOrEqual(500)
  })
})

describe('LEAD_STATUS_LABELS', () => {
  it('has labels for all statuses', () => {
    for (const status of Object.keys(ALLOWED_TRANSITIONS)) {
      expect(LEAD_STATUS_LABELS).toHaveProperty(status)
    }
  })
})

describe('LEAD_SOURCE_LABELS', () => {
  it('has at least abandoned_cart and inquiry_website', () => {
    expect(LEAD_SOURCE_LABELS).toHaveProperty('abandoned_cart')
    expect(LEAD_SOURCE_LABELS).toHaveProperty('inquiry_website')
  })
})

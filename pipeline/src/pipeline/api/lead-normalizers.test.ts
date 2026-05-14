import { describe, it, expect, vi } from 'vitest'

vi.mock('./firestore-utils', () => ({
  nowIso: () => '2026-04-13T00:00:00.000Z',
}))

import {
  parseSuperfoneEventRecords,
  parseSuperfoneInteraktControls,
  parseSuperfoneInteraktControlsResponse,
} from './lead-normalizers'

describe('parseSuperfoneEventRecords', () => {
  it('returns empty for null/undefined', () => {
    expect(parseSuperfoneEventRecords(null)).toEqual([])
    expect(parseSuperfoneEventRecords(undefined)).toEqual([])
  })

  it('returns empty for non-array non-object', () => {
    expect(parseSuperfoneEventRecords('hello')).toEqual([])
    expect(parseSuperfoneEventRecords(42)).toEqual([])
  })

  it('parses direct array of events', () => {
    const result = parseSuperfoneEventRecords([
      {
        id: 'e1',
        event: 'call_completed',
        customerPhone: '+919876543210',
        customerName: 'Test User',
        callType: 'outbound',
        durationSec: 120,
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e1')
    expect(result[0].event).toBe('call_completed')
    expect(result[0].customerPhone).toBe('+919876543210')
    expect(result[0].durationSec).toBe(120)
  })

  it('parses events from .events property', () => {
    const result = parseSuperfoneEventRecords({
      events: [{ id: 'e2', event: 'missed_call', customerPhone: '9999999999' }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e2')
  })

  it('parses events from .data property', () => {
    const result = parseSuperfoneEventRecords({
      data: [{ id: 'e3', event: 'voicemail' }],
    })
    expect(result).toHaveLength(1)
  })

  it('generates fallback ID when missing', () => {
    const result = parseSuperfoneEventRecords([{ event: 'call' }])
    expect(result[0].id).toBe('sf-event-1')
  })

  it('defaults customerName to Unknown', () => {
    const result = parseSuperfoneEventRecords([{ id: 'x' }])
    expect(result[0].customerName).toBe('Unknown')
  })

  it('parses labelTitles from direct array', () => {
    const result = parseSuperfoneEventRecords([{ id: 'x', labelTitles: ['VIP', 'Regular'] }])
    expect(result[0].labelTitles).toEqual(['VIP', 'Regular'])
  })

  it('skips non-object items in array', () => {
    const result = parseSuperfoneEventRecords([null, 'bad', { id: 'ok' }])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ok')
  })

  it('parses durationSec from string', () => {
    const result = parseSuperfoneEventRecords([{ id: 'x', durationSec: '60' }])
    expect(result[0].durationSec).toBe(60)
  })
})

describe('parseSuperfoneInteraktControls', () => {
  it('returns all false for empty input', () => {
    const result = parseSuperfoneInteraktControls({})
    expect(result.base_enabled).toBe(false)
    expect(result.runtime_enabled).toBe(false)
    expect(result.configured).toBe(false)
    expect(result.dispatch_allowed).toBe(false)
    expect(result.template).toBeNull()
  })

  it('parses boolean fields', () => {
    const result = parseSuperfoneInteraktControls({
      controls: {
        base_enabled: true,
        runtime_enabled: 'yes',
        configured: 1,
        dispatch_allowed: false,
        template: 'booking_confirmation',
      },
    })
    expect(result.base_enabled).toBe(true)
    expect(result.runtime_enabled).toBe(true)
    expect(result.configured).toBe(true)
    expect(result.dispatch_allowed).toBe(false)
    expect(result.template).toBe('booking_confirmation')
  })

  it('handles flat object (no .controls wrapper)', () => {
    const result = parseSuperfoneInteraktControls({
      base_enabled: true,
      dispatch_allowed: true,
    })
    expect(result.base_enabled).toBe(true)
    expect(result.dispatch_allowed).toBe(true)
  })
})

describe('parseSuperfoneInteraktControlsResponse', () => {
  it('wraps controls in response shape', () => {
    const result = parseSuperfoneInteraktControlsResponse({ base_enabled: true }, 'interakt_status')
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('interakt_status')
    expect(result.controls.base_enabled).toBe(true)
    expect(result.generated_at).toBeTruthy()
  })

  it('uses toggle mode', () => {
    const result = parseSuperfoneInteraktControlsResponse({}, 'interakt_toggle')
    expect(result.mode).toBe('interakt_toggle')
  })
})

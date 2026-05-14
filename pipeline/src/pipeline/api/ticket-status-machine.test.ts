import { describe, it, expect } from 'vitest'
import { validateStatusTransition } from './ticket-status-machine'

describe('validateStatusTransition', () => {
  it('allows Open → In Progress', () => {
    expect(validateStatusTransition('Open', 'In Progress')).toEqual({ ok: true })
  })
  it('allows In Progress → Resolved', () => {
    expect(validateStatusTransition('In Progress', 'Resolved')).toEqual({ ok: true })
  })
  it('rejects same status', () => {
    expect(validateStatusTransition('Open', 'Open')).toEqual({ ok: false, reason: 'same status' })
  })
  it('rejects Closed → anything (terminal)', () => {
    expect(validateStatusTransition('Closed', 'Open').ok).toBe(false)
    expect(validateStatusTransition('Closed', 'Resolved').ok).toBe(false)
  })
  it('allows Resolved → Open via reopen within 48h', () => {
    const r = validateStatusTransition('Resolved', 'Open', {
      isReopen: true,
      resolvedAt: '2026-04-26T10:00:00Z',
      now: new Date('2026-04-27T10:00:00Z'),
    })
    expect(r).toEqual({ ok: true })
  })
  it('rejects Resolved → Open after 48h', () => {
    const r = validateStatusTransition('Resolved', 'Open', {
      isReopen: true,
      resolvedAt: '2026-04-20T10:00:00Z',
      now: new Date('2026-04-27T10:00:00Z'),
    })
    expect(r).toEqual({ ok: false, reason: 'reopen window expired (48h)' })
  })
  it('rejects Resolved → Open without reopen flag', () => {
    expect(validateStatusTransition('Resolved', 'Open').ok).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { captureAutoContext, recordLastError } from './ticket-auto-context'

describe('captureAutoContext', () => {
  it('always returns appVersion and buildSha', () => {
    const ctx = captureAutoContext()
    expect(typeof ctx.appVersion).toBe('string')
    expect(typeof ctx.buildSha).toBe('string')
  })

  it('includes lastErrorMessage when recordLastError was called', () => {
    recordLastError('boom')
    const ctx = captureAutoContext()
    expect(ctx.lastErrorMessage).toBe('boom')
    expect(typeof ctx.lastErrorAt).toBe('string')
  })
})

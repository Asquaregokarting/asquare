import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger, setLogReporter, type LogReporter } from './logger'

describe('logger', () => {
  let reporter: LogReporter
  let captured: Array<{ level: string; message: string; context?: unknown }>

  beforeEach(() => {
    captured = []
    reporter = {
      capture: (level, message, _error, context) => {
        captured.push({ level, message, context })
      },
    }
    setLogReporter(reporter)
    // Silence the console fallback so test output stays clean.
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    setLogReporter(null)
  })

  it('forwards each level to the reporter', () => {
    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')
    expect(captured.map((c) => c.level)).toEqual(['debug', 'info', 'warn', 'error'])
  })

  it('scrubs sensitive top-level keys', () => {
    logger.info('auth.attempt', {
      phone: '+919999999999',
      otp: '123456',
      orderId: 'ord_1',
    })
    expect(captured[0].context).toEqual({
      phone: '[redacted]',
      otp: '[redacted]',
      orderId: 'ord_1',
    })
  })

  it('scrubs sensitive keys nested in objects', () => {
    logger.warn('payment.weird', {
      response: {
        razorpayPaymentId: 'pay_xyz',
        razorpaySignature: 'sig_abc',
        amount: 500,
      },
    })
    expect(captured[0].context).toEqual({
      response: {
        razorpayPaymentId: '[redacted]',
        razorpaySignature: '[redacted]',
        amount: 500,
      },
    })
  })

  it('does not crash when reporter throws', () => {
    setLogReporter({
      capture: () => {
        throw new Error('reporter exploded')
      },
    })
    expect(() => logger.error('boom', new Error('e'))).not.toThrow()
  })
})

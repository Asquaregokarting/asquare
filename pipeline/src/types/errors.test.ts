import { describe, it, expect } from 'vitest'
import { ApplicationError, ValidationError, NetworkError, PaymentError, APIError } from './errors'

describe('ApplicationError', () => {
  it('sets message, code, and statusCode', () => {
    const err = new ApplicationError('Something failed', 'APP_ERR', 500)
    expect(err.message).toBe('Something failed')
    expect(err.code).toBe('APP_ERR')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('ApplicationError')
  })

  it('defaults statusCode to 500', () => {
    const err = new ApplicationError('fail', 'ERR')
    expect(err.statusCode).toBe(500)
  })

  it('supports details', () => {
    const err = new ApplicationError('fail', 'ERR', 500, { field: 'email' })
    expect(err.details?.field).toBe('email')
  })

  it('is instanceof Error', () => {
    const err = new ApplicationError('fail', 'ERR')
    expect(err instanceof Error).toBe(true)
    expect(err instanceof ApplicationError).toBe(true)
  })
})

describe('ValidationError', () => {
  it('sets code to VALIDATION_ERROR and status 400', () => {
    const err = new ValidationError('Invalid email')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.statusCode).toBe(400)
    expect(err.name).toBe('ValidationError')
  })

  it('is instanceof ApplicationError', () => {
    expect(new ValidationError('x') instanceof ApplicationError).toBe(true)
  })
})

describe('NetworkError', () => {
  it('has default message', () => {
    const err = new NetworkError()
    expect(err.message).toBe('Network connection failed')
    expect(err.code).toBe('NETWORK_ERROR')
    expect(err.statusCode).toBe(503)
  })

  it('accepts custom message', () => {
    const err = new NetworkError('Timeout after 30s')
    expect(err.message).toBe('Timeout after 30s')
  })
})

describe('PaymentError', () => {
  it('sets code to PAYMENT_ERROR and status 402', () => {
    const err = new PaymentError('Insufficient funds')
    expect(err.code).toBe('PAYMENT_ERROR')
    expect(err.statusCode).toBe(402)
  })
})

describe('APIError', () => {
  it('accepts custom error code', () => {
    const err = new APIError('Order creation failed', 'RAZORPAY_ORDER_FAILED')
    expect(err.code).toBe('RAZORPAY_ORDER_FAILED')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('APIError')
  })

  it('supports details', () => {
    const err = new APIError('fail', 'ERR', { orderId: 'xyz' })
    expect(err.details?.orderId).toBe('xyz')
  })
})

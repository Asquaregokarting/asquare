import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./bookingService', () => ({
  bookingService: { triggerPaymentFailedNotification: vi.fn(() => Promise.resolve()) },
}))
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../types/errors', () => ({
  PaymentError: class PaymentError extends Error {
    constructor(
      message: string,
      public details?: Record<string, unknown>,
    ) {
      super(message)
      this.name = 'PaymentError'
    }
  },
}))

const BASE_OPTIONS = {
  amount: 50000,
  razorpay_order_id: 'order_test_456',
  name: 'Test User',
  email: 'test@test.com',
  phone: '9876543210',
}

describe('razorpayService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('isLoaded returns false when Razorpay not on window', async () => {
    delete (window as Record<string, unknown>).Razorpay
    const { razorpayService } = await import('./razorpayService')
    expect(razorpayService.isLoaded()).toBe(false)
  })

  it('isLoaded returns true when Razorpay is on window', async () => {
    ;(window as Record<string, unknown>).Razorpay = vi.fn()
    const { razorpayService } = await import('./razorpayService')
    expect(razorpayService.isLoaded()).toBe(true)
  })

  it('initiatePayment resolves on successful payment', async () => {
    const mockResponse = {
      razorpay_payment_id: 'pay_test_123',
      razorpay_order_id: 'order_test_456',
      razorpay_signature: 'sig_test_789',
    }
    ;(window as Record<string, unknown>).Razorpay = vi
      .fn()
      .mockImplementation((options: Record<string, unknown>) => ({
        open: () => {
          ;(options.handler as (r: typeof mockResponse) => void)(mockResponse)
        },
        on: vi.fn(),
      }))
    const { razorpayService } = await import('./razorpayService')
    const result = await razorpayService.initiatePayment(BASE_OPTIONS)
    expect(result.razorpay_payment_id).toBe('pay_test_123')
  })

  it('initiatePayment rejects on user cancellation', async () => {
    ;(window as Record<string, unknown>).Razorpay = vi
      .fn()
      .mockImplementation((options: Record<string, unknown>) => ({
        open: () => {
          ;(options.modal as { ondismiss: () => void }).ondismiss()
        },
        on: vi.fn(),
      }))
    const { razorpayService } = await import('./razorpayService')
    await expect(razorpayService.initiatePayment(BASE_OPTIONS)).rejects.toThrow(
      'Payment cancelled by user',
    )
  })

  it('initiatePayment rejects on payment failure', async () => {
    ;(window as Record<string, unknown>).Razorpay = vi.fn().mockImplementation(() => {
      let failHandler: ((r: Record<string, unknown>) => void) | undefined
      return {
        open: () => {
          // Simulate payment failure after open
          setTimeout(() => {
            failHandler?.({
              error: { description: 'Insufficient funds', code: 'BAD_REQUEST_ERROR' },
            })
          }, 0)
        },
        on: vi
          .fn()
          .mockImplementation((event: string, handler: (r: Record<string, unknown>) => void) => {
            if (event === 'payment.failed') failHandler = handler
          }),
      }
    })
    const { razorpayService } = await import('./razorpayService')
    await expect(
      razorpayService.initiatePayment({ ...BASE_OPTIONS, orderNumber: 'ASG123' }),
    ).rejects.toThrow('Insufficient funds')
  })

  it('rejects when Razorpay SDK not on window', async () => {
    delete (window as Record<string, unknown>).Razorpay
    const { razorpayService } = await import('./razorpayService')
    // loadRazorpaySDK will try to create a script tag — mock it to resolve but leave window.Razorpay undefined
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'script') {
        setTimeout(() => el.dispatchEvent(new Event('load')), 0)
      }
      return el
    })
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => null as unknown as HTMLElement)

    await expect(razorpayService.initiatePayment(BASE_OPTIONS)).rejects.toThrow(
      /Razorpay SDK not loaded/,
    )
  })
})

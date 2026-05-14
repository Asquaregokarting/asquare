import { describe, it, expect, vi, beforeEach } from 'vitest'

const assertCustomerUnderRateLimitMock = vi.fn()

vi.mock('../pipeline/api/ticket-rate-limit', () => ({
  assertCustomerUnderRateLimit: (...args: unknown[]) => assertCustomerUnderRateLimitMock(...args),
  CUSTOMER_RATE_LIMIT_PER_24H: 5,
  CustomerRateLimitError: class CustomerRateLimitError extends Error {
    constructor(public count: number) {
      super(`rate limit reached (${count}/5 in last 24h)`)
      this.name = 'CustomerRateLimitError'
    }
  },
}))

// Imported after the mock so the service picks up the stubbed helper.
import { ticketCustomerService } from './ticketCustomerService'

describe('ticketCustomerService.createTicket validation', () => {
  beforeEach(() => {
    assertCustomerUnderRateLimitMock.mockReset()
    assertCustomerUnderRateLimitMock.mockResolvedValue(undefined)
  })

  it('rejects empty title', async () => {
    await expect(
      ticketCustomerService.createTicket({
        userId: 'u',
        userName: 'U',
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        categoryId: 'other',
        title: '   ',
        description: 'long enough description',
      }),
    ).rejects.toThrow(/title/)
  })

  it('rejects too-short description', async () => {
    await expect(
      ticketCustomerService.createTicket({
        userId: 'u',
        userName: 'U',
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        categoryId: 'other',
        title: 'OK',
        description: 'too short',
      }),
    ).rejects.toThrow(/10 chars/)
  })

  it('bubbles a rate-limit error before validation runs', async () => {
    assertCustomerUnderRateLimitMock.mockRejectedValueOnce(
      Object.assign(new Error('rate limit reached (5/5 in last 24h)'), {
        name: 'CustomerRateLimitError',
      }),
    )
    await expect(
      ticketCustomerService.createTicket({
        userId: 'u',
        userName: 'U',
        branchId: 'vizag',
        branchDisplayName: 'Vizag',
        categoryId: 'other',
        title: 'OK',
        description: 'long enough description',
      }),
    ).rejects.toThrow(/rate limit/)
    expect(assertCustomerUnderRateLimitMock).toHaveBeenCalledWith('u')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callApi } from './apiProxy'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('callApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends POST request with transac param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'yes' }),
    })
    const result = await callApi('get_tables')
    expect(result).toEqual({ status: 'yes' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('proxyApiCall'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.transac).toBe('get_tables')
  })

  it('includes extra params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })
    await callApi('submit_order', { branch_id: '0', mobile: '9876543210' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.branch_id).toBe('0')
    expect(body.mobile).toBe('9876543210')
    expect(body.transac).toBe('submit_order')
  })

  it('supports POST method with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'order-1' }),
    })
    await callApi('create', {}, { method: 'POST', body: { items: [1, 2] } })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe('POST')
    expect(body.body).toEqual({ items: [1, 2] })
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(callApi('bad_request')).rejects.toThrow('Proxy HTTP 500')
  })

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(callApi('offline_test')).rejects.toThrow('Failed to fetch')
  })
})

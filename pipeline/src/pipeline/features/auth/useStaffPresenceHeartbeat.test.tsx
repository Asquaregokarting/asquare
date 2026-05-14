import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStaffPresenceHeartbeat } from './useStaffPresenceHeartbeat'
import { staffPresenceApi } from '../../api/staff-presence'

vi.mock('../../api/staff-presence', () => ({
  staffPresenceApi: {
    start: vi.fn(),
    heartbeat: vi.fn(),
    close: vi.fn(),
  },
}))

describe('useStaffPresenceHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(staffPresenceApi.start).mockResolvedValue('2026-04-24T18:00:00Z')
    vi.mocked(staffPresenceApi.heartbeat).mockResolvedValue(undefined)
    vi.mocked(staffPresenceApi.close).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does nothing when user is null', () => {
    renderHook(() => useStaffPresenceHeartbeat({ user: null, sessionId: null }))
    expect(staffPresenceApi.start).not.toHaveBeenCalled()
  })

  it('does nothing for non-monitored roles', () => {
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u1', name: 'Owner', role: 'Owner', branchId: '0' },
        sessionId: 'ds-1',
      }),
    )
    expect(staffPresenceApi.start).not.toHaveBeenCalled()
  })

  it('starts presence and heartbeats every 60s for monitored role', async () => {
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u2', name: 'Cash', role: 'Cashier', branchId: '1' },
        sessionId: 'ds-2',
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(staffPresenceApi.start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(2)
  })

  // N4 — unmount clears the timer: no further heartbeats after unmount.
  it('stops heartbeats after unmount', async () => {
    const { unmount } = renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u3', name: 'TM', role: 'TrackMarshall', branchId: '0' },
        sessionId: 'ds-3',
      }),
    )
    await vi.advanceTimersByTimeAsync(0) // let start fire
    unmount()
    await vi.advanceTimersByTimeAsync(120_000) // advance well past one interval
    // heartbeat should never have been called (unmounted before first tick)
    expect(staffPresenceApi.heartbeat).not.toHaveBeenCalled()
  })

  // N4 — visibilitychange → 'visible' fires an immediate heartbeat.
  it('fires immediate heartbeat on visibilitychange to visible', async () => {
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u4', name: 'TC', role: 'Telecaller', branchId: '2' },
        sessionId: 'ds-4',
      }),
    )
    await vi.advanceTimersByTimeAsync(0)

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(1)
  })

  // Missing-1 — backoff: after a failure the interval should double (up to 300s).
  it('backs off exponentially on heartbeat failures', async () => {
    vi.mocked(staffPresenceApi.heartbeat).mockRejectedValueOnce(new Error('network'))
    renderHook(() =>
      useStaffPresenceHeartbeat({
        user: { id: 'u5', name: 'Cash2', role: 'Cashier', branchId: '1' },
        sessionId: 'ds-5',
      }),
    )
    await vi.advanceTimersByTimeAsync(0) // start fires
    // First tick at 60s — fails
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(1)
    // Next tick should be at 120s (60s × 2^1), not 60s
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(1) // still 1 — not fired yet
    await vi.advanceTimersByTimeAsync(60_000)
    expect(staffPresenceApi.heartbeat).toHaveBeenCalledTimes(2) // fired at 120s mark
  })
})

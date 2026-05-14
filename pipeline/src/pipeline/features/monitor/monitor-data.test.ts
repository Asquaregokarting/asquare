import { describe, it, expect } from 'vitest'
import { mergeMonitorRoster } from './monitor-data'
import type { ShiftRecord } from '../../api/shifts'
import type { StaffPresenceRecord, UserRecord } from '../../api/types'

const NOW_MS = new Date('2026-04-25T12:00:00Z').getTime()

const mkUser = (
  overrides: Partial<UserRecord> & { id: string; role: UserRecord['role'] },
): UserRecord => ({
  name: 'Test User',
  email: 'test@example.com',
  isActive: true,
  ...overrides,
})

const mkShift = (
  overrides: Partial<ShiftRecord> & {
    userId: string
    role: ShiftRecord['role']
    locationId: string
  },
): ShiftRecord => ({
  id: `shift-${overrides.userId}`,
  shiftDate: '2026-04-25',
  locationName: 'Vizag',
  startTime: '2026-04-25T09:00:00Z',
  breaks: [],
  ...overrides,
})

const mkPresence = (
  overrides: Partial<StaffPresenceRecord> & {
    userId: string
    role: StaffPresenceRecord['role']
    branchId: string
  },
): StaffPresenceRecord => ({
  userName: 'Live User',
  sessionId: 'sess-1',
  loginAt: '2026-04-25T11:00:00Z',
  lastSeenAt: '2026-04-25T11:59:00Z', // 1 min ago — online
  explicitLogoutAt: null,
  ...overrides,
})

describe('mergeMonitorRoster', () => {
  it('marks Cashier with active shift but no presence as active + never', () => {
    const result = mergeMonitorRoster({
      todayShifts: [mkShift({ userId: 'u1', role: 'Cashier', locationId: '0' })],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Cashier', name: 'Asha' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    const rows = result.byBranch.get('0') ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      userName: 'Asha',
      role: 'Cashier',
      shiftStatus: 'active',
      webStatus: 'never',
    })
    expect(result.activeCountByBranch.get('0')).toBe(1)
    expect(result.onlineCountByBranch.get('0')).toBe(0)
  })

  it('marks Cashier without a shift as not_started', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Cashier', name: 'Asha' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    const rows = result.byBranch.get('0') ?? []
    expect(rows).toHaveLength(0)
  })

  it('hides Cashier without a shift even if allowedLocations[0] is set', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [],
      monitoredUsers: [
        mkUser({ id: 'u1', role: 'Cashier', name: 'Asha', allowedLocations: ['0'] }),
      ],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0') ?? []).toHaveLength(0)
  })

  it('hides Telecaller with no presence (no_shift_required + never)', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [],
      monitoredUsers: [
        mkUser({ id: 'u2', role: 'Telecaller', name: 'Ravi', allowedLocations: ['0'] }),
      ],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0') ?? []).toHaveLength(0)
  })

  it('marks Telecaller as no_shift_required + uses presence-only branch', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [mkPresence({ userId: 'u2', role: 'Telecaller', branchId: '1' })],
      monitoredUsers: [mkUser({ id: 'u2', role: 'Telecaller', name: 'Ravi' })],
      allowedBranchIds: ['0', '1'],
      nowMs: NOW_MS,
    })
    const rows = result.byBranch.get('1') ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 'u2',
      role: 'Telecaller',
      shiftStatus: 'no_shift_required',
      webStatus: 'online',
      branchId: '1',
    })
    expect(result.onlineCountByBranch.get('1')).toBe(1)
  })

  it('flags an open break as on_break', () => {
    const result = mergeMonitorRoster({
      todayShifts: [
        mkShift({
          userId: 'u1',
          role: 'TrackMarshall',
          locationId: '0',
          breaks: [{ breakStart: '2026-04-25T10:00:00Z' }], // no breakEnd
        }),
      ],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'TrackMarshall', name: 'Vikram' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0')![0].shiftStatus).toBe('on_break')
    expect(result.activeCountByBranch.get('0')).toBe(1)
  })

  it('flags ended shift as completed', () => {
    const result = mergeMonitorRoster({
      todayShifts: [
        mkShift({
          userId: 'u1',
          role: 'Cashier',
          locationId: '0',
          endTime: '2026-04-25T18:00:00Z',
        }),
      ],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Cashier', name: 'Asha' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0')![0].shiftStatus).toBe('completed')
    expect(result.activeCountByBranch.get('0')).toBe(0)
  })

  it('drops users whose branch is not in allowedBranchIds', () => {
    const result = mergeMonitorRoster({
      todayShifts: [mkShift({ userId: 'u1', role: 'Cashier', locationId: '7' })],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Cashier' })],
      allowedBranchIds: ['0', '1'],
      nowMs: NOW_MS,
    })
    expect([...result.byBranch.values()].flat()).toHaveLength(0)
  })

  it('drops non-monitored roles even if they have a shift row', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Owner', name: 'Owner Person' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect([...result.byBranch.values()].flat()).toHaveLength(0)
  })

  it('sorts active shifts before completed (and hides not_started)', () => {
    const result = mergeMonitorRoster({
      todayShifts: [
        mkShift({
          userId: 'completed-user',
          role: 'Cashier',
          locationId: '0',
          endTime: '2026-04-25T18:00:00Z',
        }),
        mkShift({ userId: 'active-user', role: 'Cashier', locationId: '0' }),
      ],
      presenceRecords: [],
      monitoredUsers: [
        mkUser({ id: 'active-user', role: 'Cashier', name: 'Active Asha' }),
        mkUser({ id: 'completed-user', role: 'Cashier', name: 'Completed Carla' }),
        mkUser({
          id: 'notstarted-user',
          role: 'Cashier',
          name: 'Notstarted Niki',
          allowedLocations: ['0'],
        }),
      ],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    const rows = result.byBranch.get('0') ?? []
    expect(rows.map((r) => r.shiftStatus)).toEqual(['active', 'completed'])
  })

  it('uses the most recent shift when multiple exist for one user', () => {
    const result = mergeMonitorRoster({
      todayShifts: [
        mkShift({
          userId: 'u1',
          role: 'Cashier',
          locationId: '0',
          startTime: '2026-04-25T08:00:00Z',
          endTime: '2026-04-25T12:00:00Z',
        }),
        mkShift({
          userId: 'u1',
          role: 'Cashier',
          locationId: '0',
          startTime: '2026-04-25T13:00:00Z',
        }),
      ],
      presenceRecords: [],
      monitoredUsers: [mkUser({ id: 'u1', role: 'Cashier', name: 'Asha' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0')![0].shiftStatus).toBe('active')
    expect(result.byBranch.get('0')![0].shiftStartTime).toBe('2026-04-25T13:00:00Z')
  })

  it('downgrades stale presence to offline (>5m)', () => {
    const result = mergeMonitorRoster({
      todayShifts: [],
      presenceRecords: [
        mkPresence({
          userId: 'u2',
          role: 'Telecaller',
          branchId: '0',
          lastSeenAt: '2026-04-25T11:50:00Z', // 10 min ago — offline
        }),
      ],
      monitoredUsers: [mkUser({ id: 'u2', role: 'Telecaller', name: 'Ravi' })],
      allowedBranchIds: ['0'],
      nowMs: NOW_MS,
    })
    expect(result.byBranch.get('0')![0].webStatus).toBe('offline')
  })
})

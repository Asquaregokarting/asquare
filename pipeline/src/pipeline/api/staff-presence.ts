import { MonitoredRole, StaffPresenceRecord, StaffSessionLogRecord } from './types'
import {
  buildHistoryQueryConstraints,
  closeSession,
  derivePresenceStatus,
  heartbeatPresence,
  listPresence,
  queryHistory,
  startPresence,
  type HistoryQueryInput,
  type PresenceStatus,
  type StartPresenceInput,
} from './staff-presence-firestore'

export type { HistoryQueryInput, MonitoredRole, PresenceStatus, StartPresenceInput }

export const staffPresenceApi = {
  start(input: StartPresenceInput) {
    return startPresence(input)
  },
  heartbeat(userId: string) {
    return heartbeatPresence(userId)
  },
  close(userId: string, endReason: 'explicit_signout' | 'timeout' | 'new_session_replaced') {
    return closeSession(userId, endReason)
  },
  listLive(branchId?: string): Promise<StaffPresenceRecord[]> {
    return listPresence(branchId)
  },
  queryHistory(input: HistoryQueryInput): Promise<StaffSessionLogRecord[]> {
    return queryHistory(input)
  },
  deriveStatus: derivePresenceStatus,
  buildHistoryConstraints: buildHistoryQueryConstraints,
}

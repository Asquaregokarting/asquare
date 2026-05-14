import type { BookingScope } from './billing-firestore'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { CallHistoryRecord, Role, StaffInsightRecord, UserRecord } from './types'
import {
  buildFirestoreCallHistory,
  buildFirestoreGameRevenueReport,
  buildFirestoreOperationsReport,
  buildFirestoreRevenueReport,
  buildFirestoreShiftSummaryReport,
  buildFirestoreStaffInsights,
} from './reports-firestore'

/** Roles that are considered part of the ops/technical team with company-wide visibility. */
const FINANCIAL_ROLES_UNRESTRICTED: Role[] = [
  'Owner',
  'Admin',
  'Developer',
  'Backend',
  // Accountant is the financial books owner — operations / revenue /
  // shift-summary / GST reports are core to their job. Adding here
  // lets `reportsApi.operations`, `reportsApi.revenue`, etc. all
  // accept Accountant calls instead of returning the 403 wall.
  'Accountant',
]

const canRunFinancialReport = (role: Role): boolean =>
  isPrivilegedRole(role) || FINANCIAL_ROLES_UNRESTRICTED.includes(role)

/** Build a BookingScope describing what the authenticated user is allowed to read. */
const scopeForUser = (user: UserRecord): BookingScope => {
  if (user.role === 'ThirdParty') {
    return { role: user.role, vendorId: user.id }
  }
  // For location-restricted roles, the first (usually only) allowedLocation is
  // the effective branch. Privileged roles keep branchId undefined — the
  // listAllBookings helper treats them as unrestricted.
  const first =
    Array.isArray(user.allowedLocations) && user.allowedLocations.length === 1
      ? user.allowedLocations[0]
      : undefined
  return { role: user.role, branchId: first }
}

export const reportsApi = {
  async operations(token: string): Promise<{ report: Record<string, unknown> }> {
    const user = await getFirestoreSessionUser(token)
    if (!canRunFinancialReport(user.role)) {
      throw new Error('Forbidden: operations report is restricted to Owner/Admin.')
    }
    const report = await buildFirestoreOperationsReport(token, scopeForUser(user))
    return { report: report as unknown as Record<string, unknown> }
  },
  async revenue(
    token: string,
    query?: { from?: string; to?: string },
  ): Promise<{ report: Record<string, unknown> }> {
    const user = await getFirestoreSessionUser(token)
    if (!canRunFinancialReport(user.role)) {
      throw new Error('Forbidden: revenue report is restricted to Owner/Admin.')
    }
    const report = await buildFirestoreRevenueReport(query, scopeForUser(user))
    return { report: report as unknown as Record<string, unknown> }
  },
  shifts(
    token: string,
    query?: { from?: string; to?: string },
  ): Promise<{ report: Record<string, unknown> }> {
    return buildFirestoreShiftSummaryReport(token, query).then((report) => ({
      report: report as unknown as Record<string, unknown>,
    }))
  },
  callHistory(
    _token: string,
    query?: {
      from?: string
      to?: string
      type?: 'Incoming' | 'Outgoing' | 'Missed'
      staffId?: string
      q?: string
      limit?: number
      cursor?: string
    },
  ): Promise<{ records: CallHistoryRecord[]; nextCursor?: string }> {
    return buildFirestoreCallHistory(query)
  },
  insights(
    _token: string,
    query?: { from?: string; to?: string; staffId?: string },
  ): Promise<{
    summary: {
      outgoingCalls: number
      incomingCalls: number
      connectedCalls: number
      missedCalls: number
      totalDurationSeconds: number
      uniqueCustomers: number
      noAnswerCalls: number
    }
    staffInsights: StaffInsightRecord[]
  }> {
    return buildFirestoreStaffInsights(query)
  },
  async gameRevenue(
    token: string,
    query?: { from?: string; to?: string },
  ): Promise<{ report: Record<string, unknown> }> {
    const user = await getFirestoreSessionUser(token)
    if (!canRunFinancialReport(user.role)) {
      throw new Error('Forbidden: game revenue report is restricted to Owner/Admin.')
    }
    const report = await buildFirestoreGameRevenueReport(query, scopeForUser(user))
    return { report: report as unknown as Record<string, unknown> }
  },
}

import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, TrendingUp } from 'lucide-react'
import DashboardRefreshControl from './DashboardRefreshControl'
import { fmtDateIST, fmtTimeShortIST } from '../../../lib/date-format'
import { getEnabledLocations } from '../../../lib/locations'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  DashboardWidgetState,
  ModuleTab,
  Role,
  ReprintApprovalRecord,
  KartReportBypassRequest,
} from '../../api/types'
import { AppShell } from '../../components/layout/AppShell'
import { ActionCard } from '../../components/ui/ActionCard'
import { EmptyState } from '../../components/ui/EmptyState'
import { KpiCard } from '../../components/ui/KpiCard'
import { Skeleton } from '../../components/ui/Skeleton'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useAuth } from '../../features/auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { BranchGameRevenueBreakdown } from '../../api/types'
import { logger } from '../../../lib/logger'
import {
  DashboardFeedItem,
  DashboardSnapshot,
  LocationCheckout,
  StaffShiftEntry,
  loadDashboardData,
} from '../../features/dashboard/dashboard-data'
import { aggregateDayReport } from '../../features/billing/checkout-day-report'
import { printDayReport } from '../../features/billing/generateDayReport'
import { todayIST } from '../../lib/ist-date'
import { getRoleConfig, rolePathMap } from '../../features/dashboard/role-config'
import {
  getRoleMobileShortcuts,
  isPathAllowedForRole,
  resolveRoleActionRoute,
} from '../../features/navigation/action-route-map'
import { getTabForPath, getTabsForRole } from '../../features/navigation/module-manifest'
import { useTheme } from '../../features/theme/theme-context'
import {
  asquareBookingsApi,
  subscribeRecentProtocolBookings,
  subscribeRecentOfferBookings,
  type AsquareBooking,
} from '../../api/asquare-bookings'
import {
  approveReprint,
  rejectReprint,
  subscribePendingReprintApprovals,
  subscribeRecentReprintApprovals,
} from '../../api/reprint-approvals'
import {
  approveKartReportBypass,
  rejectKartReportBypass,
  subscribePendingKartReportBypasses,
} from '../../api/kart-report-bypass'
import { isFeatureNew } from '../../lib/feature-highlights'
import { formatActivityLabel } from '../../../lib/format-activity'
import { NewBadge } from '../../components/ui/NewBadge'
import { subscribeRecentVendorRegistrations } from '../../api/vendor-registration-firestore'
import {
  subscribeRecentLeaveRequests,
  subscribeRecentOvertimeRequests,
} from '../../api/shift-workforce-firestore'
import { subscribeRecentRefunds } from '../../api/billing-firestore'
import { subscribeRecentTickets } from '../../api/tickets'
import type { VendorRegistrationRecord, TransactionRecord, Ticket } from '../../api/types'
import type { LeaveRequestRecord, OvertimeRequestRecord } from '../../api/shift-workforce'
import { useTransactionCounts } from '../../features/track/scanner/hooks/useTransactionCounts'
import { getLocationDisplayName } from '../../../lib/locations'
import KartfluencerBanner from '../../components/banners/KartfluencerBanner'
import FutureBookingsStrip from './FutureBookingsStrip'
import FutureBookingsSlideOver from './FutureBookingsSlideOver'
import RecentBookingsTable from './RecentBookingsTable'
import CountUp from '../../components/ui/CountUp'

const toneStyle = (tone: DashboardFeedItem['tone']): DashboardFeedItem['tone'] => tone

/** Format ISO → { date: "02 Apr 2026", time: "07:31 PM" } in IST */
const fmtDateTimeParts = (iso: string): { date: string; time: string } => {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return { date: '-', time: '-' }
    const date = d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
    const time = d
      .toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      })
      .toUpperCase()
    return { date, time }
  } catch {
    return { date: '-', time: '-' }
  }
}

// ── Activity Stream Types & Hook ─────────────────────────────────────────────

type ActivityCategory =
  | 'reprint'
  | 'protocol'
  | 'offer'
  | 'vendor'
  | 'leave'
  | 'overtime'
  | 'refund'
  | 'ticket'

interface ActivityStreamItem extends DashboardFeedItem {
  category: ActivityCategory
  timestamp: string
}

const CATEGORY_LABELS: Record<ActivityCategory, { label: string; className: string }> = {
  reprint: {
    label: 'Reprint',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  },
  protocol: {
    label: 'Protocol',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  offer: {
    label: 'Offer',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  vendor: {
    label: 'Vendor',
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  },
  leave: {
    label: 'Leave',
    className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  },
  overtime: {
    label: 'Overtime',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  refund: {
    label: 'Refund',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  },
  ticket: {
    label: 'Ticket',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
}

const shiftChipStyles: Record<string, { dot: string; bg: string; text: string }> = {
  active: {
    dot: 'bg-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/25',
    text: 'text-emerald-300',
  },
  completed: { dot: 'bg-blue-400', bg: 'bg-blue-500/10 border-blue-500/25', text: 'text-blue-300' },
  notStarted: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/25',
    text: 'text-amber-300',
  },
}

const ShiftStaffChip = ({
  staff,
  tone,
}: {
  staff: StaffShiftEntry
  tone: DashboardFeedItem['tone']
}) => {
  const style =
    staff.status === 'active'
      ? shiftChipStyles.active
      : staff.status === 'completed'
        ? shiftChipStyles.completed
        : tone === 'warning'
          ? shiftChipStyles.notStarted
          : shiftChipStyles.active

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      <span>{staff.name}</span>
      {staff.location && <span className="opacity-60">· {staff.location}</span>}
    </span>
  )
}

const ROLE_GROUP_VISIBLE_COUNT = 6

const StaffRoleGroup = ({
  role,
  members,
  tone,
  expanded,
  onToggle,
}: {
  role: string
  members: StaffShiftEntry[]
  tone: DashboardFeedItem['tone']
  expanded: boolean
  onToggle: () => void
}) => {
  const needsToggle = members.length > ROLE_GROUP_VISIBLE_COUNT
  const visibleMembers = members.slice(0, ROLE_GROUP_VISIBLE_COUNT)
  const hiddenCount = members.length - ROLE_GROUP_VISIBLE_COUNT

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">{role}</p>
      <div className="flex flex-wrap gap-1.5">
        {visibleMembers.map((staff, idx) => (
          <ShiftStaffChip key={idx} staff={staff} tone={tone} />
        ))}
        <AnimatePresence>
          {needsToggle &&
            expanded &&
            members.slice(ROLE_GROUP_VISIBLE_COUNT).map((staff, idx) => (
              <motion.span
                key={`overflow-${idx}`}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2, ease: 'easeOut', delay: idx * 0.03 }}
              >
                <ShiftStaffChip staff={staff} tone={tone} />
              </motion.span>
            ))}
        </AnimatePresence>
      </div>
      {needsToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-border/40 bg-surface/50 px-2.5 py-1 text-[11px] font-medium text-muted transition hover:bg-surface hover:text-text"
        >
          {expanded ? (
            <>
              Show Less <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              Show More ({hiddenCount} more) <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

const statusTone = (status: string): DashboardFeedItem['tone'] => {
  const s = status.toLowerCase()
  if (s === 'approved' || s === 'completed') return 'success'
  if (s === 'rejected' || s === 'full') return 'critical'
  if (s === 'pending' || s === 'pending_approval' || s === 'partial') return 'warning'
  return 'info'
}

/**
 * Adapter: turns a `subscribe(onData, onError) => unsubscribe` function
 * into a one-shot promise that resolves with the first payload and then
 * tears down the listener. We use this to reuse the existing
 * subscribeRecent* helpers without duplicating their Firestore query logic.
 * The short-lived listener keeps us on the same rules path as the old
 * real-time subscriptions while letting React Query do the polling.
 */
function subscribeOnce<T>(
  subscribeFn: (onData: (rows: T[]) => void, onError: (err: Error) => void) => () => void,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsub: (() => void) | null = null
    // Safety net: a stuck subscription should reject so React Query retries.
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        unsub?.()
      } catch {
        /* ignore */
      }
      reject(new Error('subscribeOnce timed out'))
    }, 15_000)

    unsub = subscribeFn(
      (rows) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        try {
          unsub?.()
        } catch {
          /* ignore */
        }
        resolve(rows)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        try {
          unsub?.()
        } catch {
          /* ignore */
        }
        reject(err)
      },
    )
  })
}

/**
 * Single React Query that fans out to all 7 activity sources in parallel,
 * polls on a 90-second interval, and returns a merged+sorted feed.
 *
 * PREVIOUSLY: this hook opened 7 persistent `onSnapshot` subscriptions per
 * Owner/Admin dashboard mount, each watching a separate collection. With
 * many open tabs or frequent dashboard navigations this compounded into
 * sustained listener churn on Firestore.
 *
 * NOW: one queryKey, one polling timer, deduped by React Query across any
 * number of mounted consumers. Each poll over-reads exactly once (7 parallel
 * getDocs-equivalents via subscribeOnce) — a huge net reduction vs the
 * continuous listener stream.
 */
const useActivityStream = (role: Role): { items: ActivityStreamItem[]; loading: boolean } => {
  const isOwnerOrAdmin = role === 'Owner' || role === 'Admin'
  const isStreamEnabled = isOwnerOrAdmin || role === 'Developer'

  const query = useQuery<ActivityStreamItem[]>({
    queryKey: ['role-dashboard', 'activity-stream'],
    enabled: isStreamEnabled,
    // 90s polling window. These feeds are not real-time-critical (leave
    // requests, refunds, vendor registrations) and admins typically stay on
    // the dashboard for brief checks.
    refetchInterval: 90_000,
    // Refetch on window focus so an admin returning from another tab sees
    // current data without waiting for the next poll.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    queryFn: async () => {
      const [
        reprintRows,
        protocolRows,
        offerRows,
        vendorRows,
        leaveRows,
        overtimeRows,
        refundRows,
        ticketRows,
      ] = await Promise.all([
        subscribeOnce<ReprintApprovalRecord>((onData, onErr) =>
          subscribeRecentReprintApprovals(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.reprints_fetch_failed', err)
          return [] as ReprintApprovalRecord[]
        }),
        subscribeOnce<AsquareBooking>((onData, onErr) =>
          subscribeRecentProtocolBookings(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.protocols_fetch_failed', err)
          return [] as AsquareBooking[]
        }),
        subscribeOnce<AsquareBooking>((onData, onErr) =>
          subscribeRecentOfferBookings(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.offers_fetch_failed', err)
          return [] as AsquareBooking[]
        }),
        subscribeOnce<VendorRegistrationRecord>((onData, onErr) =>
          subscribeRecentVendorRegistrations(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.vendors_fetch_failed', err)
          return [] as VendorRegistrationRecord[]
        }),
        subscribeOnce<LeaveRequestRecord>((onData, onErr) =>
          subscribeRecentLeaveRequests(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.leaves_fetch_failed', err)
          return [] as LeaveRequestRecord[]
        }),
        subscribeOnce<OvertimeRequestRecord>((onData, onErr) =>
          subscribeRecentOvertimeRequests(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.overtimes_fetch_failed', err)
          return [] as OvertimeRequestRecord[]
        }),
        subscribeOnce<TransactionRecord>((onData, onErr) =>
          subscribeRecentRefunds(onData, onErr),
        ).catch((err) => {
          logger.error('role_dashboard.refunds_fetch_failed', err)
          return [] as TransactionRecord[]
        }),
        subscribeOnce<Ticket>((onData, onErr) => subscribeRecentTickets(onData, onErr)).catch(
          (err) => {
            logger.error('role_dashboard.tickets_fetch_failed', err)
            return [] as Ticket[]
          },
        ),
      ])

      const reprints: ActivityStreamItem[] = reprintRows.map((r) => ({
        id: `reprint-${r.id}`,
        title: `Reprint Request — ${r.invoiceNumber}`,
        detail: `By ${r.requestedByName} (${r.requestedByRole}) · ${r.customerName ?? '—'}`,
        tone: statusTone(r.status),
        category: 'reprint' as ActivityCategory,
        timestamp: r.requestedAt,
      }))

      const protocols: ActivityStreamItem[] = protocolRows.map((b) => {
        const raw = b as unknown as Record<string, unknown>
        const protocolStatus = String(raw.protocolStatus ?? 'pending_approval')
        // Build item summary from billingItems (POS) or items (app bookings)
        const bi = raw.billingItems as Array<{ itemName?: string; quantity?: number }> | undefined
        const displayItems = bi && bi.length > 0 ? bi : b.items || []
        const itemSummary =
          displayItems.length > 0
            ? displayItems
                .map((item: unknown) => {
                  const row = item as {
                    itemName?: string
                    quantity?: number
                    activity?: { name?: string; category?: string }
                  }
                  const label =
                    row.itemName ||
                    (row.activity?.name
                      ? formatActivityLabel(row.activity as { name: string; category?: string })
                      : 'Activity')
                  return `${label} ×${row.quantity || 1}`
                })
                .join(', ')
            : 'No items'
        return {
          id: `protocol-${b.id}`,
          title: `Protocol — ${itemSummary}`,
          detail: `By ${String(raw.protocolRequestedBy ?? raw.createdByAdminName ?? '—')} · ${String(raw.userDisplayName ?? '—')}`,
          tone: statusTone(protocolStatus),
          category: 'protocol' as ActivityCategory,
          timestamp: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
        }
      })

      const offers: ActivityStreamItem[] = offerRows.map((b) => {
        const raw = b as unknown as Record<string, unknown>
        const offerStatus = String(raw.offerStatus ?? 'pending_approval')
        return {
          id: `offer-${b.id}`,
          title: `Offer Entry — ${b.id}`,
          detail: `By ${String(raw.offerRequestedBy ?? raw.createdByAdminName ?? '—')} · ${String(raw.userDisplayName ?? '—')} · ₹${Math.round(Number(raw.totalAmount ?? 0)).toLocaleString('en-IN')}`,
          tone: statusTone(offerStatus),
          category: 'offer' as ActivityCategory,
          timestamp: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
        }
      })

      const vendors: ActivityStreamItem[] = vendorRows.map((v) => ({
        id: `vendor-${v.id}`,
        title: `Vendor Registration — ${v.vendorName}`,
        detail: `${v.companyName} · ${v.status}`,
        tone: statusTone(v.status),
        category: 'vendor' as ActivityCategory,
        timestamp: v.submittedAt,
      }))

      const leaves: ActivityStreamItem[] = leaveRows.map((l) => ({
        id: `leave-${l.id}`,
        title: `Leave Request — ${l.userName}`,
        detail: `${l.fromDate} to ${l.toDate} · ${l.reason}`,
        tone: statusTone(l.status),
        category: 'leave' as ActivityCategory,
        timestamp: l.createdAt,
      }))

      const overtimes: ActivityStreamItem[] = overtimeRows.map((o) => ({
        id: `overtime-${o.id}`,
        title: `Overtime Request — ${o.userName}`,
        detail: `${o.hours}h on ${o.requestDate} · ${o.reason}`,
        tone: statusTone(o.status),
        category: 'overtime' as ActivityCategory,
        timestamp: o.createdAt,
      }))

      const refunds: ActivityStreamItem[] = refundRows.map((t) => ({
        id: `refund-${t.id}`,
        title: `Refund — ${t.invoiceNumber}`,
        detail: `${t.refundStatus} · INR ${Math.round(t.refundAmount ?? 0).toLocaleString('en-IN')} · ${t.customerName ?? '—'}`,
        tone: statusTone(t.refundStatus),
        category: 'refund' as ActivityCategory,
        timestamp: t.transactionDate,
      }))

      const tickets: ActivityStreamItem[] = ticketRows.map((tk) => ({
        id: `ticket-${tk.id}`,
        title: `Ticket ${tk.id} — ${tk.locationDisplayName}`,
        detail: `${tk.raisedByName} (${tk.role}) → ${tk.assignedToName || 'Developer'}: ${tk.issue.length > 80 ? tk.issue.slice(0, 80) + '…' : tk.issue}`,
        tone:
          tk.status === 'Open' ? 'critical' : tk.status === 'In Progress' ? 'warning' : 'success',
        category: 'ticket' as ActivityCategory,
        timestamp: tk.createdAt,
      }))

      // Client-side IST 4-day cutoff as safety net
      const cutoff = (() => {
        const d = new Date()
        d.setMinutes(d.getMinutes() + 330) // shift to IST
        d.setDate(d.getDate() - 3)
        d.setHours(0, 0, 0, 0)
        d.setMinutes(d.getMinutes() - 330) // back to UTC
        return d.toISOString()
      })()

      return [
        ...reprints,
        ...protocols,
        ...offers,
        ...vendors,
        ...leaves,
        ...overtimes,
        ...refunds,
        ...tickets,
      ]
        .filter((item) => item.timestamp >= cutoff)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 15)
    },
  })

  const items = query.data ?? EMPTY_ACTIVITY_STREAM
  return { items, loading: isStreamEnabled && query.isLoading }
}

// Stable empty reference so the hook doesn't hand back a new array identity
// on every render when the query has not resolved yet.
const EMPTY_ACTIVITY_STREAM: ActivityStreamItem[] = []

// ── Protocol Notifications (Owner Dashboard) ────────────────────────────────
const ProtocolNotifications = ({ actor }: { actor: { id: string; name: string } }) => {
  const navigate = useNavigate()
  const [pending, setPending] = useState<AsquareBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [rejectReasonMap, setRejectReasonMap] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const all = await asquareBookingsApi.listProtocolBookings()
      setPending(
        all.filter(
          (b) => (b as unknown as Record<string, unknown>).protocolStatus === 'pending_approval',
        ),
      )
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleApprove = async (id: string) => {
    setProcessingId(id)
    setFeedback(null)
    try {
      await asquareBookingsApi.approveProtocol(id, actor)
      setFeedback({ type: 'success', msg: `${id} approved.` })
      await load()
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (id: string) => {
    const reason = rejectReasonMap[id]?.trim()
    if (!reason) {
      setFeedback({ type: 'error', msg: 'Provide a rejection reason.' })
      return
    }
    setProcessingId(id)
    setFeedback(null)
    try {
      await asquareBookingsApi.rejectProtocol(id, actor, reason)
      setFeedback({ type: 'success', msg: `${id} rejected.` })
      setRejectReasonMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await load()
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  if (loading || pending.length === 0) return null

  return (
    <section className="rounded-xl border-2 border-warning/50 bg-warning/5 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/20 text-warning">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-warning">Protocol Approvals</h3>
            <p className="text-xs text-muted">
              {pending.length} pending — free Go-Karting entries awaiting your approval
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-accent hover:underline"
          onClick={() => navigate('/bookings/protocol')}
        >
          View All →
        </button>
      </div>

      {feedback && (
        <p
          className={`mb-3 rounded-lg border px-3 py-1.5 text-xs ${feedback.type === 'success' ? 'border-success/45 bg-success/10 text-success' : 'border-critical/45 bg-critical/10 text-critical'}`}
        >
          {feedback.msg}
        </p>
      )}

      <div className="space-y-3">
        {pending.map((booking) => {
          const raw = booking as unknown as Record<string, unknown>
          return (
            <div
              key={booking.id}
              className="rounded-xl border border-warning/30 bg-panel p-3 shadow-sm"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-text break-all">{booking.id}</p>
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                      Protocol
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {String(raw.userDisplayName ?? raw.customerName ?? 'Unknown')} &middot;{' '}
                    {String(raw.userPhone ?? raw.customerPhone ?? '')}
                  </p>
                  <p className="text-xs text-muted">
                    Branch: {booking.locationId} &middot; {fmtDateIST(booking.createdAt)}
                  </p>
                  <p className="text-xs text-muted">
                    By:{' '}
                    <span className="font-medium text-text">
                      {String(raw.protocolRequestedBy ?? raw.createdByAdminName ?? '—')}
                    </span>
                    {raw.createdByRole ? ` (${String(raw.createdByRole)})` : ''}
                  </p>
                  {Boolean(raw.protocolReason) && (
                    <p className="text-xs italic text-text break-words">
                      "{String(raw.protocolReason)}"
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 w-full lg:w-auto lg:shrink-0">
                  <button
                    type="button"
                    disabled={processingId === booking.id}
                    onClick={() => void handleApprove(booking.id)}
                    className="ui-btn ui-btn-success min-h-8 w-full lg:w-auto px-4 text-xs font-semibold disabled:opacity-50"
                  >
                    {processingId === booking.id ? '...' : 'Approve'}
                  </button>
                  <input
                    className="ui-field h-8 w-full lg:w-48 text-xs"
                    placeholder="Reason"
                    value={rejectReasonMap[booking.id] ?? ''}
                    onChange={(e) =>
                      setRejectReasonMap((prev) => ({ ...prev, [booking.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    disabled={processingId === booking.id}
                    onClick={() => void handleReject(booking.id)}
                    className="ui-btn ui-btn-critical min-h-8 w-full lg:w-auto px-4 text-xs font-semibold disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Offer Notifications (Owner Dashboard) ──────────────────────────────────
const OfferNotifications = ({ actor }: { actor: { id: string; name: string } }) => {
  const navigate = useNavigate()
  const [pending, setPending] = useState<AsquareBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [rejectReasonMap, setRejectReasonMap] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const all = await asquareBookingsApi.listOfferBookings()
      setPending(
        all.filter(
          (b) => (b as unknown as Record<string, unknown>).offerStatus === 'pending_approval',
        ),
      )
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleApprove = async (id: string) => {
    setProcessingId(id)
    setFeedback(null)
    try {
      await asquareBookingsApi.approveOffer(id, actor)
      setFeedback({ type: 'success', msg: `${id} approved.` })
      await load()
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (id: string) => {
    const reason = rejectReasonMap[id]?.trim()
    if (!reason) {
      setFeedback({ type: 'error', msg: 'Provide a rejection reason.' })
      return
    }
    setProcessingId(id)
    setFeedback(null)
    try {
      await asquareBookingsApi.rejectOffer(id, actor, reason)
      setFeedback({ type: 'success', msg: `${id} rejected.` })
      setRejectReasonMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await load()
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  if (loading || pending.length === 0) return null

  return (
    <section className="rounded-xl border-2 border-blue-400/50 bg-blue-50/50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-400/20 text-blue-600">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-blue-700">Offer Approvals</h3>
            <p className="text-xs text-muted">
              {pending.length} pending — Go-Karting offer entries awaiting your approval
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-accent hover:underline"
          onClick={() => navigate('/bookings/offers')}
        >
          View All →
        </button>
      </div>

      {feedback && (
        <p
          className={`mb-3 rounded-lg border px-3 py-1.5 text-xs ${feedback.type === 'success' ? 'border-success/45 bg-success/10 text-success' : 'border-critical/45 bg-critical/10 text-critical'}`}
        >
          {feedback.msg}
        </p>
      )}

      <div className="space-y-3">
        {pending.map((booking) => {
          const raw = booking as unknown as Record<string, unknown>
          return (
            <div
              key={booking.id}
              className="rounded-xl border border-blue-300/30 bg-panel p-3 shadow-sm"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-text break-all">{booking.id}</p>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      Offer
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {String(raw.userDisplayName ?? raw.customerName ?? 'Unknown')} &middot;{' '}
                    {String(raw.userPhone ?? raw.customerPhone ?? '')}
                  </p>
                  <p className="text-xs text-muted">
                    Branch: {booking.locationId} &middot; {fmtDateIST(booking.createdAt)}
                  </p>
                  <p className="text-xs text-muted">
                    By:{' '}
                    <span className="font-medium text-text">
                      {String(raw.offerRequestedBy ?? raw.createdByAdminName ?? '—')}
                    </span>
                    {raw.createdByRole ? ` (${String(raw.createdByRole)})` : ''}
                  </p>
                  {Boolean(raw.offerReason) && (
                    <p className="text-xs italic text-text break-words">
                      "{String(raw.offerReason)}"
                    </p>
                  )}
                  <p className="text-xs font-semibold text-blue-700">
                    ₹{Math.round(Number(raw.totalAmount ?? 0)).toLocaleString('en-IN')} (
                    {String(raw.paymentMethod ?? 'Cash')})
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full lg:w-auto lg:shrink-0">
                  <button
                    type="button"
                    disabled={processingId === booking.id}
                    onClick={() => void handleApprove(booking.id)}
                    className="ui-btn ui-btn-success min-h-8 w-full lg:w-auto px-4 text-xs font-semibold disabled:opacity-50"
                  >
                    {processingId === booking.id ? '...' : 'Approve'}
                  </button>
                  <input
                    className="ui-field h-8 w-full lg:w-48 text-xs"
                    placeholder="Reason"
                    value={rejectReasonMap[booking.id] ?? ''}
                    onChange={(e) =>
                      setRejectReasonMap((prev) => ({ ...prev, [booking.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    disabled={processingId === booking.id}
                    onClick={() => void handleReject(booking.id)}
                    className="ui-btn ui-btn-critical min-h-8 w-full lg:w-auto px-4 text-xs font-semibold disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Reprint Approval Notifications (Owner Dashboard) ─────────────────────────
const ReprintApprovalNotifications = ({ actor }: { actor: { id: string; name: string } }) => {
  const navigate = useNavigate()
  const [pending, setPending] = useState<ReprintApprovalRecord[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    const unsub = subscribePendingReprintApprovals(
      (rows) => setPending(rows),
      (err) => logger.error('role_dashboard.reprint_approvals_error', err),
    )
    return unsub
  }, [])

  const handleApprove = async (req: ReprintApprovalRecord) => {
    setProcessingId(req.id)
    setFeedback(null)
    try {
      await approveReprint(req.id, { reviewedBy: actor.id, reviewedByName: actor.name })
      setFeedback({
        type: 'success',
        msg: `Reprint approved for ${req.invoiceNumber}. Cashier can now print.`,
      })
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (req: ReprintApprovalRecord) => {
    setProcessingId(req.id)
    setFeedback(null)
    try {
      await rejectReprint(req.id, { reviewedBy: actor.id, reviewedByName: actor.name })
      setFeedback({ type: 'success', msg: `Reprint rejected for ${req.invoiceNumber}.` })
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Failed.' })
    } finally {
      setProcessingId(null)
    }
  }

  if (pending.length === 0) return null

  return (
    <section className="rounded-xl border-2 border-info/50 bg-info/5 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-info/20 text-info">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
              />
            </svg>
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-info">Reprint Requests</h3>
            <p className="text-xs text-muted">
              {pending.length} pending — staff requesting receipt reprints
            </p>
          </div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-accent hover:underline"
          onClick={() => navigate('/billing/transactions')}
        >
          View Billing →
        </button>
      </div>

      {feedback && (
        <p
          className={`mb-3 rounded-lg border px-3 py-1.5 text-xs ${feedback.type === 'success' ? 'border-success/45 bg-success/10 text-success' : 'border-critical/45 bg-critical/10 text-critical'}`}
        >
          {feedback.msg}
        </p>
      )}

      <div className="space-y-3">
        {pending.map((req) => (
          <div key={req.id} className="rounded-xl border border-info/30 bg-panel p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-text">{req.invoiceNumber}</p>
                  <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info">
                    Reprint
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {req.customerName ?? '—'} &middot; INR{' '}
                  {Math.round(req.amount).toLocaleString('en-IN')}
                </p>
                <p className="text-xs text-muted">
                  By: <span className="font-medium text-text">{req.requestedByName}</span> (
                  {req.requestedByRole}) &middot; {fmtDateIST(req.requestedAt)}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={processingId === req.id}
                  onClick={() => void handleApprove(req)}
                  className="ui-btn ui-btn-success min-h-8 px-4 text-xs font-semibold disabled:opacity-50"
                >
                  {processingId === req.id ? '...' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={processingId === req.id}
                  onClick={() => void handleReject(req)}
                  className="ui-btn ui-btn-critical min-h-8 px-4 text-xs font-semibold disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Kart-Report Bypass Approval Queue (Owner Dashboard) ──────────────────────
// Cashiers raise a request from the Check-In gate when Track Marshall hasn't
// submitted today's kart report. Each pending row shows who, where, why, and
// when. Approve grants the cashier's session-local override (their popup
// flips to "approved" via the subscribeKartReportBypassRequest live feed
// and the Check In gate clears). Reject sets status='rejected'; their popup
// then shows the reviewer + an optional note. Amber accent matches the
// caution register (vs. the info-blue used for reprints).
const KartReportBypassNotifications = ({ actor }: { actor: { id: string; name: string } }) => {
  const [pending, setPending] = useState<KartReportBypassRequest[]>([])
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    const unsub = subscribePendingKartReportBypasses(
      (rows) => setPending(rows),
      (err) => logger.error('role_dashboard.kart_report_bypass_subscribe_failed', err),
    )
    return unsub
  }, [])

  const handleApprove = async (req: KartReportBypassRequest) => {
    setProcessingId(req.id)
    setFeedback(null)
    try {
      await approveKartReportBypass(req.id, {
        reviewedBy: actor.id,
        reviewedByName: actor.name,
      })
      setFeedback({
        type: 'success',
        msg: `Approved bypass for ${req.requestedByName || 'cashier'}.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Failed to approve.',
      })
    } finally {
      setProcessingId(null)
    }
  }

  const handleReject = async (req: KartReportBypassRequest) => {
    setProcessingId(req.id)
    setFeedback(null)
    try {
      await rejectKartReportBypass(req.id, {
        reviewedBy: actor.id,
        reviewedByName: actor.name,
      })
      setFeedback({
        type: 'success',
        msg: `Rejected bypass for ${req.requestedByName || 'cashier'}.`,
      })
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Failed to reject.',
      })
    } finally {
      setProcessingId(null)
    }
  }

  if (pending.length === 0) return null

  return (
    <section className="rounded-xl border-2 border-amber-500/45 bg-amber-500/5 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-base text-amber-700 dark:text-amber-300"
          >
            ⚠
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-amber-700 dark:text-amber-300">
              Kart-Report Bypass Requests
            </h3>
            <p className="text-xs text-muted">
              {pending.length} pending — cashiers asking to Check In without today&apos;s kart
              report
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <p
          className={`mb-3 rounded-lg border px-3 py-1.5 text-xs ${
            feedback.type === 'success'
              ? 'border-success/45 bg-success/10 text-success'
              : 'border-critical/45 bg-critical/10 text-critical'
          }`}
        >
          {feedback.msg}
        </p>
      )}

      <div className="space-y-3">
        {pending.map((req) => (
          <div
            key={req.id}
            className="rounded-xl border border-amber-500/30 bg-panel p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-text">{req.requestedByName || 'Unknown'}</p>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    {req.locationId || '—'}
                  </span>
                  <span className="rounded-full bg-base/60 px-2 py-0.5 text-[10px] font-medium text-muted">
                    {req.requestedByRole || 'Cashier'}
                  </span>
                </div>
                <p className="text-sm text-default">{req.reason}</p>
                <p className="font-mono text-[11px] tabular-nums text-muted">
                  {fmtDateIST(req.requestedAt)} · {fmtTimeShortIST(req.requestedAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  disabled={processingId === req.id}
                  onClick={() => void handleApprove(req)}
                  className="ui-btn ui-btn-success min-h-8 px-4 text-xs font-semibold disabled:opacity-50"
                >
                  {processingId === req.id ? '…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={processingId === req.id}
                  onClick={() => void handleReject(req)}
                  className="ui-btn ui-btn-critical min-h-8 px-4 text-xs font-semibold disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Location Day Reports (Owner/Admin) ────────────────────────────────────────
const LocationDayReports = ({ checkouts }: { checkouts: LocationCheckout[] }) => {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const { session } = useAuth()
  const fmtCurr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`

  const handlePrint = async (loc: LocationCheckout) => {
    setLoadingId(loc.locationId)
    try {
      const data = await aggregateDayReport(loc.locationId, todayIST())
      if (data.transactionCount === 0) {
        window.alert('No completed transactions found for today at this location.')
        return
      }
      // Attach settlement data for excess/shortage calculation
      if (loc.cashEntered != null) {
        data.settlement = {
          cashEntered: loc.cashEntered ?? 0,
          cardEntered: loc.cardEntered ?? 0,
          upiEntered: loc.upiEntered ?? 0,
          cashActual: loc.cashTotal,
          cardActual: loc.cardTotal,
          upiActual: loc.upiTotal,
        }
      }
      await printDayReport(data, session?.user.name, session?.token)
    } catch (err) {
      logger.error('role_dashboard.day_report_generation_failed', err)
      window.alert(
        err instanceof Error ? err.message : 'Failed to generate report. Please try again.',
      )
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">
          Location Day Reports
        </h2>
        <StatusBadge tone="success">{checkouts.length} Checked Out</StatusBadge>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {checkouts.map((loc) => {
          const total = loc.cashTotal + loc.cardTotal + loc.upiTotal
          const settledTime = (() => {
            try {
              return fmtTimeShortIST(new Date(loc.settledAt))
            } catch {
              return ''
            }
          })()
          return (
            <div
              key={loc.locationId}
              className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {loc.locationName}
                </p>
                {settledTime && <span className="text-[10px] text-muted">{settledTime}</span>}
              </div>
              <p className="mt-2 font-display text-2xl font-semibold leading-none tracking-tight text-text">
                {fmtCurr(total)}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span>Cash: {fmtCurr(loc.cashTotal)}</span>
                <span>Card: {fmtCurr(loc.cardTotal)}</span>
                <span>UPI: {fmtCurr(loc.upiTotal)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{loc.totalTransactions} transactions</p>
              <button
                type="button"
                onClick={() => void handlePrint(loc)}
                disabled={loadingId === loc.locationId}
                className="mt-3 w-full rounded-lg bg-accent/15 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
              >
                {loadingId === loc.locationId ? 'Generating...' : 'Print Day Report'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export const RoleDashboardScene = ({ userRole: role }: { userRole: Role }) => {
  const { session, logout } = useAuth()
  const { allowedSlugs } = useLocations()
  const { mode, cycleMode } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  // Used by handleRefresh to also invalidate the React-Query-backed
  // widgets (FutureBookingsStrip, RecentBookingsTable) so they refetch
  // along with the dashboard snapshot. Without this, those widgets keep
  // their cached data until their own 30–60s staleTime expires.
  const queryClient = useQueryClient()

  // Last-10-min revenue pulse — shows what just came in to give the
  // owner a "live heartbeat" next to the Total Revenue number. Fetched
  // client-side from the bookings collection (no API call) and
  // refetched alongside the snapshot on every dashboard refresh.
  const { data: recentPulseRevenue } = useQuery({
    queryKey: ['recent-pulse-revenue-10min'],
    queryFn: async () => {
      if (!session) return null
      try {
        const { collection, getDocs, query: fsq, where, Timestamp } = await import(
          'firebase/firestore'
        )
        const { getAsquareFirestore } = await import('../../api/asquare-firestore')
        const firestore = getAsquareFirestore()
        const cutoff = new Date(Date.now() - 10 * 60 * 1000)
        const snap = await getDocs(
          fsq(
            collection(firestore, 'bookings'),
            where('createdAt', '>=', Timestamp.fromDate(cutoff)),
          ),
        )
        let sum = 0
        for (const d of snap.docs) {
          const b = d.data() as Record<string, unknown>
          if (b.paymentStatus !== 'completed') continue
          if (b.cancelled === true) continue
          sum += Number(b.finalAmount) || 0
        }
        return Math.round(sum)
      } catch {
        return null
      }
    },
    enabled: role === 'Owner' && !!session,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const [state, setState] = useState<DashboardWidgetState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // 0 sentinel means "never refreshed yet" — the refresh control hides the
  // timestamp until the first successful fetch (or cache hydrate) lands.
  // Without the sentinel we would falsely tell the Owner "Refreshed just now"
  // while skeletons are still on screen.
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(0)

  const [activityExpanded, setActivityExpanded] = useState(false)
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  // The future-bookings strip lives below the discrepancy band for Owner
  // / Admin. Clicking a day opens the drill-in slide-over. Only one day
  // can be open at a time.
  const [futureBookingsDate, setFutureBookingsDate] = useState<string | null>(null)
  const [expandedRoleGroups, setExpandedRoleGroups] = useState<Record<string, boolean>>({})
  const toggleRoleGroup = useCallback((key: string) => {
    setExpandedRoleGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const config = getRoleConfig(role)
  const activityStream = useActivityStream(role)

  // Real-time pending scans count for TrackMarshall
  const scannerLocation =
    role === 'TrackMarshall' && allowedSlugs?.[0] ? getLocationDisplayName(allowedSlugs[0]) : null
  const { pending: pendingScans } = useTransactionCounts(scannerLocation)

  useEffect(() => {
    if (!session || session.user.role !== role) {
      return
    }

    let cancelled = false

    // Stale-while-revalidate: show cached data instantly, then refresh in background.
    const cacheKey = `pipeline:dashboard-cache:${role}`
    const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const cached = JSON.parse(raw) as { data: DashboardSnapshot; cachedAt: number }
        if (Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS) {
          setSnapshot(cached.data)
          setState(cached.data.activity.length === 0 ? 'empty' : 'ready')
          setLastRefreshedAt(cached.cachedAt)
        }
      }
    } catch {
      // Ignore corrupt cache
    }

    const run = async () => {
      // Only show loading skeleton if we have no cached data to show
      if (!snapshot) {
        setState('loading')
      }
      setError(null)
      try {
        const nextSnapshot = await loadDashboardData({
          role,
          token: session.token,
          userId: session.user.id,
          allowedSlugs,
        })
        if (cancelled) {
          return
        }
        // Fields where the server-side `safe()` wrapper can silently swallow
        // a transient upstream failure (e.g. reportsApi.gameRevenue) and
        // hand us back `undefined`. Falling back to the previous snapshot's
        // value keeps a working Revenue section on screen instead of
        // visually deleting it on a flaky refresh.
        const merged: DashboardSnapshot = {
          ...nextSnapshot,
          gameRevenue: nextSnapshot.gameRevenue ?? snapshot?.gameRevenue,
          locationCheckouts: nextSnapshot.locationCheckouts ?? snapshot?.locationCheckouts,
        }
        setSnapshot(merged)
        setState(merged.activity.length === 0 ? 'empty' : 'ready')
        setLastRefreshedAt(Date.now())
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: merged, cachedAt: Date.now() }))
        } catch {
          // localStorage full or unavailable — ignore
        }
      } catch (err) {
        if (cancelled) {
          return
        }
        // Only show error state if we have no stale data to show
        if (!snapshot) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
          setState('error')
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, session])

  // In-place refetch — no full reload, no white flash, no lost scroll.
  // Owner can audit the same view they're already looking at, get fresh
  // numbers, and the scanner sweep makes the action feel consequential.
  const handleRefresh = useCallback(async () => {
    if (!session || isRefreshing) return
    setIsRefreshing(true)
    setError(null)
    // Kick the React-Query widgets at the same time as the snapshot
    // fetch — they each manage their own cache and would otherwise
    // serve stale data until their staleTime ran out. Fire-and-forget;
    // their internal isLoading state shows the spinner. Match by
    // queryKey prefix so this stays robust if either widget adds more
    // dependent values to its key in the future.
    void queryClient.invalidateQueries({ queryKey: ['recent-bookings-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['future-bookings'] })
    void queryClient.invalidateQueries({ queryKey: ['future-bookings-day'] })
    void queryClient.invalidateQueries({ queryKey: ['recent-pulse-revenue-10min'] })
    try {
      const nextSnapshot = await loadDashboardData({
        role,
        token: session.token,
        userId: session.user.id,
        allowedSlugs,
      })
      // See the initial-load equivalent above: server-side `safe()` may
      // hand us `undefined` for fields whose upstream failed transiently.
      // Merge so a refresh never visually deletes a working section.
      const merged: DashboardSnapshot = {
        ...nextSnapshot,
        gameRevenue: nextSnapshot.gameRevenue ?? snapshot?.gameRevenue,
        locationCheckouts: nextSnapshot.locationCheckouts ?? snapshot?.locationCheckouts,
      }
      setSnapshot(merged)
      setState(merged.activity.length === 0 ? 'empty' : 'ready')
      setLastRefreshedAt(Date.now())
      try {
        localStorage.setItem(
          `pipeline:dashboard-cache:${role}`,
          JSON.stringify({ data: merged, cachedAt: Date.now() }),
        )
      } catch {
        // localStorage full or unavailable — ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh dashboard')
    } finally {
      setIsRefreshing(false)
    }
  }, [role, session, allowedSlugs, isRefreshing, snapshot])

  if (!session) {
    return <Navigate replace to="/login" />
  }
  if (session.user.role !== role) {
    return <Navigate replace to={rolePathMap[session.user.role]} />
  }

  const deniedModule = (location.state as { deniedModule?: ModuleTab } | undefined)?.deniedModule
  const moduleNav = getTabsForRole(role).map((tab) => ({ label: tab.label, href: tab.path }))
  const mobileShortcuts = getRoleMobileShortcuts(role)
  const quickFabHref = resolveRoleActionRoute(role, config.quickFabAction.id)

  const kpiCards = config.kpis.map((kpi) => ({
    ...kpi,
    value: kpi.id === 'pendingScans' ? String(pendingScans) : (snapshot?.kpiValues[kpi.id] ?? '-'),
  }))

  const routeAction = (targetPath: string) => {
    if (isPathAllowedForRole(role, targetPath)) {
      navigate(targetPath)
      return
    }

    navigate(rolePathMap[role], {
      state: { deniedModule: getTabForPath(targetPath) },
    })
  }

  return (
    <AppShell
      role={role}
      userName={session.user.name}
      navItems={moduleNav}
      primaryActions={config.primaryActions}
      quickFabAction={config.quickFabAction}
      quickFabHref={quickFabHref}
      mobileShortcuts={mobileShortcuts}
      themeMode={mode}
      onCycleTheme={cycleMode}
      onLogout={() => void logout()}
    >
      <div className="ui-section-stack lg:space-y-5">
        {deniedModule ? (
          <div
            className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning"
            aria-live="polite"
          >
            Access to <span className="font-semibold">{deniedModule}</span> is not permitted for
            your role.
          </div>
        ) : null}

        {role === 'Owner' ? (
          <DashboardRefreshControl
            title={
              <h2 className="font-display text-xl font-semibold tracking-tight text-text lg:text-2xl">
                Dashboard
              </h2>
            }
            onRefresh={handleRefresh}
            lastRefreshedAt={lastRefreshedAt}
            isRefreshing={isRefreshing}
          />
        ) : null}

        {(role === 'Owner' || role === 'Admin') && session ? (
          <>
            <ProtocolNotifications actor={{ id: session.user.id, name: session.user.name }} />
            <OfferNotifications actor={{ id: session.user.id, name: session.user.name }} />
            <KartReportBypassNotifications
              actor={{ id: session.user.id, name: session.user.name }}
            />
            <ReprintApprovalNotifications
              actor={{ id: session.user.id, name: session.user.name }}
            />
            {role === 'Admin' && <KartfluencerBanner />}
          </>
        ) : null}

        {config.kpis.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {state === 'loading'
              ? config.kpis.map((kpi) => <Skeleton className="h-32 rounded-xl" key={kpi.id} />)
              : kpiCards.map((kpi) => (
                  <KpiCard key={kpi.id} label={kpi.label} value={kpi.value} tone={kpi.tone} />
                ))}
          </section>
        ) : null}

        {config.primaryActions.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {config.primaryActions.map((action) => (
              <ActionCard
                key={action.id}
                label={action.label}
                description={action.description}
                hotkey={action.hotkey}
                tone={action.tone ?? 'info'}
                to={resolveRoleActionRoute(role, action.id)}
                onClick={() => routeAction(resolveRoleActionRoute(role, action.id))}
              />
            ))}
          </section>
        ) : null}

        {role === 'Owner' && snapshot?.gameRevenue ? (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">
                Location-Wise Revenue
              </h2>
              <button
                type="button"
                className="text-sm font-medium text-accent hover:underline"
                onClick={() => routeAction('/reports/game-revenue')}
              >
                View Full Report →
              </button>
            </div>
            {(() => {
              const lb = snapshot.gameRevenue.locationBreakdown ?? []
              const fmt = (v: number) => `\u20B9${Math.round(v).toLocaleString('en-IN')}`
              const totPos = lb.reduce((s, l) => s + (l.posRevenue || 0), 0)
              const totWebsite = lb.reduce((s, l) => s + (l.bookingRevenue || 0), 0)
              const totAdmin = lb.reduce((s, l) => s + (l.adminBookingRevenue || 0), 0)
              const totTele = lb.reduce((s, l) => s + (l.telecallerRevenue || 0), 0)
              const totOnline = totWebsite + totAdmin + totTele
              return (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {/* Total Revenue */}
                  <button
                    type="button"
                    className="cursor-pointer rounded-xl border border-border/45 bg-panel p-4 text-left shadow-sm transition-shadow hover:shadow-md"
                    onClick={() => routeAction('/reports/game-revenue')}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Total Revenue (All Branches)
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="font-display text-3xl font-semibold leading-none tracking-tight text-success lg:text-4xl">
                        {/* key={value} re-mounts CountUp on every refresh,
                            so the spring replays from 0 → new value. */}
                        <span aria-hidden>&#8377;</span>
                        <CountUp
                          key={`total-rev-${Math.round(snapshot.gameRevenue.totalRevenue || 0)}`}
                          from={0}
                          to={Math.round(snapshot.gameRevenue.totalRevenue || 0)}
                          duration={0.1}
                          separator=","
                        />
                      </p>
                      {/* Live pulse — revenue earned in the last 10
                          minutes. Hidden when nothing came in. Green
                          up-arrow makes it read as "what just landed". */}
                      {typeof recentPulseRevenue === 'number' && recentPulseRevenue > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-mono tabular-nums font-semibold text-success"
                          title="Revenue received in the last 10 minutes"
                          aria-label={`Plus rupees ${recentPulseRevenue} in the last 10 minutes`}
                        >
                          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                          +&#8377;
                          <CountUp
                            key={`pulse-${recentPulseRevenue}`}
                            from={0}
                            to={recentPulseRevenue}
                            duration={0.1}
                            separator=","
                          />
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      {totPos > 0 && (
                        <span className="text-xs text-muted">
                          <span className="font-medium text-text/70">Branch (POS)</span>{' '}
                          {fmt(totPos)}
                        </span>
                      )}
                      {totOnline > 0 && (
                        <span className="text-xs text-muted">
                          <span className="font-medium text-text/70">City Office</span>{' '}
                          {fmt(totOnline)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* City Office Revenue */}
                  <button
                    type="button"
                    className="cursor-pointer rounded-xl border border-border/45 bg-panel p-4 text-left shadow-sm transition-shadow hover:shadow-md"
                    onClick={() => routeAction('/reports/game-revenue')}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-info">
                      City Office Revenue{isFeatureNew('city-office-dashboard') && <NewBadge />}
                    </p>
                    <p className="mt-2.5 font-display text-2xl font-semibold leading-none tracking-tight text-info lg:text-3xl">
                      <span aria-hidden>&#8377;</span>
                      <CountUp
                        key={`city-office-rev-${Math.round(totOnline)}`}
                        from={0}
                        to={Math.round(totOnline)}
                        duration={0.1}
                        separator=","
                      />
                    </p>
                    {totOnline > 0 ? (
                      <div className="mt-3 flex flex-col gap-1">
                        {getEnabledLocations().map((loc) => {
                          const row = lb.find(
                            (l) =>
                              l.locationId === loc.slug ||
                              (l.locationName ?? '')
                                .toLowerCase()
                                .includes(loc.displayName.toLowerCase()) ||
                              loc.displayName
                                .toLowerCase()
                                .includes((l.locationName ?? '').toLowerCase()),
                          )
                          const co =
                            (row?.bookingRevenue ?? 0) +
                            (row?.adminBookingRevenue ?? 0) +
                            (row?.telecallerRevenue ?? 0)
                          return (
                            <span key={loc.slug} className="text-xs text-muted">
                              <span className="font-medium text-text/70">{loc.displayName}</span>
                              {' : '}
                              {fmt(co)}
                            </span>
                          )
                        })}
                      </div>
                    ) : null}
                  </button>

                  {/* Per-Location Cards (POS only) */}
                  {(snapshot.gameRevenue.branchBreakdowns ?? [])
                    .filter((b: BranchGameRevenueBreakdown) =>
                      getEnabledLocations().some((loc) =>
                        b.displayName.toLowerCase().includes(loc.displayName.toLowerCase()),
                      ),
                    )
                    .map((branch: BranchGameRevenueBreakdown) => {
                      const locRow = (snapshot.gameRevenue?.locationBreakdown ?? []).find(
                        (l) =>
                          l.locationId === branch.locationId ||
                          l.locationName
                            ?.toLowerCase()
                            .includes(branch.displayName.toLowerCase()) ||
                          branch.displayName
                            .toLowerCase()
                            .includes(l.locationName?.toLowerCase() ?? ''),
                      )
                      const posRevenue = locRow?.posRevenue || 0
                      return (
                        <button
                          key={branch.locationId}
                          type="button"
                          className="cursor-pointer rounded-xl border border-border/45 bg-panel p-4 text-left shadow-sm transition-shadow hover:shadow-md"
                          onClick={() => routeAction('/reports/game-revenue')}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                            {branch.displayName}
                          </p>
                          <p className="mt-2.5 font-display text-2xl font-semibold leading-none tracking-tight text-text lg:text-3xl">
                            <span aria-hidden>&#8377;</span>
                            <CountUp
                              key={`branch-pos-${branch.locationId}-${Math.round(posRevenue)}`}
                              from={0}
                              to={Math.round(posRevenue)}
                              duration={0.1}
                              separator=","
                            />
                          </p>
                          {posRevenue > 0 ? (
                            <div className="mt-3">
                              <span className="text-xs text-muted">
                                <span className="font-medium text-text/70">POS</span>{' '}
                                {fmt(posRevenue)}
                              </span>
                            </div>
                          ) : null}
                        </button>
                      )
                    })}
                </div>
              )
            })()}
          </section>
        ) : null}

        {(role === 'Owner' || role === 'Admin') &&
        snapshot?.locationCheckouts &&
        snapshot.locationCheckouts.length > 0 ? (
          <LocationDayReports checkouts={snapshot.locationCheckouts} />
        ) : null}

        {role === 'Owner' || role === 'Admin' ? (
          <FutureBookingsStrip onSelectDate={setFutureBookingsDate} />
        ) : null}

        {role === 'Owner' || role === 'Admin' ? <RecentBookingsTable /> : null}

        {role === 'Owner' ? (
          <section className="ui-panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">
                Quick Accesses
              </h2>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:flex sm:flex-wrap sm:gap-2">
              <button
                type="button"
                onClick={() => routeAction('/incharge/reports')}
                className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-border/45 bg-panel/80 p-3 text-center shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md active:scale-[0.98] sm:aspect-auto sm:w-28 sm:gap-1.5 sm:p-2.5"
              >
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-xl sm:h-8 sm:w-8 sm:text-base"
                  aria-hidden
                >
                  📋
                </span>
                <p className="font-display text-sm font-semibold leading-tight text-text sm:text-xs">
                  Incharge Report
                </p>
              </button>
              <button
                type="button"
                onClick={() => routeAction('/bookings/protocol')}
                className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-border/45 bg-panel/80 p-3 text-center shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md active:scale-[0.98] sm:aspect-auto sm:w-28 sm:gap-1.5 sm:p-2.5"
              >
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-xl sm:h-8 sm:w-8 sm:text-base"
                  aria-hidden
                >
                  📑
                </span>
                <p className="font-display text-sm font-semibold leading-tight text-text sm:text-xs">
                  Protocol
                </p>
              </button>
              <button
                type="button"
                onClick={() => routeAction('/track/reports')}
                className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-border/45 bg-panel/80 p-3 text-center shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md active:scale-[0.98] sm:aspect-auto sm:w-28 sm:gap-1.5 sm:p-2.5"
              >
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-xl sm:h-8 sm:w-8 sm:text-base"
                  aria-hidden
                >
                  🏎️
                </span>
                <p className="font-display text-sm font-semibold leading-tight text-text sm:text-xs">
                  Kart Reports
                </p>
              </button>
              <button
                type="button"
                onClick={() => routeAction('/workspaces/work-report')}
                className="group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-border/45 bg-panel/80 p-3 text-center shadow-sm backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md active:scale-[0.98] sm:aspect-auto sm:w-28 sm:gap-1.5 sm:p-2.5"
              >
                <span
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-xl sm:h-8 sm:w-8 sm:text-base"
                  aria-hidden
                >
                  📊
                </span>
                <p className="font-display text-sm font-semibold leading-tight text-text sm:text-xs">
                  Work Report
                </p>
              </button>
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className="ui-panel min-h-[22rem] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">
                Activity Stream
              </h2>
              <StatusBadge tone="info">Live</StatusBadge>
            </div>
            <div className="mt-3 space-y-3">
              {role === 'Owner' || role === 'Admin' || role === 'Developer' ? (
                activityStream.loading ? (
                  <>
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                  </>
                ) : activityStream.items.length > 0 ? (
                  <>
                    {(activityExpanded
                      ? activityStream.items
                      : activityStream.items.slice(0, 3)
                    ).map((item) => {
                      const cat = CATEGORY_LABELS[item.category]
                      const ts = fmtDateTimeParts(item.timestamp)
                      return (
                        <div
                          key={item.id}
                          className="relative rounded-xl border border-border/45 bg-panel px-3 py-2.5 shadow-sm"
                        >
                          <StatusBadge
                            tone={toneStyle(item.tone)}
                            className="absolute right-3 top-2.5"
                          />
                          <div className="flex items-center gap-2 pr-14 sm:pr-24">
                            <span
                              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cat.className}`}
                            >
                              {cat.label}
                            </span>
                            <p className="truncate text-sm font-semibold text-text">{item.title}</p>
                          </div>
                          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                            <span>{item.detail}</span>
                            <span className="opacity-50">·</span>
                            <span className="whitespace-nowrap">
                              <span className="opacity-60">{ts.date}</span>{' '}
                              <span className="opacity-50">•</span> {ts.time}
                            </span>
                          </p>
                        </div>
                      )
                    })}
                    {activityStream.items.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setActivityExpanded((p) => !p)}
                        className="w-full rounded-lg border border-border/40 bg-surface/50 py-2 text-xs font-medium text-muted transition hover:bg-surface hover:text-text"
                      >
                        {activityExpanded
                          ? 'Show Less'
                          : `Show More (${activityStream.items.length - 3} more)`}
                      </button>
                    )}
                  </>
                ) : (
                  <EmptyState
                    title="No events"
                    description="Approval requests will appear here in real time."
                  />
                )
              ) : state === 'loading' ? (
                <>
                  <Skeleton className="h-12 rounded-xl" />
                  <Skeleton className="h-12 rounded-xl" />
                </>
              ) : snapshot?.activity.length ? (
                <>
                  {(activityExpanded ? snapshot.activity : snapshot.activity.slice(0, 3)).map(
                    (item) => (
                      <div
                        key={item.id}
                        className="relative rounded-xl border border-border/45 bg-panel px-3 py-2.5 shadow-sm"
                      >
                        <StatusBadge
                          tone={toneStyle(item.tone)}
                          className="absolute right-3 top-2.5"
                        />
                        <div className="pr-24">
                          <p className="text-sm font-semibold text-text">{item.title}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted">{item.detail}</p>
                      </div>
                    ),
                  )}
                  {snapshot.activity.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setActivityExpanded((p) => !p)}
                      className="w-full rounded-lg border border-border/40 bg-surface/50 py-2 text-xs font-medium text-muted transition hover:bg-surface hover:text-text"
                    >
                      {activityExpanded
                        ? 'Show Less'
                        : `Show More (${snapshot.activity.length - 3} more)`}
                    </button>
                  )}
                </>
              ) : (
                <EmptyState
                  title="No events"
                  description="Activity will appear once events are generated."
                />
              )}
            </div>
          </article>

          <article className="ui-panel min-h-[22rem] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">
                Alerts & Recovery
              </h2>
              <StatusBadge tone={state === 'error' ? 'critical' : 'success'}>
                {state === 'error' ? 'Attention' : 'Stable'}
              </StatusBadge>
            </div>
            <div className="mt-3 space-y-3" aria-live="polite">
              {state === 'error' ? (
                <div className="rounded-xl border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
                  {error ?? 'Dashboard data unavailable.'}
                </div>
              ) : snapshot?.alerts.length ? (
                <>
                  {(alertsExpanded ? snapshot.alerts : snapshot.alerts.slice(0, 3)).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border/45 bg-panel px-3 py-2.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-text">{item.title}</p>
                        <StatusBadge tone={toneStyle(item.tone)} />
                      </div>
                      {item.staffList && item.staffList.length > 0 ? (
                        <div className="mt-2 space-y-2.5">
                          {Object.entries(
                            item.staffList.reduce<Record<string, StaffShiftEntry[]>>(
                              (groups, staff) => {
                                const key = staff.role || 'Other'
                                ;(groups[key] ??= []).push(staff)
                                return groups
                              },
                              {},
                            ),
                          ).map(([role, members]) => {
                            const groupKey = `${item.id}::${role}`
                            return (
                              <StaffRoleGroup
                                key={role}
                                role={role}
                                members={members}
                                tone={item.tone}
                                expanded={!!expandedRoleGroups[groupKey]}
                                onToggle={() => toggleRoleGroup(groupKey)}
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted">{item.detail}</p>
                      )}
                    </div>
                  ))}
                  {snapshot.alerts.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setAlertsExpanded((p) => !p)}
                      className="w-full rounded-lg border border-border/40 bg-surface/50 py-2 text-xs font-medium text-muted transition hover:bg-surface hover:text-text"
                    >
                      {alertsExpanded
                        ? 'Show Less'
                        : `Show More (${snapshot.alerts.length - 3} more)`}
                    </button>
                  )}
                </>
              ) : (
                <EmptyState title="No alerts" description="No actionable alerts right now." />
              )}
            </div>
          </article>
        </section>
      </div>
      {futureBookingsDate ? (
        <FutureBookingsSlideOver
          date={futureBookingsDate}
          onClose={() => setFutureBookingsDate(null)}
        />
      ) : null}
    </AppShell>
  )
}

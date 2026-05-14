import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { DashboardWidgetState, ReprintApprovalRecord } from '../../api/types'
import { AsquareBooking, asquareBookingsApi } from '../../api/asquare-bookings'
import { printTransactionReceipt } from '../../features/billing/generateBillingReceipt'
import { checkPrintCount, logPrint } from '../../api/print-log'
import {
  requestReprintApproval,
  getApprovalForTransaction,
  completeReprint,
  subscribeUserReprintApprovals,
} from '../../api/reprint-approvals'
import { reserveSerialsForItems } from '../../api/serial-counters'
import { logger } from '../../../lib/logger'
import { formatActivityLabel, formatActivityDisplay } from '../../../lib/format-activity'

import { AppShell } from '../../components/layout/AppShell'
import { ActionCard } from '../../components/ui/ActionCard'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ModalShell } from '../../components/ui/ModalShell'
import { useAuth } from '../../features/auth/auth-context'
import { DashboardSnapshot, loadDashboardData } from '../../features/dashboard/dashboard-data'
import { getRoleConfig, rolePathMap } from '../../features/dashboard/role-config'
import {
  getRoleMobileShortcuts,
  isPathAllowedForRole,
  resolveRoleActionRoute,
} from '../../features/navigation/action-route-map'
import { getTabsForRole } from '../../features/navigation/module-manifest'
import { useTheme } from '../../features/theme/theme-context'
import { useLocations } from '../../hooks/useLocations'
import { slugToBranchId, getLocationDisplayName } from '../../../lib/locations'
import { fmtDateIST } from '../../../lib/date-format'
const fmtCurrency = (v: number) => `\u20B9${Math.round(v || 0).toLocaleString('en-IN')}`
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── Build transaction object for printing ────────────────────────────────────
function buildPrintTxn(
  booking: AsquareBooking,
  locationId: string,
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    serialStart?: number
  }>,
) {
  const gstPercent = 18
  const baseAmount = Math.round((booking.finalAmount / (1 + gstPercent / 100)) * 100) / 100
  const gstAmount = Math.round((booking.finalAmount - baseAmount) * 100) / 100
  const couponCode = String((booking as Record<string, unknown>).couponCode ?? '')
  const couponDiscount = Number(
    (booking as Record<string, unknown>).couponAmount ?? booking.discountAmount ?? 0,
  )

  return {
    id: booking.id,
    invoiceNumber: booking.id,
    customerName: booking.userDisplayName || 'Guest',
    customerPhone: booking.userPhone || '',
    totalAmount: booking.finalAmount,
    baseAmount,
    gstAmount,
    gstPercent,
    paymentMethod: ((): 'Cash' | 'Card' | 'UPI' | 'Razorpay' => {
      const m = String(booking.paymentMethod ?? '').toLowerCase()
      if (m === 'razorpay') return 'Razorpay'
      if (m === 'upi') return 'UPI'
      if (m === 'card') return 'Card'
      return 'Cash'
    })(),
    refundStatus: 'None' as const,
    transactionDate:
      booking.createdAt instanceof Date
        ? booking.createdAt.toISOString()
        : String(booking.createdAt),
    visitDate: (() => {
      const d = new Date(booking.sessionDate)
      return isNaN(d.getTime()) ? undefined : fmtDate(d)
    })(),
    locationId,
    paymentStatus: 'completed' as const,
    source: 'Booking' as const,
    bookingId: booking.id,
    discount: booking.discountAmount,
    couponCode: couponCode || undefined,
    couponDiscount: couponDiscount || undefined,
    items,
  }
}

// ── Reserve or reuse serial numbers ──────────────────────────────────────────
async function resolveSerials(
  booking: AsquareBooking,
  locationId: string,
  txnDate: string,
  items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    serialStart?: number
  }>,
) {
  const storedSerials = booking.printSerials as number[] | undefined
  if (storedSerials && storedSerials.length === items.length) {
    for (let i = 0; i < items.length; i++) items[i].serialStart = storedSerials[i]
  } else {
    try {
      const serialStarts = await reserveSerialsForItems(locationId, txnDate, items, booking.id)
      for (let i = 0; i < items.length; i++) items[i].serialStart = serialStarts[i]
      await asquareBookingsApi.updateBooking(booking.id, booking.userId, {
        printSerials: serialStarts,
        printSerialDate: txnDate,
      } as Partial<AsquareBooking>)
    } catch {
      /* non-critical */
    }
  }
}

// ── Print ticket handler ─────────────────────────────────────────────────────
async function handlePrintTicket(
  booking: AsquareBooking,
  actor: { id: string; name: string; role: string },
  approvedRequest?: ReprintApprovalRecord | null,
): Promise<'printed' | 'approval_sent' | 'already_pending' | 'blocked'> {
  if (booking.paymentStatus !== 'completed') {
    window.alert('Cannot print ticket \u2014 payment is still pending.')
    return 'blocked'
  }

  const locationId = slugToBranchId(booking.locationId ?? '')
  const sessionDate = new Date(booking.sessionDate)
  const visitDate = isNaN(sessionDate.getTime()) ? undefined : fmtDate(sessionDate)
  const txnDate = visitDate ?? fmtDate(new Date())

  const items: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    serialStart?: number
  }> = (booking.items || []).map((item) => ({
    itemName: item.activity ? formatActivityLabel(item.activity) : 'Activity',
    quantity: item.quantity,
    unitPrice: Number(item.price ?? item.activity?.basePrice ?? 0) / Math.max(1, item.quantity),
    gameId: (item.activity as unknown as Record<string, unknown>)?.gameTypeId as string | undefined,
    subGameId: item.activity?.id,
  }))

  await resolveSerials(booking, locationId, txnDate, items)

  // Read-only check — does NOT create a log entry yet
  try {
    const { isReprint, printCount } = await checkPrintCount(booking.id, 'booking')
    if (isReprint) {
      // Non-Owner: handle reprint approval flow
      if (actor.role !== 'Owner') {
        // If we have an approved reprint request, proceed to print
        if (approvedRequest && approvedRequest.status === 'approved') {
          const txn = buildPrintTxn(booking, locationId, items)
          await logPrint({
            documentId: booking.id,
            source: 'booking',
            printedBy: actor.id,
            printedByName: actor.name,
            printedByRole: actor.role,
            customerName: booking.userDisplayName || 'Guest',
            customerPhone: booking.userPhone,
            amount: booking.finalAmount,
            locationId,
          })
          await printTransactionReceipt(txn)
          await completeReprint(approvedRequest.id)
          return 'printed'
        }

        // Check for existing pending/approved request to avoid duplicates
        const existing = await getApprovalForTransaction(booking.id, actor.id)
        if (existing) {
          if (existing.status === 'approved') {
            const txn = buildPrintTxn(booking, locationId, items)
            await logPrint({
              documentId: booking.id,
              source: 'booking',
              printedBy: actor.id,
              printedByName: actor.name,
              printedByRole: actor.role,
              customerName: booking.userDisplayName || 'Guest',
              customerPhone: booking.userPhone,
              amount: booking.finalAmount,
              locationId,
            })
            await printTransactionReceipt(txn)
            await completeReprint(existing.id)
            return 'printed'
          }
          // Already pending — return so popup can show status
          return 'already_pending'
        }

        // No existing request — send one and return so popup shows
        await requestReprintApproval({
          transactionId: booking.id,
          invoiceNumber: booking.id,
          customerName: booking.userDisplayName || 'Guest',
          customerPhone: booking.userPhone,
          amount: booking.finalAmount,
          locationId,
          requestedBy: actor.id,
          requestedByName: actor.name,
          requestedByRole: actor.role,
        })
        return 'approval_sent'
      }

      // Owner: confirm and proceed
      const proceed = window.confirm(
        `This ticket has been printed ${printCount} time(s) before.\n\nThis reprint will be logged.\n\nContinue?`,
      )
      if (!proceed) return 'blocked'
    }
  } catch {
    /* non-critical — don't block first-time printing */
  }

  // First print OR Owner-approved reprint: log AFTER printing
  const txn = buildPrintTxn(booking, locationId, items)
  await printTransactionReceipt(txn)
  try {
    await logPrint({
      documentId: booking.id,
      source: 'booking',
      printedBy: actor.id,
      printedByName: actor.name,
      printedByRole: actor.role,
      customerName: booking.userDisplayName || 'Guest',
      customerPhone: booking.userPhone,
      amount: booking.finalAmount,
      locationId,
    })
  } catch {
    /* non-critical */
  }
  return 'printed'
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reprint Approval Popup
// ═══════════════════════════════════════════════════════════════════════════════
interface ReprintPopupProps {
  open: boolean
  booking: AsquareBooking | null
  printCount: number
  actor: { id: string; name: string; role: string }
  onClose: () => void
}

const ReprintApprovalPopup = ({ open, booking, printCount, actor, onClose }: ReprintPopupProps) => {
  const [approval, setApproval] = useState<ReprintApprovalRecord | null>(null)
  const [sending, setSending] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Subscribe to this user's reprint approvals for real-time status
  useEffect(() => {
    if (!open || !booking) return
    const unsub = subscribeUserReprintApprovals(
      actor.id,
      (rows) => {
        const match = rows.find(
          (r) =>
            r.transactionId === booking.id && (r.status === 'pending' || r.status === 'approved'),
        )
        setApproval(match ?? null)
        if (match) setSent(true)
      },
      () => {},
    )
    return unsub
  }, [open, booking, actor.id])

  // Reset state when popup closes
  useEffect(() => {
    if (!open) {
      setApproval(null)
      setSending(false)
      setPrinting(false)
      setSent(false)
      setError(null)
    }
  }, [open])

  const handleRequestApproval = async () => {
    if (!booking) return
    setSending(true)
    setError(null)
    try {
      await requestReprintApproval({
        transactionId: booking.id,
        invoiceNumber: booking.id,
        customerName: booking.userDisplayName || 'Guest',
        customerPhone: booking.userPhone,
        amount: booking.finalAmount,
        locationId: slugToBranchId(booking.locationId ?? ''),
        requestedBy: actor.id,
        requestedByName: actor.name,
        requestedByRole: actor.role,
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send request.')
    } finally {
      setSending(false)
    }
  }

  const handlePrintApproved = async () => {
    if (!booking || !approval) return
    setPrinting(true)
    try {
      await completeReprint(approval.id)
      await handlePrintTicket(booking, actor)
      onClose()
    } catch {
      setError('Failed to print. Please try again.')
    } finally {
      setPrinting(false)
    }
  }

  const status = approval?.status
  const isApproved = status === 'approved'
  const isPending = status === 'pending'

  return (
    <ModalShell open={open} onClose={onClose}>
      <div className="p-5">
        <h3 className="text-lg font-semibold text-text mb-1">Reprint Required</h3>
        <p className="text-sm text-muted mb-4">
          This ticket has already been printed{' '}
          <span className="font-semibold text-warning">
            {printCount} time{printCount > 1 ? 's' : ''}
          </span>
          . Owner approval is required to reprint.
        </p>

        {booking && (
          <div className="rounded-lg border border-border/50 bg-surface/50 p-3 mb-4 text-sm space-y-1">
            <p className="font-medium text-text">{booking.userDisplayName || 'Guest'}</p>
            <p className="text-muted font-mono text-xs">{booking.id}</p>
            <p className="text-muted">{fmtCurrency(booking.finalAmount)}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical mb-4">
            {error}
          </div>
        )}

        {/* Status display */}
        {isPending && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 mb-4 flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-warning animate-pulse shrink-0" />
            <div>
              <p className="text-sm font-semibold text-warning">Waiting for Owner Approval</p>
              <p className="text-xs text-warning/80">
                Request sent. This will update automatically when approved.
              </p>
            </div>
          </div>
        )}

        {isApproved && (
          <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 mb-4 flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-success shrink-0" />
            <div>
              <p className="text-sm font-semibold text-success">Approved</p>
              <p className="text-xs text-success/80">
                Approved by {approval?.reviewedByName || 'Owner'}. You can now print.
              </p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
          >
            {isApproved ? 'Cancel' : 'Close'}
          </button>

          {!sent && !isPending && !isApproved && (
            <button
              type="button"
              onClick={() => void handleRequestApproval()}
              disabled={sending}
              className="ui-btn ui-btn-warning min-h-10 px-5 text-sm"
            >
              {sending ? 'Sending...' : 'Request Approval'}
            </button>
          )}

          {isApproved && (
            <button
              type="button"
              onClick={() => void handlePrintApproved()}
              disabled={printing}
              className="ui-btn ui-btn-primary min-h-10 px-5 text-sm"
            >
              {printing ? 'Printing...' : 'Print Ticket'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ticket Search Section
// ═══════════════════════════════════════════════════════════════════════════════
const TicketSearchSection = ({ actor }: { actor: { id: string; name: string; role: string } }) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<AsquareBooking[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [printing, setPrinting] = useState<string | null>(null)
  const [myReprintRequests, setMyReprintRequests] = useState<ReprintApprovalRecord[]>([])

  // Subscribe to this cashier's reprint approval requests in real-time
  useEffect(() => {
    if (actor.role === 'Owner' || !actor.id) return
    const unsub = subscribeUserReprintApprovals(
      actor.id,
      (rows) => setMyReprintRequests(rows),
      (err) => logger.error('cashier_dashboard.my_reprint_requests_error', err),
    )
    return unsub
  }, [actor.id, actor.role])

  // Helper: find pending/approved reprint request for a booking
  const getRequestForBooking = (bookingId: string): ReprintApprovalRecord | undefined =>
    myReprintRequests.find((r) => r.transactionId === bookingId)

  // Reprint approval popup state
  const [reprintPopup, setReprintPopup] = useState<{
    booking: AsquareBooking
    printCount: number
  } | null>(null)

  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    setSearched(false)
    try {
      const all = await asquareBookingsApi.listAdminBookings()
      const lower = q.toLowerCase()
      const digitsOnly = q.replace(/\D/g, '')
      const isDateQuery = /^\d{4}-\d{2}-\d{2}$/.test(q) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(q)

      const matched = all.filter((b) => {
        if (b.id.toLowerCase().includes(lower)) return true
        if (digitsOnly.length >= 4 && (b.userPhone ?? '').includes(digitsOnly)) return true
        if ((b.userDisplayName ?? '').toLowerCase().includes(lower)) return true
        const email = String(
          (b as Record<string, unknown>).email ??
            (b as Record<string, unknown>).customerEmail ??
            '',
        )
        if (email.toLowerCase().includes(lower)) return true
        if (isDateQuery) {
          const bookingDate = fmtDate(new Date(b.sessionDate))
          let normalizedQuery = q
          const ddmmyyyy = q.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
          if (ddmmyyyy)
            normalizedQuery = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
          if (bookingDate === normalizedQuery) return true
        }
        return false
      })

      setResults(matched.slice(0, 20))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  const onPrint = async (b: AsquareBooking) => {
    if (b.paymentStatus !== 'completed') return
    setPrinting(b.id)
    try {
      const approvedReq = getRequestForBooking(b.id)
      const result = await handlePrintTicket(b, actor, approvedReq)
      // Show popup for non-Owner reprint flows
      if (actor.role !== 'Owner' && (result === 'approval_sent' || result === 'already_pending')) {
        const { printCount } = await checkPrintCount(b.id, 'booking').catch(() => ({
          isReprint: true,
          printCount: 1,
        }))
        setReprintPopup({ booking: b, printCount })
      }
    } catch {
      /* non-critical */
    } finally {
      setPrinting(null)
    }
  }

  // Determine button label and style for a booking
  const getButtonState = (b: AsquareBooking) => {
    if (b.paymentStatus !== 'completed')
      return {
        label: 'Pending',
        disabled: true,
        className: 'opacity-50 cursor-not-allowed bg-muted/20 text-muted',
      }
    const req = getRequestForBooking(b.id)
    if (req?.status === 'approved')
      return { label: 'Print Ticket', disabled: false, className: 'ui-btn-success' }
    if (req?.status === 'pending')
      return {
        label: 'Pending Approval...',
        disabled: true,
        className: 'opacity-60 bg-warning/20 text-warning border border-warning/30',
      }
    return { label: 'Print Ticket', disabled: false, className: 'ui-btn-primary' }
  }

  return (
    <article className="ui-panel p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="font-display text-xl tracking-tight text-text">Ticket Search & Print</h2>
        <StatusBadge tone="info">Quick Lookup</StatusBadge>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSearch()
        }}
        className="flex gap-2 mb-4"
      >
        <input
          type="text"
          className="ui-field min-h-12 flex-1 text-base text-white"
          placeholder="Phone, Name, Transaction ID, Email, or Date (DD/MM/YYYY)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          type="submit"
          className="ui-btn ui-btn-primary min-h-12 px-6 text-base"
          disabled={searching || !searchQuery.trim()}
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {searched && results.length === 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-warning">
          No bookings found for &quot;{searchQuery}&quot;
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {results.length} result{results.length > 1 ? 's' : ''}
          </p>
          {results.map((b) => {
            const btn = getButtonState(b)
            return (
              <div
                key={b.id}
                className="rounded-xl border border-border/60 bg-surface p-4 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-text">{b.id}</span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        b.paymentStatus === 'completed'
                          ? 'bg-success/20 text-success'
                          : b.paymentStatus === 'failed'
                            ? 'bg-critical/20 text-critical'
                            : 'bg-warning/20 text-warning'
                      }`}
                    >
                      {b.paymentStatus}
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase">
                      {getLocationDisplayName(b.locationId) || b.locationId}
                    </span>
                  </div>
                  <p className="text-sm text-text font-medium">
                    {b.userDisplayName ||
                      ((b as Record<string, unknown>).customerName as string) ||
                      'Guest'}
                    <span className="text-muted font-normal">
                      {' '}
                      &middot;{' '}
                      {b.userPhone ||
                        ((b as Record<string, unknown>).customerPhone as string) ||
                        'No phone'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {(b.items || [])
                      .map((item) =>
                        formatActivityDisplay(item.activity ?? { name: 'Activity' }, item.quantity),
                      )
                      .join(', ') || 'POS Transaction'}
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    <span>Date: {fmtDateIST(b.sessionDate)}</span>
                    <span>
                      Amount:{' '}
                      {fmtCurrency(
                        b.finalAmount ||
                          ((b as Record<string, unknown>).totalAmount as number) ||
                          0,
                      )}
                    </span>
                    <span>Method: {b.paymentMethod || 'N/A'}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void onPrint(b)}
                    disabled={btn.disabled || printing === b.id}
                    className={`ui-btn min-h-10 whitespace-nowrap px-5 text-sm ${btn.className}`}
                  >
                    {printing === b.id ? 'Printing...' : btn.label}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Reprint Approval Popup */}
      <ReprintApprovalPopup
        open={reprintPopup !== null}
        booking={reprintPopup?.booking ?? null}
        printCount={reprintPopup?.printCount ?? 0}
        actor={actor}
        onClose={() => setReprintPopup(null)}
      />
    </article>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main: CashierDashboard
// ═══════════════════════════════════════════════════════════════════════════════
const CashierDashboard = () => {
  const role = 'Cashier' as const
  const { session, logout } = useAuth()
  const { mode, cycleMode } = useTheme()
  const { isRestricted, allowedSlugs } = useLocations()
  const navigate = useNavigate()
  const ticketRef = useRef<HTMLDivElement>(null)

  const [_state, setState] = useState<DashboardWidgetState>('loading')
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [_error, setError] = useState<string | null>(null)

  const config = getRoleConfig(role)

  useEffect(() => {
    if (!session || session.user.role !== role) return
    let cancelled = false
    const cacheKey = `pipeline:dashboard-cache:${role}`
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const cached = JSON.parse(raw) as { data: DashboardSnapshot; cachedAt: number }
        if (Date.now() - cached.cachedAt < 5 * 60 * 1000) {
          setSnapshot(cached.data)
          setState(cached.data.activity.length === 0 ? 'empty' : 'ready')
        }
      }
    } catch {
      /* ignore */
    }

    const run = async () => {
      if (!snapshot) setState('loading')
      setError(null)
      try {
        const next = await loadDashboardData({
          role,
          token: session.token,
          userId: session.user.id,
          allowedSlugs: isRestricted ? allowedSlugs : undefined,
        })
        if (cancelled) return
        setSnapshot(next)
        setState(next.activity.length === 0 ? 'empty' : 'ready')
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ data: next, cachedAt: Date.now() }))
        } catch {
          /* */
        }
      } catch (err) {
        if (!cancelled && !snapshot) {
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
  }, [role, session, isRestricted, allowedSlugs])

  if (!session) return <Navigate replace to="/login" />
  if (session.user.role !== role) return <Navigate replace to={rolePathMap[session.user.role]} />

  const moduleNav = getTabsForRole(role).map((tab) => ({ label: tab.label, href: tab.path }))
  const mobileShortcuts = getRoleMobileShortcuts(role)
  const quickFabHref = resolveRoleActionRoute(role, config.quickFabAction.id)
  const actor = { id: session.user.id, name: session.user.name, role: session.user.role }

  const routeAction = (actionId: string) => {
    const targetPath = resolveRoleActionRoute(role, actionId)
    if (isPathAllowedForRole(role, targetPath)) {
      navigate(targetPath)
    }
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
        {/* Action Cards */}
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
          {config.primaryActions.map((action) => (
            <ActionCard
              key={action.id}
              label={action.label}
              description={action.description}
              hotkey={action.hotkey}
              tone={action.tone ?? 'info'}
              to={resolveRoleActionRoute(role, action.id)}
              onClick={() => routeAction(action.id)}
            />
          ))}
        </section>

        {/* Ticket Search & Print */}
        <div ref={ticketRef}>
          <TicketSearchSection actor={actor} />
        </div>
      </div>
    </AppShell>
  )
}

export default CashierDashboard

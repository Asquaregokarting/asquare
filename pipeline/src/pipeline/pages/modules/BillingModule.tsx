import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { listBranchActivityCatalog } from '../../api/activity-catalog-firestore'
import { billingApi } from '../../api/billing'
import {
  ActivityCatalogRecord,
  HelicopterActivityRecord,
  HelicopterPaymentRecord,
  TransactionRecord,
} from '../../api/types'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { useAuth } from '../../features/auth/auth-context'
import { BillingConfirmation } from '../../features/billing/BillingConfirmation'
import { ProtocolAwaitingApproval } from '../../features/billing/ProtocolAwaitingApproval'
import { printTransactionReceipt } from '../../features/billing/generateBillingReceipt'
import {
  logPrint,
  listPrintLogs,
  deletePrintLogEntry,
  adjustPrintCount,
  checkPrintCount,
  type PrintLogEntry,
} from '../../api/print-log'
import {
  subscribeProtocolBookingStatus,
  subscribeOfferBookingStatus,
} from '../../api/asquare-bookings'
// feature-highlights and NewBadge removed — "Special" toggle no longer uses NewBadge
import {
  CouponValidationResult,
  validateCouponForCart,
} from '../../features/billing/validateCoupon'
import {
  lookupMemberByPhone,
  ensureMember150CouponCodes,
  MemberRecord,
  MemberCouponCode,
} from '../../api/asquare-members'
import { lookupCustomerByPhone, AsquareCustomer } from '../../api/asquare-customers'
import { logger } from '../../../lib/logger'
import { listCombos } from '../../features/combos/combo-firestore'
import type { ComboRecord } from '../../features/combos/combo-types'
import { listEventCampaignsForPos } from '../../features/event-campaigns/event-campaigns-firestore'
import type {
  EventCampaignRecord,
  EventPackage,
  EventPackageItem,
} from '../../features/event-campaigns/event-campaign-types'
import {
  calculatePackageTotal,
  computePackageDiscount,
  type PackageDiscountLine,
  type PackageDiscountResult,
} from '../../features/event-campaigns/event-pricing'
import { shiftsApi, type ShiftRecord } from '../../api/shifts'
import { getLatestActiveShiftForUser } from '../../api/shifts-firestore'
import {
  KartReportRecord,
  subscribeKartReport,
} from '../../features/track/services/kartReportService'
import {
  buildTrackTaskBlockMessage,
  subscribeTrackEndOfDayStatus,
  type TrackEndOfDayStatus,
} from '../../features/track/services/trackEndOfDayStatus'
import { getLocationDayTotals } from '../../api/billing-firestore'
import {
  requestReprintApproval,
  approveReprint,
  rejectReprint,
  subscribePendingReprintApprovals,
  subscribeUserReprintApprovals,
  completeReprint,
} from '../../api/reprint-approvals'
import {
  requestRefundApproval,
  approveAndExecuteRefund,
  rejectRefund,
  subscribePendingRefundApprovals,
  subscribeUserRefundApprovals,
} from '../../api/refund-approvals'
import {
  requestKartReportBypass,
  cancelKartReportBypass,
  subscribeKartReportBypassRequest,
} from '../../api/kart-report-bypass'
import type {
  ReprintApprovalRecord,
  RefundApprovalRecord,
  KartReportBypassRequest,
} from '../../api/types'
import { useLocations } from '../../hooks/useLocations'
import { getLocationDisplayName, slugToBranchId } from '../../../lib/locations'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { initializeFirestore } from '../../lib/firebase'
import { loadRazorpaySDK } from '../../../services/razorpayService'
import { todayIST, toISTDateStr } from '../../lib/ist-date'
import { getWeeklyGameReport, listWeeklyGameReports } from '../../api/incentives-firestore'
import { getCurrentWeekKey } from '../../features/cashier-incentives/week-utils'
import { aggregateDayReport } from '../../features/billing/checkout-day-report'
import { printDayReport } from '../../features/billing/generateDayReport'
import { fmtDateTimeFullIST, fmtDateIST, fmtTimeShortIST } from '../../../lib/date-format'

export type BillingView =
  | 'pos'
  | 'transactions'
  | 'invoice'
  | 'reprint'
  | 'refunds'
  | 'revenue'
  | 'report'
  | 'helicopter'
  | 'printlogs'

const subnav = [
  { label: 'POS', to: '/billing/pos' },
  { label: 'Transactions', to: '/billing/transactions' },
  { label: 'Reprint', to: '/billing/reprint' },
  { label: 'Refunds', to: '/billing/refunds' },
  { label: 'Revenue', to: '/billing/revenue' },
  { label: 'Report', to: '/billing/report' },
  { label: 'Helicopter', to: '/billing/helicopter' },
  { label: 'Print Logs', to: '/billing/printlogs' },
]

const titleMap: Record<BillingView, string> = {
  pos: 'POS — Point of Sale',
  transactions: 'Transactions',
  invoice: 'Invoice Detail',
  reprint: 'Reprint Receipts',
  refunds: 'Refund Processing',
  revenue: 'Revenue Analytics',
  report: 'Cashier Report',
  helicopter: 'Helicopter Bookings',
  printlogs: 'Print Logs',
}

const subtitleMap: Record<BillingView, string> = {
  pos: 'Select activities, build a cart, and process payments in seconds.',
  transactions: 'Review transaction history and payment mix.',
  invoice: 'Inspect full invoice details.',
  reprint: 'Request and manage receipt reprints with approval tracking.',
  refunds: 'Issue partial or full refunds with reason tracking.',
  revenue: 'Daily revenue and method-wise breakdown.',
  report: 'Daily payment summary for shift settlement.',
  helicopter: 'Send helicopter payment links and manage activity catalog.',
  printlogs: 'Audit every ticket/receipt print and reprint event.',
}

const currency = (amount: number) => `INR ${Math.round(amount).toLocaleString('en-IN')}`

/** Returns `YYYY-MM-DD` for today in IST (used as date filter default). */
const todayDateString = todayIST

// ─── Cart Types ────────────────────────────────────────────────────────────────
interface ComboItemBreakdown {
  activityId: string
  itemName: string
  adjustedPrice: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
}

interface CartItem {
  key: string
  activityId: string
  itemName: string
  unitPrice: number
  quantity: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  vendorBranchId?: string
  isCombo?: boolean
  comboId?: string
  comboItems?: ComboItemBreakdown[]
  isEventPackage?: boolean
  eventPackageRef?: {
    campaignId: string
    packageId: string
    title: string
  }
  eventPackageItems?: EventPackageItem[]
  printIndividualTokens?: boolean
}

// ─── POS Panel ────────────────────────────────────────────────────────────────
const GST_PERCENT = 18

const REPEAT_STORAGE_PREFIX = 'pos-last-transaction:'

const POSPanel = ({ token, onSuccess }: { token: string; onSuccess: () => void }) => {
  const { session } = useAuth()
  const repeatStorageKey = `${REPEAT_STORAGE_PREFIX}${session?.user.id ?? 'anon'}`
  const { enabledLocations, allowedSlugs, lockedLocationId, isRoleLocked } = useLocations()
  // Seed the cashier's branch from their identity, NOT from a globally-sorted
  // location list. Order of preference:
  //   1. lockedLocationId — exact branch from their `allowedLocations` (single)
  //   2. allowedSlugs[0]  — first branch they're permitted to use
  //   3. enabledLocations[0].slug — fallback to whatever loaded first
  //   4. literal 'visakhapatnam' — last-resort if nothing has loaded yet
  // Without this, a Rajahmundry cashier whose user record is missing
  // `allowedLocations` would default to Vizag (branchId 0 → first in the
  // bundled fallback list) and bill against the wrong branch.
  const [locationKey, setLocationKey] = useState(
    () => lockedLocationId ?? allowedSlugs[0] ?? enabledLocations[0]?.slug ?? 'visakhapatnam',
  )
  const [posTab, setPosTab] = useState<'activities' | 'events'>('activities')
  const [eventsForPos, setEventsForPos] = useState<EventCampaignRecord[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [activities, setActivities] = useState<ActivityCatalogRecord[]>([])
  const [combos, setCombos] = useState<ComboRecord[]>([])
  const [gamePopularity, setGamePopularity] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [couponResult, setCouponResult] = useState<CouponValidationResult | null>(null)
  const [validatingCoupon, setValidatingCoupon] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<
    'Cash' | 'Card' | 'UPI' | 'Razorpay' | 'Split'
  >('UPI')
  const [splitCash, setSplitCash] = useState('')
  const [splitUpi, setSplitUpi] = useState('')
  const [splitCard, setSplitCard] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry guard. The `submitting` state above is async — a
  // fast second click can land before React schedules the disabled prop
  // update. inFlightSubmitRef rejects the re-entry on the same tick.
  const inFlightSubmitRef = useRef(false)
  // Idempotency token. Generated lazily on first submit attempt for a given
  // sale, kept across retries (so the server dedups on retry), cleared on
  // successful write so the next sale gets a fresh token.
  const clientRequestIdRef = useRef<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
  // `completedTransaction` is session-only and drives the BillingConfirmation
  // modal. It MUST NOT rehydrate from localStorage on mount — doing so makes
  // the confirmation popup reappear every time the page reloads, showing the
  // previous session's booking.
  const [completedTransaction, setCompletedTransactionRaw] = useState<TransactionRecord | null>(
    null,
  )
  // `lastRepeatableTransaction` is persisted across reloads via localStorage
  // and powers the "Repeat" button only. It's set alongside
  // `completedTransaction` whenever a booking completes, but is NOT cleared
  // when the confirmation modal is dismissed.
  const [lastRepeatableTransaction, setLastRepeatableTransaction] =
    useState<TransactionRecord | null>(null)
  const setCompletedTransaction = useCallback(
    (txn: TransactionRecord | null) => {
      setCompletedTransactionRaw(txn)
      if (txn) {
        setLastRepeatableTransaction(txn)
        try {
          localStorage.setItem(repeatStorageKey, JSON.stringify(txn))
        } catch {
          /* quota */
        }
      }
    },
    [repeatStorageKey],
  )
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [audienceFilter, setAudienceFilter] = useState<'Adult-Navy' | 'Child-Navy' | null>(null)
  const billingDate = todayIST()
  const [pendingPaymentTxn, setPendingPaymentTxn] = useState<TransactionRecord | null>(null)
  const [paymentCountdown, setPaymentCountdown] = useState(0)
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const [, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [rzpOrderCache, setRzpOrderCache] = useState<{
    orderId: string
    amount: number
    key: string
    customerName: string
    customerPhone: string
  } | null>(null)
  const [memberData, setMemberData] = useState<MemberRecord | null>(null)
  const [customerData, setCustomerData] = useState<AsquareCustomer | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberCouponCodes, setMemberCouponCodes] = useState<MemberCouponCode[]>([])
  const [showCouponCodes, setShowCouponCodes] = useState(false)
  // Redeem wallet balance at checkout. When the looked-up customer has a
  // positive wallet balance, the cashier can tick this box to apply it
  // against the cart total. Actual debit happens atomically inside
  // createUnifiedBooking → deductCustomerWallet.
  const [redeemWallet, setRedeemWallet] = useState(false)
  // POS mode: "normal" (standard billing) vs "restricted" (protocol/offers)
  const [posMode, setPosMode] = useState<'normal' | 'restricted'>('normal')
  const [restrictedNotification, setRestrictedNotification] = useState<
    'approved' | 'rejected' | null
  >(null)
  const [isProtocol, setIsProtocol] = useState(false)
  const [protocolReason, setProtocolReason] = useState('')
  const [protocolRequestReady, setProtocolRequestReady] = useState(false)
  const [protocolSubmittedBooking, setProtocolSubmittedBooking] = useState<{
    id: string
    customerName: string
    reason: string
  } | null>(null)
  const [protocolApprovalStatus, setProtocolApprovalStatus] = useState<
    'pending' | 'approved' | 'rejected'
  >('pending')
  const [protocolRejectReason, setProtocolRejectReason] = useState('')
  const [protocolApprovedBy, setProtocolApprovedBy] = useState<string | undefined>()
  const [protocolApprovedTransaction, setProtocolApprovedTransaction] =
    useState<TransactionRecord | null>(null)
  // Offer mode state
  const [isOffer, setIsOffer] = useState(false)
  const [offerReason, setOfferReason] = useState('')
  const [offerRequestReady, setOfferRequestReady] = useState(false)
  const [offerSubmittedBooking, setOfferSubmittedBooking] = useState<{
    id: string
    customerName: string
    reason: string
  } | null>(null)
  const [offerApprovalStatus, setOfferApprovalStatus] = useState<
    'pending' | 'approved' | 'rejected'
  >('pending')
  const [offerRejectReason, setOfferRejectReason] = useState('')
  const [offerApprovedBy, setOfferApprovedBy] = useState<string | undefined>()
  const [offerApprovedTransaction, setOfferApprovedTransaction] =
    useState<TransactionRecord | null>(null)
  // Incentive highlighting: non-performing variants for the current week
  const [nonPerformingKeys, setNonPerformingKeys] = useState<Set<string>>(() => new Set())

  // UPI UTR last-4-digits prompt
  const [utrPendingTxn, setUtrPendingTxn] = useState<TransactionRecord | null>(null)
  const [utrDigits, setUtrDigits] = useState('')
  const [utrSaving, setUtrSaving] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nameAutoFilledRef = useRef(false)

  // Per-mode saved state for seamless switching
  const savedNormalState = useRef<{
    cart: CartItem[]
    customerName: string
    customerPhone: string
    couponCode: string
    categoryFilter: string
  } | null>(null)
  const savedRestrictedState = useRef<{
    cart: CartItem[]
    customerName: string
    customerPhone: string
    couponCode: string
    categoryFilter: string
    isProtocol: boolean
    isOffer: boolean
    protocolReason: string
    protocolRequestReady: boolean
    offerReason: string
    offerRequestReady: boolean
  } | null>(null)

  // ── Cashier Shift Control ──
  const isCashier = session?.user.role === 'Cashier'
  const [shiftActive, setShiftActive] = useState(false)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftRecord, setShiftRecord] = useState<ShiftRecord | null>(null)
  // Kart-report preflight: cashier check-in is blocked until today's report
  // is submitted for the selected location.
  const [todaysKartReport, setTodaysKartReport] = useState<KartReportRecord | null>(null)
  const KART_REPORT_BLOCK_MSG =
    "Kart update was not completed. Please wait for Track Marshall to submit today's kart report."
  // Track Marshall end-of-day preflight: cashier checkout is blocked until
  // today's deep clean is done AND all 5 end-shift verification photos are
  // uploaded for this location.
  const [trackEodStatus, setTrackEodStatus] = useState<TrackEndOfDayStatus | null>(null)
  // Click-time warning for the TM-tasks gate. Only set when the cashier
  // clicks Confirm Check Out with valid amounts but TM tasks are still
  // incomplete. Auto-clears when TM completes (subscription updates).
  const [trackTaskWarning, setTrackTaskWarning] = useState<string | null>(null)
  const [showSettlement, setShowSettlement] = useState(false)
  const [settlementCash, setSettlementCash] = useState('')
  const [settlementCard, setSettlementCard] = useState('')
  const [settlementUpi, setSettlementUpi] = useState('')
  const [settlementActuals, setSettlementActuals] = useState<{
    Cash: number
    Card: number
    UPI: number
    count: number
  } | null>(null)
  const [settlementLoading, setSettlementLoading] = useState(false)
  const [settlementError, setSettlementError] = useState<string | null>(null)
  const [settlementFetchFailed, setSettlementFetchFailed] = useState(false)
  const [checkoutComplete, setCheckoutComplete] = useState(false)
  const [checkoutLocationId, setCheckoutLocationId] = useState('')
  // The shift-day the settlement modal is computing totals for. Derived
  // from the active shift's startTime (IST date) so a cashier who got
  // stuck before today's checkout can still settle that earlier day's
  // till instead of seeing today's empty totals. Captured at checkout
  // time too so the post-settlement "Print Day Report" pulls the right
  // day's transactions even after shiftRecord has been cleared.
  const [checkoutDate, setCheckoutDate] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const billingEnabled = !isCashier || shiftActive

  const stopPaymentPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setQrImageUrl(null)
    setQrLoading(false)
    setQrError(null)
  }, [])

  const startPaymentPolling = useCallback(
    (txn: TransactionRecord) => {
      setPendingPaymentTxn(txn)
      setPaymentCountdown(180)

      countdownRef.current = setInterval(() => {
        setPaymentCountdown((prev) => {
          if (prev <= 1) {
            // Time's up — auto-fail
            stopPaymentPolling()
            void billingApi
              .updateTransactionPaymentStatus(txn.id, { paymentStatus: 'failed' })
              .catch(() => {})
            setPendingPaymentTxn(null)
            setSubmitError('Payment not confirmed within 3 minutes. Transaction marked as failed.')
            return 0
          }
          return prev - 1
        })
      }, 1000)

      pollRef.current = setInterval(async () => {
        try {
          const result = await billingApi.getTransaction(token, txn.id)
          if (result.transaction.paymentStatus === 'completed') {
            stopPaymentPolling()
            setPendingPaymentTxn(null)
            setCompletedTransaction(result.transaction)
            void handlePrintReceipt(result.transaction)
          }
        } catch {
          /* ignore poll errors */
        }
      }, 10000)
    },
    [token, stopPaymentPolling],
  )

  // Cleanup on unmount
  useEffect(() => () => stopPaymentPolling(), [stopPaymentPolling])

  // ── Restore active shift on mount (Cashier only) ──
  useEffect(() => {
    if (!isCashier || !session?.user.id) return
    let cancelled = false
    setShiftLoading(true)
    getLatestActiveShiftForUser(session.user.id)
      .then((result) => {
        if (cancelled) return
        if (result) {
          setShiftActive(true)
          setShiftRecord(result.shift)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setShiftLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isCashier, session?.user.id])

  // ── Kart report preflight (Cashier only) ──
  // Subscribes to today's kart report for the cashier's selected location.
  // If no submitted report exists, Check In is blocked with a visible message.
  useEffect(() => {
    if (!isCashier || !locationKey) {
      setTodaysKartReport(null)
      return
    }
    const unsubscribe = subscribeKartReport(
      locationKey,
      todayIST(),
      (record) => setTodaysKartReport(record),
      () => setTodaysKartReport(null),
    )
    return () => unsubscribe()
  }, [isCashier, locationKey])

  // Session-local override for the Track-Marshall kart-report preflight.
  // Granted ONLY after Owner approval on the corresponding
  // KartReportBypassRequest doc — never set by the cashier alone. Resets
  // on full reload; the approval event is the durable audit trail.
  const [kartReportOverride, setKartReportOverride] = useState(false)
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [bypassSubmitting, setBypassSubmitting] = useState(false)
  const [bypassError, setBypassError] = useState<string | null>(null)
  // The active bypass request being watched. null while typing the reason,
  // populated after submit and live-updated via subscribeKartReportBypassRequest.
  const [activeBypass, setActiveBypass] = useState<KartReportBypassRequest | null>(null)
  const cashierBlocked =
    isCashier &&
    (!todaysKartReport || todaysKartReport.status !== 'submitted') &&
    !kartReportOverride

  const handleKartReportOverride = () => {
    setOverrideReason('')
    setBypassError(null)
    setActiveBypass(null)
    setShowOverrideModal(true)
  }

  // Submit the cashier's bypass request. Creates a pending doc in
  // `kartReportBypassRequests` and flips the popup to the pending state.
  // Owner approval is required before kartReportOverride is granted
  // (handled by the subscription effect below).
  const submitBypassRequest = async () => {
    const reason = overrideReason.trim()
    if (!reason || !session?.user.id) return
    setBypassSubmitting(true)
    setBypassError(null)
    try {
      const id = await requestKartReportBypass({
        locationId: locationKey,
        requestedBy: session.user.id,
        requestedByName: session.user.name ?? '',
        requestedByRole: session.user.role ?? '',
        reason,
      })
      logger.info('cashier.kart_report_bypass_requested', {
        requestId: id,
        locationId: locationKey,
      })
      // Seed the local record so the UI flips immediately; the subscription
      // below will replace this with the real Firestore doc and react to
      // any status change.
      setActiveBypass({
        id,
        locationId: locationKey,
        requestedBy: session.user.id,
        requestedByName: session.user.name ?? '',
        requestedByRole: session.user.role ?? '',
        requestedAt: new Date().toISOString(),
        reason,
        status: 'pending',
      })
    } catch (err) {
      logger.error('cashier.kart_report_bypass_request_failed', err)
      setBypassError(err instanceof Error ? err.message : 'Could not send the request.')
    } finally {
      setBypassSubmitting(false)
    }
  }

  // Cashier cancels their own pending request. Marks the doc 'cancelled'
  // so the Owner queue clears it, then closes the popup.
  const cancelBypassRequest = async () => {
    if (activeBypass?.status === 'pending') {
      try {
        await cancelKartReportBypass(activeBypass.id)
      } catch (err) {
        logger.warn('cashier.kart_report_bypass_cancel_failed', { error: err })
      }
    }
    setShowOverrideModal(false)
    setActiveBypass(null)
    setOverrideReason('')
    setBypassError(null)
  }

  // Close popup from a terminal state (rejected). No request to cancel.
  const closeBypassPopup = () => {
    setShowOverrideModal(false)
    setActiveBypass(null)
    setOverrideReason('')
    setBypassError(null)
  }

  // Reset to the form so the cashier can amend the reason and try again
  // after a rejection. Keeps the typed reason in the textarea.
  const retryBypassRequest = () => {
    setActiveBypass(null)
    setBypassError(null)
  }

  // Live subscription on the active bypass doc. When the Owner approves
  // we grant the session-local override and auto-close the popup. When
  // they reject, the popup flips to the rejected state with their note.
  useEffect(() => {
    if (!activeBypass?.id) return
    const unsub = subscribeKartReportBypassRequest(
      activeBypass.id,
      (record) => {
        if (!record) return
        setActiveBypass(record)
        if (record.status === 'approved') {
          logger.warn('cashier.kart_report_bypass_approved', {
            requestId: record.id,
            requestedBy: record.requestedBy,
            requestedByName: record.requestedByName,
            reviewedBy: record.reviewedBy ?? '',
            reviewedByName: record.reviewedByName ?? '',
            locationId: record.locationId,
            reason: record.reason,
          })
          setKartReportOverride(true)
          setSubmitError(null)
          window.setTimeout(() => {
            setShowOverrideModal(false)
            setActiveBypass(null)
            setOverrideReason('')
            setBypassError(null)
          }, 1400)
        }
      },
      (err) => {
        logger.error('cashier.kart_report_bypass_subscribe_failed', err)
        setBypassError('Lost connection. Refresh and try again.')
      },
    )
    return unsub
  }, [activeBypass?.id])

  // ── Track Marshall end-of-day preflight (Cashier only) ──
  // Subscribes to today's deep clean assignment + scanner shift end-photos
  // for this cashier's location while the cashier is checked in. Used to
  // gate the Confirm Check Out button inside the settlement modal.
  useEffect(() => {
    if (!isCashier || !shiftActive) {
      setTrackEodStatus(null)
      return
    }
    const loc = shiftRecord?.locationId ?? locationKey
    if (!loc) {
      setTrackEodStatus(null)
      return
    }
    const unsubscribe = subscribeTrackEndOfDayStatus(
      loc,
      (status) => setTrackEodStatus(status),
      () =>
        setTrackEodStatus({
          deepCleanComplete: false,
          endShiftPhotosComplete: false,
        }),
    )
    return () => unsubscribe()
  }, [isCashier, shiftActive, shiftRecord?.locationId, locationKey])

  const trackEodBlockMessage = trackEodStatus
    ? buildTrackTaskBlockMessage(trackEodStatus)
    : 'Verifying Track Marshall task completion…'
  const trackEodBlocked = trackEodStatus === null || trackEodBlockMessage !== null

  // Auto-clear the click-time TM-tasks warning the moment the live
  // subscription reports both tasks complete. The cashier doesn't have
  // to dismiss anything — the banner just disappears.
  useEffect(() => {
    if (!trackEodBlocked && trackTaskWarning) {
      setTrackTaskWarning(null)
    }
  }, [trackEodBlocked, trackTaskWarning])

  const handleCheckIn = async () => {
    if (!token) return
    setSubmitError(null)
    if (cashierBlocked) {
      // Short-circuit BEFORE the server round-trip so the user always
      // gets immediate, visible feedback on click.
      setSubmitError(KART_REPORT_BLOCK_MSG)
      return
    }
    setShiftLoading(true)
    try {
      const { shift } = await shiftsApi.start(token, 'Cashier', locationKey)
      setShiftRecord(shift)
      setShiftActive(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to check in.')
    } finally {
      setShiftLoading(false)
    }
  }

  const openSettlement = async () => {
    setShowSettlement(true)
    setSettlementCash('')
    setSettlementCard('')
    setSettlementUpi('')
    setSettlementError(null)
    setSettlementFetchFailed(false)
    setTrackTaskWarning(null)
    setSettlementLoading(true)
    // Use the active shift's IST start-date — not "today" — so a cashier
    // who couldn't close on their actual shift day (e.g. blocked by the
    // 2026-05-11 online-bookings inflation bug) can still settle that
    // day's till when they log back in later. Falls back to today for
    // non-cashier roles or when no shift is active.
    const shiftDate = shiftRecord?.startTime
      ? toISTDateStr(new Date(shiftRecord.startTime))
      : todayDateString()
    try {
      const totals = await getLocationDayTotals(
        shiftRecord?.locationId ?? locationKey,
        shiftDate,
      )
      setSettlementActuals(totals)
    } catch (err) {
      logger.error('billing_module.settlement_fetch_totals_failed', err)
      setSettlementActuals({ Cash: 0, Card: 0, UPI: 0, count: 0 })
      setSettlementFetchFailed(true)
    } finally {
      setSettlementLoading(false)
    }
  }

  const handleCheckOut = async () => {
    if (!token || !settlementActuals) return
    setSettlementError(null)
    setTrackTaskWarning(null)
    if (trackEodBlocked) {
      // Show the click-time TM-tasks warning ONLY after the cashier has
      // entered valid amounts and clicked Confirm Check Out. The amber
      // banner that renders below uses this state — it auto-clears the
      // moment the live subscription reports tasks complete.
      setTrackTaskWarning(
        trackEodBlockMessage ??
          'Track Marshall task verification is still loading. Please retry in a moment.',
      )
      return
    }
    setSettlementLoading(true)
    try {
      const effectiveLocation = shiftRecord?.locationId ?? locationKey
      // Capture the settling shift's date BEFORE clearing shiftRecord so
      // the post-checkout "Print Day Report" button still pulls the
      // correct day's transactions. Mirrors the shiftDate derivation in
      // openSettlement.
      const effectiveDate = shiftRecord?.startTime
        ? toISTDateStr(new Date(shiftRecord.startTime))
        : todayDateString()
      const cashEntered = Number(settlementCash) || 0
      const cardEntered = Number(settlementCard) || 0
      const upiEntered = Number(settlementUpi) || 0
      const settlement = {
        cashEntered,
        cardEntered,
        upiEntered,
        cashActual: settlementFetchFailed ? cashEntered : settlementActuals.Cash,
        cardActual: settlementFetchFailed ? cardEntered : settlementActuals.Card,
        upiActual: settlementFetchFailed ? upiEntered : settlementActuals.UPI,
        settledAt: new Date().toISOString(),
        totalTransactions: settlementActuals.count,
        locationId: effectiveLocation,
      }
      await shiftsApi.endWithSettlement(token, settlement)
      setShiftActive(false)
      setShiftRecord(null)
      setCheckoutComplete(true)
      setCheckoutLocationId(effectiveLocation)
      setCheckoutDate(effectiveDate)
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      nameAutoFilledRef.current = false
      setCouponCode('')
      setCouponResult(null)
    } catch (err) {
      setSettlementError(err instanceof Error ? err.message : 'Failed to check out.')
    } finally {
      setSettlementLoading(false)
    }
  }

  const handlePrintDayReport = async () => {
    if (!checkoutLocationId) {
      window.alert('No location selected. Cannot generate report.')
      return
    }
    setReportLoading(true)
    try {
      // Use the shift's settled date (captured at checkout time) rather
      // than today — when a late checkout closes a prior day's shift the
      // printed report must show that prior day's transactions, not
      // today's empty bucket.
      const data = await aggregateDayReport(checkoutLocationId, checkoutDate || todayIST())
      if (data.transactionCount === 0) {
        window.alert('No completed transactions found for today at this location.')
        return
      }
      // Attach settlement data for excess/shortage calculation
      if (settlementActuals) {
        data.settlement = {
          cashEntered: Number(settlementCash) || 0,
          cardEntered: Number(settlementCard) || 0,
          upiEntered: Number(settlementUpi) || 0,
          cashActual: settlementActuals.Cash,
          cardActual: settlementActuals.Card,
          upiActual: settlementActuals.UPI,
        }
      }
      await printDayReport(data, session?.user.name, session?.token)
    } catch (err) {
      logger.error('billing_module.day_report_generation_failed', err)
      window.alert(
        err instanceof Error ? err.message : 'Failed to generate report. Please try again.',
      )
    } finally {
      setReportLoading(false)
    }
  }

  const handleCloseCheckoutSuccess = () => {
    setShowSettlement(false)
    setCheckoutComplete(false)
    setCheckoutLocationId('')
    setCheckoutDate('')
  }

  const cancelPendingPayment = useCallback(() => {
    if (!pendingPaymentTxn) return
    stopPaymentPolling()
    void billingApi
      .updateTransactionPaymentStatus(pendingPaymentTxn.id, { paymentStatus: 'failed' })
      .catch(() => {})
    setPendingPaymentTxn(null)
    setSubmitError('Payment cancelled. Transaction marked as failed.')
  }, [pendingPaymentTxn, stopPaymentPolling])

  // ── Load last transaction from localStorage for Repeat button ──
  // Rehydrate into `lastRepeatableTransaction` only — never into
  // `completedTransaction`, otherwise the BillingConfirmation modal would
  // pop up on every page reload with the previous booking's details.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(repeatStorageKey)
      if (stored) setLastRepeatableTransaction(JSON.parse(stored))
    } catch {
      /* ignore corrupt data */
    }
  }, [repeatStorageKey])

  // ── Sync locationKey when enabledLocations / allowed list resolves ──
  // Two correctness rules:
  //   1. If the user is role-locked (Cashier/TrackMarshall/Incharge) and we
  //      know their lockedLocationId, FORCE locationKey to it. They cannot
  //      bill against any other branch — silently or otherwise.
  //   2. Otherwise, only re-seed when the current locationKey is invalid for
  //      this user (preserves a deliberate Owner/Admin choice).
  useEffect(() => {
    if (enabledLocations.length === 0) return
    if (isRoleLocked && lockedLocationId && locationKey !== lockedLocationId) {
      setLocationKey(lockedLocationId)
      return
    }
    const valid = enabledLocations.some((l) => l.slug === locationKey)
    if (!valid) {
      setLocationKey(allowedSlugs[0] ?? enabledLocations[0].slug)
    }
  }, [enabledLocations, isRoleLocked, lockedLocationId, allowedSlugs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch event campaigns for the current branch when on Events tab ──
  useEffect(() => {
    if (posTab !== 'events') return
    let cancelled = false
    setEventsLoading(true)
    listEventCampaignsForPos(locationKey)
      .then((list) => {
        if (!cancelled) setEventsForPos(list)
      })
      .catch(() => {
        if (!cancelled) setEventsForPos([])
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [posTab, locationKey])

  useEffect(() => {
    setLoadingActivities(true)
    Promise.all([
      listBranchActivityCatalog(locationKey).catch(() => [] as ActivityCatalogRecord[]),
      listCombos(slugToBranchId(locationKey)).catch(() => [] as ComboRecord[]),
    ])
      .then(async ([acts, cmbs]) => {
        const { isCurrentlyUnavailable, isOnSurface } =
          await import('../../api/activity-availability')
        // Hide:
        //   - permanently inactive (`status !== 'Active'`)
        //   - currently temporarily unavailable (auto-expire honored)
        //   - games the operator unticked from POS in Activities → Hierarchy
        // Legacy docs without an explicit platforms array stay visible (see
        // `isOnSurface` doc), so this doesn't blank out the cashier screen
        // until everyone re-saves their game configurations.
        setActivities(
          acts.filter(
            (a) => a.status === 'Active' && !isCurrentlyUnavailable(a) && isOnSurface(a, 'pos'),
          ),
        )
        setCombos(cmbs)
      })
      .finally(() => setLoadingActivities(false))

    // Load non-performing variants for incentive highlighting
    const branchId = slugToBranchId(locationKey)
    getWeeklyGameReport(getCurrentWeekKey())
      .then(async (currentReport) => {
        let report = currentReport
        if (!report) {
          const recent = await listWeeklyGameReports(1)
          if (recent.length === 0) {
            setNonPerformingKeys(new Set())
            return
          }
          report = recent[0]
        }
        const locData = report.locationReports[branchId] ?? report.locationReports[locationKey]
        if (!locData) {
          setNonPerformingKeys(new Set())
          return
        }
        const keys = new Set<string>()
        for (const g of locData.games) {
          if (g.isNonPerforming) {
            keys.add(`${g.gameId}_${g.subGameId}_${g.variantId}`)
          }
        }
        setNonPerformingKeys(keys)
      })
      .catch(() => setNonPerformingKeys(new Set()))
  }, [locationKey])

  // ── Game popularity sorting (cached, fetch once per 30 min) ──
  useEffect(() => {
    const CACHE_KEY = `billing:gamePopularity:${locationKey}`
    const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { data: Record<string, number>; cachedAt: number }
        if (Date.now() - cached.cachedAt < CACHE_TTL) {
          setGamePopularity(cached.data)
          return
        }
      }
    } catch {
      /* ignore corrupt cache */
    }

    const db = initializeFirestore()
    if (!db) return

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

    const branchId = slugToBranchId(locationKey)
    const q = query(collection(db, 'bookings'), where('locationId', 'in', [locationKey, branchId]))

    getDocs(q)
      .then((snap) => {
        const counts: Record<string, number> = {}
        for (const d of snap.docs) {
          const data = d.data()
          const ps = String(data.paymentStatus ?? '').toLowerCase()
          const bs = String(data.bookingStatus ?? '').toLowerCase()
          if (ps !== 'completed' || bs === 'cancelled') continue

          const bookingDate = String(
            data.sessionDate ?? data.transactionDate ?? data.createdAt ?? '',
          ).slice(0, 10)
          if (bookingDate < fromDate) continue

          const items = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.billingItems)
              ? data.billingItems
              : []
          for (const item of items) {
            const cat = String(
              (item as Record<string, unknown>).category ??
                (item as Record<string, unknown>).gameName ??
                (item as Record<string, unknown>).itemName ??
                '',
            ).trim()
            if (cat) {
              counts[cat] = (counts[cat] ?? 0) + 1
            }
          }
        }
        setGamePopularity(counts)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data: counts, cachedAt: Date.now() }))
        } catch {
          /* storage full */
        }
      })
      .catch(() => {
        /* non-critical */
      })
  }, [locationKey])

  // Look up customer + member when phone has 10 digits — auto-fill name unless user manually edited it
  useEffect(() => {
    const digits = customerPhone.replace(/\D/g, '').slice(-10)
    if (digits.length !== 10) {
      setMemberData(null)
      setCustomerData(null)
      setMemberCouponCodes([])
      setShowCouponCodes(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setMemberLoading(true)
      try {
        const [customerResult, memberResult, couponCodesResult] = await Promise.allSettled([
          lookupCustomerByPhone(digits),
          lookupMemberByPhone(digits),
          ensureMember150CouponCodes(digits),
        ])
        if (cancelled) return

        const customer = customerResult.status === 'fulfilled' ? customerResult.value : null
        const member = memberResult.status === 'fulfilled' ? memberResult.value : null
        const couponCodes = couponCodesResult.status === 'fulfilled' ? couponCodesResult.value : []

        setCustomerData(customer)
        setMemberData(member)
        setMemberCouponCodes(couponCodes)
        setShowCouponCodes(false)

        // Auto-fill name: prefer customer displayName, fall back to member name
        const autoName = customer?.displayName || member?.name || ''
        if (autoName && (!customerName.trim() || nameAutoFilledRef.current)) {
          setCustomerName(autoName)
          nameAutoFilledRef.current = true
        }
      } catch {
        if (!cancelled) {
          setMemberData(null)
          setCustomerData(null)
        }
      } finally {
        if (!cancelled) setMemberLoading(false)
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [customerPhone]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Detect navy audience type from subcategory/subGameId/name. */
  const getAudienceType = (a: ActivityCatalogRecord): 'adult-navy' | 'child-navy' | 'other' => {
    const sub = (a.subcategory || a.subGameId || '').toLowerCase()
    const name = a.name.toLowerCase()
    const text = `${sub} ${name}`
    if (!text.includes('navy')) return 'other'
    if (text.includes('child') || text.includes('kid')) return 'child-navy'
    return 'adult-navy'
  }

  /** Detect navy audience type for a combo from its items. */
  const getComboAudienceType = (combo: ComboRecord): 'adult-navy' | 'child-navy' | 'other' => {
    const text = `${combo.name} ${combo.items.map((i) => i.itemName).join(' ')}`.toLowerCase()
    if (!text.includes('navy')) return 'other'
    if (text.includes('child') || text.includes('kid')) return 'child-navy'
    return 'adult-navy'
  }

  const isGoKartActivity = (name: string) => {
    const n = name.toLowerCase()
    return (
      n.includes('gokarting') ||
      n.includes('go-karting') ||
      n.includes('go karting') ||
      n.includes('gokart') ||
      n.includes('go-kart') ||
      n.includes('go kart')
    )
  }

  /** Returns true only for genuine lap-based Go-Karting rides (excludes photoshoots, add-ons, combos). */
  const isLapBasedKarting = (a: ActivityCatalogRecord): boolean =>
    isGoKartActivity(a.category) && typeof a.laps === 'number' && a.laps > 0 && !a.isCombo

  const PROTOCOL_MAX_LAPS = 5

  /** Returns true for activities visible in Offer mode (explicit flag, with heuristic fallback). */
  const isOfferActivity = (a: ActivityCatalogRecord): boolean =>
    a.visibleInOffers === true ||
    (a.visibleInOffers === undefined &&
      isGoKartActivity(a.category) &&
      (a.subcategory || '').toLowerCase().includes('offer'))

  /** Returns true for activities visible in Protocol mode (explicit flag, with heuristic fallback). */
  const isProtocolActivity = (a: ActivityCatalogRecord): boolean =>
    a.visibleInProtocol === true ||
    (a.visibleInProtocol === undefined && isLapBasedKarting(a) && a.laps === PROTOCOL_MAX_LAPS)

  const categories = useMemo(() => {
    const cats = Array.from(new Set(activities.map((a) => a.category)))
    // Protocol / Offer mode: only show Go-Karting category
    if (isProtocol || isOffer) {
      const goKartCats = cats.filter((c) => isGoKartActivity(c))
      return goKartCats.length > 0 ? goKartCats : cats.slice(0, 1)
    }
    // Sort by popularity (highest transaction count first), fallback order for ties
    const fallback = ['gokarting', 'cricket', 'archery']
    cats.sort((a, b) => {
      const aCount = gamePopularity[a] ?? 0
      const bCount = gamePopularity[b] ?? 0
      if (aCount !== bCount) return bCount - aCount
      const aFb = fallback.findIndex((f) => a.toLowerCase().includes(f))
      const bFb = fallback.findIndex((f) => b.toLowerCase().includes(f))
      const aIdx = aFb >= 0 ? aFb : fallback.length
      const bIdx = bFb >= 0 ? bFb : fallback.length
      if (aIdx !== bIdx) return aIdx - bIdx
      return a.localeCompare(b)
    })
    const base = ['All', ...cats]
    if (combos.length > 0) base.push('Combos')
    return base
  }, [activities, combos, gamePopularity, isProtocol, isOffer])

  const filteredActivities = useMemo(() => {
    if (categoryFilter === 'Combos') return []
    const q = search.toLowerCase()
    let filtered = activities.filter((a) => {
      const matchesSearch =
        !q || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
      const matchesCategory = categoryFilter === 'All' || a.category === categoryFilter
      return matchesSearch && matchesCategory
    })
    // Normal mode: hide offer-specific and protocol-specific items from regular POS
    if (!isProtocol && !isOffer) {
      filtered = filtered.filter((a) => {
        if (a.visibleInPOS === false) return false
        if (a.visibleInPOS === true) return true
        // No explicit flag (old data): use legacy heuristic
        return !isOfferActivity(a) && !isProtocolActivity(a)
      })
    }
    // Protocol mode: strict flag-based filtering with legacy fallback for old data
    if (isProtocol) {
      filtered = filtered.filter((a) => {
        if (a.visibleInProtocol === true) return true
        if (a.visibleInProtocol === false) return false
        // undefined (old data without flags): legacy heuristic
        return isLapBasedKarting(a) && a.laps === PROTOCOL_MAX_LAPS
      })
    }
    // Offer mode: only Go-Karting activities with "offer" subcategory
    if (isOffer) {
      filtered = filtered.filter(isOfferActivity)
    }
    // Audience filter
    if (audienceFilter) {
      filtered = filtered.filter((a) => getAudienceType(a) === audienceFilter.toLowerCase())
    }
    // Sort by game popularity so popular categories appear first
    if (
      !isProtocol &&
      !isOffer &&
      categoryFilter === 'All' &&
      Object.keys(gamePopularity).length > 0
    ) {
      filtered.sort((a, b) => (gamePopularity[b.category] ?? 0) - (gamePopularity[a.category] ?? 0))
    }
    return filtered
  }, [
    activities,
    search,
    categoryFilter,
    audienceFilter,
    gamePopularity,
    isProtocol,
    isOffer,
    locationKey,
  ])

  const filteredCombos = useMemo(() => {
    if (isProtocol || isOffer) return []
    if (categoryFilter !== 'All' && categoryFilter !== 'Combos') return []
    const q = search.toLowerCase()
    let filtered = combos.filter((c) => !q || c.name.toLowerCase().includes(q))
    if (audienceFilter) {
      filtered = filtered.filter((c) => getComboAudienceType(c) === audienceFilter.toLowerCase())
    }
    return filtered
  }, [combos, search, categoryFilter, audienceFilter, isProtocol, isOffer])

  const groupedActivities = useMemo(() => {
    const groups: Record<string, ActivityCatalogRecord[]> = {}
    for (const a of filteredActivities) {
      const key = a.subcategory || 'Other'
      ;(groups[key] ??= []).push(a)
    }
    // Sort variants within each group by price ascending
    const branchKey = slugToBranchId(locationKey)
    for (const variants of Object.values(groups)) {
      variants.sort((a, b) => (a.branchPrices[branchKey] ?? 0) - (b.branchPrices[branchKey] ?? 0))
    }
    // Use the categories pill order (already sorted by popularity) as rank
    const catIndex = new Map(categories.map((c, i) => [c, i]))
    const variantOrder = ['adult', 'child', 'double']
    return Object.entries(groups).sort(([a, aVars], [b, bVars]) => {
      // Primary: sort by category pill order (popularity)
      const aCat = aVars[0]?.category ?? ''
      const bCat = bVars[0]?.category ?? ''
      const aRank = catIndex.get(aCat) ?? 999
      const bRank = catIndex.get(bCat) ?? 999
      if (aRank !== bRank) return aRank - bRank
      // Secondary: within same category, sort by adult → child → double
      const ai = variantOrder.findIndex((k) => a.toLowerCase().includes(k))
      const bi = variantOrder.findIndex((k) => b.toLowerCase().includes(k))
      const aIdx = ai >= 0 ? ai : variantOrder.length
      const bIdx = bi >= 0 ? bi : variantOrder.length
      if (aIdx !== bIdx) return aIdx - bIdx
      return a.localeCompare(b)
    })
  }, [filteredActivities, locationKey, categories])

  const addToCart = (activity: ActivityCatalogRecord) => {
    const branchKey = slugToBranchId(locationKey)
    const basePrice =
      activity.branchPrices[branchKey] ??
      activity.branchPrices[Object.keys(activity.branchPrices)[0]] ??
      0
    const price =
      isOffer && typeof activity.offerPrice === 'number' && activity.offerPrice > 0
        ? activity.offerPrice
        : basePrice
    const itemName = [activity.category, activity.subcategory, activity.name]
      .filter(Boolean)
      .join(' — ')

    // Protocol validation: only lap-based Go-Karting rides allowed
    if (isProtocol && !isLapBasedKarting(activity)) {
      setSubmitError(
        'Protocol allows only Go-Karting lap rides. Photoshoots, add-ons, and combos are not permitted.',
      )
      return
    }

    // Offer validation: only Go-Karting offer activities allowed
    if (isOffer && !isOfferActivity(activity)) {
      setSubmitError('Offers mode allows only Go-Karting offer activities.')
      return
    }

    // Protocol validation: max 5 laps (quantity)
    if (isProtocol) {
      const currentTotal = cart.reduce((sum, c) => sum + c.quantity, 0)
      if (currentTotal >= PROTOCOL_MAX_LAPS) {
        setSubmitError(`Protocol is limited to ${PROTOCOL_MAX_LAPS} laps maximum.`)
        return
      }
    }

    const key = `${activity.id}-${locationKey}`
    setSubmitError(null)
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key)
      if (existing) {
        // Protocol: enforce max laps on quantity increase
        if (isProtocol) {
          const currentTotal = prev.reduce((sum, c) => sum + c.quantity, 0)
          if (currentTotal >= PROTOCOL_MAX_LAPS) return prev
        }
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + 1 } : c))
      }
      return [
        ...prev,
        {
          key,
          activityId: activity.id,
          itemName,
          unitPrice: isProtocol ? 0 : price,
          quantity: 1,
          gameId: activity.gameId,
          subGameId: activity.subGameId,
          variantId: activity.variantId,
          vendorId: activity.vendorId, // derived from game.metadata.vendorId (read-only)
          vendorBranchId: activity.vendorBranchId,
          printIndividualTokens: activity.printIndividualTokens === true,
        },
      ]
    })
    setProtocolRequestReady(false)
    setOfferRequestReady(false)
  }

  const addPackageToCart = (event: EventCampaignRecord, pkg: EventPackage) => {
    const key = `event-${event.id}-pkg-${pkg.id}`
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key)
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + 1 } : c))
      }
      const enabledItems = pkg.items.filter((it) => it.enabled !== false)
      const scopedPkg: EventPackage = { ...pkg, items: enabledItems }
      const total = calculatePackageTotal(scopedPkg)
      return [
        ...prev,
        {
          key,
          activityId: key,
          itemName: `${event.title} — ${pkg.title || 'Package'}`,
          unitPrice: total,
          quantity: 1,
          isEventPackage: true,
          eventPackageRef: {
            campaignId: event.id,
            packageId: pkg.id,
            title: pkg.title || 'Package',
          },
          eventPackageItems: enabledItems,
        },
      ]
    })
    setProtocolRequestReady(false)
    setOfferRequestReady(false)
  }

  const addComboToCart = (combo: ComboRecord) => {
    const key = `combo-${combo.id}-${locationKey}`
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key)
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + 1 } : c))
      }
      return [
        ...prev,
        {
          key,
          activityId: combo.id,
          itemName: combo.name,
          unitPrice: combo.comboPrice,
          quantity: 1,
          isCombo: true,
          comboId: combo.id,
          comboItems: combo.items.map((item) => ({
            activityId: item.activityId,
            itemName: item.itemName,
            adjustedPrice: item.adjustedPrice,
            gameId: item.gameId,
            subGameId: item.subGameId,
            variantId: item.variantId,
            vendorId: item.vendorId,
          })),
        },
      ]
    })
  }

  const repeatLastTransaction = () => {
    const source = lastRepeatableTransaction ?? completedTransaction
    if (!source?.items || source.items.length === 0) {
      setSubmitError('No previous transaction to repeat.')
      return
    }
    setSubmitError(null)
    const newItems: CartItem[] = source.items
      .filter((item) => !item.refunded)
      .map((item, idx) => ({
        key: `repeat-${item.gameId || idx}-${locationKey}-${Date.now()}`,
        activityId: item.gameId || `repeat-${idx}`,
        itemName: item.itemName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        gameId: item.gameId,
        subGameId: item.subGameId,
        variantId: item.variantId,
        vendorId: item.vendorId,
      }))
    setCart(newItems)
    if (source.customerName) setCustomerName(source.customerName)
    if (source.customerPhone) setCustomerPhone(source.customerPhone)
  }

  const updateQty = (key: string, delta: number) => {
    setCart((prev) => {
      if (isProtocol && delta > 0) {
        const currentTotal = prev.reduce((sum, c) => sum + c.quantity, 0)
        if (currentTotal >= PROTOCOL_MAX_LAPS) return prev
      }
      // Event package lines are removed when qty drops to 0 (card-level − button UX).
      // Other lines floor at 1 to match the existing cart-panel behaviour.
      const target = prev.find((c) => c.key === key)
      if (target?.isEventPackage && target.quantity + delta <= 0) {
        return prev.filter((c) => c.key !== key)
      }
      return prev.map((c) =>
        c.key === key ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c,
      )
    })
    setProtocolRequestReady(false)
    setOfferRequestReady(false)
  }

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((c) => c.key !== key))
    setProtocolRequestReady(false)
    setOfferRequestReady(false)
  }

  const clearCart = () => {
    setCart([])
    setProtocolRequestReady(false)
    setOfferRequestReady(false)
  }

  // Prices are GST-inclusive — subtotal already contains GST.
  const subtotal = cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0)
  const couponDiscount = couponResult?.valid ? couponResult.discountAmount : 0

  // ── Per-campaign package discount computation ─────────────────────────────
  // Groups package cart lines by campaign, runs computePackageDiscount against
  // each campaign's packageDiscount config. BxGy free-units are baked into the
  // final flatMap expansion (free variants with unitPrice=0). Flat discount is
  // included in the transaction-level `discount` variable alongside the coupon.
  const packageDiscountByEvent = useMemo(() => {
    const byEvent = new Map<string, PackageDiscountResult>()
    const linesByEvent = new Map<string, PackageDiscountLine[]>()
    for (const c of cart) {
      if (!c.isEventPackage || !c.eventPackageRef) continue
      const campaignId = c.eventPackageRef.campaignId
      const list = linesByEvent.get(campaignId) ?? []
      list.push({
        packageId: c.eventPackageRef.packageId,
        unitPrice: c.unitPrice,
        quantity: c.quantity,
      })
      linesByEvent.set(campaignId, list)
    }
    for (const [campaignId, lines] of linesByEvent) {
      const evt = eventsForPos.find((e) => e.id === campaignId)
      byEvent.set(campaignId, computePackageDiscount(lines, evt?.packageDiscount ?? null))
    }
    return byEvent
  }, [cart, eventsForPos])

  const packageFreeByCartKey = useMemo(() => {
    const out = new Map<string, number>()
    for (const c of cart) {
      if (!c.isEventPackage || !c.eventPackageRef) continue
      const res = packageDiscountByEvent.get(c.eventPackageRef.campaignId)
      if (!res) continue
      const free = res.freeByPackage.get(c.eventPackageRef.packageId) ?? 0
      out.set(c.key, Math.min(c.quantity, free))
    }
    return out
  }, [cart, packageDiscountByEvent])

  const packageFlatDiscountTotal = useMemo(
    () => Array.from(packageDiscountByEvent.values()).reduce((s, r) => s + r.flatValue, 0),
    [packageDiscountByEvent],
  )

  const packageBxgyDiscountTotal = useMemo(
    () => Array.from(packageDiscountByEvent.values()).reduce((s, r) => s + r.bxgyFreeValue, 0),
    [packageDiscountByEvent],
  )

  const discount = couponDiscount + packageFlatDiscountTotal
  // BxGy reduces the effective subtotal (free units become 0-price items at flatMap time),
  // flat discount is applied via the existing transaction-level discount pipeline.
  const bxgyAdjustedSubtotal = Math.max(0, subtotal - packageBxgyDiscountTotal)
  const total = Math.max(0, bxgyAdjustedSubtotal - discount)

  // Wallet redemption is applied on top of `total` (after coupon + package
  // discounts) and capped at whatever balance the customer actually has.
  // This feeds directly into `finalAmount` / `totalAfterWallet`, which is
  // what the cashier collects and what gets debited from the wallet inside
  // createUnifiedBooking. We recompute every render rather than caching in
  // state so stale balances (e.g. race with a concurrent wallet change)
  // can't cause a mismatch at submit time.
  const availableWalletBalance = customerData?.walletBalance ?? 0
  const walletRedemptionAmount =
    redeemWallet && availableWalletBalance > 0 ? Math.min(availableWalletBalance, total) : 0
  const totalAfterWallet = Math.max(0, total - walletRedemptionAmount)
  // Auto-reset the checkbox if the customer changes away from one with a
  // balance, so we never carry a stale "yes redeem" into a different cart.
  useEffect(() => {
    if (!(customerData && customerData.walletBalance > 0) && redeemWallet) {
      setRedeemWallet(false)
    }
  }, [customerData, redeemWallet])

  const baseAmount = Math.round((totalAfterWallet * 100) / (100 + GST_PERCENT))
  const gstAmount = totalAfterWallet - baseAmount

  // ── Per-line pricing for transparency UI ──────────────────────────────────
  // Surfaces the original (un-discounted) price next to the final price for each
  // cart line so customers see the value of every applied discount. Pure overlay
  // on top of the existing total/discount math — does not change any number that
  // gets recorded into the transaction.
  const cartLinePricing = useMemo(() => {
    const out = new Map<
      string,
      {
        originalUnit: number
        originalLineTotal: number
        finalLineTotal: number
        lineSavings: number
      }
    >()

    // Distribute each campaign's flat discount across its package lines,
    // weighted by line subtotal. Last line in a campaign absorbs rounding so
    // the per-line allocations sum exactly to flatValue.
    const flatByCartKey = new Map<string, number>()
    const linesByCampaign = new Map<string, string[]>()
    for (const c of cart) {
      if (!c.isEventPackage || !c.eventPackageRef) continue
      const id = c.eventPackageRef.campaignId
      const list = linesByCampaign.get(id) ?? []
      list.push(c.key)
      linesByCampaign.set(id, list)
    }
    for (const [campaignId, keys] of linesByCampaign) {
      const flatValue = packageDiscountByEvent.get(campaignId)?.flatValue ?? 0
      if (flatValue <= 0) continue
      const lines = keys.map((k) => cart.find((c) => c.key === k)).filter((c): c is CartItem => !!c)
      const weightSum = lines.reduce((s, c) => s + c.unitPrice * c.quantity, 0)
      if (weightSum <= 0) continue
      let allocated = 0
      lines.forEach((c, idx) => {
        const isLast = idx === lines.length - 1
        const share = isLast
          ? flatValue - allocated
          : Math.round((c.unitPrice * c.quantity * flatValue) / weightSum)
        flatByCartKey.set(c.key, share)
        allocated += share
      })
    }

    cart.forEach((item, i) => {
      const lineSubtotal = item.unitPrice * item.quantity

      // Combo: cart unitPrice is the discounted combo price; original = ComboRecord.originalTotal
      let comboSavings = 0
      let originalUnit = item.unitPrice
      if (item.isCombo && item.comboId) {
        const combo = combos.find((c) => c.id === item.comboId)
        if (combo && combo.originalTotal > item.unitPrice) {
          originalUnit = combo.originalTotal
          comboSavings = (combo.originalTotal - item.unitPrice) * item.quantity
        }
      }

      const bxgyFreeUnits = packageFreeByCartKey.get(item.key) ?? 0
      const bxgySavings = bxgyFreeUnits * item.unitPrice
      const couponLineSavings = couponResult?.valid ? (couponResult.itemDiscounts?.[i] ?? 0) : 0
      const flatLineSavings = flatByCartKey.get(item.key) ?? 0

      const originalLineTotal = lineSubtotal + comboSavings
      const finalLineTotal = Math.max(
        0,
        lineSubtotal - bxgySavings - couponLineSavings - flatLineSavings,
      )
      const lineSavings = Math.max(0, originalLineTotal - finalLineTotal)

      out.set(item.key, { originalUnit, originalLineTotal, finalLineTotal, lineSavings })
    })

    return out
  }, [cart, combos, packageDiscountByEvent, packageFreeByCartKey, couponResult])

  const originalSubtotal = useMemo(
    () =>
      cart.reduce(
        (sum, c) =>
          sum + (cartLinePricing.get(c.key)?.originalLineTotal ?? c.unitPrice * c.quantity),
        0,
      ),
    [cart, cartLinePricing],
  )
  const totalSavings = Math.max(0, originalSubtotal - total)
  const hasAnyDiscount = totalSavings > 0

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setValidatingCoupon(true)
    try {
      const result = await validateCouponForCart(couponCode, cart, subtotal, customerPhone)

      // Event-policy gate: strip coupon discount from any event-package line
      // whose campaign has `couponPolicy.allowCouponUsage === false`. Keeps the
      // policy consistent regardless of which coupon the cashier entered.
      if (result.valid && Array.isArray(result.itemDiscounts)) {
        const adjustedItemDiscounts = result.itemDiscounts.slice()
        let stripped = 0
        cart.forEach((c, idx) => {
          if (!c.isEventPackage || !c.eventPackageRef) return
          const evt = eventsForPos.find((e) => e.id === c.eventPackageRef?.campaignId)
          if (evt?.couponPolicy?.allowCouponUsage) return
          const take = adjustedItemDiscounts[idx] ?? 0
          if (take > 0) {
            adjustedItemDiscounts[idx] = 0
            stripped += take
          }
        })
        if (stripped > 0) {
          setCouponResult({
            ...result,
            itemDiscounts: adjustedItemDiscounts,
            discountAmount: Math.max(0, result.discountAmount - stripped),
          })
          return
        }
      }
      setCouponResult(result)
    } catch {
      setCouponResult({
        valid: false,
        discountAmount: 0,
        errorMessage: 'Failed to validate coupon.',
      })
    } finally {
      setValidatingCoupon(false)
    }
  }

  // ── Protocol approval real-time listener ──
  useEffect(() => {
    if (!protocolSubmittedBooking) return
    const unsub = subscribeProtocolBookingStatus(
      protocolSubmittedBooking.id,
      async (status) => {
        if (status.protocolStatus === 'approved') {
          setProtocolApprovalStatus('approved')
          setProtocolApprovedBy(status.protocolApprovedBy)
          setRestrictedNotification('approved')
          // Fetch full transaction for printing
          try {
            const { transaction: fullTxn } = await billingApi.getTransaction(
              session?.token || '',
              protocolSubmittedBooking.id,
            )
            if (fullTxn) {
              setProtocolApprovedTransaction(fullTxn)
            }
          } catch {
            /* print manually via button */
          }
        } else if (status.protocolStatus === 'rejected') {
          setProtocolApprovalStatus('rejected')
          setProtocolRejectReason(status.protocolRejectReason || 'No reason provided')
          setRestrictedNotification('rejected')
        }
      },
      (err) => logger.error('billing_module.protocol_subscription_error', err),
    )
    return unsub
  }, [protocolSubmittedBooking]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Offer approval real-time listener ──
  useEffect(() => {
    if (!offerSubmittedBooking) return
    const unsub = subscribeOfferBookingStatus(
      offerSubmittedBooking.id,
      async (status) => {
        if (status.offerStatus === 'approved') {
          setOfferApprovalStatus('approved')
          setOfferApprovedBy(status.offerApprovedBy)
          setRestrictedNotification('approved')
          try {
            const { transaction: fullTxn } = await billingApi.getTransaction(
              session?.token || '',
              offerSubmittedBooking.id,
            )
            if (fullTxn) {
              setOfferApprovedTransaction(fullTxn)
            }
          } catch {
            /* print manually via button */
          }
        } else if (status.offerStatus === 'rejected') {
          setOfferApprovalStatus('rejected')
          setOfferRejectReason(status.offerRejectReason || 'No reason provided')
          setRestrictedNotification('rejected')
        }
      },
      (err) => logger.error('billing_module.offer_subscription_error', err),
    )
    return unsub
  }, [offerSubmittedBooking]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrintReceipt = async (txn: TransactionRecord) => {
    try {
      await logPrint({
        documentId: txn.invoiceNumber || txn.id,
        source: 'billing',
        printedBy: session?.user.id || 'unknown',
        printedByName: session?.user.name || 'Unknown',
        printedByRole: session?.user.role || 'unknown',
        customerName: txn.customerName,
        customerPhone: txn.customerPhone,
        amount: txn.totalAmount,
        locationId: txn.locationId,
      })
    } catch {
      // Non-critical
    }
    await printTransactionReceipt(txn)
  }

  const handleUtrSubmit = async () => {
    if (!utrPendingTxn) return
    const digits = utrDigits.trim()
    if (digits.length !== 4 || !/^\d{4}$/.test(digits)) return
    setUtrSaving(true)
    try {
      await billingApi.updateTransactionPaymentStatus(utrPendingTxn.id, {
        paymentStatus: 'completed',
        paymentReference: `UTR-****${digits}`,
      })
      const updated = { ...utrPendingTxn, paymentReference: `UTR-****${digits}` }
      setUtrPendingTxn(null)
      setUtrDigits('')
      setCompletedTransaction(updated)
      void handlePrintReceipt(updated)
    } catch {
      // If saving fails, still proceed with printing — UTR is non-critical
      setUtrPendingTxn(null)
      setUtrDigits('')
      setCompletedTransaction(utrPendingTxn)
      void handlePrintReceipt(utrPendingTxn)
    } finally {
      setUtrSaving(false)
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // Synchronous double-submit guard — rejects re-entry before React
    // schedules the `submitting` state flip. Without this, a fast second
    // click within the same event tick would slip past the disabled
    // attribute and create a duplicate booking.
    if (inFlightSubmitRef.current) return
    if (cart.length === 0) {
      setSubmitError('Cart is empty.')
      return
    }
    if (!customerName.trim()) {
      setSubmitError('Customer name is required.')
      return
    }
    if (!customerPhone.trim()) {
      setSubmitError('Customer phone is required.')
      return
    }

    // Protocol validation — only lap-based Go-Karting rides permitted
    if (isProtocol) {
      const hasInvalid = cart.some((c) => {
        if (!isGoKartActivity(c.itemName)) return true
        // Must contain "lap" in the name to be a genuine lap ride (not photoshoot/add-on)
        if (!c.itemName.toLowerCase().includes('lap')) return true
        return false
      })
      if (hasInvalid) {
        setSubmitError(
          'Protocol allows only Go-Karting lap rides. Remove any photoshoots, add-ons, or non-lap items.',
        )
        return
      }
      const totalQty = cart.reduce((sum, c) => sum + c.quantity, 0)
      if (totalQty > PROTOCOL_MAX_LAPS) {
        setSubmitError(
          `Protocol is limited to ${PROTOCOL_MAX_LAPS} laps maximum. Currently: ${totalQty}.`,
        )
        return
      }
      if (!protocolReason.trim()) {
        setSubmitError('Please provide a reason for the protocol booking.')
        return
      }
    }

    // Offer validation
    if (isOffer) {
      if (!offerReason.trim()) {
        setSubmitError('Please provide a reason for the offer booking.')
        return
      }
    }

    // (The defensive availability re-check used to live here, before the
    // re-entry guard was set. That left a window — every `await` in this
    // block let a second tap on "Pay & Print" slip past the guard,
    // producing one duplicate booking per extra tap. Phone 9502617044
    // hit five duplicates this way on 2026-05-07. The re-check has been
    // moved INSIDE the `try` block below, after the guard flips.)

    // Guard: if any cart item came from a vendor-game activity but is missing its vendorId,
    // the billing split would silently fall through to company. Block and ask to reload.
    // Skip combo items — their vendor data is embedded in comboItems.
    for (const cartItem of cart) {
      if (cartItem.isCombo) continue
      const catalogEntry = activities.find((a) => a.id === cartItem.activityId)
      if (catalogEntry?.vendorId && !cartItem.vendorId) {
        setSubmitError(
          `"${cartItem.itemName}" is a vendor game but is missing vendor data. ` +
            `Please reload the page and try again.`,
        )
        return
      }
    }

    // Cross-branch vendor stamp: a cart item came in with a vendorId
    // whose vendorBranchId doesn't match the current POS branch. We
    // used to hard-block the sale here; that left cashiers stuck in
    // front of paying customers when the catalog had stale vendor
    // metadata. Now: log loudly, strip the stamp on the cart item so
    // the sale falls through to company-attribution, and let the admin
    // re-attribute via Reconciliation > Re-attribute by booking ID
    // afterward. Cheque math stays correct because the ledger trigger
    // never gets a wrong-branch vendor stamp from this booking.
    const currentBranchId = slugToBranchId(locationKey)
    let strippedCount = 0
    for (const cartItem of cart) {
      if (cartItem.isCombo) continue
      if (
        cartItem.vendorId &&
        cartItem.vendorBranchId &&
        cartItem.vendorBranchId !== currentBranchId
      ) {
        logger.error('billing_module.cross_branch_vendor_stripped', undefined, {
          itemName: cartItem.itemName,
          vendorId: cartItem.vendorId,
          vendorBranchId: cartItem.vendorBranchId,
          currentBranchId,
        })
        // Mutate the cart item in-place — it lives in our local state and
        // the subsequent submit logic reads the same reference. Also
        // mirror the cleared values onto activity/comboItem fields the
        // billing path consumes downstream.
        ;(cartItem as { vendorId?: string }).vendorId = undefined
        ;(cartItem as { vendorBranchId?: string }).vendorBranchId = undefined
        strippedCount += 1
      }
    }
    if (strippedCount > 0) {
      // Non-blocking warning so cashier sees what happened. Don't return —
      // sale continues with company attribution on the affected items.
      setSubmitError(null)
    }

    // Split payment validation
    if (paymentMethod === 'Split') {
      const sCash = Number(splitCash) || 0
      const sUpi = Number(splitUpi) || 0
      const sCard = Number(splitCard) || 0
      const splitTotal = sCash + sUpi + sCard
      if (splitTotal <= 0) {
        setSubmitError('Split payment requires at least one amount greater than zero.')
        return
      }
      if (Math.abs(splitTotal - totalAfterWallet) >= 0.01) {
        setSubmitError(
          `Split total (₹${splitTotal}) does not match amount payable (₹${totalAfterWallet}). Please adjust.`,
        )
        return
      }
    }

    inFlightSubmitRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    setCompletedTransaction(null)
    // Reuse an existing token if a prior attempt failed mid-write — the
    // server-side query dedups on this token so a retried submit never
    // creates a second booking. Generate fresh on first attempt only.
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `cri_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    const clientRequestId = clientRequestIdRef.current
    try {
      // Defensive availability re-check: between when the cart was
      // assembled and the staff hit Submit, an admin may have flagged
      // one of the cart items as temporarily unavailable. This used to
      // live BEFORE the re-entry guard which created a duplicate-write
      // race (a fast second tap during the catalog fetch slipped past
      // the guard and rang up the same cart twice). Now it runs after
      // the guard and inside the try, so the outer `finally` releases
      // the guard on every exit — including the `return` below.
      try {
        const [{ listBranchActivityCatalog }, { isCurrentlyUnavailable }] = await Promise.all([
          import('../../api/activity-catalog-firestore'),
          import('../../api/activity-availability'),
        ])
        const freshCatalog = await listBranchActivityCatalog(locationKey)
        const downNames: string[] = []
        for (const cartItem of cart) {
          if (cartItem.isCombo) {
            for (const inner of cartItem.comboItems ?? []) {
              const freshInner = freshCatalog.find((c) => c.id === inner.activityId)
              if (isCurrentlyUnavailable(freshInner)) {
                downNames.push(`${cartItem.itemName} → ${inner.itemName}`)
              }
            }
            continue
          }
          const fresh = freshCatalog.find((c) => c.id === cartItem.activityId)
          if (isCurrentlyUnavailable(fresh)) {
            downNames.push(cartItem.itemName)
          }
        }
        if (downNames.length > 0) {
          setSubmitError(
            `Cannot complete sale — the following item(s) were just marked unavailable: ${downNames.join(', ')}. Remove from cart or reload the page.`,
          )
          return
        }
      } catch (catalogErr) {
        logger.error('billing_module.availability_recheck_failed', catalogErr)
        // Non-fatal — staff is in front of a paying customer.
      }

      // ── Non-owner protocol: create draft request only (no full booking) ──
      if (isProtocol) {
        const { createProtocolRequest } = await import('../../api/asquare-bookings')
        const reqResult = await createProtocolRequest({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          reason: protocolReason.trim(),
          items: cart.map((c) => ({
            itemName: c.itemName,
            quantity: c.quantity,
            unitPrice: 0,
            gameId: c.gameId,
            subGameId: c.subGameId,
            variantId: c.variantId,
            vendorId: c.vendorId,
            vendorBranchId: c.vendorBranchId,
          })),
          locationId: locationKey,
          requestedById: session?.user?.id || '',
          requestedByName: session?.user?.name || '',
          requestedByRole: session?.user?.role || '',
        })

        // Clear form
        setCart([])
        setCustomerName('')
        setCustomerPhone('')
        nameAutoFilledRef.current = false
        setCouponCode('')
        setCouponResult(null)
        setMemberData(null)
        setRzpOrderCache(null)
        onSuccess()

        // Show awaiting-approval modal
        setCompletedTransaction(null)
        setSubmitError(null)
        setProtocolSubmittedBooking({
          id: reqResult.id,
          customerName: customerName.trim(),
          reason: protocolReason.trim(),
        })
        setProtocolApprovalStatus('pending')
        setProtocolRejectReason('')
        setProtocolApprovedBy(undefined)
        setProtocolApprovedTransaction(null)
        clientRequestIdRef.current = null
        setSubmitting(false)
        return
      }

      // ── Non-owner offer: create draft request with real pricing ──
      if (isOffer) {
        const { createOfferRequest } = await import('../../api/asquare-bookings')
        const reqResult = await createOfferRequest({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          reason: offerReason.trim(),
          items: cart.map((c) => ({
            itemName: c.itemName,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            gameId: c.gameId,
            subGameId: c.subGameId,
            variantId: c.variantId,
            vendorId: c.vendorId,
            vendorBranchId: c.vendorBranchId,
          })),
          totalAmount: total,
          finalAmount: total,
          discountAmount: discount,
          paymentMethod,
          ...(paymentMethod === 'Split'
            ? {
                splitCash: Number(splitCash) || 0,
                splitUpi: Number(splitUpi) || 0,
                splitCard: Number(splitCard) || 0,
              }
            : {}),
          locationId: locationKey,
          requestedById: session?.user?.id || '',
          requestedByName: session?.user?.name || '',
          requestedByRole: session?.user?.role || '',
        })

        // Clear form
        setCart([])
        setCustomerName('')
        setCustomerPhone('')
        nameAutoFilledRef.current = false
        setCouponCode('')
        setCouponResult(null)
        setMemberData(null)
        setRzpOrderCache(null)
        onSuccess()

        // Show awaiting-approval modal
        setCompletedTransaction(null)
        setSubmitError(null)
        setOfferSubmittedBooking({
          id: reqResult.id,
          customerName: customerName.trim(),
          reason: offerReason.trim(),
        })
        setOfferApprovalStatus('pending')
        setOfferRejectReason('')
        setOfferApprovedBy(undefined)
        setOfferApprovedTransaction(null)
        clientRequestIdRef.current = null
        setSubmitting(false)
        return
      }

      // ── Normal flow (non-protocol, or owner protocol auto-approval) ──
      const isOnlinePayment = paymentMethod === 'Razorpay'
      // For cash/cashier bookings, we send counter_checkin_20 instead of the auto-trigger
      const suppressAutoConfirm = !isOnlinePayment && customerPhone.trim()
      const { createUnifiedBooking } = await import('../../../lib/unified-booking')
      const posResult = await createUnifiedBooking({
        source: 'POS',
        sourceType: 'BILLING',
        clientRequestId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        ...(suppressAutoConfirm
          ? {
              interakt: {
                outboundRequestedAt: new Date(),
                outboundTemplateName: 'counter_checkin_20',
                outboundRequestSource: 'billing_cash_counter',
              },
            }
          : {}),
        items: cart.flatMap((c) => {
          if (c.isCombo && c.comboItems) {
            return c.comboItems.map((ci) => ({
              itemName: `${c.itemName} — ${ci.itemName}`,
              quantity: c.quantity,
              unitPrice: ci.adjustedPrice,
              gameId: ci.gameId,
              subGameId: ci.subGameId,
              variantId: ci.variantId,
              vendorId: ci.vendorId,
              printIndividualTokens: c.printIndividualTokens,
            }))
          }
          if (c.isEventPackage && c.eventPackageItems) {
            const freeQty = packageFreeByCartKey.get(c.key) ?? 0
            const paidQty = Math.max(0, c.quantity - freeQty)
            // Stamp activity metadata (category 'Event', vendorId, basePrice)
            // on every event-package line so the unified onBookingPaid hook
            // can credit vendors for the FULL (paid + free) quantity at full
            // unit price. Top-level `vendorId` is intentionally left
            // undefined — that prevents enrichItemsWithBilling from writing
            // a (finalAmount-pro-rated, BOGO-shortchanged) vendor split to
            // billingItems that would conflict with the hook's write.
            const eventItemId = (it: { id?: string; name?: string }): string => {
              const slug = String(it.id ?? it.name ?? '').replace(/[^a-zA-Z0-9_-]/g, '-')
              return `evt-${c.key}-${slug}`
            }
            const buildActivity = (it: {
              id?: string
              name?: string
              price: number
              type?: string
              vendorId?: string
              revenueShare?: boolean
            }) => ({
              id: eventItemId(it),
              apiId: eventItemId(it),
              name: `${c.itemName} — ${it.name ?? 'Item'}`,
              category: 'Event',
              basePrice: Number(it.price) || 0,
              available: true,
              ...(it.type === 'thirdParty' && it.vendorId ? { vendorId: it.vendorId } : {}),
              ...(it.type === 'thirdParty' && it.revenueShare === false
                ? { revenueShare: false as const }
                : {}),
            })
            const out: Array<{
              itemName: string
              quantity: number
              unitPrice: number
              gameId: string | undefined
              subGameId: string | undefined
              variantId: string | undefined
              vendorId: string | undefined
              vendorSharePercentOverride: number | undefined
              printIndividualTokens: boolean | undefined
              activity: ReturnType<typeof buildActivity>
            }> = []
            if (paidQty > 0) {
              for (const it of c.eventPackageItems) {
                out.push({
                  itemName: `${c.itemName} — ${it.name}`,
                  quantity: paidQty,
                  unitPrice: it.price,
                  gameId: undefined,
                  subGameId: undefined,
                  variantId: undefined,
                  vendorId: undefined,
                  vendorSharePercentOverride: undefined,
                  printIndividualTokens: c.printIndividualTokens,
                  activity: buildActivity(it),
                })
              }
            }
            if (freeQty > 0) {
              for (const it of c.eventPackageItems) {
                out.push({
                  itemName: `${c.itemName} — ${it.name} (FREE)`,
                  quantity: freeQty,
                  unitPrice: 0,
                  gameId: undefined,
                  subGameId: undefined,
                  variantId: undefined,
                  vendorId: undefined,
                  vendorSharePercentOverride: undefined,
                  printIndividualTokens: c.printIndividualTokens,
                  activity: buildActivity(it),
                })
              }
            }
            return out
          }
          return [
            {
              itemName: c.itemName,
              quantity: c.quantity,
              unitPrice: c.unitPrice,
              gameId: c.gameId,
              subGameId: c.subGameId,
              variantId: c.variantId,
              vendorId: c.vendorId,
              printIndividualTokens: c.printIndividualTokens,
            },
          ]
        }),
        totalAmount: isProtocol ? 0 : bxgyAdjustedSubtotal,
        discountAmount: isProtocol ? 0 : discount,
        finalAmount: isProtocol ? 0 : totalAfterWallet,
        walletRedeemed: isProtocol
          ? undefined
          : walletRedemptionAmount > 0
            ? walletRedemptionAmount
            : undefined,
        paymentMethod: isProtocol ? 'Protocol' : paymentMethod,
        paymentStatus: isProtocol ? 'completed' : isOnlinePayment ? 'pending' : 'completed',
        ...(paymentMethod === 'Split'
          ? {
              splitCash: Number(splitCash) || 0,
              splitUpi: Number(splitUpi) || 0,
              splitCard: Number(splitCard) || 0,
            }
          : {}),
        locationId: locationKey,
        couponCode: couponResult?.valid ? couponResult.coupon?.code : undefined,
        couponAmount: couponResult?.valid ? couponResult.discountAmount : undefined,
        itemDiscounts: couponResult?.valid ? couponResult.itemDiscounts : undefined,
        transactionDate: new Date().toISOString(),
        createdByAdminId: session?.user?.id,
        createdByAdminName: session?.user?.name,
        createdByRole: session?.user?.role,
        // Owner protocol: auto-approved, creates full booking immediately
        ...(isProtocol
          ? {
              isProtocol: true,
              protocolStatus: 'approved' as const,
              protocolReason: protocolReason.trim(),
            }
          : {}),
        // Owner offer: auto-approved, creates full booking immediately
        ...(isOffer
          ? {
              isOffer: true,
              offerStatus: 'approved' as const,
              offerReason: offerReason.trim(),
            }
          : {}),
      })
      // Write vendor-ledger credits for any event-package items at full gross
      // (paid + free qty × unit price) so BOGO free units are paid to the
      // vendor — the company absorbs the customer-side discount. Idempotent
      // and non-blocking; failures are logged but do not fail the booking.
      if (posResult.id) {
        const isPaid = isProtocol || !isOnlinePayment
        if (isPaid) {
          try {
            const { onBookingPaidById } = await import('../../../lib/booking-vendor-payout')
            void onBookingPaidById(posResult.id)
          } catch (err) {
            logger.error('billing_module.event_vendor_payout_failed', err, {
              bookingId: posResult.id,
            })
          }
        }
      }
      // Map to TransactionRecord shape for receipt printing and polling
      // Prefer billingItems (has itemName, unitPrice, serials) over sparse items array
      const doc = posResult.document as Record<string, unknown>
      const result = {
        transaction: {
          ...doc,
          id: posResult.id,
          invoiceNumber: posResult.invoiceNumber,
          items: doc.billingItems || doc.items,
        } as TransactionRecord,
      }

      // Increment coupon usage
      if (couponResult?.valid && couponResult.coupon) {
        try {
          const { asquareCouponsApi } = await import('../../api/asquare-coupons')
          await asquareCouponsApi.updateCoupon(couponResult.coupon.id, {
            usedCount: couponResult.coupon.usedCount + 1,
          })
        } catch {
          /* non-critical */
        }
      }

      // Send counter_checkin_20 WhatsApp notification for cash/cashier bookings
      if (suppressAutoConfirm) {
        fetch('https://asia-south1-a-square-6720c.cloudfunctions.net/sendCounterCheckin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: customerPhone.trim(),
            customerName: customerName.trim() || 'Racer',
            bookingId: posResult.id,
            branch: `A Square GoKarting, ${getLocationDisplayName(locationKey)}`,
            amount: `₹${totalAfterWallet}`,
          }),
        }).catch(() => {
          /* non-critical */
        })
      }

      // Clear form
      setCart([])
      setCustomerName('')
      setCustomerPhone('')
      nameAutoFilledRef.current = false
      setCouponCode('')
      setCouponResult(null)
      setMemberData(null)
      setRzpOrderCache(null)
      setRedeemWallet(false)
      // Sale wrote successfully — drop the idempotency token so the next
      // sale gets a fresh one. (On error we keep it so retries dedup.)
      clientRequestIdRef.current = null
      onSuccess()

      if (isOnlinePayment) {
        // UPI/Online: create Razorpay order and open Standard Checkout (has built-in UPI QR)
        setQrImageUrl(null)
        setQrLoading(true)
        setQrError(null)
        try {
          const CREATE_POS_QR_URL =
            'https://asia-south1-a-square-6720c.cloudfunctions.net/createPosQrCode'
          const qrResp = await fetch(CREATE_POS_QR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: totalAfterWallet,
              transactionId: posResult.id,
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
            }),
          })
          const orderData = await qrResp.json()
          if (orderData.ok && orderData.orderId) {
            // Open Razorpay Standard Checkout — has built-in UPI QR for scanning
            const rzpKey = orderData.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID
            setRzpOrderCache({
              orderId: orderData.orderId,
              amount: orderData.amount,
              key: rzpKey,
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
            })
            await loadRazorpaySDK()
            if (window.Razorpay) {
              const rzp = new window.Razorpay({
                key: rzpKey,
                amount: orderData.amount,
                currency: 'INR',
                name: 'A Square GoKarting',
                description: `POS Payment - ${posResult.id}`,
                order_id: orderData.orderId,
                prefill: {
                  name: customerName.trim(),
                  contact: customerPhone.trim(),
                },
                notes: {
                  order_number: posResult.id,
                  source: 'POS',
                },
                theme: { color: '#0066FF' },
                payment_capture: 1,
                handler: async (response: {
                  razorpay_payment_id: string
                  razorpay_order_id?: string
                  razorpay_signature?: string
                }) => {
                  // Payment success — update transaction
                  try {
                    await billingApi.updateTransactionPaymentStatus(posResult.id, {
                      paymentStatus: 'completed',
                      paymentReference: response.razorpay_payment_id,
                    })
                  } catch {
                    /* webhook will handle it */
                  }
                  // Write vendor-ledger credits for any event-package items.
                  try {
                    const { onBookingPaidById } = await import('../../../lib/booking-vendor-payout')
                    void onBookingPaidById(posResult.id)
                  } catch (err) {
                    logger.error('billing_module.razorpay_vendor_payout_failed', err, {
                      bookingId: posResult.id,
                    })
                  }
                  stopPaymentPolling()
                  setPendingPaymentTxn(null)
                  const updated = {
                    ...result.transaction,
                    paymentStatus: 'completed' as const,
                    paymentId: response.razorpay_payment_id,
                  }
                  setCompletedTransaction(updated)
                  void handlePrintReceipt(updated)
                },
                modal: {
                  ondismiss: () => {
                    // User closed checkout without paying — keep polling
                    setQrError('Payment window closed. Waiting for payment...')
                  },
                },
              })
              rzp.on('payment.failed', () => {
                setQrError('Payment failed. You can retry or cancel.')
              })
              rzp.open()
              setQrImageUrl('checkout-open') // Flag to show "Checkout opened" state
            } else {
              setQrError('Payment SDK not loaded. Please refresh the page.')
            }
          } else {
            setQrError(orderData.message || 'Failed to create payment order')
          }
        } catch {
          setQrError('Network error — could not create payment order')
        } finally {
          setQrLoading(false)
        }
        startPaymentPolling(result.transaction)
      } else if (paymentMethod === 'UPI') {
        // UPI: prompt for last 4 digits of UTR before printing
        setUtrPendingTxn(result.transaction)
        setUtrDigits('')
      } else {
        // Cash/Card: print immediately and show confirmation for reprints
        setCompletedTransaction(result.transaction)
        void handlePrintReceipt(result.transaction)
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create transaction.')
    } finally {
      // Release the synchronous re-entry guard. State flips here too — they
      // run in any return path (early-return inside try also goes through
      // finally). The clientRequestIdRef is intentionally NOT cleared here:
      // on error we want a retry to use the same token so the server-side
      // idempotency check can dedup if the original request actually wrote.
      inFlightSubmitRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Cashier Shift Control Header ── */}
      {isCashier && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {shiftActive ? (
                <>
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-green-600">Shift Active</p>
                    {shiftRecord && (
                      <p className="text-xs text-muted">
                        Since {fmtTimeShortIST(shiftRecord.startTime)}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="inline-flex h-3 w-3 rounded-full bg-gray-400" />
                  <p className="text-sm font-semibold text-muted">Not Checked In</p>
                </>
              )}
            </div>
            <div>
              {shiftActive ? (
                <button
                  type="button"
                  onClick={() => void openSettlement()}
                  disabled={shiftLoading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  Check Out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCheckIn()}
                  disabled={shiftLoading}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {shiftLoading ? 'Starting...' : 'Check In'}
                </button>
              )}
            </div>
          </div>

          {/* Preflight banner — visible BEFORE the cashier clicks Check In */}
          {!shiftActive && cashierBlocked ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <span className="text-base leading-none">⚠️</span>
              <span className="flex-1">{KART_REPORT_BLOCK_MSG}</span>
              <button
                type="button"
                onClick={handleKartReportOverride}
                className="shrink-0 rounded-md border border-amber-500/60 bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-500/30 dark:text-amber-100"
              >
                Manager Override
              </button>
            </div>
          ) : null}

          {/* Override-active indicator — replaces the preflight banner once
              the cashier has acknowledged the missing kart report. Keeps
              the bypass visible so it can't be used silently. */}
          {!shiftActive && isCashier && kartReportOverride ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
              <span className="text-base leading-none">⚙️</span>
              <span>Kart-report preflight bypassed by manager override (logged).</span>
            </div>
          ) : null}

          {/* Click-time error — fires immediately after a blocked Check In click */}
          {!shiftActive && submitError ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              <span className="text-base leading-none">🚫</span>
              <span>{submitError}</span>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Kart-Report Bypass Approval Popup ─────────────────────────────
          Cashier-initiated bypass request gated by Owner approval. Three
          UI states share the same overlay shell so geometry doesn't jump:
          • form — compose reason and send the request
          • pending — request raised, awaiting Owner; live-updates via
                      subscribeKartReportBypassRequest
          • rejected — Owner declined; show their note and let the cashier
                       amend the reason and resubmit
          Approval is handled by the subscription effect: kartReportOverride
          flips on, the popup auto-closes after a brief success frame, and
          the cashier can then Check In normally. */}
      {showOverrideModal &&
        (() => {
          const status = activeBypass?.status
          const isPending = status === 'pending'
          const isRejected = status === 'rejected'
          const isApproved = status === 'approved'
          const accent = isApproved
            ? 'border-success/45'
            : isRejected
              ? 'border-critical/45'
              : 'border-amber-500/40'
          return (
            <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 px-4 backdrop-blur-sm">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="kart-override-title"
                className={`w-full max-w-md rounded-xl border ${accent} bg-panel p-6 shadow-2xl`}
              >
                {/* ── State: Approved (brief success frame, then auto-close) ── */}
                {isApproved && activeBypass ? (
                  <div className="flex flex-col items-center gap-3 py-2 text-center">
                    <span
                      aria-hidden="true"
                      className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success"
                    >
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <h2 id="kart-override-title" className="text-base font-semibold text-default">
                        Approved by {activeBypass.reviewedByName || 'Owner'}
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        You can Check In now. Closing…
                      </p>
                    </div>
                  </div>
                ) : isRejected && activeBypass ? (
                  /* ── State: Rejected ── */
                  <>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-critical/15 text-critical"
                      >
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </span>
                      <div className="flex-1">
                        <h2 id="kart-override-title" className="text-base font-semibold text-default">
                          Rejected by {activeBypass.reviewedByName || 'Owner'}
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          The Owner declined this bypass. Amend the reason and try again, or close
                          and wait for the kart report.
                        </p>
                      </div>
                    </div>

                    {activeBypass.reviewNote ? (
                      <div className="mt-4 rounded-lg border border-critical/30 bg-critical/5 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-critical">
                          Reviewer note
                        </p>
                        <p className="mt-1 text-sm text-default">{activeBypass.reviewNote}</p>
                      </div>
                    ) : null}

                    <div className="mt-5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeBypassPopup}
                        className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-default"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        onClick={retryBypassRequest}
                        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-400"
                      >
                        Amend and resubmit
                      </button>
                    </div>
                  </>
                ) : isPending && activeBypass ? (
                  /* ── State: Pending Owner approval ── */
                  <>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/40" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                      </span>
                      <div className="flex-1">
                        <h2 id="kart-override-title" className="text-base font-semibold text-default">
                          Awaiting Owner approval
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          Request sent. This popup updates the moment the Owner approves or rejects
                          it. Keep it open.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 rounded-lg border border-border/70 bg-base/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Your request
                      </p>
                      <p className="mt-1 text-sm text-default">{activeBypass.reason}</p>
                      <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
                        Sent by {activeBypass.requestedByName || 'unknown'} ·{' '}
                        {fmtTimeShortIST(activeBypass.requestedAt)} · loc{' '}
                        {activeBypass.locationId || '—'}
                      </p>
                    </div>

                    <div className="mt-5 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => void cancelBypassRequest()}
                        className="rounded-md border border-border/70 px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-default"
                      >
                        Cancel request
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── State: Form (compose request) ── */
                  <>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500/15 text-lg text-amber-700 dark:text-amber-300"
                      >
                        ⚠
                      </span>
                      <div className="flex-1">
                        <h2 id="kart-override-title" className="text-base font-semibold text-default">
                          Request Owner approval
                        </h2>
                        <p className="mt-1 text-sm text-muted">
                          Track Marshall has not submitted today&apos;s kart report. The Owner must
                          approve this bypass before you can Check In.
                        </p>
                      </div>
                    </div>

                    <label
                      htmlFor="kart-override-reason"
                      className="mt-5 block text-xs font-semibold uppercase tracking-wide text-muted"
                    >
                      Reason for bypass
                    </label>
                    <textarea
                      id="kart-override-reason"
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault()
                          if (overrideReason.trim() && !bypassSubmitting) void submitBypassRequest()
                        }
                        if (event.key === 'Escape') setShowOverrideModal(false)
                      }}
                      rows={3}
                      placeholder="e.g. Track Marshall on leave; closing prior-day shift."
                      className="mt-2 w-full rounded-lg border border-border/70 bg-base px-3 py-2 text-sm text-default placeholder:text-muted focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    />
                    <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
                      Signed: {session?.user.name ?? 'unknown'} ·{' '}
                      {fmtTimeShortIST(new Date().toISOString())} · loc {locationKey || '—'}
                    </p>

                    {bypassError ? (
                      <p className="mt-3 rounded-md border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
                        {bypassError}
                      </p>
                    ) : null}

                    <div className="mt-5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowOverrideModal(false)}
                        className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-default"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitBypassRequest()}
                        disabled={!overrideReason.trim() || bypassSubmitting}
                        className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {bypassSubmitting ? 'Sending…' : 'Send request'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })()}

      {/* ── Settlement Dialog ── */}
      {showSettlement && (checkoutComplete || settlementActuals) && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-border/70 bg-panel p-6 shadow-2xl"
          >
            {/* ── Checkout Success State ── */}
            {checkoutComplete ? (
              <div className="flex flex-col items-center text-center gap-4 py-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
                  <svg
                    className="h-7 w-7 text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-text">
                    Shift Checkout Complete
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    Your shift has been settled successfully.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => void handlePrintDayReport()}
                    disabled={reportLoading}
                    className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                  >
                    {reportLoading ? 'Generating Report...' : 'Print Day Report'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseCheckoutSuccess}
                    className="w-full rounded-lg border border-border py-2.5 text-sm font-semibold text-muted transition-colors hover:text-text"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : settlementActuals ? (
              /* ── Settlement Form ── */
              <>
                <h3 className="mb-4 font-display text-lg font-bold text-text">Shift Settlement</h3>
                <p className="mb-4 text-sm text-muted">
                  Enter the total amounts collected today. Values must match system records exactly.
                </p>

                <div className="space-y-3">
                  {(['Cash', 'Card', 'UPI'] as const).map((method) => {
                    const enteredValue =
                      method === 'Cash'
                        ? settlementCash
                        : method === 'Card'
                          ? settlementCard
                          : settlementUpi
                    const setFn =
                      method === 'Cash'
                        ? setSettlementCash
                        : method === 'Card'
                          ? setSettlementCard
                          : setSettlementUpi

                    return (
                      <div key={method} className="flex items-center gap-3">
                        <label className="w-16 text-sm font-semibold text-text">{method}</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className="ui-field min-h-10 flex-1"
                          placeholder={`Enter ${method} total`}
                          value={enteredValue}
                          onChange={(e) => setFn(e.target.value)}
                        />
                      </div>
                    )
                  })}
                </div>

                <p className="mt-3 text-xs text-muted">
                  Transactions today: {settlementActuals.count}
                </p>

                {settlementFetchFailed && (
                  <div className="mt-2 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <strong>Warning:</strong> Could not load transaction data from the server.
                    Totals may be incorrect.
                    <button
                      type="button"
                      onClick={() => void openSettlement()}
                      className="ml-2 font-semibold text-amber-900 underline"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {settlementError && (
                  <p className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
                    {settlementError}
                  </p>
                )}

                {trackTaskWarning ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    <span className="text-base leading-none">⚠️</span>
                    <span>{trackTaskWarning}</span>
                  </div>
                ) : null}

                {(() => {
                  const cashMatch =
                    settlementCash !== '' && (Number(settlementCash) || 0) >= settlementActuals.Cash
                  const cardMatch =
                    settlementCard !== '' &&
                    (Number(settlementCard) || 0) === settlementActuals.Card
                  const upiMatch =
                    settlementUpi !== '' && (Number(settlementUpi) || 0) >= settlementActuals.UPI
                  const allMatch = cashMatch && cardMatch && upiMatch
                  const allFilled =
                    settlementCash !== '' && settlementCard !== '' && settlementUpi !== ''
                  const canCheckOut = allMatch || (settlementFetchFailed && allFilled)

                  return (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowSettlement(false)}
                        className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-muted transition-colors hover:text-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCheckOut()}
                        disabled={!canCheckOut || settlementLoading}
                        className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {settlementLoading ? 'Processing...' : 'Confirm Check Out'}
                      </button>
                    </div>
                  )
                })()}

                {!settlementFetchFailed &&
                  !(() => {
                    const cashMatch =
                      settlementCash === '' ||
                      (Number(settlementCash) || 0) >= settlementActuals.Cash
                    const cardMatch =
                      settlementCard === '' ||
                      (Number(settlementCard) || 0) === settlementActuals.Card
                    const upiMatch =
                      settlementUpi === '' || (Number(settlementUpi) || 0) >= settlementActuals.UPI
                    return cashMatch && cardMatch && upiMatch
                  })() && (
                    <p className="mt-2 text-center text-xs font-medium text-red-500">
                      Settlement mismatch — please verify amounts
                    </p>
                  )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Billing Disabled Overlay (Cashier not checked in) ── */}
      {!billingEnabled && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface py-20 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-text">Billing Locked</h3>
          <p className="mt-1 text-sm text-muted">
            Check in to start your shift and access billing features.
          </p>
        </div>
      )}

      {billingEnabled && (
        <>
          {posMode === 'restricted' && isProtocol && (
            <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white">
                P
              </span>
              Protocol Mode Active — Go-Karting lap rides only, {PROTOCOL_MAX_LAPS} laps FREE
            </div>
          )}
          {posMode === 'restricted' && isOffer && (
            <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 shadow-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-400 text-[10px] font-bold text-white">
                O
              </span>
              Offers Mode Active — Go-Karting offer items only, requires Owner approval
            </div>
          )}
          <div
            className={`flex flex-col gap-4 xl:flex-row ${posMode === 'restricted' && isProtocol ? 'mt-2 rounded-xl ring-2 ring-amber-400/60 p-2' : posMode === 'restricted' && isOffer ? 'mt-2 rounded-xl ring-2 ring-blue-400/60 p-2' : ''}`}
          >
            {/* ── LEFT: Activity Picker ── */}
            <div className="flex flex-col gap-3 xl:w-[55%]">
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {/* Location selector: Owner/Admin see switcher, Cashier sees single badge */}
                  {!isCashier && enabledLocations.length > 1 ? (
                    <div className="flex gap-1">
                      {enabledLocations.map((loc) => (
                        <button
                          key={loc.slug}
                          type="button"
                          onClick={() => setLocationKey(loc.slug)}
                          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                            locationKey === loc.slug
                              ? 'bg-accent text-white'
                              : 'border border-border bg-panel text-muted hover:text-text'
                          }`}
                        >
                          {loc.displayName}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm font-semibold text-accent">
                      {enabledLocations.find((l) => l.slug === locationKey)?.displayName ??
                        locationKey}
                    </span>
                  )}

                  {/* ── iOS-style Mode Slider ── */}
                  {(() => {
                    const hasPending = !!(protocolSubmittedBooking || offerSubmittedBooking)
                    const switchDisabled = submitting || !!pendingPaymentTxn || !!utrPendingTxn
                    const badgeColor =
                      restrictedNotification === 'approved'
                        ? 'bg-green'
                        : restrictedNotification === 'rejected'
                          ? 'bg-red'
                          : 'bg-amber'
                    const showBadge = posMode === 'normal' && (restrictedNotification || hasPending)
                    return (
                      <button
                        type="button"
                        disabled={switchDisabled}
                        onClick={() => {
                          if (switchDisabled) return
                          if (posMode === 'normal') {
                            // Save normal state
                            savedNormalState.current = {
                              cart,
                              customerName,
                              customerPhone,
                              couponCode,
                              categoryFilter,
                            }
                            // Restore restricted state or start fresh
                            const s = savedRestrictedState.current
                            if (s) {
                              setCart(s.cart)
                              setCustomerName(s.customerName)
                              setCustomerPhone(s.customerPhone)
                              setCouponCode(s.couponCode)
                              setCategoryFilter(s.categoryFilter)
                              setIsProtocol(s.isProtocol)
                              setIsOffer(s.isOffer)
                              setProtocolReason(s.protocolReason)
                              setProtocolRequestReady(s.protocolRequestReady)
                              setOfferReason(s.offerReason)
                              setOfferRequestReady(s.offerRequestReady)
                              nameAutoFilledRef.current = false
                            } else {
                              setCart([])
                              setCustomerName('')
                              setCustomerPhone('')
                              nameAutoFilledRef.current = false
                              setCouponCode('')
                            }
                            setCouponResult(null)
                            setMemberData(null)
                            setSubmitError(null)
                            setSubmitSuccess(null)
                            setRestrictedNotification(null)
                            setPosMode('restricted')
                          } else {
                            // Save restricted state
                            savedRestrictedState.current = {
                              cart,
                              customerName,
                              customerPhone,
                              couponCode,
                              categoryFilter,
                              isProtocol,
                              isOffer,
                              protocolReason,
                              protocolRequestReady,
                              offerReason,
                              offerRequestReady,
                            }
                            // Restore normal state or start fresh
                            const s = savedNormalState.current
                            if (s) {
                              setCart(s.cart)
                              setCustomerName(s.customerName)
                              setCustomerPhone(s.customerPhone)
                              setCouponCode(s.couponCode)
                              setCategoryFilter(s.categoryFilter)
                              nameAutoFilledRef.current = false
                            } else {
                              setCart([])
                              setCustomerName('')
                              setCustomerPhone('')
                              nameAutoFilledRef.current = false
                              setCouponCode('')
                              setCategoryFilter('All')
                            }
                            setIsProtocol(false)
                            setIsOffer(false)
                            setCouponResult(null)
                            setMemberData(null)
                            setSubmitError(null)
                            setSubmitSuccess(null)
                            setPosMode('normal')
                          }
                        }}
                        className={`relative h-10 w-[160px] shrink-0 rounded-xl border transition-all duration-300 disabled:opacity-50 ${
                          posMode === 'restricted'
                            ? 'border-amber-500/40 bg-amber-500/10'
                            : 'border-border/60 bg-surface'
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] bottom-[3px] w-[76px] rounded-lg shadow-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                            posMode === 'restricted'
                              ? 'left-[80px] bg-amber-500'
                              : 'left-[3px] bg-accent'
                          }`}
                        />
                        <span
                          className={`relative z-10 inline-block w-[76px] text-center text-[11px] font-bold uppercase tracking-wide transition-colors duration-300 ${
                            posMode === 'normal' ? 'text-white' : 'text-muted/60'
                          }`}
                        >
                          POS
                        </span>
                        <span
                          className={`relative z-10 inline-block w-[76px] text-center text-[11px] font-bold uppercase tracking-wide transition-colors duration-300 ${
                            posMode === 'restricted' ? 'text-white' : 'text-muted/60'
                          }`}
                        >
                          Special
                        </span>
                        {showBadge && (
                          <span className="absolute -right-1 -top-1 flex h-3 w-3">
                            <span
                              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${badgeColor}-400 opacity-75`}
                            />
                            <span
                              className={`relative inline-flex h-3 w-3 rounded-full ${badgeColor}-500`}
                            />
                          </span>
                        )}
                      </button>
                    )
                  })()}

                  {/* Activities | Events segmented toggle (visible only in normal POS mode) */}
                  {posMode === 'normal' && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setPosTab('activities')}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                          posTab === 'activities'
                            ? 'bg-accent/20 text-accent'
                            : 'border border-border text-muted hover:text-text'
                        }`}
                      >
                        Activities
                      </button>
                      <button
                        type="button"
                        onClick={() => setPosTab('events')}
                        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                          posTab === 'events'
                            ? 'bg-accent/20 text-accent'
                            : 'border border-border text-muted hover:text-text'
                        }`}
                      >
                        Events
                      </button>
                    </div>
                  )}

                  {/* Search bar — hidden in restricted landing and Events tab */}
                  {!(posMode === 'restricted' && !isProtocol && !isOffer) &&
                    !(posMode === 'normal' && posTab === 'events') && (
                      <input
                        className="ui-field min-h-9 flex-1"
                        placeholder="Search activities & combos..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    )}
                </div>

                {/* ── Restricted Mode Landing: Protocol & Offers cards ── */}
                {posMode === 'restricted' && !isProtocol && !isOffer ? (
                  <div className="py-4">
                    <div className="mb-5 text-center">
                      <h3 className="text-base font-bold text-text">Special Billing</h3>
                      <p className="text-xs text-muted mt-1">
                        Choose a mode below — both require Owner approval
                      </p>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setIsProtocol(true)
                          setIsOffer(false)
                          setCart([])
                          setSubmitError(null)
                          const goKartCat = activities.find((a) =>
                            isGoKartActivity(a.category),
                          )?.category
                          setCategoryFilter(goKartCat || 'All')
                        }}
                        className="group relative rounded-xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent p-5 text-left transition-all hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 cursor-pointer"
                      >
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15">
                          <svg
                            className="h-5 w-5 text-amber-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </div>
                        <h4 className="text-sm font-bold text-text">Protocol</h4>
                        <p className="mt-1 text-[11px] text-muted leading-relaxed">
                          Free Go-Karting rides — max {PROTOCOL_MAX_LAPS} laps per session
                        </p>
                        <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-amber-500">
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4l3 3" />
                          </svg>
                          Owner Approval
                        </div>
                        <div className="absolute top-3 right-3 text-muted/30 group-hover:text-muted/60 transition-colors">
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                          </svg>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsOffer(true)
                          setIsProtocol(false)
                          setCart([])
                          setSubmitError(null)
                          const goKartCat = activities.find((a) =>
                            isGoKartActivity(a.category),
                          )?.category
                          setCategoryFilter(goKartCat || 'All')
                        }}
                        className="group relative rounded-xl border border-blue-500/20 bg-gradient-to-b from-blue-500/5 to-transparent p-5 text-left transition-all hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/5 cursor-pointer"
                      >
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15">
                          <svg
                            className="h-5 w-5 text-blue-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                            <line x1="7" y1="7" x2="7.01" y2="7" />
                          </svg>
                        </div>
                        <h4 className="text-sm font-bold text-text">Offers</h4>
                        <p className="mt-1 text-[11px] text-muted leading-relaxed">
                          Go-Karting offer items with custom pricing
                        </p>
                        <div className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-blue-500">
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4l3 3" />
                          </svg>
                          Owner Approval
                        </div>
                        <div className="absolute top-3 right-3 text-muted/30 group-hover:text-muted/60 transition-colors">
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M5 12h14" />
                            <path d="m12 5 7 7-7 7" />
                          </svg>
                        </div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ── Back button for restricted sub-mode ── */}
                    {posMode === 'restricted' && (isProtocol || isOffer) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsProtocol(false)
                          setIsOffer(false)
                          setCart([])
                          setCategoryFilter('All')
                        }}
                        className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-text cursor-pointer"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Back to Special Options
                      </button>
                    )}

                    {isProtocol && (
                      <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white">
                          P
                        </span>
                        Protocol Mode — Go-Karting Lap Rides Only
                      </div>
                    )}

                    {posMode === 'normal' && posTab === 'events' ? (
                      eventsLoading ? (
                        <p className="text-sm text-muted">Loading events...</p>
                      ) : eventsForPos.length === 0 ? (
                        <p className="text-sm text-muted">
                          No active event campaigns with packages enabled for billing in this
                          branch.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {eventsForPos.map((evt) => (
                            <div
                              key={evt.id}
                              className="rounded-xl border border-border bg-surface p-3"
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-sm font-bold uppercase tracking-wider text-text">
                                  {evt.title}
                                </p>
                                <span className="text-[10px] text-muted">
                                  {evt.startDate} – {evt.endDate}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {(evt.packages ?? [])
                                  .filter((pkg) => pkg.enabled !== false)
                                  .map((pkg) => {
                                    const total = calculatePackageTotal(pkg)
                                    const cartKey = `event-${evt.id}-pkg-${pkg.id}`
                                    const qty = cart.find((c) => c.key === cartKey)?.quantity ?? 0
                                    const freeForPkg =
                                      packageDiscountByEvent
                                        .get(evt.id)
                                        ?.freeByPackage.get(pkg.id) ?? 0
                                    return (
                                      <div
                                        key={pkg.id}
                                        className="rounded-lg border border-border bg-panel px-3 py-2"
                                      >
                                        <div className="mb-1 flex items-center gap-1.5">
                                          <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                                            Event
                                          </span>
                                          {freeForPkg > 0 && (
                                            <span className="shrink-0 rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-green-600">
                                              {freeForPkg} FREE
                                            </span>
                                          )}
                                          <p className="truncate text-sm font-semibold text-text">
                                            {pkg.title || 'Package'}
                                          </p>
                                        </div>
                                        {(() => {
                                          const enabled = pkg.items.filter(
                                            (it) => it.enabled !== false,
                                          )
                                          return (
                                            <>
                                              <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                                                {enabled
                                                  .map((it) => it.name)
                                                  .filter(Boolean)
                                                  .join(', ') || 'No items'}
                                              </p>
                                              <p className="mt-0.5 text-[10px] text-muted">
                                                {enabled.length} item
                                                {enabled.length === 1 ? '' : 's'}
                                              </p>
                                            </>
                                          )
                                        })()}
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-bold text-accent">
                                            {currency(total)}
                                          </span>
                                          {qty === 0 ? (
                                            <button
                                              type="button"
                                              onClick={() => addPackageToCart(evt, pkg)}
                                              className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/25"
                                            >
                                              + Add
                                            </button>
                                          ) : (
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() => updateQty(cartKey, -1)}
                                                className="flex h-6 w-6 items-center justify-center rounded border border-border text-sm text-muted transition-colors hover:text-text"
                                              >
                                                −
                                              </button>
                                              <span className="w-6 text-center text-sm font-semibold text-text">
                                                {qty}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => updateQty(cartKey, 1)}
                                                className="flex h-6 w-6 items-center justify-center rounded border border-border text-sm text-muted transition-colors hover:text-text"
                                              >
                                                +
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    ) : (
                      <>
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {categories.map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setCategoryFilter(cat)}
                              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                                categoryFilter === cat
                                  ? 'bg-accent/20 text-accent'
                                  : 'border border-border text-muted hover:text-text'
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                          <span className="mx-1 h-5 w-px bg-border/50" />
                          <button
                            type="button"
                            onClick={() =>
                              setAudienceFilter(
                                audienceFilter === 'Adult-Navy' ? null : 'Adult-Navy',
                              )
                            }
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                              audienceFilter === 'Adult-Navy'
                                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                                : 'border border-border text-muted hover:text-text'
                            }`}
                          >
                            Adult-Navy
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAudienceFilter(
                                audienceFilter === 'Child-Navy' ? null : 'Child-Navy',
                              )
                            }
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                              audienceFilter === 'Child-Navy'
                                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                : 'border border-border text-muted hover:text-text'
                            }`}
                          >
                            Child-Navy
                          </button>
                          <button
                            type="button"
                            onClick={repeatLastTransaction}
                            disabled={!lastRepeatableTransaction?.items?.length}
                            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                              lastRepeatableTransaction?.items?.length
                                ? 'border border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'
                                : 'border border-border text-muted/40 cursor-not-allowed'
                            }`}
                            title={
                              lastRepeatableTransaction?.items?.length
                                ? `Repeat: ${lastRepeatableTransaction.invoiceNumber}`
                                : 'No previous transaction'
                            }
                          >
                            Repeat
                          </button>
                        </div>

                        {loadingActivities ? (
                          <p className="text-sm text-muted">Loading activities...</p>
                        ) : filteredActivities.length === 0 && filteredCombos.length === 0 ? (
                          <p className="text-sm text-muted">No activities found.</p>
                        ) : (
                          <div className="space-y-3">
                            {/* ── SubGame-grouped Activity Cards ──
                            Each card uses CSS `content-visibility: auto` so
                            the browser skips layout/paint of off-screen
                            cards entirely. With 150-200 activities × ~5
                            variants each, this is a near-virtualization
                            speed-up without pulling in react-window. The
                            `contain-intrinsic-size` reserves space so the
                            scroll container doesn't jump as cards enter
                            the viewport.
                            See: https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility */}
                            {groupedActivities.length > 0 && (
                              <div className="flex items-start gap-3 overflow-x-auto pb-1">
                                {groupedActivities.map(([subGame, variants]) => (
                                  <div
                                    key={subGame}
                                    className="min-w-[200px] flex-shrink-0 rounded-xl border border-border bg-surface p-3 [content-visibility:auto] [contain-intrinsic-size:220px_200px]"
                                  >
                                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
                                      {subGame}
                                    </p>
                                    <div className="flex flex-col gap-1.5">
                                      {variants.map((activity) => {
                                        const price =
                                          activity.branchPrices[slugToBranchId(locationKey)] ?? 0
                                        const vKey = `${activity.gameId}_${activity.subGameId}_${activity.variantId}`
                                        const isNP = nonPerformingKeys.has(vKey)
                                        const isGoKartHighLaps =
                                          isGoKartActivity(activity.category) &&
                                          typeof activity.laps === 'number' &&
                                          activity.laps >= 12
                                        const hasIncentive = isNP || isGoKartHighLaps

                                        return (
                                          <button
                                            key={activity.id}
                                            type="button"
                                            onClick={() => addToCart(activity)}
                                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                                              isNP
                                                ? 'border-amber-500/60 bg-amber-500/5 hover:border-amber-400 hover:bg-amber-500/10'
                                                : isGoKartHighLaps
                                                  ? 'border-green-500/60 bg-green-500/5 hover:border-green-400 hover:bg-green-500/10'
                                                  : 'border-border bg-panel hover:border-accent/40 hover:bg-accent/5'
                                            }`}
                                          >
                                            <div className="min-w-0">
                                              <p className="text-sm font-semibold text-text">
                                                {activity.name}
                                              </p>
                                              <p className="text-xs text-muted">
                                                {activity.category}
                                              </p>
                                              {hasIncentive && (
                                                <span
                                                  className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${
                                                    isNP
                                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                                                      : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                                  }`}
                                                >
                                                  {isNP
                                                    ? '2% Incentive · NP'
                                                    : '2% Incentive · ≥12 Laps'}
                                                </span>
                                              )}
                                            </div>
                                            <span
                                              className={`ml-2 shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${isProtocol ? 'bg-amber-100 text-amber-700' : 'bg-accent/10 text-accent'}`}
                                            >
                                              {isProtocol ? 'FREE' : currency(price)}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* ── Combo Cards ── (inside Activities tab branch) */}
                            {filteredCombos.length > 0 && (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {filteredCombos.map((combo) => {
                                  // Check if any combo item qualifies for incentive
                                  const comboIncentiveItems = combo.items.filter((ci) => {
                                    const ciKey = `${ci.gameId}_${ci.subGameId}_${ci.variantId}`
                                    if (nonPerformingKeys.has(ciKey)) return true
                                    // Check GoKart ≥12 laps via activity catalog lookup
                                    const isGK = /kart/i.test(ci.itemName)
                                    if (!isGK) return false
                                    const catalogMatch = activities.find(
                                      (a) =>
                                        a.gameId === ci.gameId &&
                                        a.subGameId === ci.subGameId &&
                                        a.variantId === ci.variantId,
                                    )
                                    if (
                                      catalogMatch &&
                                      typeof catalogMatch.laps === 'number' &&
                                      catalogMatch.laps >= 12
                                    )
                                      return true
                                    // Fallback: parse laps from item name
                                    const lapMatch = ci.itemName.match(/(\d+)\s*laps?/i)
                                    return lapMatch ? Number(lapMatch[1]) >= 12 : false
                                  })
                                  const hasComboIncentive = comboIncentiveItems.length > 0
                                  const hasNP = comboIncentiveItems.some((ci) =>
                                    nonPerformingKeys.has(
                                      `${ci.gameId}_${ci.subGameId}_${ci.variantId}`,
                                    ),
                                  )

                                  return (
                                    <button
                                      key={combo.id}
                                      type="button"
                                      onClick={() => addComboToCart(combo)}
                                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                                        hasComboIncentive
                                          ? hasNP
                                            ? 'border-amber-500/60 bg-amber-500/5 hover:border-amber-400 hover:bg-amber-500/10'
                                            : 'border-green-500/60 bg-green-500/5 hover:border-green-400 hover:bg-green-500/10'
                                          : 'border-accent/30 bg-accent/5 hover:border-accent/60 hover:bg-accent/10'
                                      }`}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                                            Combo
                                          </span>
                                          <p className="truncate text-sm font-semibold text-text">
                                            {combo.name}
                                          </p>
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-muted">
                                          {combo.items.map((i) => i.itemName).join(', ')}
                                        </p>
                                        {combo.originalTotal > combo.comboPrice && (
                                          <p className="text-[10px] font-semibold text-green-600">
                                            Save {currency(combo.originalTotal - combo.comboPrice)}
                                          </p>
                                        )}
                                        {hasComboIncentive && (
                                          <span
                                            className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold ${
                                              hasNP
                                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                                                : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                            }`}
                                          >
                                            2% Incentive · {comboIncentiveItems.length} item
                                            {comboIncentiveItems.length > 1 ? 's' : ''}
                                          </span>
                                        )}
                                      </div>
                                      <div className="ml-2 shrink-0 text-right">
                                        <span className="rounded-md bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                                          {currency(combo.comboPrice)}
                                        </span>
                                        <p className="mt-0.5 text-[10px] text-muted line-through">
                                          {currency(combo.originalTotal)}
                                        </p>
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ── RIGHT: Cart + Checkout ── */}
            <div className="flex flex-col gap-3 xl:w-[45%]">
              <form onSubmit={onSubmit} className="flex flex-col gap-3">
                {/* Cart */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-display text-lg font-bold uppercase tracking-wide text-text">
                      Cart
                    </h3>
                    {cart.length > 0 && (
                      <button
                        type="button"
                        onClick={clearCart}
                        className="text-xs text-critical hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {cart.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted">
                      Select activities from the left to add them here.
                    </p>
                  ) : (
                    (() => {
                      const totalCartQty = cart.reduce((sum, c) => sum + c.quantity, 0)
                      return (
                        <div className="flex flex-col gap-2">
                          {cart.map((item) => {
                            const pricing = cartLinePricing.get(item.key)
                            const showSavings = !isProtocol && !!pricing && pricing.lineSavings > 0
                            return (
                              <div
                                key={item.key}
                                className={`flex items-center gap-2 rounded-lg border bg-panel px-3 py-2 ${isProtocol ? 'border-amber-300/60' : 'border-border'}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="truncate text-sm font-medium text-text">
                                    {isProtocol && (
                                      <span className="mr-1 inline-block rounded bg-amber-400/20 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                                        Protocol
                                      </span>
                                    )}
                                    {item.isCombo && (
                                      <span className="mr-1 inline-block rounded bg-accent/20 px-1 py-0.5 text-[10px] font-bold uppercase text-accent">
                                        Combo
                                      </span>
                                    )}
                                    {item.isEventPackage && (
                                      <span className="mr-1 inline-block rounded bg-accent/20 px-1 py-0.5 text-[10px] font-bold uppercase text-accent">
                                        Event
                                      </span>
                                    )}
                                    {item.isEventPackage &&
                                      (packageFreeByCartKey.get(item.key) ?? 0) > 0 && (
                                        <span className="mr-1 inline-block rounded bg-green-500/20 px-1 py-0.5 text-[10px] font-bold uppercase text-green-600">
                                          {packageFreeByCartKey.get(item.key)} FREE
                                        </span>
                                      )}
                                    {item.itemName}
                                  </p>
                                  <p className="text-xs text-muted">
                                    {isProtocol ? (
                                      '₹0'
                                    ) : showSavings && pricing!.originalUnit > item.unitPrice ? (
                                      <>
                                        <span className="text-muted line-through">
                                          {currency(pricing!.originalUnit)}
                                        </span>{' '}
                                        <span className="text-text">
                                          {currency(item.unitPrice)}
                                        </span>{' '}
                                        each
                                      </>
                                    ) : (
                                      `${currency(item.unitPrice)} each`
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => updateQty(item.key, -1)}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-border text-sm text-muted hover:text-text"
                                  >
                                    -
                                  </button>
                                  <span className="w-6 text-center text-sm font-semibold text-text">
                                    {item.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updateQty(item.key, 1)}
                                    disabled={isProtocol && totalCartQty >= PROTOCOL_MAX_LAPS}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-border text-sm text-muted hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    +
                                  </button>
                                </div>
                                {isProtocol ? (
                                  <span className="w-20 text-right text-sm font-semibold text-text">
                                    ₹0
                                  </span>
                                ) : showSavings ? (
                                  <div className="w-24 text-right">
                                    <span className="block text-[10px] text-muted line-through">
                                      {currency(pricing!.originalLineTotal)}
                                    </span>
                                    <span className="block text-sm font-semibold text-text">
                                      {currency(pricing!.finalLineTotal)}
                                    </span>
                                    <span className="block text-[10px] font-semibold text-success">
                                      Save {currency(pricing!.lineSavings)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="w-20 text-right text-sm font-semibold text-text">
                                    {currency(item.unitPrice * item.quantity)}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeFromCart(item.key)}
                                  className="ml-1 text-xs text-critical hover:underline"
                                >
                                  ✕
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()
                  )}

                  {/* Totals */}
                  {isProtocol ? (
                    <div className="mt-3 border-t border-amber-300/60 pt-3">
                      <div className="flex items-center justify-center rounded-lg border-2 border-amber-400/60 bg-amber-50 px-4 py-3">
                        <span className="text-base font-extrabold tracking-widest text-amber-700">
                          PROTOCOL — FREE
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                      {hasAnyDiscount && (
                        <div className="flex justify-between text-muted">
                          <span>Original Amount</span>
                          <span className="line-through">{currency(originalSubtotal)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-muted">
                        <span>Base Amount</span>
                        <span>{currency(baseAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted">
                        <span>Coupon</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="Enter code"
                            value={couponCode}
                            onChange={(e) => {
                              setCouponCode(e.target.value)
                              setCouponResult(null)
                            }}
                            className="ui-field h-7 w-28 text-sm"
                          />
                          <button
                            type="button"
                            disabled={!couponCode.trim() || validatingCoupon || cart.length === 0}
                            onClick={() => void handleApplyCoupon()}
                            className="rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent disabled:opacity-50"
                          >
                            {validatingCoupon ? '...' : 'Apply'}
                          </button>
                          {couponResult?.valid && (
                            <button
                              type="button"
                              onClick={() => {
                                setCouponCode('')
                                setCouponResult(null)
                              }}
                              className="text-xs text-critical"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                      {couponResult && !couponResult.valid && (
                        <p className="text-right text-xs text-critical">
                          {couponResult.errorMessage}
                        </p>
                      )}
                      {couponResult?.valid && (
                        <div className="flex justify-between text-sm text-success">
                          <span>Coupon ({couponResult.coupon?.code})</span>
                          <span>-{currency(couponDiscount)}</span>
                        </div>
                      )}
                      {packageBxgyDiscountTotal > 0 && (
                        <div className="flex justify-between text-sm text-success">
                          <span>Event offer (Buy X Get Y)</span>
                          <span>-{currency(packageBxgyDiscountTotal)}</span>
                        </div>
                      )}
                      {packageFlatDiscountTotal > 0 && (
                        <div className="flex justify-between text-sm text-success">
                          <span>Flat event discount</span>
                          <span>-{currency(packageFlatDiscountTotal)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-muted">
                        <span>GST ({GST_PERCENT}%)</span>
                        <span>{currency(gstAmount)}</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-text">
                        <span>Total</span>
                        <span>{currency(total)}</span>
                      </div>
                      {walletRedemptionAmount > 0 && (
                        <>
                          <div className="flex justify-between text-sm text-success">
                            <span>Wallet redeemed</span>
                            <span>-{currency(walletRedemptionAmount)}</span>
                          </div>
                          <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-text">
                            <span>Payable</span>
                            <span>{currency(totalAfterWallet)}</span>
                          </div>
                        </>
                      )}
                      {hasAnyDiscount && (
                        <div className="mt-2 flex items-center justify-center rounded-lg bg-success/10 px-3 py-2">
                          <span className="text-sm font-bold text-success">
                            You Saved {currency(totalSavings)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Customer Info Card */}
                {memberLoading && (
                  <div className="rounded-xl border border-border bg-surface p-3 text-center text-sm text-muted animate-pulse">
                    Looking up customer...
                  </div>
                )}
                {(customerData || memberData) && !memberLoading && (
                  <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold uppercase tracking-wide text-accent">
                        Customer Details
                      </h3>
                      <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-bold text-accent">
                        {customerData?.tier || memberData?.membership || 'bronze'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                      <div>
                        <span className="text-xs text-muted">Name</span>
                        <p className="font-semibold text-text">
                          {customerData?.displayName || memberData?.name || '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">Total Visits</span>
                        <p className="font-semibold text-text">{memberData?.totalVisits ?? 0}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">Total Spent</span>
                        <p className="font-semibold text-text">
                          {currency(memberData?.totalBillAmount ?? customerData?.totalSpent ?? 0)}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-muted">₹150 Coupons</span>
                        <p
                          className={`font-bold ${(memberData?.coupons150Available ?? 0) > 0 ? 'text-success' : 'text-muted'}`}
                        >
                          {memberData?.coupons150Available ?? 0} available
                        </p>
                      </div>
                    </div>

                    {/* Coupon Codes Section */}
                    {memberCouponCodes.length > 0 && (
                      <div className="mt-3 border-t border-accent/20 pt-3">
                        <button
                          type="button"
                          onClick={() => setShowCouponCodes(!showCouponCodes)}
                          className="flex items-center gap-1 text-xs font-bold text-accent hover:text-accent/80 transition-colors"
                        >
                          <span>Coupon Codes ({memberCouponCodes.length})</span>
                          <span
                            className={`transition-transform ${showCouponCodes ? 'rotate-180' : ''}`}
                          >
                            ▼
                          </span>
                        </button>
                        {showCouponCodes && (
                          <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                            {memberCouponCodes.map((c) => (
                              <div
                                key={c.id}
                                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-xs ${c.isUsed ? 'bg-muted/10 opacity-50' : 'bg-accent/10'}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-text">{c.code}</span>
                                  <span className="text-muted">
                                    ₹{c.discount} {c.type}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {c.expiryDate && (
                                    <span className="text-muted">exp {c.expiryDate}</span>
                                  )}
                                  <span
                                    className={`font-bold ${c.isUsed ? 'text-red-400' : 'text-success'}`}
                                  >
                                    {c.isUsed ? 'Used' : 'Active'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Wallet redemption — only shown when the looked-up customer
                    has a positive balance. The actual debit happens inside
                    createUnifiedBooking via deductCustomerWallet. */}
                {customerData && availableWalletBalance > 0 && !isProtocol && (
                  <div className="rounded-xl border border-accent/40 bg-accent/5 p-3">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
                          checked={redeemWallet}
                          onChange={(e) => setRedeemWallet(e.target.checked)}
                        />
                        <div className="flex-1">
                          <div className="text-sm font-bold text-text">Redeem wallet balance</div>
                          <div className="text-xs text-muted">
                            Available: {currency(availableWalletBalance)}
                            {redeemWallet && walletRedemptionAmount > 0 && (
                              <>
                                {' '}
                                · applying {currency(walletRedemptionAmount)}
                                {walletRedemptionAmount < availableWalletBalance
                                  ? ' (capped at order total)'
                                  : ''}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </label>
                  </div>
                )}

                {/* Customer + Payment */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-text">
                    Customer & Payment
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      className="ui-field min-h-10"
                      placeholder="Customer name *"
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value)
                        nameAutoFilledRef.current = false
                      }}
                      required
                    />
                    <input
                      className="ui-field min-h-10"
                      placeholder="Phone number *"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      required
                    />
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">
                        Billing Date
                      </label>
                      <div className="ui-field min-h-10 w-full flex items-center text-sm text-muted cursor-not-allowed opacity-75">
                        {billingDate}
                      </div>
                    </div>
                    {!isProtocol && (
                      <select
                        className="ui-field min-h-10 sm:col-span-2"
                        value={paymentMethod}
                        onChange={(e) => {
                          const v = e.target.value as 'Cash' | 'Card' | 'UPI' | 'Razorpay' | 'Split'
                          setPaymentMethod(v)
                          if (v !== 'Split') {
                            setSplitCash('')
                            setSplitUpi('')
                            setSplitCard('')
                          }
                        }}
                      >
                        <option value="Cash">Cash</option>
                        <option value="Card">Card</option>
                        <option value="UPI">UPI</option>
                        <option value="Razorpay">Razorpay</option>
                        <option value="Split">Split Payment</option>
                      </select>
                    )}

                    {/* Split Payment Fields */}
                    {!isProtocol && paymentMethod === 'Split' && (
                      <div className="sm:col-span-2 space-y-2 rounded-lg border border-border bg-panel p-3">
                        <p className="text-xs font-semibold text-muted">
                          Split across Cash, UPI & Card
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-muted">
                              Cash
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="ui-field min-h-9 w-full text-sm"
                              placeholder="0"
                              value={splitCash}
                              onChange={(e) => setSplitCash(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-muted">
                              UPI
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="ui-field min-h-9 w-full text-sm"
                              placeholder="0"
                              value={splitUpi}
                              onChange={(e) => setSplitUpi(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-muted">
                              Card
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="ui-field min-h-9 w-full text-sm"
                              placeholder="0"
                              value={splitCard}
                              onChange={(e) => setSplitCard(e.target.value)}
                            />
                          </div>
                        </div>
                        {(() => {
                          const splitTotal =
                            (Number(splitCash) || 0) +
                            (Number(splitUpi) || 0) +
                            (Number(splitCard) || 0)
                          const diff = totalAfterWallet - splitTotal
                          return (
                            <div
                              className={`text-xs font-semibold ${Math.abs(diff) < 0.01 ? 'text-success' : 'text-critical'}`}
                            >
                              Split total: {currency(splitTotal)} / {currency(totalAfterWallet)}
                              {Math.abs(diff) >= 0.01 &&
                                ` — ${diff > 0 ? `₹${diff.toFixed(0)} remaining` : `₹${Math.abs(diff).toFixed(0)} over`}`}
                            </div>
                          )
                        })()}
                      </div>
                    )}

                    {/* Protocol reason */}
                    {isProtocol && (
                      <div className="sm:col-span-2">
                        <input
                          className="ui-field min-h-10 w-full"
                          placeholder="Reason for protocol *"
                          value={protocolReason}
                          onChange={(e) => setProtocolReason(e.target.value)}
                          required
                        />
                      </div>
                    )}
                    {isProtocol && (
                      <div className="sm:col-span-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                        Protocol booking: ₹0 — Go-Karting lap rides only (no photoshoots/add-ons),
                        max {PROTOCOL_MAX_LAPS} laps. Pending Owner approval.
                      </div>
                    )}
                    {/* Offer reason */}
                    {isOffer && (
                      <div className="sm:col-span-2">
                        <input
                          className="ui-field min-h-10 w-full"
                          placeholder="Reason for offer *"
                          value={offerReason}
                          onChange={(e) => setOfferReason(e.target.value)}
                          required
                        />
                      </div>
                    )}
                    {isOffer && (
                      <div className="sm:col-span-2 rounded-lg border border-blue-400/40 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        Offer booking: Go-Karting offers only — real pricing applies. Pending Owner
                        approval.
                      </div>
                    )}
                  </div>
                </div>

                {submitError && (
                  <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
                    {submitError}
                  </p>
                )}
                {submitSuccess && (
                  <div className="flex items-center justify-between rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
                    <span>{submitSuccess}</span>
                    <button
                      type="button"
                      onClick={() => setSubmitSuccess(null)}
                      className="ml-2 text-xs font-bold hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* UPI UTR last-4-digits prompt (normal mode only) */}
                {posMode === 'normal' && utrPendingTxn && (
                  <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
                    <div
                      role="dialog"
                      aria-modal="true"
                      className="w-full max-w-xs rounded-2xl border border-border/70 bg-panel p-6 shadow-2xl"
                    >
                      <h3 className="font-display text-center text-lg font-bold text-text">
                        UPI Payment Reference
                      </h3>
                      <p className="mt-1 text-center text-sm text-muted">
                        Enter the last 4 digits of the UTR number
                      </p>
                      <p className="mt-2 text-center text-2xl font-bold text-primary">
                        {currency(utrPendingTxn.totalAmount)}
                      </p>
                      <p className="mt-1 text-center text-xs text-muted">
                        Invoice:{' '}
                        <span className="font-mono font-semibold text-text">
                          {utrPendingTxn.invoiceNumber}
                        </span>
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={utrDigits}
                        onChange={(e) =>
                          setUtrDigits(e.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && utrDigits.length === 4) void handleUtrSubmit()
                        }}
                        placeholder="Last 4 digits"
                        // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: focus UTR input on prompt open
                        autoFocus
                        className="ui-field mt-4 w-full text-center text-2xl font-mono tracking-[0.5em]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleUtrSubmit()}
                        disabled={utrDigits.length !== 4 || utrSaving}
                        className="ui-btn ui-btn-primary mt-4 w-full"
                      >
                        {utrSaving ? 'Saving...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}

                {posMode === 'normal' ? (
                  // ── Normal POS: standard checkout chain ──
                  completedTransaction ? (
                    <BillingConfirmation
                      transaction={completedTransaction}
                      locationLabel={getLocationDisplayName(completedTransaction.locationId ?? '')}
                      onDismiss={() => setCompletedTransaction(null)}
                    />
                  ) : pendingPaymentTxn ? (
                    <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
                      <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-sm rounded-2xl border border-border/70 bg-panel p-8 text-center shadow-2xl"
                      >
                        {/* Status icon */}
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
                          <svg
                            className="h-8 w-8 animate-pulse text-primary"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </div>

                        <h3 className="font-display text-lg font-bold text-text">
                          Waiting for Payment
                        </h3>

                        {/* Amount */}
                        <p className="mt-2 text-3xl font-bold text-primary">
                          {currency(pendingPaymentTxn.totalAmount)}
                        </p>

                        {/* Invoice */}
                        <p className="mt-1 text-sm text-muted">
                          Invoice:{' '}
                          <span className="font-mono font-semibold text-text">
                            {pendingPaymentTxn.invoiceNumber}
                          </span>
                        </p>

                        {/* Error message */}
                        {qrError && (
                          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                            {qrError}
                          </p>
                        )}

                        {/* Status indicator */}
                        <div className="mt-4 flex items-center justify-center gap-2">
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-warning" />
                          </span>
                          <span className="text-sm font-medium text-warning">
                            {qrImageUrl === 'checkout-open'
                              ? 'Razorpay checkout is open...'
                              : 'Waiting for payment...'}
                          </span>
                        </div>

                        {/* Countdown */}
                        <p className="mt-3 text-2xl font-bold tabular-nums text-text">
                          {Math.floor(paymentCountdown / 60)}:
                          {String(paymentCountdown % 60).padStart(2, '0')}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          Auto-fails if not confirmed within time
                        </p>

                        {/* Reopen checkout */}
                        {qrError && (
                          <button
                            type="button"
                            onClick={() => {
                              setQrError(null)
                              // Reuse cached order — never call Cloud Function twice for same transaction
                              const cached = rzpOrderCache
                              if (!cached) {
                                setQrError('Could not reopen checkout — please cancel and retry.')
                                return
                              }
                              void loadRazorpaySDK().then(() => {
                                const rzp = new window.Razorpay({
                                  key: cached.key,
                                  amount: cached.amount,
                                  currency: 'INR',
                                  name: 'A Square GoKarting',
                                  order_id: cached.orderId,
                                  prefill: {
                                    name: cached.customerName,
                                    contact: cached.customerPhone,
                                  },
                                  theme: { color: '#0066FF' },
                                  payment_capture: 1,
                                  handler: async (resp: { razorpay_payment_id: string }) => {
                                    try {
                                      await billingApi.updateTransactionPaymentStatus(
                                        pendingPaymentTxn.id,
                                        {
                                          paymentStatus: 'completed',
                                          paymentReference: resp.razorpay_payment_id,
                                        },
                                      )
                                    } catch {
                                      /* swallowed: status will be picked up by polling */
                                    }
                                    stopPaymentPolling()
                                    setPendingPaymentTxn(null)
                                    const updated = {
                                      ...pendingPaymentTxn,
                                      paymentStatus: 'completed' as const,
                                    }
                                    setCompletedTransaction(updated)
                                    void handlePrintReceipt(updated)
                                  },
                                  modal: { ondismiss: () => setQrError('Payment window closed.') },
                                })
                                rzp.open()
                                setQrImageUrl('checkout-open')
                              })
                            }}
                            className="mt-4 w-full rounded-xl bg-primary/20 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/30"
                          >
                            Reopen Payment Window
                          </button>
                        )}

                        {/* Cancel button */}
                        <button
                          type="button"
                          onClick={cancelPendingPayment}
                          className="mt-3 w-full rounded-xl border border-critical/40 bg-critical/10 py-3 text-sm font-semibold text-critical transition-colors hover:bg-critical/20"
                        >
                          Cancel & Mark as Failed
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="submit"
                      disabled={submitting || cart.length === 0}
                      className="ui-btn ui-btn-primary disabled:opacity-50"
                    >
                      {submitting
                        ? 'Processing...'
                        : paymentMethod === 'Cash' ||
                            paymentMethod === 'Card' ||
                            paymentMethod === 'UPI' ||
                            paymentMethod === 'Split'
                          ? `Print Billing — ${currency(totalAfterWallet)}`
                          : `Generate QR — ${currency(totalAfterWallet)}`}
                    </button>
                  )
                ) : // ── Restricted Mode: inline approval or submit ──
                offerSubmittedBooking ? (
                  <ProtocolAwaitingApproval
                    mode="offer"
                    inline
                    bookingId={offerSubmittedBooking.id}
                    customerName={offerSubmittedBooking.customerName}
                    reason={offerSubmittedBooking.reason}
                    status={offerApprovalStatus}
                    rejectReason={offerRejectReason}
                    approvedBy={offerApprovedBy}
                    onPrint={() => {
                      if (offerApprovedTransaction)
                        void handlePrintReceipt(offerApprovedTransaction)
                      setOfferSubmittedBooking(null)
                      setOfferApprovalStatus('pending')
                      setOfferRejectReason('')
                      setOfferApprovedBy(undefined)
                      setOfferApprovedTransaction(null)
                      setOfferReason('')
                      setOfferRequestReady(false)
                      setRestrictedNotification(null)
                    }}
                    onSwitchToNormal={() => setPosMode('normal')}
                    onCancel={async () => {
                      if (!offerSubmittedBooking) return
                      const bookingId = offerSubmittedBooking.id
                      // Clear state first to tear down the real-time listener before deletion
                      setOfferSubmittedBooking(null)
                      setOfferApprovalStatus('pending')
                      setOfferRejectReason('')
                      setOfferApprovedBy(undefined)
                      setOfferApprovedTransaction(null)
                      setOfferReason('')
                      setOfferRequestReady(false)
                      setRestrictedNotification(null)
                      try {
                        const { asquareBookingsApi: api } =
                          await import('../../api/asquare-bookings')
                        await api.cancelOfferRequest(bookingId)
                      } catch {
                        /* draft may already be gone */
                      }
                    }}
                    onNewTransaction={() => {
                      setOfferSubmittedBooking(null)
                      setOfferApprovalStatus('pending')
                      setOfferRejectReason('')
                      setOfferApprovedBy(undefined)
                      setOfferApprovedTransaction(null)
                      setOfferReason('')
                      setOfferRequestReady(false)
                      setRestrictedNotification(null)
                    }}
                    printEnabled={offerApprovalStatus === 'approved' && !!offerApprovedTransaction}
                  />
                ) : protocolSubmittedBooking ? (
                  <ProtocolAwaitingApproval
                    inline
                    bookingId={protocolSubmittedBooking.id}
                    customerName={protocolSubmittedBooking.customerName}
                    reason={protocolSubmittedBooking.reason}
                    status={protocolApprovalStatus}
                    rejectReason={protocolRejectReason}
                    approvedBy={protocolApprovedBy}
                    onPrint={() => {
                      if (protocolApprovedTransaction)
                        void handlePrintReceipt(protocolApprovedTransaction)
                      setProtocolSubmittedBooking(null)
                      setProtocolApprovalStatus('pending')
                      setProtocolRejectReason('')
                      setProtocolApprovedBy(undefined)
                      setProtocolApprovedTransaction(null)
                      setProtocolReason('')
                      setProtocolRequestReady(false)
                      setRestrictedNotification(null)
                    }}
                    onSwitchToNormal={() => setPosMode('normal')}
                    onCancel={async () => {
                      if (!protocolSubmittedBooking) return
                      const bookingId = protocolSubmittedBooking.id
                      setProtocolSubmittedBooking(null)
                      setProtocolApprovalStatus('pending')
                      setProtocolRejectReason('')
                      setProtocolApprovedBy(undefined)
                      setProtocolApprovedTransaction(null)
                      setProtocolReason('')
                      setProtocolRequestReady(false)
                      setRestrictedNotification(null)
                      try {
                        const { asquareBookingsApi: api } =
                          await import('../../api/asquare-bookings')
                        await api.cancelProtocolRequest(bookingId)
                      } catch {
                        /* draft may already be gone */
                      }
                    }}
                    onNewTransaction={() => {
                      setProtocolSubmittedBooking(null)
                      setProtocolApprovalStatus('pending')
                      setProtocolRejectReason('')
                      setProtocolApprovedBy(undefined)
                      setProtocolApprovedTransaction(null)
                      setProtocolReason('')
                      setProtocolRequestReady(false)
                      setRestrictedNotification(null)
                    }}
                    printEnabled={
                      protocolApprovalStatus === 'approved' && !!protocolApprovedTransaction
                    }
                  />
                ) : (
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      cart.length === 0 ||
                      (!isProtocol && !isOffer) ||
                      (isProtocol && !protocolReason.trim()) ||
                      (isOffer && !offerReason.trim())
                    }
                    className={`ui-btn disabled:opacity-50 ${isProtocol ? 'ui-btn-primary border-2 border-amber-500 bg-amber-500 hover:bg-amber-600' : isOffer ? 'ui-btn-primary border-2 border-blue-500 bg-blue-500 hover:bg-blue-600' : 'ui-btn-primary'}`}
                  >
                    {submitting
                      ? 'Processing...'
                      : isProtocol
                        ? 'Submit Protocol Request'
                        : isOffer
                          ? `Submit Offer Request — ${currency(total)}`
                          : 'Select Protocol or Offers to proceed'}
                  </button>
                )}
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Module ───────────────────────────────────────────────────────────────
const BillingModule = ({ view }: { view: BillingView }) => {
  const { session } = useAuth()
  const { enabledLocations, isRestricted, allowedSlugs } = useLocations()
  const { invoiceNumber } = useParams<{ invoiceNumber: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])
  const [selectedInvoice, setSelectedInvoice] = useState<TransactionRecord | null>(null)
  const [heliActivities, setHeliActivities] = useState<HelicopterActivityRecord[]>([])
  const [heliPayments, setHeliPayments] = useState<HelicopterPaymentRecord[]>([])
  const [revenueSummary, setRevenueSummary] = useState<{
    totalRevenue: number
    totalTransactions: number
    averageTransactionValue: number
    paymentMethodBreakdown: Record<string, number>
    refundsCount: number
    refundsValue: number
  } | null>(null)
  const [locationFilter, setLocationFilter] = useState('All')
  const [txnDateMode, setTxnDateMode] = useState<'single' | 'range'>('single')
  const [txnDateFrom, setTxnDateFrom] = useState(todayDateString)
  const [txnDateTo, setTxnDateTo] = useState(todayDateString)
  const [rescheduleTarget, setRescheduleTarget] = useState<string | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')

  // ── Refund flow state ─────────────────────────────────────────────────────
  const [refundPhone, setRefundPhone] = useState('')
  const [refundSearchResults, setRefundSearchResults] = useState<TransactionRecord[]>([])
  const [refundSelectedTxn, setRefundSelectedTxn] = useState<TransactionRecord | null>(null)
  const [refundSelectedItems, setRefundSelectedItems] = useState<Set<number>>(new Set())
  const [refundReason, setRefundReason] = useState('')
  const [refundSearching, setRefundSearching] = useState(false)
  const [refundProcessing, setRefundProcessing] = useState(false)

  const [pendingReprintApprovals, setPendingReprintApprovals] = useState<ReprintApprovalRecord[]>(
    [],
  )
  const [myReprintRequests, setMyReprintRequests] = useState<ReprintApprovalRecord[]>([])

  const [pendingRefundApprovals, setPendingRefundApprovals] = useState<RefundApprovalRecord[]>([])
  const [myRefundRequests, setMyRefundRequests] = useState<RefundApprovalRecord[]>([])

  const [printLogs, setPrintLogs] = useState<PrintLogEntry[]>([])
  const [printLogsLoading, setPrintLogsLoading] = useState(false)
  const [printLogsFilter, setPrintLogsFilter] = useState<'all' | 'print' | 'reprint'>('all')
  const [printLogsSourceFilter, setPrintLogsSourceFilter] = useState<'all' | 'booking' | 'billing'>(
    'all',
  )
  const [printLogsLocationFilter, setPrintLogsLocationFilter] = useState<string>('All')
  const [printLogsRoleFilter, setPrintLogsRoleFilter] = useState<string>('All')
  const [printLogsDateFrom, setPrintLogsDateFrom] = useState<string>('')
  const [printLogsDateTo, setPrintLogsDateTo] = useState<string>('')
  const [printLogsAmountMin, setPrintLogsAmountMin] = useState<string>('')
  const [printLogsAmountMax, setPrintLogsAmountMax] = useState<string>('')
  const [printLogsSearch, setPrintLogsSearch] = useState<string>('')
  const [printLogsSort, setPrintLogsSort] = useState<
    | 'recent'
    | 'oldest'
    | 'printCountDesc'
    | 'printCountAsc'
    | 'amountDesc'
    | 'amountAsc'
    | 'documentId'
  >('recent')
  const [adjustDocId, setAdjustDocId] = useState<string>('')
  const [adjustSource, setAdjustSource] = useState<'booking' | 'billing'>('booking')
  const [adjustTargetCount, setAdjustTargetCount] = useState<string>('')
  const [adjustCurrentCount, setAdjustCurrentCount] = useState<number | null>(null)
  const [adjustWorking, setAdjustWorking] = useState(false)

  const token = session?.token ?? ''
  const canMutate = session ? ['Cashier', 'Admin', 'Owner'].includes(session.user.role) : false
  const isOwner = session?.user.role === 'Owner'
  // Accountant is view-only on Billing per segregation-of-duties — they
  // reconcile and audit the money trail, they don't create transactions.
  // The sub-nav filter below removes POS / Reprint / Helicopter from
  // their view; the existing canMutate / canApproveRefund / canMutateHelicopter
  // gates already exclude them from any mutating button.
  const isAccountant = session?.user.role === 'Accountant'
  const canApproveRefund = session ? ['Owner', 'Admin'].includes(session.user.role) : false
  const canViewHelicopter = session
    ? ['Owner', 'Admin', 'Developer', 'Backend'].includes(session.user.role)
    : false
  const canMutateHelicopter = session ? ['Owner', 'Admin'].includes(session.user.role) : false

  const loadTransactions = async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await billingApi.listTransactions(token)
      setTransactions(result.transactions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions.')
    } finally {
      setLoading(false)
    }
  }

  const loadHelicopter = async () => {
    if (!token) return
    const [activityResult, paymentResult] = await Promise.all([
      billingApi.listHelicopterActivities(token, canMutateHelicopter),
      billingApi.listHelicopterPayments(token, { limit: 100 }),
    ])
    setHeliActivities(activityResult.activities)
    setHeliPayments(paymentResult.payments)
  }

  const handleReprintTransaction = async (txn: TransactionRecord) => {
    if (txn.paymentStatus !== 'completed') {
      window.alert('Cannot print — payment is still pending.')
      return
    }

    // Non-Owner: send approval request to Owner instead of printing
    if (!isOwner) {
      try {
        await requestReprintApproval({
          transactionId: txn.id,
          invoiceNumber: txn.invoiceNumber,
          customerName: txn.customerName,
          customerPhone: txn.customerPhone,
          amount: txn.totalAmount,
          locationId: txn.locationId,
          requestedBy: session?.user.id || 'unknown',
          requestedByName: session?.user.name || 'Unknown',
          requestedByRole: session?.user.role || 'unknown',
        })
        setSuccess(`Reprint request for ${txn.invoiceNumber} sent to Owner for approval.`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send reprint request.')
      }
      return
    }

    // Owner: print immediately with audit logging
    try {
      const { isReprint, printCount } = await logPrint({
        documentId: txn.invoiceNumber || txn.id,
        source: 'billing',
        printedBy: session?.user.id || 'unknown',
        printedByName: session?.user.name || 'Unknown',
        printedByRole: session?.user.role || 'unknown',
        customerName: txn.customerName,
        customerPhone: txn.customerPhone,
        amount: txn.totalAmount,
        locationId: txn.locationId,
      })
      if (isReprint) {
        const proceed = window.confirm(
          `This receipt has already been printed ${printCount - 1} time(s) before.\n\nThis reprint will be logged for admin review.\n\nContinue?`,
        )
        if (!proceed) return
      }
    } catch {
      // Non-critical — don't block printing if logging fails
    }
    await printTransactionReceipt(txn)
  }

  const handleMarkPaid = async (txn: TransactionRecord) => {
    const ref = window.prompt('Enter payment reference (UPI ref, transaction ID, etc.):')
    if (ref === null) return
    try {
      await billingApi.updateTransactionPaymentStatus(txn.id, {
        paymentStatus: 'completed',
        paymentReference: ref.trim() || undefined,
      })
      setSuccess(`Transaction ${txn.invoiceNumber} marked as paid.`)
      void loadTransactions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment status.')
    }
  }

  const handleReschedule = async (txnId: string, newDate: string) => {
    if (!token || !newDate) return
    try {
      await billingApi.reschedule(token, txnId, newDate)
      setSuccess('Visit date rescheduled successfully.')
      setRescheduleTarget(null)
      setRescheduleDate('')
      void loadTransactions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reschedule.')
    }
  }

  const handleCancelTransaction = async (txn: TransactionRecord) => {
    if (txn.cancelled) return
    const reason = window.prompt('Enter cancellation reason:')
    if (!reason) return
    try {
      await billingApi.cancel(token, {
        transactionId: txn.id,
        reason: reason.trim(),
        cancelledBy: session?.user.id || 'unknown',
        cancelledByName: session?.user.name || 'Unknown',
      })
      setSuccess(`Transaction ${txn.invoiceNumber} cancelled.`)
      void loadTransactions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel transaction.')
    }
  }

  useEffect(() => {
    if (!token) return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        if (view === 'invoice' && invoiceNumber) {
          const result = await billingApi.getInvoice(token, invoiceNumber)
          setSelectedInvoice(result.invoice)
          return
        }
        if (view === 'revenue') {
          const result = await billingApi.revenueSummary(token, {
            from: searchParams.get('from') || undefined,
            to: searchParams.get('to') || undefined,
          })
          setRevenueSummary(result.summary)
          return
        }
        if (view === 'helicopter') {
          await loadHelicopter()
          return
        }
        await loadTransactions()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing data.')
      } finally {
        setLoading(false)
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view, invoiceNumber, searchParams.get('from'), searchParams.get('to')])

  // Owner: load print logs when the view is active
  useEffect(() => {
    if (!isOwner || view !== 'printlogs') return
    let cancelled = false
    setPrintLogsLoading(true)
    listPrintLogs(500)
      .then((rows) => {
        if (!cancelled) setPrintLogs(rows)
      })
      .catch((err) => logger.error('billing_module.print_logs_error', err))
      .finally(() => {
        if (!cancelled) setPrintLogsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOwner, view])

  // Owner: subscribe to pending reprint approval requests in real-time
  useEffect(() => {
    if (!isOwner) return
    const unsub = subscribePendingReprintApprovals(
      (rows) => setPendingReprintApprovals(rows),
      (err) => logger.error('billing_module.reprint_approvals_error', err),
    )
    return unsub
  }, [isOwner])

  // Cashier: subscribe to own reprint requests to see approval status in real-time
  useEffect(() => {
    if (isOwner || !session?.user.id) return
    const unsub = subscribeUserReprintApprovals(
      session.user.id,
      (rows) => setMyReprintRequests(rows),
      (err) => logger.error('billing_module.my_reprint_requests_error', err),
    )
    return unsub
  }, [isOwner, session?.user.id])

  // Owner/Admin: subscribe to pending refund approval queue
  useEffect(() => {
    if (!canApproveRefund) return
    const unsub = subscribePendingRefundApprovals(
      (rows) => setPendingRefundApprovals(rows),
      (err) => logger.error('billing_module.refund_approvals_error', err),
    )
    return unsub
  }, [canApproveRefund])

  // Requester: subscribe to own refund requests to see approval status in real-time
  useEffect(() => {
    if (!session?.user.id) return
    const unsub = subscribeUserRefundApprovals(
      session.user.id,
      (rows) => setMyRefundRequests(rows),
      (err) => logger.error('billing_module.my_refund_requests_error', err),
    )
    return unsub
  }, [session?.user.id])

  const handleApprovedReprint = async (txn: TransactionRecord, reqId: string) => {
    try {
      await logPrint({
        documentId: txn.invoiceNumber || txn.id,
        source: 'billing',
        printedBy: session?.user.id || 'unknown',
        printedByName: session?.user.name || 'Unknown',
        printedByRole: session?.user.role || 'unknown',
        customerName: txn.customerName,
        customerPhone: txn.customerPhone,
        amount: txn.totalAmount,
        locationId: txn.locationId,
      })
      await printTransactionReceipt(txn)
      await completeReprint(reqId)
      setSuccess(`Receipt reprinted for ${txn.invoiceNumber}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to print receipt.')
    }
  }

  const handleApproveReprint = async (req: ReprintApprovalRecord) => {
    try {
      await approveReprint(req.id, {
        reviewedBy: session?.user.id || 'unknown',
        reviewedByName: session?.user.name || 'Unknown',
      })
      setSuccess(`Reprint approved for ${req.invoiceNumber}. Cashier can now print.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve reprint.')
    }
  }

  const handleRejectReprint = async (req: ReprintApprovalRecord) => {
    try {
      await rejectReprint(req.id, {
        reviewedBy: session?.user.id || 'unknown',
        reviewedByName: session?.user.name || 'Unknown',
      })
      setSuccess(`Reprint rejected for ${req.invoiceNumber}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject reprint.')
    }
  }

  const filteredTransactions = useMemo(() => {
    // Billing module shows only POS/in-store transactions created through the billing flow.
    // sourceType === "BILLING" is the sole reliable marker (set explicitly by POS checkout).
    // Old customer bookings without a source field default to source:"POS" in the mapper,
    // so the legacy fallback (!t.sourceType && t.source === "POS") is intentionally removed.
    let filtered = transactions.filter((t) => t.sourceType === 'BILLING')

    // Location filter
    if (locationFilter !== 'All') {
      filtered = filtered.filter((t) => t.locationId === locationFilter)
    } else if (isRestricted) {
      filtered = filtered.filter((t) => allowedSlugs.includes(t.locationId ?? ''))
    }

    // Date filter — supports both YYYY-MM-DD and ISO datetime formats
    if (txnDateFrom) {
      filtered = filtered.filter((t) => t.transactionDate.slice(0, 10) >= txnDateFrom)
    }
    const endDate = txnDateMode === 'range' && txnDateTo ? txnDateTo : txnDateFrom
    if (endDate) {
      filtered = filtered.filter((t) => t.transactionDate.slice(0, 10) <= endDate)
    }

    return filtered
  }, [
    transactions,
    locationFilter,
    txnDateFrom,
    txnDateTo,
    txnDateMode,
    isRestricted,
    allowedSlugs,
  ])

  const todaySummary = useMemo(() => {
    const todayStr = todayIST()
    const todayTransactions = filteredTransactions.filter(
      (item) => item.transactionDate.slice(0, 10) === todayStr,
    )
    const paidTransactions = todayTransactions.filter(
      (item) => item.paymentStatus !== 'pending' && item.paymentStatus !== 'failed',
    )
    const total = paidTransactions.reduce((sum, item) => sum + item.totalAmount, 0)
    const refunds = todayTransactions.filter((item) => item.refundStatus !== 'None').length
    return { count: paidTransactions.length, total, refunds }
  }, [filteredTransactions])

  const onRefundSearch = async () => {
    if (!token || refundPhone.replace(/\D/g, '').length < 10) return
    setRefundSearching(true)
    setError(null)
    setRefundSearchResults([])
    setRefundSelectedTxn(null)
    setRefundSelectedItems(new Set())
    try {
      const results = await billingApi.searchTransactionsByPhone(token, refundPhone)
      const locationFiltered = isRestricted
        ? results.filter((t) => allowedSlugs.includes(t.locationId ?? ''))
        : results
      setRefundSearchResults(locationFiltered)
      if (locationFiltered.length === 0)
        setError('No refundable transactions found for this phone number.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search transactions.')
    } finally {
      setRefundSearching(false)
    }
  }

  const onRefundSelectTxn = (txn: TransactionRecord) => {
    setRefundSelectedTxn(txn)
    setRefundSelectedItems(new Set())
    setRefundReason('')
  }

  const onRefundToggleItem = (idx: number) => {
    setRefundSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const refundTotal = useMemo(() => {
    if (!refundSelectedTxn?.items) return 0
    let sum = 0
    for (const idx of refundSelectedItems) {
      const item = refundSelectedTxn.items[idx]
      if (!item) continue
      sum += (item.itemBaseAmount ?? item.unitPrice * item.quantity) + (item.itemGstAmount ?? 0)
    }
    return Math.round(sum)
  }, [refundSelectedTxn, refundSelectedItems])

  const onRefundConfirm = async () => {
    if (!token || !refundSelectedTxn || refundSelectedItems.size === 0 || !refundReason.trim())
      return
    setRefundProcessing(true)
    setError(null)
    setSuccess(null)
    try {
      await requestRefundApproval({
        transactionId: refundSelectedTxn.id,
        invoiceNumber: refundSelectedTxn.invoiceNumber,
        customerName: refundSelectedTxn.customerName,
        customerPhone: refundSelectedTxn.customerPhone ?? refundPhone,
        refundAmount: refundTotal,
        itemIndices: [...refundSelectedItems],
        reason: refundReason.trim(),
        locationId: refundSelectedTxn.locationId,
        requestedBy: session?.user.id || 'unknown',
        requestedByName: session?.user.name || 'Unknown',
        requestedByRole: session?.user.role || 'unknown',
      })
      setSuccess(
        `Refund request submitted for ${refundSelectedTxn.invoiceNumber} — awaiting Owner/Admin approval.`,
      )
      setRefundSelectedTxn(null)
      setRefundSelectedItems(new Set())
      setRefundReason('')
      setRefundSearchResults([])
      setRefundPhone('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit refund request.')
    } finally {
      setRefundProcessing(false)
    }
  }

  const handleApproveRefund = async (req: RefundApprovalRecord) => {
    try {
      const result = await approveAndExecuteRefund(req.id, {
        reviewedBy: session?.user.id || 'unknown',
        reviewedByName: session?.user.name || 'Unknown',
      })
      const walletMsg = result.walletCredited
        ? ` Wallet credited with ${currency(req.refundAmount)}.`
        : result.walletError
          ? ` Wallet credit failed: ${result.walletError}`
          : ''
      setSuccess(`Refund approved for ${req.invoiceNumber}.${walletMsg}`)
      await loadTransactions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve refund.')
    }
  }

  const handleRejectRefund = async (req: RefundApprovalRecord) => {
    try {
      await rejectRefund(req.id, {
        reviewedBy: session?.user.id || 'unknown',
        reviewedByName: session?.user.name || 'Unknown',
      })
      setSuccess(`Refund rejected for ${req.invoiceNumber}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject refund.')
    }
  }

  const onSendHelicopterPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      customerName: String(formData.get('customerName') ?? ''),
      phone: String(formData.get('phone') ?? ''),
      activityId: String(formData.get('activityId') ?? ''),
      discountPercentage: Number(formData.get('discountPercentage') ?? 0),
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await billingApi.sendHelicopterPayment(token, payload)
      setSuccess('Helicopter payment link sent.')
      await loadHelicopter()
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send helicopter payment.')
    } finally {
      setLoading(false)
    }
  }

  const onCreateHelicopterActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const payload = {
      name: String(formData.get('name') ?? ''),
      amount: Number(formData.get('amount') ?? 0),
      status: String(formData.get('status') ?? 'Active') as 'Active' | 'Inactive',
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await billingApi.createHelicopterActivity(token, payload)
      setSuccess('Helicopter activity created.')
      await loadHelicopter()
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create activity.')
    } finally {
      setLoading(false)
    }
  }

  const onToggleHelicopterActivityStatus = async (activity: HelicopterActivityRecord) => {
    if (!token) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      await billingApi.updateHelicopterActivity(token, activity.id, {
        status: activity.status === 'Active' ? 'Inactive' : 'Active',
      })
      setSuccess('Activity status updated.')
      await loadHelicopter()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update activity.')
    } finally {
      setLoading(false)
    }
  }

  const refreshPrintLogs = useCallback(() => {
    setPrintLogsLoading(true)
    return listPrintLogs(500)
      .then((rows) => setPrintLogs(rows))
      .catch((err) => {
        logger.error('billing_module.print_logs_error', err)
        setError(err instanceof Error ? err.message : 'Failed to load print logs.')
      })
      .finally(() => setPrintLogsLoading(false))
  }, [])

  const handleDeletePrintLog = useCallback(
    async (entry: PrintLogEntry) => {
      if (!entry.id) return
      const ok = window.confirm(
        `Delete this print log entry?\n\nDocument: ${entry.documentId}\nPrint #${entry.printCount}\nBy: ${entry.printedByName}\n\nThe derived print count for this document will drop by 1.`,
      )
      if (!ok) return
      try {
        await deletePrintLogEntry(entry.id)
        setSuccess('Print log entry deleted.')
        await refreshPrintLogs()
      } catch (err) {
        logger.error('billing_module.print_log_delete_error', err)
        setError(err instanceof Error ? err.message : 'Failed to delete entry.')
      }
    },
    [refreshPrintLogs],
  )

  const handleLookupAdjustCount = useCallback(async () => {
    const docId = adjustDocId.trim()
    if (!docId) {
      setError('Enter a document ID first.')
      return
    }
    try {
      const { printCount } = await checkPrintCount(docId, adjustSource)
      setAdjustCurrentCount(printCount)
      setAdjustTargetCount(String(printCount))
    } catch (err) {
      logger.error('billing_module.print_log_lookup_error', err)
      setError(err instanceof Error ? err.message : 'Failed to look up count.')
    }
  }, [adjustDocId, adjustSource])

  const handleApplyAdjustCount = useCallback(async () => {
    if (!session) return
    const docId = adjustDocId.trim()
    const target = Number.parseInt(adjustTargetCount, 10)
    if (!docId) {
      setError('Enter a document ID first.')
      return
    }
    if (!Number.isFinite(target) || target < 0) {
      setError('Target count must be a non-negative integer.')
      return
    }
    const confirmMsg =
      adjustCurrentCount === null
        ? `Set print count for ${docId} (${adjustSource}) to ${target}?`
        : `Change print count for ${docId} from ${adjustCurrentCount} to ${target}?`
    if (!window.confirm(confirmMsg)) return
    setAdjustWorking(true)
    try {
      const result = await adjustPrintCount({
        documentId: docId,
        source: adjustSource,
        targetCount: target,
        admin: {
          id: session.user.id,
          name: session.user.name,
          role: session.user.role,
        },
      })
      setSuccess(`Print count updated: ${result.previousCount} → ${result.newCount}.`)
      setAdjustCurrentCount(result.newCount)
      await refreshPrintLogs()
    } catch (err) {
      logger.error('billing_module.print_log_adjust_error', err)
      setError(err instanceof Error ? err.message : 'Failed to adjust count.')
    } finally {
      setAdjustWorking(false)
    }
  }, [session, adjustDocId, adjustSource, adjustTargetCount, adjustCurrentCount, refreshPrintLogs])

  const printLogsRoleOptions = useMemo(() => {
    const roles = new Set<string>()
    printLogs.forEach((entry) => {
      if (entry.printedByRole) roles.add(entry.printedByRole)
    })
    return Array.from(roles).sort()
  }, [printLogs])

  const filteredSortedPrintLogs = useMemo(() => {
    const search = printLogsSearch.trim().toLowerCase()
    const fromTs = printLogsDateFrom ? new Date(`${printLogsDateFrom}T00:00:00`).getTime() : null
    const toTs = printLogsDateTo ? new Date(`${printLogsDateTo}T23:59:59`).getTime() : null
    const amountMin = printLogsAmountMin !== '' ? Number(printLogsAmountMin) : null
    const amountMax = printLogsAmountMax !== '' ? Number(printLogsAmountMax) : null

    const filtered = printLogs.filter((entry) => {
      if (printLogsFilter !== 'all' && entry.type !== printLogsFilter) return false
      if (printLogsSourceFilter !== 'all' && entry.source !== printLogsSourceFilter) return false
      if (
        printLogsLocationFilter !== 'All' &&
        (entry.locationId ?? '') !== printLogsLocationFilter
      ) {
        return false
      }
      if (printLogsRoleFilter !== 'All' && entry.printedByRole !== printLogsRoleFilter) {
        return false
      }
      const ts = entry.printedAt instanceof Date ? entry.printedAt.getTime() : 0
      if (fromTs !== null && ts < fromTs) return false
      if (toTs !== null && ts > toTs) return false
      if (amountMin !== null && Number.isFinite(amountMin)) {
        if (typeof entry.amount !== 'number' || entry.amount < amountMin) return false
      }
      if (amountMax !== null && Number.isFinite(amountMax)) {
        if (typeof entry.amount !== 'number' || entry.amount > amountMax) return false
      }
      if (search) {
        const haystack = [
          entry.documentId,
          entry.customerName,
          entry.customerPhone,
          entry.printedByName,
          entry.printedByRole,
          entry.locationId,
          String(entry.printCount),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    const sorted = [...filtered]
    const amount = (entry: PrintLogEntry) => (typeof entry.amount === 'number' ? entry.amount : -1)
    sorted.sort((a, b) => {
      switch (printLogsSort) {
        case 'oldest':
          return a.printedAt.getTime() - b.printedAt.getTime()
        case 'printCountDesc':
          return b.printCount - a.printCount
        case 'printCountAsc':
          return a.printCount - b.printCount
        case 'amountDesc':
          return amount(b) - amount(a)
        case 'amountAsc':
          return amount(a) - amount(b)
        case 'documentId':
          return a.documentId.localeCompare(b.documentId)
        case 'recent':
        default:
          return b.printedAt.getTime() - a.printedAt.getTime()
      }
    })
    return sorted
  }, [
    printLogs,
    printLogsFilter,
    printLogsSourceFilter,
    printLogsLocationFilter,
    printLogsRoleFilter,
    printLogsDateFrom,
    printLogsDateTo,
    printLogsAmountMin,
    printLogsAmountMax,
    printLogsSearch,
    printLogsSort,
  ])

  if (!session || !token) {
    return null
  }
  // Accountant has read access to Refunds (they approve, they don't
  // create) — let them through. POS / Reprint stay blocked.
  if (!canMutate && view === 'pos') {
    return <Navigate replace to="/billing/transactions" />
  }
  if (!canMutate && view === 'refunds' && !isAccountant) {
    return <Navigate replace to="/billing/transactions" />
  }
  if (isAccountant && view === 'reprint') {
    return <Navigate replace to="/billing/transactions" />
  }
  if (!canViewHelicopter && view === 'helicopter') {
    return <Navigate replace to="/billing/transactions" />
  }
  if (!isOwner && !isAccountant && view === 'printlogs') {
    return <Navigate replace to="/billing/transactions" />
  }

  const isCashierRole = session?.user.role === 'Cashier'
  if (isCashierRole && (view === 'report' || view === 'revenue')) {
    return <Navigate replace to="/billing/pos" />
  }

  const roleSubnav = subnav.filter((item) => {
    if (item.to === '/billing/helicopter' && !canViewHelicopter) return false
    if (item.to === '/billing/report' && isCashierRole) return false
    if (item.to === '/billing/revenue' && isCashierRole) return false
    // Print Logs: Owner has always seen it for full audit; Accountant gets
    // it too since the print trail is part of the books they reconcile.
    if (item.to === '/billing/printlogs' && !isOwner && !isAccountant) return false
    // Accountant is view-only: hide POS (creates transactions),
    // Reprint (mutates print state), and Helicopter (mutations).
    if (isAccountant) {
      if (
        item.to === '/billing/pos' ||
        item.to === '/billing/reprint' ||
        item.to === '/billing/helicopter'
      ) {
        return false
      }
    }
    return true
  })

  return (
    <ModulePageLayout
      moduleTab="Billing"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Billing', titleMap[view]]}
      subnav={roleSubnav}
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      ) : null}

      {view !== 'invoice' && view !== 'pos' && !isCashierRole ? (
        <SummaryCards
          items={[
            {
              id: 'count',
              label: 'Transactions Today',
              value: String(todaySummary.count),
              tone: 'info',
            },
            {
              id: 'total',
              label: 'Revenue Today',
              value: currency(todaySummary.total),
              tone: 'success',
            },
            {
              id: 'refunds',
              label: 'Refunds Today',
              value: String(todaySummary.refunds),
              tone: 'warning',
            },
            {
              id: 'average',
              label: 'Average Invoice',
              value: currency(todaySummary.count > 0 ? todaySummary.total / todaySummary.count : 0),
              tone: 'muted',
            },
          ]}
        />
      ) : null}

      {view === 'pos' ? <POSPanel token={token} onSuccess={() => void loadTransactions()} /> : null}

      {view === 'refunds' ? (
        <div className="mt-4 space-y-4">
          {/* Approval queue — visible to Owner/Admin only */}
          {canApproveRefund && pendingRefundApprovals.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-warning">
                Pending Refund Approvals ({pendingRefundApprovals.length})
              </h3>
              <div className="space-y-2">
                {pendingRefundApprovals.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-text">{req.invoiceNumber}</span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-sm text-muted">{req.customerName || '—'}</span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-sm font-medium text-warning">
                        {currency(Math.round(req.refundAmount))}
                      </span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-xs text-muted">
                        by {req.requestedByName} ({req.requestedByRole})
                      </span>
                      <div className="mt-1 text-xs text-muted">Reason: {req.reason}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApproveRefund(req)}
                        className="rounded border border-success/45 bg-success/10 px-3 py-1 text-xs font-semibold text-success"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRejectRefund(req)}
                        className="rounded border border-critical/45 bg-critical/10 px-3 py-1 text-xs font-semibold text-critical"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Requester's own pending/decided requests */}
          {!canApproveRefund && myRefundRequests.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-muted">
                My Refund Requests
              </h3>
              <div className="space-y-1 text-xs">
                {myRefundRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between">
                    <span className="text-text">
                      {req.invoiceNumber} — {currency(Math.round(req.refundAmount))}
                    </span>
                    <span
                      className={
                        req.status === 'pending'
                          ? 'text-warning'
                          : req.status === 'approved'
                            ? 'text-success'
                            : 'text-critical'
                      }
                    >
                      {req.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Phone search */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-display text-2xl uppercase tracking-[0.04em] text-text">
              Request Refund
            </h3>
            <p className="mt-1 text-xs text-muted">
              Every refund requires Owner or Admin approval before it executes. Enter the customer's
              mobile number to find their recent transactions.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                className="ui-field min-h-10 flex-1"
                type="tel"
                placeholder="Customer mobile number"
                value={refundPhone}
                onChange={(e) => setRefundPhone(e.target.value)}
                maxLength={13}
              />
              <button
                type="button"
                onClick={onRefundSearch}
                disabled={refundSearching || refundPhone.replace(/\D/g, '').length < 10}
                className="ui-btn ui-btn-primary min-h-10 px-5 disabled:opacity-50"
              >
                {refundSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Step 2: Transaction selection */}
          {refundSearchResults.length > 0 && !refundSelectedTxn && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h4 className="text-sm font-semibold text-text mb-3">
                Select a transaction to refund
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {refundSearchResults.map((txn) => (
                  <button
                    key={txn.id}
                    type="button"
                    onClick={() => onRefundSelectTxn(txn)}
                    className="rounded-lg border border-border bg-panel p-3 text-left hover:border-accent/50 hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text">{txn.invoiceNumber}</span>
                      <span className="text-sm font-bold text-text">
                        {currency(txn.totalAmount)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <span>{fmtDateIST(txn.transactionDate)}</span>
                      <span>·</span>
                      <span>{txn.paymentMethod}</span>
                      {txn.customerName && (
                        <>
                          <span>·</span>
                          <span>{txn.customerName}</span>
                        </>
                      )}
                    </div>
                    {txn.refundStatus === 'Partial' && (
                      <span className="mt-1 inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                        Partially Refunded ({currency(txn.refundAmount ?? 0)})
                      </span>
                    )}
                    <div className="mt-2 text-xs text-muted">
                      {(txn.items ?? []).map((item) => item.itemName).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Item selection + auto-calculated amount */}
          {refundSelectedTxn && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-text">
                  Select items to refund — {refundSelectedTxn.invoiceNumber}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setRefundSelectedTxn(null)
                    setRefundSelectedItems(new Set())
                  }}
                  className="text-xs text-muted hover:text-text"
                >
                  ← Back
                </button>
              </div>

              <div className="space-y-2">
                {(refundSelectedTxn.items ?? []).map((item, idx) => {
                  const lineTotal =
                    (item.itemBaseAmount ?? item.unitPrice * item.quantity) +
                    (item.itemGstAmount ?? 0)
                  const isRefunded = !!item.refunded
                  const isSelected = refundSelectedItems.has(idx)
                  return (
                    <label
                      key={idx}
                      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                        isRefunded
                          ? 'border-border/50 bg-surface/50 opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'border-accent/50 bg-accent/5'
                            : 'border-border bg-panel cursor-pointer hover:border-accent/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isRefunded}
                        onChange={() => onRefundToggleItem(idx)}
                        className="h-4 w-4 rounded border-border accent-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text truncate">
                            {item.itemName}
                          </span>
                          {isRefunded && (
                            <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                              Refunded
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted">
                          Qty: {item.quantity} × {currency(item.unitPrice)}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-text whitespace-nowrap">
                        {currency(Math.round(lineTotal))}
                      </span>
                    </label>
                  )
                })}
              </div>

              {/* Refund total + reason + confirm */}
              {refundSelectedItems.size > 0 && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted">
                      Refund Amount ({refundSelectedItems.size} item
                      {refundSelectedItems.size > 1 ? 's' : ''})
                    </span>
                    <span className="text-xl font-bold text-warning">{currency(refundTotal)}</span>
                  </div>
                  <input
                    className="ui-field min-h-10 w-full"
                    placeholder="Reason for refund (required)"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={onRefundConfirm}
                    disabled={refundProcessing || !refundReason.trim()}
                    className="w-full rounded-lg border border-warning/45 bg-warning/10 px-4 py-2.5 text-sm font-semibold text-warning hover:bg-warning/20 disabled:opacity-50"
                  >
                    {refundProcessing
                      ? 'Submitting...'
                      : `Request Refund Approval — ${currency(refundTotal)}`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {view === 'transactions' || view === 'reprint' ? (
        <>
          {!isCashierRole && (
            <FilterBar>
              <FilterField label="Location">
                <select
                  className="ui-field min-h-10"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="All">All Locations</option>
                  {enabledLocations.map((loc) => (
                    <option key={loc.slug} value={loc.slug}>
                      {loc.displayName}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Date Mode">
                <select
                  className="ui-field min-h-10"
                  value={txnDateMode}
                  onChange={(e) => {
                    const mode = e.target.value as 'single' | 'range'
                    setTxnDateMode(mode)
                    if (mode === 'single') setTxnDateTo(txnDateFrom)
                  }}
                >
                  <option value="single">Single Date</option>
                  <option value="range">Date Range</option>
                </select>
              </FilterField>
              <FilterField label={txnDateMode === 'range' ? 'From Date' : 'Date'}>
                <input
                  type="date"
                  className="ui-field min-h-10"
                  value={txnDateFrom}
                  onChange={(e) => {
                    setTxnDateFrom(e.target.value)
                    if (txnDateMode === 'single') setTxnDateTo(e.target.value)
                  }}
                />
              </FilterField>
              {txnDateMode === 'range' && (
                <FilterField label="To Date">
                  <input
                    type="date"
                    className="ui-field min-h-10"
                    value={txnDateTo}
                    min={txnDateFrom}
                    onChange={(e) => setTxnDateTo(e.target.value)}
                  />
                </FilterField>
              )}
              <FilterField label=" ">
                <button
                  type="button"
                  onClick={() => {
                    setTxnDateFrom(todayDateString())
                    setTxnDateTo(todayDateString())
                    setTxnDateMode('single')
                  }}
                  className="ui-btn ui-btn-neutral min-h-10 text-xs"
                >
                  Today
                </button>
              </FilterField>
            </FilterBar>
          )}
          {view === 'reprint' && isOwner && pendingReprintApprovals.length > 0 && (
            <div className="mb-4 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-warning">
                Pending Reprint Requests ({pendingReprintApprovals.length})
              </h3>
              <div className="space-y-2">
                {pendingReprintApprovals.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="flex-1">
                      <span className="font-semibold text-text">{req.invoiceNumber}</span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-sm text-muted">{req.customerName || '—'}</span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-sm font-medium text-text">
                        INR {Math.round(req.amount).toLocaleString('en-IN')}
                      </span>
                      <span className="mx-2 text-muted">·</span>
                      <span className="text-xs text-muted">
                        by {req.requestedByName} ({req.requestedByRole})
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleApproveReprint(req)}
                        className="rounded border border-success/45 bg-success/10 px-3 py-1 text-xs font-semibold text-success"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRejectReprint(req)}
                        className="rounded border border-critical/45 bg-critical/10 px-3 py-1 text-xs font-semibold text-critical"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DataTable
            columns={[
              { key: 'invoice', header: 'Invoice', render: (item) => item.invoiceNumber },
              {
                key: 'date',
                header: 'Date',
                render: (item) => {
                  try {
                    return fmtDateIST(
                      item.transactionDate +
                        (item.transactionDate.length === 10 ? 'T00:00:00' : ''),
                    )
                  } catch {
                    return '—'
                  }
                },
              },
              { key: 'customer', header: 'Customer', render: (item) => item.customerName ?? '—' },
              {
                key: 'location',
                header: 'Location',
                render: (item) => getLocationDisplayName(item.locationId ?? ''),
              },
              { key: 'amount', header: 'Total', render: (item) => currency(item.totalAmount) },
              { key: 'payment', header: 'Payment', render: (item) => item.paymentMethod },
              {
                key: 'visitDate',
                header: 'Visit Date',
                render: (item) => {
                  const vd = item.visitDate || item.transactionDate
                  try {
                    const label = fmtDateIST(vd + (vd.length === 10 ? 'T00:00:00' : ''))
                    return item.originalVisitDate ? (
                      <span
                        className="text-warning"
                        title={`Originally: ${item.originalVisitDate}`}
                      >
                        {label} ↻
                      </span>
                    ) : (
                      label
                    )
                  } catch {
                    return '—'
                  }
                },
              },
              { key: 'refund', header: 'Refund', render: (item) => item.refundStatus },
              {
                key: 'status',
                header: 'Status',
                render: (item) => (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      item.cancelled
                        ? 'bg-muted/15 text-muted line-through'
                        : item.paymentStatus === 'pending'
                          ? 'bg-warning/15 text-warning'
                          : item.paymentStatus === 'failed'
                            ? 'bg-critical/15 text-critical'
                            : 'bg-success/15 text-success'
                    }`}
                  >
                    {item.cancelled
                      ? 'Cancelled'
                      : item.paymentStatus === 'pending'
                        ? 'Pending'
                        : item.paymentStatus === 'failed'
                          ? 'Failed'
                          : 'Paid'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (item) => (
                  <div className="flex gap-1">
                    <Link
                      to={`/billing/invoices/${item.invoiceNumber}`}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      View
                    </Link>
                    {view === 'reprint' &&
                      canMutate &&
                      (() => {
                        if (isOwner) {
                          return (
                            <button
                              type="button"
                              onClick={() => void handleReprintTransaction(item)}
                              className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                            >
                              Reprint
                            </button>
                          )
                        }
                        const approvedReq = myReprintRequests.find(
                          (r) => r.transactionId === item.id && r.status === 'approved',
                        )
                        const pendingReq = myReprintRequests.find(
                          (r) => r.transactionId === item.id && r.status === 'pending',
                        )
                        if (approvedReq) {
                          return (
                            <button
                              type="button"
                              onClick={() => void handleApprovedReprint(item, approvedReq.id)}
                              className="rounded border border-success/45 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success"
                            >
                              Reprint
                            </button>
                          )
                        }
                        if (pendingReq) {
                          return (
                            <button
                              type="button"
                              disabled
                              className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs opacity-50"
                            >
                              Pending...
                            </button>
                          )
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => void handleReprintTransaction(item)}
                            className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                          >
                            Request Reprint
                          </button>
                        )
                      })()}
                    {view === 'transactions' && item.paymentStatus === 'pending' && canMutate && (
                      <button
                        type="button"
                        onClick={() => void handleMarkPaid(item)}
                        className="rounded border border-success/45 bg-success/10 px-2 py-0.5 text-xs font-semibold text-success"
                      >
                        Mark Paid
                      </button>
                    )}
                    {view === 'transactions' &&
                      isOwner &&
                      item.refundStatus !== 'Full' &&
                      !item.cancelled &&
                      (rescheduleTarget === item.id ? (
                        <span className="flex items-center gap-1">
                          {}
                          <input
                            type="date"
                            className="ui-field h-7 w-28 text-xs"
                            value={rescheduleDate}
                            onChange={(e) => setRescheduleDate(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="button"
                            disabled={!rescheduleDate}
                            onClick={() => void handleReschedule(item.id, rescheduleDate)}
                            className="rounded border border-info/45 bg-info/10 px-1.5 py-0.5 text-xs font-semibold text-info disabled:opacity-50"
                          >
                            Go
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRescheduleTarget(null)
                              setRescheduleDate('')
                            }}
                            className="text-xs text-muted"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRescheduleTarget(item.id)
                            setRescheduleDate(todayIST())
                          }}
                          className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                        >
                          Reschedule
                        </button>
                      ))}
                    {view === 'transactions' &&
                      isOwner &&
                      !item.cancelled &&
                      item.refundStatus !== 'Full' && (
                        <button
                          type="button"
                          onClick={() => void handleCancelTransaction(item)}
                          className="rounded border border-critical/45 bg-critical/10 px-2 py-0.5 text-xs font-semibold text-critical"
                        >
                          Cancel
                        </button>
                      )}
                  </div>
                ),
              },
            ]}
            rows={isCashierRole ? filteredTransactions.slice(0, 5) : filteredTransactions}
            rowKey={(item) => item.id}
            emptyMessage={loading ? 'Loading transactions...' : 'No transactions yet.'}
          />
        </>
      ) : null}

      {view === 'reprint' && !isOwner && myReprintRequests.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-text">
            My Reprint Requests ({myReprintRequests.length})
          </h3>
          <div className="space-y-2">
            {myReprintRequests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2"
              >
                <div className="flex-1">
                  <span className="font-semibold text-text">{req.invoiceNumber}</span>
                  <span className="mx-2 text-muted">·</span>
                  <span className="text-sm text-muted">{req.customerName || '—'}</span>
                  <span className="mx-2 text-muted">·</span>
                  <span className="text-sm font-medium text-text">
                    INR {Math.round(req.amount).toLocaleString('en-IN')}
                  </span>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    req.status === 'approved'
                      ? 'bg-success/15 text-success'
                      : req.status === 'rejected'
                        ? 'bg-critical/15 text-critical'
                        : req.status === 'completed'
                          ? 'bg-muted/15 text-muted'
                          : 'bg-warning/15 text-warning'
                  }`}
                >
                  {req.status === 'approved'
                    ? 'Approved'
                    : req.status === 'rejected'
                      ? 'Rejected'
                      : req.status === 'completed'
                        ? 'Completed'
                        : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'invoice' ? (
        <DetailPanel title={`Invoice ${selectedInvoice?.invoiceNumber ?? invoiceNumber ?? ''}`}>
          {selectedInvoice ? (
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="rounded-lg border border-border bg-panel px-3 py-2 space-y-1">
                <p className="font-semibold text-text">
                  Customer: {selectedInvoice.customerName ?? '—'}{' '}
                  {selectedInvoice.customerPhone ? `(${selectedInvoice.customerPhone})` : ''}
                </p>
                <p>Date: {fmtDateTimeFullIST(selectedInvoice.transactionDate)}</p>
                <p>Payment: {selectedInvoice.paymentMethod}</p>
                <p>
                  Base Amount:{' '}
                  {currency(selectedInvoice.baseAmount ?? selectedInvoice.subtotal ?? 0)}
                </p>
                {selectedInvoice.couponCode ? (
                  <p className="text-success">
                    Coupon: {selectedInvoice.couponCode} (-
                    {currency(selectedInvoice.couponDiscount ?? selectedInvoice.discount ?? 0)})
                  </p>
                ) : selectedInvoice.discount ? (
                  <p>Discount: -{currency(selectedInvoice.discount)}</p>
                ) : null}
                {selectedInvoice.gstAmount ? (
                  <p>
                    GST ({selectedInvoice.gstPercent ?? 18}%): {currency(selectedInvoice.gstAmount)}
                  </p>
                ) : null}
                <p className="font-bold text-text">
                  Total: {currency(selectedInvoice.totalAmount)}
                </p>
                {selectedInvoice.paymentStatus === 'pending' && (
                  <p className="text-warning">Payment: Pending</p>
                )}
                {selectedInvoice.paymentReference && (
                  <p className="text-xs text-muted">Ref: {selectedInvoice.paymentReference}</p>
                )}
                {selectedInvoice.refundStatus !== 'None' ? (
                  <p className="text-warning">
                    Refund: {selectedInvoice.refundStatus} —{' '}
                    {currency(selectedInvoice.refundAmount ?? 0)}
                  </p>
                ) : null}
              </div>
              {canMutate &&
                (() => {
                  if (isOwner) {
                    return (
                      <button
                        type="button"
                        onClick={() => void handleReprintTransaction(selectedInvoice)}
                        className="ui-btn ui-btn-neutral"
                      >
                        Print Invoice
                      </button>
                    )
                  }
                  const approvedReq = myReprintRequests.find(
                    (r) => r.transactionId === selectedInvoice.id && r.status === 'approved',
                  )
                  const pendingReq = myReprintRequests.find(
                    (r) => r.transactionId === selectedInvoice.id && r.status === 'pending',
                  )
                  if (approvedReq) {
                    return (
                      <button
                        type="button"
                        onClick={() => void handleApprovedReprint(selectedInvoice, approvedReq.id)}
                        className="ui-btn ui-btn-success"
                      >
                        Print Invoice
                      </button>
                    )
                  }
                  if (pendingReq) {
                    return (
                      <button type="button" disabled className="ui-btn ui-btn-neutral opacity-50">
                        Pending Approval...
                      </button>
                    )
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => void handleReprintTransaction(selectedInvoice)}
                      className="ui-btn ui-btn-neutral"
                    >
                      Request Reprint
                    </button>
                  )
                })()}
              {selectedInvoice.items && selectedInvoice.items.length > 0 ? (
                <div className="rounded-lg border border-border bg-panel px-3 py-2">
                  <p className="mb-1 font-semibold text-text">Items</p>
                  {selectedInvoice.items.map((item, i) => (
                    <div key={i} className="flex justify-between text-muted">
                      <span>
                        {item.itemName} × {item.quantity}
                      </span>
                      <span>{currency(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {/* Go Karting serial numbers grouped by category */}
              {(() => {
                const sItems = (selectedInvoice.items ?? []).filter((it) => it.serialStart != null)
                if (sItems.length === 0) return null
                const groups: Array<{ label: string; serials: number[] }> = []
                for (const it of sItems) {
                  const parts = (it.itemName || '').split(' — ')
                  const catLabel = parts.length >= 2 ? parts[1].trim() : it.itemName || 'Item'
                  const nums: number[] = []
                  for (let s = 0; s < (it.quantity || 1); s++) nums.push(it.serialStart! + s)
                  const existing = groups.find(
                    (g) => g.label.toLowerCase() === catLabel.toLowerCase(),
                  )
                  if (existing) {
                    existing.serials.push(...nums)
                  } else {
                    groups.push({ label: catLabel, serials: nums })
                  }
                }
                for (const g of groups) g.serials.sort((a, b) => a - b)
                return (
                  <div className="rounded-lg border border-border bg-panel px-3 py-2">
                    <p className="mb-1 font-semibold text-text">Serial Numbers</p>
                    <div className="flex flex-wrap gap-3">
                      {groups.map((g) => (
                        <div
                          key={g.label}
                          className="rounded border border-border px-3 py-2 text-center min-w-[80px]"
                        >
                          <p className="text-[11px] font-semibold text-muted">
                            {g.label}
                            {g.serials.length > 1 ? ` (x${g.serials.length})` : ''}
                          </p>
                          <p className="text-lg font-black text-text">
                            {g.serials.map((s) => String(s).padStart(3, '0')).join(', ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {(() => {
                const hasItemSplits =
                  selectedInvoice.items &&
                  selectedInvoice.items.length > 0 &&
                  selectedInvoice.items[0].vendorBase !== undefined
                if (hasItemSplits) {
                  // New format: group items by vendorId
                  const vendorGroups = new Map<string, NonNullable<typeof selectedInvoice.items>>()
                  const companyItems: NonNullable<typeof selectedInvoice.items> = []
                  for (const item of selectedInvoice.items!) {
                    if (item.vendorId) {
                      const g = vendorGroups.get(item.vendorId) ?? []
                      g.push(item)
                      vendorGroups.set(item.vendorId, g)
                    } else {
                      companyItems.push(item)
                    }
                  }
                  return (
                    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted space-y-2">
                      <p className="font-semibold text-sm text-text">Revenue Split (Item-Level)</p>
                      {[...vendorGroups.entries()].map(([vid, items]) => {
                        const vBase = items.reduce((s, i) => s + (i.vendorBase ?? 0), 0)
                        const vGst = items.reduce((s, i) => s + (i.vendorGst ?? 0), 0)
                        const vTotal = items.reduce((s, i) => s + (i.vendorTotal ?? 0), 0)
                        const cShareBase = items.reduce((s, i) => s + (i.companyBase ?? 0), 0)
                        const cShareGst = items.reduce((s, i) => s + (i.companyGst ?? 0), 0)
                        const cShareTotal = items.reduce((s, i) => s + (i.companyTotal ?? 0), 0)
                        return (
                          <div
                            key={vid}
                            className="rounded border border-border/50 px-2 py-1.5 space-y-0.5"
                          >
                            <p className="font-semibold text-text">
                              Vendor: {vid} ({items[0]?.vendorSharePercent ?? '—'}% share)
                            </p>
                            <p>
                              Vendor — Base: {currency(vBase)} + GST: {currency(vGst)} ={' '}
                              <strong>{currency(vTotal)}</strong>
                            </p>
                            <p className="opacity-70">
                              Company share — Base: {currency(cShareBase)} + GST:{' '}
                              {currency(cShareGst)} = {currency(cShareTotal)}
                            </p>
                          </div>
                        )
                      })}
                      {companyItems.length > 0 &&
                        (() => {
                          const cBase = companyItems.reduce((s, i) => s + (i.companyBase ?? 0), 0)
                          const cGst = companyItems.reduce((s, i) => s + (i.companyGst ?? 0), 0)
                          const cTotal = companyItems.reduce((s, i) => s + (i.companyTotal ?? 0), 0)
                          return (
                            <div className="rounded border border-border/50 px-2 py-1.5 space-y-0.5">
                              <p className="font-semibold text-text">Company (100%)</p>
                              <p>
                                Base: {currency(cBase)} + GST: {currency(cGst)} ={' '}
                                <strong>{currency(cTotal)}</strong>
                              </p>
                            </div>
                          )
                        })()}
                      <div className="border-t border-border/50 pt-1 space-y-0.5">
                        {selectedInvoice.vendorTotal !== undefined && (
                          <p>
                            Vendor total: <strong>{currency(selectedInvoice.vendorTotal)}</strong>
                          </p>
                        )}
                        <p>
                          Company total:{' '}
                          <strong>{currency(selectedInvoice.companyTotal ?? 0)}</strong>
                        </p>
                      </div>
                    </div>
                  )
                }
                // Old format fallback
                if (selectedInvoice.vendorTotal !== undefined) {
                  return (
                    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted space-y-0.5">
                      <p className="font-semibold text-text">
                        Revenue Split ({selectedInvoice.vendorSharePercent ?? 80}% vendor)
                      </p>
                      <p>
                        Vendor — Base: {currency(selectedInvoice.vendorBase ?? 0)} + GST:{' '}
                        {currency(selectedInvoice.vendorGst ?? 0)} ={' '}
                        <strong>{currency(selectedInvoice.vendorTotal)}</strong>
                      </p>
                      <p>
                        Company — Base: {currency(selectedInvoice.companyBase ?? 0)} + GST:{' '}
                        {currency(selectedInvoice.companyGst ?? 0)} ={' '}
                        <strong>{currency(selectedInvoice.companyTotal ?? 0)}</strong>
                      </p>
                    </div>
                  )
                }
                if (selectedInvoice.companyTotal !== undefined) {
                  return (
                    <div className="rounded-lg border border-border bg-panel px-3 py-2 text-xs text-muted">
                      <p>Company game — Full amount: {currency(selectedInvoice.companyTotal)}</p>
                    </div>
                  )
                }
                return null
              })()}
            </div>
          ) : (
            <p className="text-sm text-muted">
              {loading ? 'Loading invoice...' : 'Invoice not found.'}
            </p>
          )}
        </DetailPanel>
      ) : null}

      {view === 'revenue' ? (
        <>
          <FilterBar>
            <FilterField label="From">
              <input
                className="ui-field min-h-10"
                type="date"
                value={searchParams.get('from') ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('from', event.target.value)
                  else next.delete('from')
                  setSearchParams(next)
                }}
              />
            </FilterField>
            <FilterField label="To">
              <input
                className="ui-field min-h-10"
                type="date"
                value={searchParams.get('to') ?? ''}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('to', event.target.value)
                  else next.delete('to')
                  setSearchParams(next)
                }}
              />
            </FilterField>
          </FilterBar>

          <DetailPanel title="Revenue Summary">
            {revenueSummary ? (
              <div className="space-y-2 text-sm text-text">
                <p>Total revenue: {currency(revenueSummary.totalRevenue)}</p>
                <p>Total transactions: {revenueSummary.totalTransactions}</p>
                <p>Average value: {currency(revenueSummary.averageTransactionValue)}</p>
                <p>Refund count: {revenueSummary.refundsCount}</p>
                <p>Refund value: {currency(revenueSummary.refundsValue)}</p>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {Object.entries(revenueSummary.paymentMethodBreakdown).map(([method, amount]) => (
                    <div
                      key={method}
                      className="rounded-lg border border-border bg-panel px-3 py-2"
                    >
                      {method}: {currency(amount)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {loading ? 'Loading revenue summary...' : 'No data available.'}
              </p>
            )}
          </DetailPanel>
        </>
      ) : null}

      {view === 'report'
        ? (() => {
            const reportDate = txnDateFrom || todayDateString()
            const billingTxns = transactions
              .filter((t) => t.sourceType === 'BILLING')
              .filter((t) => t.paymentStatus === 'completed')
              .filter((t) => t.transactionDate.slice(0, 10) === reportDate)
              .filter((t) => locationFilter === 'All' || t.locationId === locationFilter)

            const methods = ['Cash', 'UPI', 'Card', 'Razorpay'] as const
            const methodTotals: Record<string, { count: number; total: number }> = {}
            for (const m of methods) methodTotals[m] = { count: 0, total: 0 }
            for (const t of billingTxns) {
              if (t.paymentMethod === 'Protocol') continue
              if (t.paymentMethod === 'Split') {
                if (t.splitCash) {
                  methodTotals.Cash.total += t.splitCash
                  methodTotals.Cash.count++
                }
                if (t.splitUpi) {
                  methodTotals.UPI.total += t.splitUpi
                  methodTotals.UPI.count++
                }
                if (t.splitCard) {
                  methodTotals.Card.total += t.splitCard
                  methodTotals.Card.count++
                }
              } else if (t.paymentMethod && methodTotals[t.paymentMethod]) {
                methodTotals[t.paymentMethod].total += t.totalAmount
                methodTotals[t.paymentMethod].count++
              }
            }
            const breakdown = methods.map((method) => ({
              method,
              count: methodTotals[method].count,
              total: methodTotals[method].total,
            }))
            const grandCount = billingTxns.filter((t) => t.paymentMethod !== 'Protocol').length
            const grandTotal = breakdown.reduce((s, b) => s + b.total, 0)

            return (
              <>
                <FilterBar>
                  <FilterField label="Date">
                    <input
                      type="date"
                      className="ui-field min-h-10"
                      value={txnDateFrom || todayDateString()}
                      onChange={(e) => setTxnDateFrom(e.target.value)}
                    />
                  </FilterField>
                  <FilterField label="Location">
                    <select
                      className="ui-field min-h-10"
                      value={locationFilter}
                      onChange={(e) => setLocationFilter(e.target.value)}
                    >
                      <option value="All">All Locations</option>
                      {enabledLocations.map((loc) => (
                        <option key={loc.slug} value={loc.slug}>
                          {loc.displayName}
                        </option>
                      ))}
                    </select>
                  </FilterField>
                  <FilterField label=" ">
                    <button
                      type="button"
                      onClick={() => {
                        setTxnDateFrom(todayDateString())
                        setLocationFilter('All')
                      }}
                      className="ui-btn ui-btn-neutral min-h-10 text-xs"
                    >
                      Today
                    </button>
                  </FilterField>
                </FilterBar>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
                  {breakdown.map(({ method, count, total }) => (
                    <div
                      key={method}
                      className="rounded-xl border border-border bg-surface p-4 text-center"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                        {method}
                      </p>
                      <p className="mt-1 font-display text-2xl font-bold text-text">
                        {currency(total)}
                      </p>
                      <p className="text-xs text-muted">
                        {count} transaction{count !== 1 ? 's' : ''}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Detailed Table */}
                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-panel/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-muted">
                          Payment Method
                        </th>
                        <th className="px-4 py-3 text-right font-semibold text-muted">
                          Transactions
                        </th>
                        <th className="px-4 py-3 text-right font-semibold text-muted">
                          Total Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {breakdown.map(({ method, count, total }) => (
                        <tr key={method} className={count > 0 ? '' : 'opacity-40'}>
                          <td className="px-4 py-3 font-medium text-text">{method}</td>
                          <td className="px-4 py-3 text-right text-text">{count}</td>
                          <td className="px-4 py-3 text-right font-semibold text-text">
                            {currency(total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-panel/80 border-t-2 border-border">
                        <td className="px-4 py-3 font-bold text-text">Grand Total</td>
                        <td className="px-4 py-3 text-right font-bold text-text">{grandCount}</td>
                        <td className="px-4 py-3 text-right font-bold text-lg text-text">
                          {currency(grandTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {loading && (
                  <p className="mt-4 text-sm text-muted text-center">Loading transactions...</p>
                )}
              </>
            )
          })()
        : null}

      {view === 'helicopter' ? (
        <>
          <SummaryCards
            items={[
              {
                id: 'activities',
                label: 'Activities',
                value: String(heliActivities.length),
                tone: 'info',
              },
              {
                id: 'payments',
                label: 'Payments Sent',
                value: String(heliPayments.length),
                tone: 'success',
              },
              {
                id: 'total-final',
                label: 'Final Amount Total',
                value: currency(
                  heliPayments.reduce((sum, payment) => sum + payment.finalAmount, 0),
                ),
                tone: 'warning',
              },
              {
                id: 'paid-count',
                label: 'Paid',
                value: String(heliPayments.filter((payment) => payment.status === 'Paid').length),
                tone: 'muted',
              },
            ]}
          />

          <div
            className={`mt-4 grid grid-cols-1 gap-4 ${canMutateHelicopter ? 'xl:grid-cols-2' : ''}`}
          >
            {canMutateHelicopter ? (
              <DetailPanel title="Send Payment Link">
                <form
                  className="grid grid-cols-1 gap-2 md:grid-cols-2"
                  onSubmit={onSendHelicopterPayment}
                >
                  <input
                    className="ui-field min-h-10"
                    name="customerName"
                    placeholder="Customer name"
                    required
                  />
                  <input
                    className="ui-field min-h-10"
                    name="phone"
                    placeholder="Phone number"
                    required
                  />
                  <select className="ui-field min-h-10" name="activityId" required>
                    <option value="">Select activity</option>
                    {heliActivities
                      .filter((activity) => activity.status === 'Active')
                      .map((activity) => (
                        <option key={activity.id} value={activity.id}>
                          {activity.name} ({currency(activity.amount)})
                        </option>
                      ))}
                  </select>
                  <input
                    className="ui-field min-h-10"
                    name="discountPercentage"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={0}
                  />
                  <button type="submit" className="ui-btn ui-btn-primary">
                    Send Payment
                  </button>
                </form>
              </DetailPanel>
            ) : null}

            <DetailPanel title="Activity Catalog">
              {canMutateHelicopter ? (
                <form
                  className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4"
                  onSubmit={onCreateHelicopterActivity}
                >
                  <input
                    className="ui-field min-h-10"
                    name="name"
                    placeholder="Activity name"
                    required
                  />
                  <input
                    className="ui-field min-h-10"
                    name="amount"
                    type="number"
                    min={1}
                    placeholder="Amount"
                    required
                  />
                  <select className="ui-field min-h-10" name="status" defaultValue="Active">
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg border border-info/45 bg-info/10 px-3 py-1.5 text-sm font-semibold text-info"
                  >
                    Add
                  </button>
                </form>
              ) : null}
              <DataTable
                columns={[
                  { key: 'name', header: 'Activity', render: (activity) => activity.name },
                  {
                    key: 'amount',
                    header: 'Amount',
                    render: (activity) => currency(activity.amount),
                  },
                  { key: 'status', header: 'Status', render: (activity) => activity.status },
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (activity) =>
                      canMutateHelicopter ? (
                        <button
                          type="button"
                          onClick={() => void onToggleHelicopterActivityStatus(activity)}
                          className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                        >
                          Toggle Status
                        </button>
                      ) : (
                        <span className="text-xs text-muted">Read-only</span>
                      ),
                  },
                ]}
                rows={heliActivities}
                rowKey={(activity) => activity.id}
                emptyMessage={
                  loading ? 'Loading activities...' : 'No helicopter activities configured.'
                }
              />
            </DetailPanel>
          </div>

          <div className="mt-4">
            <DataTable
              columns={[
                { key: 'customer', header: 'Customer', render: (payment) => payment.customerName },
                { key: 'phone', header: 'Phone', render: (payment) => payment.phone },
                { key: 'activity', header: 'Activity', render: (payment) => payment.activityName },
                { key: 'base', header: 'Base', render: (payment) => currency(payment.baseAmount) },
                {
                  key: 'discount',
                  header: 'Discount',
                  render: (payment) => `${payment.discountPercentage}%`,
                },
                {
                  key: 'final',
                  header: 'Final',
                  render: (payment) => currency(payment.finalAmount),
                },
                { key: 'status', header: 'Status', render: (payment) => payment.status },
                {
                  key: 'created',
                  header: 'Created',
                  render: (payment) => fmtDateTimeFullIST(payment.createdAt),
                },
              ]}
              rows={heliPayments}
              rowKey={(payment) => payment.id}
              emptyMessage={
                loading ? 'Loading helicopter payments...' : 'No helicopter payments available.'
              }
            />
          </div>
        </>
      ) : null}

      {view === 'printlogs' && isOwner ? (
        <div className="mt-4 space-y-4">
          <DetailPanel title="Adjust Print Count">
            <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto_auto]">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Document ID
                </label>
                <input
                  type="text"
                  className="ui-field min-h-10 w-full font-mono text-xs"
                  placeholder="e.g. ASG2604181143111035NB1"
                  value={adjustDocId}
                  onChange={(e) => {
                    setAdjustDocId(e.target.value)
                    setAdjustCurrentCount(null)
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Source
                </label>
                <select
                  aria-label="Adjust print count source"
                  className="ui-field min-h-10 w-full"
                  value={adjustSource}
                  onChange={(e) => {
                    setAdjustSource(e.target.value as 'booking' | 'billing')
                    setAdjustCurrentCount(null)
                  }}
                >
                  <option value="booking">Booking</option>
                  <option value="billing">Billing</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                  Target Count
                </label>
                <input
                  type="number"
                  min={0}
                  className="ui-field min-h-10 w-full"
                  placeholder="0"
                  value={adjustTargetCount}
                  onChange={(e) => setAdjustTargetCount(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handleLookupAdjustCount()}
                  className="ui-btn ui-btn-neutral min-h-10 text-xs"
                >
                  Look up
                </button>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={adjustWorking}
                  onClick={() => void handleApplyAdjustCount()}
                  className="ui-btn ui-btn-primary min-h-10 text-xs disabled:opacity-60"
                >
                  {adjustWorking ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </div>
            {adjustCurrentCount !== null ? (
              <p className="mt-2 text-xs text-muted">
                Current count: <span className="font-semibold text-text">{adjustCurrentCount}</span>
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              Reducing deletes the newest entries first. Increasing adds manual-adjustment entries
              so the next real print is numbered correctly.
            </p>
          </DetailPanel>

          <FilterBar>
            <FilterField label="Search">
              <input
                type="text"
                className="ui-field min-h-10"
                placeholder="Document ID, customer, phone, staff"
                value={printLogsSearch}
                onChange={(e) => setPrintLogsSearch(e.target.value)}
              />
            </FilterField>
            <FilterField label="Event Type">
              <select
                aria-label="Event type filter"
                className="ui-field min-h-10"
                value={printLogsFilter}
                onChange={(e) => setPrintLogsFilter(e.target.value as 'all' | 'print' | 'reprint')}
              >
                <option value="all">All Events</option>
                <option value="print">First Prints</option>
                <option value="reprint">Reprints Only</option>
              </select>
            </FilterField>
            <FilterField label="Source">
              <select
                aria-label="Source filter"
                className="ui-field min-h-10"
                value={printLogsSourceFilter}
                onChange={(e) =>
                  setPrintLogsSourceFilter(e.target.value as 'all' | 'booking' | 'billing')
                }
              >
                <option value="all">All Sources</option>
                <option value="booking">Booking</option>
                <option value="billing">Billing</option>
              </select>
            </FilterField>
            <FilterField label="Location">
              <select
                aria-label="Location filter"
                className="ui-field min-h-10"
                value={printLogsLocationFilter}
                onChange={(e) => setPrintLogsLocationFilter(e.target.value)}
              >
                <option value="All">All Locations</option>
                {enabledLocations.map((loc) => (
                  <option key={loc.slug} value={loc.slug}>
                    {loc.displayName}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Role">
              <select
                aria-label="Role filter"
                className="ui-field min-h-10"
                value={printLogsRoleFilter}
                onChange={(e) => setPrintLogsRoleFilter(e.target.value)}
              >
                <option value="All">All Roles</option>
                {printLogsRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="From Date">
              <input
                type="date"
                className="ui-field min-h-10"
                value={printLogsDateFrom}
                onChange={(e) => setPrintLogsDateFrom(e.target.value)}
              />
            </FilterField>
            <FilterField label="To Date">
              <input
                type="date"
                className="ui-field min-h-10"
                value={printLogsDateTo}
                min={printLogsDateFrom || undefined}
                onChange={(e) => setPrintLogsDateTo(e.target.value)}
              />
            </FilterField>
            <FilterField label="Amount Min">
              <input
                type="number"
                min={0}
                className="ui-field min-h-10"
                placeholder="0"
                value={printLogsAmountMin}
                onChange={(e) => setPrintLogsAmountMin(e.target.value)}
              />
            </FilterField>
            <FilterField label="Amount Max">
              <input
                type="number"
                min={0}
                className="ui-field min-h-10"
                placeholder="No limit"
                value={printLogsAmountMax}
                onChange={(e) => setPrintLogsAmountMax(e.target.value)}
              />
            </FilterField>
            <FilterField label="Sort By">
              <select
                aria-label="Sort print logs"
                className="ui-field min-h-10"
                value={printLogsSort}
                onChange={(e) => setPrintLogsSort(e.target.value as typeof printLogsSort)}
              >
                <option value="recent">Most Recent</option>
                <option value="oldest">Oldest First</option>
                <option value="printCountDesc">Print # (High → Low)</option>
                <option value="printCountAsc">Print # (Low → High)</option>
                <option value="amountDesc">Amount (High → Low)</option>
                <option value="amountAsc">Amount (Low → High)</option>
                <option value="documentId">Document ID (A → Z)</option>
              </select>
            </FilterField>
            <FilterField label=" ">
              <button
                type="button"
                onClick={() => {
                  setPrintLogsFilter('all')
                  setPrintLogsSourceFilter('all')
                  setPrintLogsLocationFilter('All')
                  setPrintLogsRoleFilter('All')
                  setPrintLogsDateFrom('')
                  setPrintLogsDateTo('')
                  setPrintLogsAmountMin('')
                  setPrintLogsAmountMax('')
                  setPrintLogsSearch('')
                  setPrintLogsSort('recent')
                }}
                className="ui-btn ui-btn-neutral min-h-10 text-xs"
              >
                Reset
              </button>
            </FilterField>
            <FilterField label=" ">
              <button
                type="button"
                onClick={() => void refreshPrintLogs()}
                className="ui-btn ui-btn-neutral min-h-10 text-xs"
              >
                Refresh
              </button>
            </FilterField>
          </FilterBar>

          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Showing {filteredSortedPrintLogs.length} of {printLogs.length} entries
            </span>
          </div>

          <DataTable
            columns={[
              {
                key: 'printedAt',
                header: 'When',
                render: (entry) => fmtDateTimeFullIST(entry.printedAt),
              },
              { key: 'type', header: 'Type', render: (entry) => entry.type },
              {
                key: 'count',
                header: 'Print #',
                render: (entry) =>
                  entry.type === 'reprint' ? (
                    <span className="font-semibold text-warning">#{entry.printCount}</span>
                  ) : (
                    <span className="text-muted">#{entry.printCount}</span>
                  ),
              },
              {
                key: 'documentId',
                header: 'Document',
                render: (entry) => (
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustDocId(entry.documentId)
                      setAdjustSource(entry.source)
                      setAdjustCurrentCount(null)
                      setAdjustTargetCount('')
                    }}
                    className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                    title="Load into Adjust Print Count"
                  >
                    {entry.documentId}
                  </button>
                ),
              },
              { key: 'source', header: 'Source', render: (entry) => entry.source },
              {
                key: 'customer',
                header: 'Customer',
                render: (entry) => entry.customerName ?? '—',
              },
              {
                key: 'phone',
                header: 'Phone',
                render: (entry) => entry.customerPhone ?? '—',
              },
              {
                key: 'amount',
                header: 'Amount',
                render: (entry) =>
                  typeof entry.amount === 'number' ? currency(entry.amount) : '—',
              },
              {
                key: 'printedBy',
                header: 'Printed By',
                render: (entry) => (
                  <span>
                    {entry.printedByName}
                    <span className="ml-1 text-xs text-muted">({entry.printedByRole})</span>
                  </span>
                ),
              },
              {
                key: 'location',
                header: 'Location',
                render: (entry) => getLocationDisplayName(entry.locationId ?? ''),
              },
              {
                key: 'actions',
                header: 'Actions',
                render: (entry) => (
                  <button
                    type="button"
                    onClick={() => void handleDeletePrintLog(entry)}
                    className="rounded border border-critical/45 bg-critical/10 px-2 py-1 text-xs font-semibold text-critical"
                  >
                    Delete
                  </button>
                ),
              },
            ]}
            rows={filteredSortedPrintLogs}
            rowKey={(entry) =>
              entry.id ?? `${entry.documentId}-${entry.printCount}-${entry.printedAt.getTime()}`
            }
            emptyMessage={
              printLogsLoading ? 'Loading print logs...' : 'No print events match your filters.'
            }
          />
        </div>
      ) : null}
    </ModulePageLayout>
  )
}

export default BillingModule

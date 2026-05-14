export type Role =
  | 'Owner'
  | 'Admin'
  | 'Telecaller'
  | 'Cashier'
  | 'TrackMarshall'
  | 'Incharge'
  | 'Editor'
  | 'Developer'
  | 'Backend'
  | 'ThirdParty'
  // HR — manages staff: shifts, attendance, leave/overtime approvals,
  // incentives (payroll), staff provisioning (scoped to non-admin roles).
  // No finance / billing visibility.
  | 'HR'
  // Accountant — owns financial bookkeeping: vendor settlements, GST,
  // reconciliation, refund approvals (segregation of duties — view +
  // approve, no transaction creation).
  | 'Accountant'
export type BranchLocationKey = string
export type ModuleTab =
  | 'Dashboard'
  | 'Shifts'
  | 'Billing'
  | 'Bookings'
  | 'Activities'
  | 'Track'
  | 'Incharge'
  | 'Workspaces'
  | 'Tasks'
  | 'Files'
  | 'Reports'
  | 'Tickets'
  | 'Admin'
  | 'Accounting'
  | 'GameRevenue'
  | 'Coupons'
  | 'CouponOutreach'
  | 'Leads'
  | 'Locations'
  | 'Kartfluencer'
  | 'Banners'
  | 'Incentives'
  | 'EventCampaigns'
  | 'Reconciliation'
  | 'Helicopter'
  | 'Monitor'
  | 'Grievances'
  | 'Employees'
  | 'HRDocs'
  | 'HRCalendar'
  | 'Appraisals'
  | 'Payroll'
  | 'KartMonitor'
  | 'Settings'

// ─── Leads ──────────────────────────────────────────────────────
export type LeadSource =
  | 'inquiry_whatsapp'
  | 'inquiry_call'
  | 'inquiry_website'
  | 'interakt'
  | 'abandoned_cart'
  | 'landing_page'
  | 'exit_intent'
  | 'webhook'
  | 'manual'
  | 'import'

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'interested'
  | 'follow_up_pending'
  | 'booked'
  | 'closed'
  | 'lost'
export type LeadSubStatus =
  | 'no_answer'
  | 'callback_requested'
  | 'not_interested'
  | 'wrong_number'
  | 'already_booked'
export type LeadScoreLabel = 'hot' | 'warm' | 'cold'
export type CallOutcome = 'connected' | 'no_answer' | 'callback' | 'not_interested'

export type TimelineAction =
  | 'created'
  | 'claimed'
  | 'assigned'
  | 'reassigned'
  | 'status_changed'
  | 'called'
  | 'feedback_submitted'
  | 'whatsapp_sent'
  | 'whatsapp_inbound'
  | 'workflow_response'
  | 'button_clicked'
  | 'template_replied'
  | 'completed_flow'
  | 'whatsapp_order'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'note_added'
  | 'imported'
  | 'callback_scheduled'
  | 'closed'
  | 'score_updated'

export interface LeadScoreFactors {
  recencyDays: number
  visitCount: number
  totalSpend: number
  lastVisitDate?: string
  inquiryChannel?: string
  abandonedCartValue?: number
  abandonedBookingId?: string
}

export interface LeadRecord {
  id: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  source: LeadSource
  sourceRef?: string
  sourceChannel?: string
  status: LeadStatus
  subStatus?: LeadSubStatus
  score: number
  scoreLabel: LeadScoreLabel
  scoreFactors: LeadScoreFactors
  assignedTo?: string
  assignedAt?: string
  assignedBy?: string
  branchId: string
  branchName: string
  consecutiveNoAnswer: number
  whatsappSentAt?: string
  lastContactedAt?: string
  lastActivityAt: string
  callbackScheduledAt?: string
  feedbackNotes?: string
  feedbackSubmittedAt?: string
  feedbackSubmittedBy?: string
  convertedBookingId?: string
  convertedAt?: string
  viewedBy?: string
  viewedAt?: string
  createdAt: string
  updatedAt: string
  createdBy: string
  importBatchId?: string
  tags?: string[]
  notes?: string
}

export interface LeadTimelineEvent {
  id: string
  leadId: string
  action: TimelineAction
  actorId: string
  actorName: string
  detail: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface LeadAutomationConfig {
  noAnswerWhatsappThreshold: number
  autoCloseInactiveDays: number
  abandonedCartHours: number
  autoScoreWeights: {
    recencyWeight: number
    frequencyWeight: number
    spendWeight: number
    channelWeight: number
  }
  scoreThresholds: {
    hotMin: number
    warmMin: number
  }
  enableAutoWhatsapp: boolean
  enableAutoClose: boolean
  enableAutoAssign: boolean
  // Display & limits (added 2026-05-09 — wired into Pipeline view + LeadCard)
  leadsPageSize: number // [50, 500] — Pipeline kanban truncation ceiling
  freshLeadWindowSeconds: number // [0, 600] — duration of the ElectricBorder "new lead" highlight; 0 disables
}

export interface LeadImportBatch {
  id: string
  fileName: string
  totalRows: number
  successCount: number
  errorCount: number
  errors: Array<{ row: number; message: string }>
  columnMapping: Record<string, string>
  importedBy: string
  importedByName: string
  createdAt: string
}

// ─── Lead Performance Metrics ────────────────────────────────────────────

export interface LeadPerformanceTelecallerRow {
  telecallerId: string
  telecallerName: string
  leadsAssigned: number
  leadsContacted: number
  followUpsPending: number
  conversions: number
  conversionPercent: number
  revenue: number
}

export interface LeadPerformanceMetrics {
  totalLeads: number
  byStatus: Record<LeadStatus, number>
  totalConversions: number
  conversionPercent: number
  pendingFollowUps: number
  perTelecaller: LeadPerformanceTelecallerRow[]
}

// ─── Feedback Calls ──────────────────────────────────────────────────────
//
// Daily next-day-feedback workflow. A cron picks every customer who played
// yesterday, dedupes by phone, distributes round-robin to on-shift Telecallers
// per branch, and creates one FeedbackCallRecord per customer. Telecallers see
// their queue inside the Leads module under a new "Feedback Calls" sub-tab.

export type FeedbackCallStatus =
  | 'pending' // not yet called — fresh from the cron
  | 'in_progress' // telecaller has opened the call card
  | 'completed' // feedback submitted
  | 'no_answer' // attempted, customer didn't pick up
  | 'call_later' // telecaller deferred — stays in queue

export type FeedbackIssueCategory =
  | 'kart_quality'
  | 'service'
  | 'wait_time'
  | 'cleanliness'
  | 'pricing'
  | 'safety'
  | 'other'

export interface FeedbackCallIssue {
  category: FeedbackIssueCategory
  detail?: string
}

export type FeedbackRating = 1 | 2 | 3 | 4 | 5

export type FeedbackCallBookingSource = 'APP_BOOKING' | 'ADMIN_BOOKING' | 'POS'

export interface FeedbackCallRecord {
  id: string // ${branchSlug}_${normalizedPhone}_${callDate}
  // ── Source booking ─────────────────────────
  bookingId: string
  bookingSource?: FeedbackCallBookingSource
  // ── Customer ───────────────────────────────
  customerName: string
  customerPhone: string // 10-digit normalized
  customerEmail?: string
  // ── Branch ─────────────────────────────────
  branchId: string // location slug
  branchName: string
  // ── Visit ──────────────────────────────────
  visitDate: string // YYYY-MM-DD IST — the day the customer played
  // ── Distribution ───────────────────────────
  callDate: string // YYYY-MM-DD IST — the day the cron created this call
  assignedTo: string // telecaller userId
  assignedAt: string // ISO timestamp
  assignedBy: string // 'feedback-cron' or userId on manual re-distribution
  // ── Call lifecycle ─────────────────────────
  status: FeedbackCallStatus
  callAttempts: number // increments on each 'no_answer' outcome
  lastCallAttemptAt?: string
  nextAttemptAt?: string // set when status='call_later'
  // ── Feedback (set on completion) ───────────
  rating?: FeedbackRating
  experience?: string // free text, capped at 1000 chars at the API layer
  issues?: FeedbackCallIssue[]
  willVisitAgain?: boolean
  feedbackSubmittedAt?: string
  feedbackSubmittedBy?: string
  feedbackNotes?: string // optional internal note from the telecaller
  // ── Audit ──────────────────────────────────
  createdAt: string
  createdBy: string // 'feedback-cron' or userId on manual re-distribution
  updatedAt: string
}

export interface SubmitFeedbackPayload {
  rating: FeedbackRating
  experience: string
  issues?: FeedbackCallIssue[]
  willVisitAgain: boolean
  feedbackNotes?: string
}

export interface ListFeedbackCallsFilter {
  assignedTo?: string
  status?: FeedbackCallStatus
  branchId?: string
  fromDate?: string // YYYY-MM-DD inclusive (matches callDate)
  toDate?: string // YYYY-MM-DD inclusive (matches callDate)
  search?: string // client-side text match on name/phone
  cursor?: string // callDate of last doc for pagination
  pageSize?: number
}

export interface FeedbackCallRunSummary {
  runDate: string // YYYY-MM-DD IST (the day the cron ran)
  visitDate: string // YYYY-MM-DD IST (the day customers played)
  totalCustomers: number
  distributed: number
  skippedDuplicates: number
  skippedNoTelecaller: number
  perBranch: Record<string, { distributed: number; skipped: number }>
  perTelecaller: Record<string, number>
  durationMs: number
  trigger: 'cron' | 'manual'
  triggeredBy?: string
  createdAt: string
  error?: string
}

export interface FeedbackCallMetrics {
  total: number
  completed: number
  pending: number
  noAnswer: number
  callLater: number
  completionRate: number // completed / total * 100
  averageRating: number // mean over completed calls with a rating
  negativeCount: number // rating <= 2 OR issues.length > 0
  perTelecaller: Array<{
    telecallerId: string
    telecallerName: string
    total: number
    completed: number
    averageRating: number
    negative: number
    completionRate: number
  }>
  perBranch: Array<{
    branchId: string
    branchName: string
    total: number
    completed: number
    averageRating: number
    negative: number
  }>
  perRating: Record<FeedbackRating, number>
  perIssue: Record<FeedbackIssueCategory, number>
}

export type ThemeMode = 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type DashboardWidgetState = 'loading' | 'ready' | 'empty' | 'error'
export type AsyncViewState = DashboardWidgetState
export type NotificationSound = 'soft' | 'chime' | 'bell' | 'off' | 'custom'

export interface UserNotificationSettings {
  sound: NotificationSound
  browserPushEnabled: boolean
  customSoundDataUrl?: string
}

export interface RoleTabPermission {
  role: Role
  tabs: ModuleTab[]
}

export interface DateRangeFilter {
  from?: string
  to?: string
}

export type TaskStatus = 'Todo' | 'InProgress' | 'Completed' | 'Blocked' | (string & {})
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent'
export type PaymentMethod = 'Cash' | 'Card' | 'UPI' | 'Razorpay' | 'Protocol' | 'Split'

export interface UserProfile {
  id: string
  name: string
  email: string
  phone?: string
  role: Role
  workspaceIds: string[]
  mustChangePassword: boolean
  notificationSettings?: UserNotificationSettings
  allowedLocations?: string[] // location slugs; undefined/empty = all locations
  maxDiscountPercent?: number // 0-95; undefined = 0 (no manual discount allowed)
}

export interface LoginResponse {
  token: string
  user: UserProfile
}

export interface UserRecord {
  id: string
  name: string
  email: string
  username?: string
  role: Role
  isActive: boolean
  phone?: string
  workspaceIds?: string[]
  allowedLocations?: string[] // location slugs; undefined/empty = all locations
  maxDiscountPercent?: number // 0-95; undefined = 0 (no manual discount allowed)
  createdAt?: string
  lastLoginAt?: string
  notificationSettings?: UserNotificationSettings
  /**
   * Optional branch slug used by ticket routing. Falls back to other location-shaped
   * fields when missing. Stored as a single-branch shorthand in addition to (or
   * instead of) `allowedLocations`.
   */
  branchId?: string
  /**
   * ISO timestamp of the last time this user was assigned a ticket. Drives
   * round-robin tie-breaking in `routeTicket`. Updated fire-and-forget by
   * `createTicket` after a successful assignment.
   */
  lastAssignedTicketAt?: string
}

export interface TelecallerIncentiveConfig {
  defaultIncentivePercent: number
  updatedAt: string
  updatedBy?: string
}

export interface TelecallerMonthlyPlanRecord {
  id: string
  telecallerId: string
  monthKey: string
  targetAmount: number
  /** null = fall back to global default percent */
  incentivePercent: number | null
  updatedAt: string
  updatedBy?: string
}

export interface TelecallerMonthlyPerformanceRecord {
  telecallerId: string
  telecallerName: string
  monthKey: string
  hasPlan: boolean
  bookingCount: number
  bookedAmount: number
  targetAmount: number
  achievementPercent: number
  /** The flat percent actually applied (plan override or global default). */
  incentivePercentUsed: number
  estimatedIncentiveTotal: number
}

// ─── Cashier Incentives ─────────────────────────────────────────────

export interface IncentiveConfig {
  defaultMultiplier: number
  globalMultiplier: number | null
  incentivePercent: number
  goKartLapThreshold: number
  perGameOverrides: Record<
    string,
    {
      customThreshold: number | null
      excluded: boolean
    }
  >
  updatedAt: string
  updatedBy?: string
}

export interface WeeklyGameReportEntry {
  gameId: string
  gameName: string
  subGameId: string
  subGameName: string
  variantId: string
  variantLabel: string
  variantPrice: number
  laps: number | null
  weeklyRevenue: number
  weeklyQuantity: number
  weeklyTxnCount: number
  threshold: number
  thresholdType: 'auto' | 'manual-global' | 'manual-game'
  isNonPerforming: boolean
  isGoKartEligible: boolean
}

export interface WeeklyGameReport {
  weekKey: string
  weekStart: string
  weekEnd: string
  generatedAt: string
  configSnapshot: IncentiveConfig
  locationReports: Record<
    string,
    {
      games: WeeklyGameReportEntry[]
    }
  >
  status: 'generated'
}

export interface CashierIncentiveRecord {
  id: string
  bookingId: string
  invoiceNumber: string
  locationId: string
  cashierId: string
  cashierName: string
  itemIndex: number
  itemName: string
  gameId: string
  subGameId: string
  variantId: string
  itemAmount: number
  incentivePercent: number
  incentiveAmount: number
  reason: 'non_performing' | 'gokart_laps' | 'both'
  laps: number | null
  weeklyRevenue: number | null
  threshold: number | null
  weekKey: string
  isComboItem: boolean
  comboName: string | null
  status: 'active' | 'reversed'
  reversedAt: string | null
  reversedReason: string | null
  createdAt: string
  transactionDate: string
}

export type UserGender = 'Male' | 'Female' | 'Other'

export interface UserProfileRecord {
  userId: string
  profilePhotoUrl?: string
  dob?: string
  gender?: UserGender
  branchId?: string
  createdAt: string
  updatedAt: string
  profileCompletionPercent: number
  securityNotice: string
}

export interface UserSensitiveProfileRecord {
  userId: string
  aadharNumber?: string
  panNumber?: string
  bankAccountNumber?: string
  bankName?: string
  ifscCode?: string
  createdAt: string
  updatedAt: string
}

export interface MaskedSensitiveProfileRecord {
  aadharNumber?: string
  panNumber?: string
  bankAccountNumber?: string
  bankName?: string
  ifscCode?: string
}

export interface UserProfileBundle {
  account: UserRecord
  profile: UserProfileRecord
  sensitive: UserSensitiveProfileRecord
  maskedSensitive: MaskedSensitiveProfileRecord
}

export type VendorType = 'ThirdParty' | 'SubLease'

export interface VendorDetailsPayload {
  particular: string
  vendorName: string
  mobileNumber: string
  email: string
  preferredActivity: string
  priceInclusiveGst: number
  revenueShare: number
  vendorType?: VendorType
  gstNumber?: string
  address: string
  bankAccountNumber: string
  bankName: string
  ifscCode: string
  branch: string
  branchId?: string
}

export interface VendorDetailsRecord extends VendorDetailsPayload {
  userId: string
  userName: string
  userEmail: string
  branchId?: string
  submittedAt: string
  updatedAt: string
  status: 'Submitted'
}

export type VendorRegistrationStatus = 'Pending' | 'Approved' | 'Rejected'

export interface VendorRegistrationPayload {
  branchId: string
  vendorName: string
  companyName: string
  mobileNumber: string
  email: string
  gstNumber: string
  address: string
  bankAccountNumber: string
  bankName: string
  ifscCode: string
  bankBranch: string
}

export interface VendorRegistrationRecord {
  id: string
  branchId: string
  vendorName: string
  companyName: string
  mobileNumber: string
  email: string
  gstNumber: string
  address: string
  bankAccountNumber: string
  bankName: string
  ifscCode: string
  bankBranch: string
  submittedAt: string
  status: VendorRegistrationStatus
  reviewedAt?: string
  reviewedBy?: string
  createdUserId?: string
  vendorType?: VendorType
}

export interface AuditLogRecord {
  id: string
  action: string
  entityType: string
  entityId: string
  createdAt: string
}

export interface SessionRecord {
  id: string
  sessionName: string
  status: 'Scheduled' | 'Active' | 'Completed' | 'Cancelled'
  startTime: string
  duration: number
  maxParticipants: number
  assignedKarts: string[]
  trackMarshallId: string
}

export interface KartRecord {
  id: string
  kartNumber: string
  status: 'Available' | 'InUse' | 'Maintenance' | 'OutOfService'
  usageHours: number
  currentSessionId?: string
  nextMaintenanceDue?: string
}

export interface IncidentRecord {
  id: string
  incidentType: 'Minor' | 'Major' | 'EquipmentFailure' | 'Medical'
  status: 'Open' | 'UnderReview' | 'Resolved'
  dateTime: string
  description?: string
  actionTaken?: string
  reportedBy?: string
}

export interface TransactionRecord {
  id: string
  invoiceNumber: string
  /**
   * Set when the booking has been soft-deleted (moved to Trash). All
   * dashboard / report / accounting aggregations exclude rows with this
   * field present so a trashed booking stops counting toward today's
   * revenue, cashier totals, vendor ledger rollups, and game-revenue
   * tiles. Hard delete from Trash clears the doc entirely.
   */
  deletedAt?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  /** Internal staff note attached at billing / booking time. */
  adminNotes?: string
  /** Free-text note from the customer or telecaller. */
  notes?: string
  /** ISO timestamp when payment was confirmed. */
  paymentCompletedAt?: string
  /** Razorpay handles — used for refund / dispute follow-up. Owner/Admin only. */
  razorpayOrderId?: string
  razorpayPaymentId?: string
  /** Customer-side balance redeemed against this transaction (separate from wallet). */
  giftCardRedeemed?: number
  /** Base amount after discount, before GST. totalAmount = baseAmount + gstAmount. */
  baseAmount?: number
  gstAmount?: number
  gstPercent?: number
  totalAmount: number
  paymentMethod: PaymentMethod
  refundStatus: 'None' | 'Partial' | 'Full'
  refundAmount?: number
  /** How the refund was paid out — 'cash' reduces the cashier's till; 'wallet' does not. */
  refundMode?: 'cash' | 'wallet'
  /** ID of an in-flight RefundApprovalRecord gating any further refund activity on this transaction. */
  pendingRefundApprovalId?: string
  /** Whether the transaction has been cancelled (soft-delete). */
  cancelled?: boolean
  cancelledAt?: string
  cancelledBy?: string
  cancelledByName?: string
  cancellationReason?: string
  transactionDate: string
  /** Scheduled visit/usage date (YYYY-MM-DD). Defaults to transactionDate for same-day visits. */
  visitDate?: string
  /** Original visit date preserved on first reschedule. */
  originalVisitDate?: string
  rescheduledAt?: string
  rescheduledBy?: string
  rescheduledByName?: string
  subtotal?: number
  tax?: number
  discount?: number
  source?: 'POS' | 'Booking' | 'APP_BOOKING' | 'ADMIN_BOOKING'
  /** Billing origin tag — "BILLING" for POS/admin billing transactions. */
  sourceType?: string
  bookingId?: string
  bookingStatus?: string
  locationId?: string
  /** Present only for vendor-owned games. Absent for company-owned games. */
  vendorId?: string
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorSharePercent?: number
  /** Vendor split — calculated on baseAmount only, then GST applied separately. */
  vendorBase?: number
  vendorGst?: number
  vendorTotal?: number
  /** Company split — remainder after vendor, GST applied separately. */
  companyBase?: number
  companyGst?: number
  companyTotal?: number
  /** Payment status for POS transactions. Cash/Card default to completed; UPI/Online start as pending. */
  paymentStatus?: 'pending' | 'completed' | 'failed'
  /** External payment reference (e.g. UPI ref number) entered when marking payment as completed. */
  paymentReference?: string
  /** Split payment breakdown — present only when paymentMethod is "Split". */
  splitCash?: number
  splitUpi?: number
  splitCard?: number
  /** Coupon code applied to this transaction (if any). */
  couponCode?: string
  /** Discount amount from the applied coupon (if any). */
  couponDiscount?: number
  /**
   * Amount redeemed from the customer's wallet at billing time, applied
   * after all other discounts. Separate from `discount`/`couponDiscount`
   * so reporting, refund-reversal, and the receipt can show the wallet
   * debit as its own line. The corresponding debit is written on the
   * user's wallet subcollection (see deductCustomerWallet in
   * billing-firestore.ts) and is audit-linked back to this transaction.
   */
  walletRedeemed?: number
  createdBy?: string
  createdByName?: string
  createdByRole?: string
  createdAt?: string
  items?: Array<{
    itemName: string
    quantity: number
    unitPrice: number
    gameId?: string
    subGameId?: string
    variantId?: string
    vendorId?: string
    /** Discount applied to this specific item (item-level coupon discounting). */
    itemDiscount?: number
    /** Item's base amount after item-level discount. */
    itemBaseAmount?: number
    /** Item's GST: itemBaseAmount × gstPercent / 100. */
    itemGstAmount?: number
    /** Vendor's revenue share % — copied from vendorDetails at billing time, never overridable. */
    vendorSharePercent?: number
    vendorBase?: number
    vendorGst?: number
    vendorTotal?: number
    companyBase?: number
    companyGst?: number
    companyTotal?: number
    /** Daily running serial number — first serial for this item (serials are serialStart..serialStart+quantity-1). */
    serialStart?: number
    /** True if this item has been refunded. Prevents duplicate refunds for the same item. */
    refunded?: boolean
    /** When true, the bill printer prints one token per quantity instead of a single aggregated token. Snapshotted from the activity catalog at billing time. */
    printIndividualTokens?: boolean
  }>
}

/**
 * One row per vendor-attribution incident detected by the audit job (or
 * created by an Owner manually). Drives the Discrepancies tab UI and is
 * the source of truth the public report at `/r/disc-:ref` reads from.
 */
export interface VendorDiscrepancyRecord {
  id: string
  /** Short human-friendly reference, e.g. "DISC-2026-0414-001". */
  reference: string
  vendorId: string
  vendorName: string
  vendorPhone?: string
  branchId: string
  branchDisplayName?: string
  gameLabel: string
  affectedBookings: Array<{
    bookingId: string
    transactionDate: string
    items: Array<{ itemName: string; quantity: number; amount: number }>
  }>
  /** Sum of all booking item amounts that were not attributed. */
  grossAmount: number
  status: 'pending' | 'notified' | 'resolved'
  detectedAt: string
  notifiedAt?: string
  resolvedAt?: string
  /** Set once a `discrepancy_correction` ledger entry has been written. */
  ledgerEntryId?: string
  /** Internal note explaining the root cause for audit. */
  notes?: string
  createdBy: string
  createdByName: string
}

export interface VendorLedgerEntry {
  id: string
  /**
   * Set when the entry's source booking was soft-deleted (Trash). The
   * entry stays on disk so a restore can revive it, but every read
   * surface (vendor panel, settlements, weekly invoice generation,
   * accounting tabs) excludes voided rows so the vendor's totals match
   * what's actually billable. Cleared when the booking is restored.
   */
  voidedAt?: string
  vendorId: string
  vendorName?: string
  /** Vendor's base amount (share of pre-GST base). */
  vendorBase?: number
  /** Vendor's GST portion (share of GST collected). */
  vendorGst?: number
  /** Total payable to vendor = vendorBase + vendorGst. Stored as `amount` for display. */
  amount: number
  type: 'credit' | 'debit'
  referenceId: string
  invoiceNumber?: string
  locationId?: string
  date: string
  createdAt: string
  /** Origin of this ledger entry for traceability. */
  source?: 'POS' | 'booking' | 'refund' | 'cancellation'
  /**
   * Classifies the entry. `sale` (default) — auto-written by the billing
   * pipeline. `manual_adjustment` — owner-entered correction not tied to a
   * specific incident. `discrepancy_correction` — credit issued to fix a
   * known attribution incident; pairs with `linkedBookingIds` and a `reason`.
   * `cancellation` — debit row written when a paid booking is cancelled via
   * AllBookingsView ("bookingStatus=cancelled" without a refund); reverses
   * the corresponding sale credit so ledger net == invoice total.
   */
  entryType?: 'sale' | 'manual_adjustment' | 'discrepancy_correction' | 'cancellation'
  /** Free-text justification surfaced to vendor on settlements. */
  reason?: string
  /** Bookings this adjustment is correcting attribution for, if any. */
  linkedBookingIds?: string[]
  /** Pipeline user who wrote this entry (manual entries only). */
  createdBy?: string
  /** Display name of `createdBy` for audit display. */
  createdByName?: string
}

export type InvoiceStatus = 'draft' | 'pending' | 'locked'

export interface VendorInvoice {
  id: string
  vendorId: string
  vendorName?: string
  vendorCompanyName?: string
  vendorType?: VendorType
  locationId?: string
  periodStart: string
  periodEnd: string
  totalBase: number
  totalGst: number
  totalAmount: number
  transactionCount: number
  entries: VendorLedgerEntry[]
  status: InvoiceStatus
  generatedAt: string
  lockedAt?: string
  chequeNumber?: string
  payoutInitiatedAt?: string
  payoutInitiatedBy?: string
  letterheadDownloadedAt?: string
}

export interface CompanyInvoice {
  id: string
  periodStart: string
  periodEnd: string
  /** Company earnings from company-owned games (no vendorId). */
  companyOwnedBase: number
  companyOwnedGst: number
  companyOwnedTotal: number
  /** Company's share from vendor-game transactions. */
  companyShareBase: number
  companyShareGst: number
  companyShareTotal: number
  /** Grand total company earnings = companyOwnedTotal + companyShareTotal. */
  totalAmount: number
  transactionCount: number
  byVendor: Record<string, number>
  byLocation: Record<string, number>
  status: InvoiceStatus
  generatedAt: string
  lockedAt?: string
  chequeNumber?: string
  payoutInitiatedAt?: string
  payoutInitiatedBy?: string
  letterheadDownloadedAt?: string
}

export interface InvoiceAuditLogRecord {
  id: string
  action: 'lock' | 'unlock'
  entityType: 'vendorInvoice' | 'companyInvoice'
  entityId: string
  userId: string
  userName: string
  createdAt: string
}

export interface LetterheadVendorRow {
  sNo: number
  vendorName: string
  contactPersonName?: string
  accountNumber: string
  bankName: string
  branch: string
  ifscCode: string
  amount: number
}

export interface LetterheadConfig {
  chequeNumber: string
  date: string
  periodStart: string
  periodEnd: string
  locationLabel: string
  vendors: LetterheadVendorRow[]
  grandTotal: number
}

export interface EventCouponNotification {
  id: string
  couponId: string
  couponCode: string
  couponDescription: string
  discountLabel: string
  vendorId: string
  vendorName?: string
  /** Game IDs belonging to this vendor that are included in the event coupon. */
  games: Array<{
    gameId: string
    gameLabel: string
    subGameId?: string
    subGameLabel?: string
    locationId: string
  }>
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
  respondedAt?: string
}

export interface WorkspaceRecord {
  id: string
  workspaceName: string
  memberIds: string[]
  visibility: 'Private' | 'Organization-wide'
  boardRole?: Role
  boardRoles?: Role[]
  excludedMemberIds?: string[]
  isDeleted?: boolean
  deletedAt?: string
  deletedBy?: string
}

export interface TaskRecord {
  id: string
  workspaceId: string
  taskName: string
  priority: Priority
  status: TaskStatus
  assignedTo: string
  dueDate: string
  updatedAt: string
  isDeleted?: boolean
  deletedAt?: string
  deletedBy?: string
  description?: string
  comments?: Array<{ id: string; userId: string; comment: string; timestamp: string }>
  attachments?: Array<{
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    storageProvider: 'GoogleDrive'
    downloadPath: string
    uploadedAt: string
    revokedAt?: string
  }>
}

export type TaskMessageSource = 'message' | 'legacy-comment' | 'optimistic'
export type TaskMessageType = 'text' | 'image' | 'file' | 'poll' | 'poll-vote'

export interface TaskPollOptionRecord {
  id: string
  label: string
}

export interface TaskPollRecord {
  pollId: string
  question: string
  options: TaskPollOptionRecord[]
}

export interface TaskPollVoteRecord {
  pollId: string
  optionId: string
}

export type TaskOutgoingMessagePayload =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image'
      imageUrl: string
      text?: string
      fileName?: string
    }
  | {
      type: 'file'
      fileUrl: string
      fileName: string
      text?: string
      mimeType?: string
      sizeBytes?: number
    }
  | {
      type: 'poll'
      question: string
      options: TaskPollOptionRecord[]
      pollId?: string
    }
  | {
      type: 'poll-vote'
      pollId: string
      optionId: string
      text?: string
    }

export interface TaskMessageRecord {
  id: string
  taskId: string
  text: string
  senderId: string
  createdAt: string
  messageType?: TaskMessageType
  imageUrl?: string
  fileName?: string
  fileUrl?: string
  fileMimeType?: string
  fileSizeBytes?: number
  poll?: TaskPollRecord
  pollVote?: TaskPollVoteRecord
  clientCreatedAt?: string
  source?: TaskMessageSource
  deliveryState?: 'sent' | 'pending' | 'failed'
}

export interface TaskConversationActivityRecord {
  id: string
  taskId: string
  userId: string
  message: string
  createdAt: string
}

export interface TaskTypingRecord {
  userId: string
  isTyping: boolean
  updatedAt: string
}

export interface TaskReadReceiptRecord {
  userId: string
  lastReadAt: string
  lastReadMessageId?: string
  updatedAt: string
}

export interface TaskConversationSnapshot {
  taskId: string
  messages: TaskMessageRecord[]
  activities: TaskConversationActivityRecord[]
  typing: TaskTypingRecord[]
  readReceipts: TaskReadReceiptRecord[]
}

export type TaskNotificationType = 'task-assigned' | 'task-message'

export interface TaskNotificationRecord {
  id: string
  userId: string
  taskId: string
  workspaceId: string
  taskName: string
  senderId: string
  senderName: string
  type: TaskNotificationType
  messagePreview: string
  createdAt: string
  readAt?: string
}

export interface QueueEntryRecord {
  id: string
  customerName: string
  customerPhone: string
  sessionPreference?: string
  priority: 'Normal' | 'Priority'
  status: 'Waiting' | 'Notified' | 'Seated' | 'Cancelled'
  estimatedWaitMinutes: number
  createdAt: string
  updatedAt: string
}

export interface FileRecord {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  storageProvider: 'GoogleDrive'
  uploadedAt: string
  revokedAt?: string
  taskId: string
  workspaceId: string
  downloadPath: string
  driveFileId?: string
  uploaderId?: string
  uploaderName?: string
  folderPath?: string
  visibility?: 'view-only'
  notes?: string
}

export interface SuperfoneEventRecord {
  id: string
  receivedAt: string
  event: string
  customerPhone: string
  customerName: string
  staffName: string
  staffPhone: string
  callType: string
  disposition: string
  durationSec: number | null
  ringingSec: number | null
  source: string
  labelTitles: string[]
  branchId?: string
  branchName?: string
  staffUserId?: string
  staffMatchedBy?: 'phone' | 'name' | 'unmatched'
  callDirection?: 'Incoming' | 'Outgoing' | 'Unknown'
  talkSeconds?: number
  meta: Record<string, unknown>
  normalized: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface SuperfoneInteraktControls {
  base_enabled: boolean
  runtime_enabled: boolean
  configured: boolean
  dispatch_allowed: boolean
  template: string | null
}

export interface SuperfoneInteraktControlsResponse {
  ok: boolean
  mode: 'interakt_status' | 'interakt_toggle'
  controls: SuperfoneInteraktControls
  generated_at: string
}

export interface SuperfoneEventsResponse {
  ok: boolean
  mode: 'events'
  count: number
  events: SuperfoneEventRecord[]
  generated_at: string
}

export interface SuperfoneEventQuery {
  limit?: number
  phone?: string
  from?: string
  to?: string
}

export interface CallHistoryRecord {
  id: string
  customerName?: string
  customerNumber: string
  userId: string
  userName: string
  type: 'Incoming' | 'Outgoing' | 'Missed'
  status: 'Connected' | 'Not Connected' | 'No Answer' | 'Missed'
  durationSeconds: number
  timestamp: string
  branchId?: string
  labelTitles?: string[]
}

export interface StaffInsightRecord {
  userId: string
  staffName: string
  outgoingCalls: number
  incomingCalls: number
  connectedCalls: number
  missedCalls: number
  totalDurationSeconds: number
  averageTalkSeconds?: number
}

export interface ActivityCatalogRecord {
  id: string
  legacyActivityId?: string
  name: string
  bookingName?: string
  description?: string
  category: string
  subcategory?: string
  branchPrices: Record<string, number>
  locationKeys: BranchLocationKey[]
  durationMinutes: number
  status: 'Active' | 'Inactive'
  active?: boolean
  badges?: string[]
  sortOrder: number
  isCombo?: boolean
  activityIds?: string[]
  image?: string
  imageUrl?: string
  locationName?: string
  gameId?: string
  gameName?: string
  subGameId?: string
  subGameName?: string
  variantId?: string
  variantLabel?: string
  laps?: number
  /** vendorId from the game's metadata — present only for vendor-owned games. */
  vendorId?: string
  /** The branchId where the vendor is assigned for this game. Used to prevent cross-branch vendor routing. */
  vendorBranchId?: string
  platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
  /** Visibility: shown in normal POS mode. Defaults true for backward compat. */
  visibleInPOS?: boolean
  /** Visibility: shown in Protocol mode. */
  visibleInProtocol?: boolean
  /** Visibility: shown in Offers mode. */
  visibleInOffers?: boolean
  /** Visibility: shown in Pipeline Booking module. Defaults true for backward compat. */
  visibleInBooking?: boolean
  /** Special price used in Offer mode. */
  offerPrice?: number
  /** When true, the bill printer prints one token per quantity instead of a single token with a "Quantity: Nx" line. */
  printIndividualTokens?: boolean
  /**
   * Soft-availability flag. When true, the activity is hidden from booking
   * surfaces until `temporarilyUnavailableUntil` (or until explicitly cleared).
   */
  temporarilyUnavailable?: boolean
  temporarilyUnavailableReason?: string
  temporarilyUnavailableSince?: string
  temporarilyUnavailableMarkedById?: string
  temporarilyUnavailableMarkedByName?: string
  temporarilyUnavailableUntil?: string
  /**
   * Approved Interakt template name for booking confirmations. Set per
   * sub-game in the activities editor; resolved here for the flat catalog
   * representation used by booking flows.
   */
  interaktTemplateId?: string
  /** Language code for the Interakt template (e.g. "en"). */
  interaktTemplateLanguage?: string
  createdAt: string
  updatedAt: string
}

export interface ActivityVariantTreeRecord {
  id: string
  label: string
  price: number
  durationMinutes?: number
  laps?: number
  active: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ActivitySubGameTreeRecord {
  id: string
  name: string
  metadata?: Record<string, unknown>
  variants: ActivityVariantTreeRecord[]
  /**
   * Approved Interakt template name to use when sending the booking
   * confirmation WhatsApp for this sub-game (e.g. "booking_confirm_pdf_util"
   * for helicopter, "booking_confirmed_ticket" for go-karting). Falls back
   * to BookingConfirmationConfig.defaultTemplateId when unset.
   */
  interaktTemplateId?: string
  /** Language code for the template (e.g. "en"). Falls back to config default. */
  interaktTemplateLanguage?: string
  createdAt: string
  updatedAt: string
}

export interface ActivityGameTreeRecord {
  id: string
  name: string
  imageUrl?: string
  status: 'Active' | 'Inactive'
  platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
  metadata?: Record<string, unknown>
  subGames: ActivitySubGameTreeRecord[]
  createdAt: string
  updatedAt: string
}

export interface ActivityLocationTreeRecord {
  id: BranchLocationKey
  name: string
  games: ActivityGameTreeRecord[]
  createdAt: string
  updatedAt: string
}

export interface TrackMarshallShiftRecord {
  id: string
  userId?: string
  staffName: string
  branchId: string
  branchName: string
  loginTime: string
  logoutTime?: string
  totalActiveHours?: number
  status: 'Active' | 'Completed'
  createdAt: string
  updatedAt: string
}

export interface OperationsReportRecord {
  generatedAt: string
  totalCalls: number
  incomingCalls: number
  outgoingCalls: number
  missedCalls: number
  totalTalkSeconds: number
  telecallerCount: number
  bookingCount: number
  paidBookingCount: number
  totalRevenue: number
  bookingRevenue: number
  posRevenue: number
  trackMarshallShiftCount: number
  trackMarshallActiveHours: number
}

export interface RevenueReportRecord {
  generatedAt: string
  totalRevenue: number
  bookingRevenue: number
  posRevenue: number
  totalTransactions: number
  averageTransactionValue: number
  paymentMethodBreakdown: Record<string, number>
  refundsCount: number
  refundsValue: number
}

export interface GameRevenueRow {
  gameName: string
  totalRevenue: number
  bookingRevenue: number
  posRevenue: number
  adminBookingRevenue: number
  telecallerRevenue: number
  transactionCount: number
  contributionPercent: number
}

export interface BranchGameRevenueBreakdown {
  locationId: string
  displayName: string
  totalRevenue: number
  transactionCount: number
  gameBreakdown: GameRevenueRow[]
}

export interface LocationRevenueRow {
  locationId: string
  locationName: string
  totalRevenue: number
  bookingRevenue: number
  posRevenue: number
  adminBookingRevenue: number
  telecallerRevenue: number
  transactionCount: number
  contributionPercent: number
}

export interface GameRevenueReportRecord {
  generatedAt: string
  totalRevenue: number
  gameBreakdown: GameRevenueRow[]
  locationBreakdown: LocationRevenueRow[]
  branchBreakdowns: BranchGameRevenueBreakdown[]
  /** All transaction-level details keyed by normalized game name. */
  transactionsByGame: Record<string, GameTransactionDetail[]>
}

export interface GameTransactionDetail {
  bookingId: string
  dateTime: string
  amount: number
  source: 'POS' | 'Booking' | 'Admin' | 'Telecaller'
  paymentStatus: string
  locationId: string
  locationName: string
  items: string[]
}

export interface ShiftSummaryReportRecord {
  generatedAt: string
  totalShiftCount: number
  totalActiveHours: number
  byRole: Record<string, number>
  trackMarshallShiftCount: number
  trackMarshallActiveHours: number
  shifts: Array<{
    id: string
    userId: string
    role: string
    locationId: string
    locationName: string
    startTime: string
    endTime?: string
    totalActiveHours?: number
  }>
  trackMarshallShifts: TrackMarshallShiftRecord[]
}

export interface AsquareCustomerLookupRecord {
  id: string
  name: string
  cell: string
  email?: string
  branchId?: string
}

export interface HelicopterActivityRecord {
  id: string
  name: string
  amount: number
  status: 'Active' | 'Inactive'
  createdAt: string
  updatedAt: string
}

export interface ActivityRecord {
  id: string
  locationKey: BranchLocationKey
  locationName?: string
  name: string
  type: string
  durationMinutes: number
  price: number
  status: 'Active' | 'Inactive'
  isCombo?: boolean
  activityIds?: string[]
  activityId?: string
  activityName?: string
  gameId?: string
  gameName?: string
  subTypeId?: string
  subTypeName?: string
  subGameId?: string
  subGameName?: string
  variantId?: string
  variantName?: string
  variantLabel?: string
  imageUrl?: string
  laps?: number
  bookingName?: string
  hierarchyPath?: string[]
  bookingMeta?: Record<string, unknown>
  /** vendorId from the game's metadata — present only for vendor-owned games. */
  vendorId?: string
  /** The branchId where the vendor is assigned for this game. Used to prevent cross-branch vendor routing. */
  vendorBranchId?: string
  /**
   * Soft-availability flag — same shape as `ActivityCatalogRecord`. The
   * legacy ActivityRecord carries it too so booking surfaces operating on
   * either record can use the same `isCurrentlyUnavailable` helper.
   */
  temporarilyUnavailable?: boolean
  temporarilyUnavailableReason?: string
  temporarilyUnavailableSince?: string
  temporarilyUnavailableMarkedById?: string
  temporarilyUnavailableMarkedByName?: string
  temporarilyUnavailableUntil?: string
  /**
   * Approved Interakt template name for booking confirmations. Inherited
   * from the parent sub-game; surfaced on the flat ActivityRecord so the
   * booking flow can resolve it without re-querying the hierarchy.
   */
  interaktTemplateId?: string
  /** Language code for the Interakt template (e.g. "en"). */
  interaktTemplateLanguage?: string
  createdAt: string
  updatedAt: string
}

export interface ActivityBookingRecord {
  id: string
  customerName: string
  phone: string
  locationKey: BranchLocationKey
  activityIds: string[]
  activityNames: string[]
  totalAmount: number
  paymentLink: string
  status: 'Sent' | 'Paid' | 'Expired' | 'Failed'
  sentBy: string
  createdAt: string
  updatedAt: string
}

export interface HelicopterPaymentRecord {
  id: string
  customerName: string
  phone: string
  activityId: string
  activityName: string
  baseAmount: number
  discountPercentage: number
  finalAmount: number
  status: 'Sent' | 'Paid' | 'Failed'
  sentBy: string
  createdAt: string
  updatedAt: string
}

export type HelicopterSlotStatus = 'Open' | 'Closed' | 'Cancelled'

export interface HelicopterSlotRecord {
  id: string
  date: string // YYYY-MM-DD (IST)
  startTime: string // HH:mm
  branchId: BranchLocationKey
  branchName?: string
  maxSeats: number
  bookedSeats: number
  status: HelicopterSlotStatus
  pricePerSeat: number
  earlyBirdPrice?: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface HelicopterCounterRecord {
  count: number
  earlyBirdThreshold: number
  earlyBirdPrice: number
  regularPrice: number
  updatedAt: string
}

export interface HelicopterConfigRecord {
  enabled: boolean
  branchEnabled: Record<string, boolean>
  earlyBirdEnabled: boolean
  maxTotalWeightKg: number
  updatedAt: string
  updatedBy: string
}

export interface HelicopterPassengerSnapshot {
  name: string
  weight?: number
  age?: number
  gender?: string
  checkedInAt?: string
}

export interface HelicopterBookingView {
  id: string
  bookingId: string
  orderNumber?: string
  customerName: string
  customerPhone: string
  branchId?: string
  branchName?: string
  sessionDate?: string // YYYY-MM-DD
  slotId?: string
  startTime?: string
  seats: number
  totalAmount: number
  bookingStatus: string
  paymentStatus: string
  passengers: HelicopterPassengerSnapshot[]
  totalWeightKg: number
  createdAt: string
}

export interface ContactRecord {
  id: string
  name: string
  phone: string
  email?: string
  notes?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TodoRecord {
  id: string
  title: string
  assignedTo: string
  status: 'Pending' | 'Done'
  dueDate?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ShiftReportVM {
  state: AsyncViewState
  shifts: Array<{
    id: string
    userId: string
    role: 'Telecaller' | 'Cashier' | 'TrackMarshall'
    locationId: string
    locationName: string
    startTime: string
    endTime?: string
    totalActiveHours?: number
  }>
  filter: DateRangeFilter & {
    role?: Role
    userId?: string
    activeOnly?: boolean
    locationId?: string
  }
}

export interface PosTransactionVM {
  state: AsyncViewState
  items: Array<{ itemName: string; quantity: number; unitPrice: number }>
  paymentMethod: PaymentMethod
  discount: number
  tax: number
}

export interface TrackBoardVM {
  state: AsyncViewState
  karts: KartRecord[]
  sessions: SessionRecord[]
  queue: QueueEntryRecord[]
  incidents: IncidentRecord[]
}

export interface TaskBoardVM {
  state: AsyncViewState
  tasks: TaskRecord[]
  filter: {
    workspaceId?: string
    assignedTo?: string
    status?: TaskStatus
    priority?: Priority
  }
}

export interface FileLibraryVM {
  state: AsyncViewState
  files: FileRecord[]
  filter: {
    workspaceId?: string
    taskId?: string
  }
}

export interface ReportVM {
  state: AsyncViewState
  from?: string
  to?: string
}

// ─── Device Sessions ──────────────────────────────────────────────
export type DeviceType = 'desktop' | 'mobile' | 'tablet'

export interface DeviceSessionRecord {
  id: string
  userId: string
  deviceType: DeviceType
  browserName: string
  osName: string
  ipAddress: string
  location?: string
  loginAt: string
  lastActiveAt: string
  isRevoked: boolean
}

export interface ReprintApprovalRecord {
  id: string
  transactionId: string
  invoiceNumber: string
  customerName?: string
  customerPhone?: string
  amount: number
  locationId?: string
  requestedBy: string
  requestedByName: string
  requestedByRole: string
  requestedAt: string
  status: 'pending' | 'approved' | 'rejected' | 'completed'
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
}

export interface RefundApprovalRecord {
  id: string
  transactionId: string
  invoiceNumber: string
  customerName?: string
  customerPhone?: string
  /** Sum of base + GST for the items selected for refund. */
  refundAmount: number
  /** Indices into TransactionRecord.items that are being refunded. */
  itemIndices: number[]
  reason: string
  locationId?: string
  requestedBy: string
  requestedByName: string
  requestedByRole: string
  requestedAt: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
  /** Set once the approved refund is actually executed against the transaction. */
  executedAt?: string
  executionError?: string
  walletCredited?: boolean
  walletError?: string
}

/**
 * Cashier-initiated request to bypass the Track Marshall kart-report
 * preflight gate. Approval is gated to Owner role; on approval the
 * cashier's dashboard auto-grants the override and they can Check In.
 * Stored in the `kartReportBypassRequests` collection.
 */
export interface KartReportBypassRequest {
  id: string
  locationId: string
  /** UID of the cashier raising the request. */
  requestedBy: string
  requestedByName: string
  requestedByRole: string
  requestedAt: string
  /** Free-text reason typed by the cashier (audit-grade context). */
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  /** Owner who approved/rejected. */
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
  /** Optional note left by the reviewer (esp. on rejection). */
  reviewNote?: string
}

// ─── Kartfluencer ───────────────────────────────────────────────

export type KartfluencerStatus =
  | 'detailed'
  | 'visited'
  | 'reel_submitted'
  | 'verified'
  | 'active'
  | 'disqualified'

/** Follower-based tier — used for eligibility gating and initial access pass rewards. */
export type KartfluencerTier =
  | 'not_eligible'
  | 'access_10k'
  | 'access_25k'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'elite'

/** Views-based payment tier — determines cash payout per reel milestone. */
export type KartfluencerViewTier =
  | 'below_threshold'
  | 'starter'
  | 'bronze_views'
  | 'silver_views'
  | 'gold_views'
  | 'viral'

export interface KartfluencerRecord {
  id: string
  instagramHandle: string
  phoneCountryCode: string
  phoneNumber: string
  branchId: string
  branchName: string
  visitDate: string
  followersRange: string
  followerCount?: number
  tier: KartfluencerTier
  status: KartfluencerStatus
  upiId?: string
  upiName?: string
  walletBalance?: number
  totalEarned?: number
  totalWithdrawn?: number
  qrCode?: string
  disqualifiedReason?: string
  instagramVerified: boolean
  instagramUserId?: string
  liveFollowerCount?: number
  lastFollowerFetchAt?: string
  instagramBio?: string
  instagramMediaCount?: number
  profilePictureUrl?: string
  influencerScore?: number
  createdAt: string
  updatedAt: string
  createdBy?: string
  updatedBy?: string
}

export interface KartfluencerReel {
  id: string
  influencerId: string
  reelLink: string
  normalizedReelLink: string
  instagramMediaId?: string
  status: 'pending' | 'verified' | 'rejected'
  viewCount: number
  lastViewFetchAt?: string
  currentViewTier: KartfluencerViewTier
  highestPaidTier: KartfluencerViewTier
  totalEarned: number
  milestoneReady: boolean
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
}

export interface KartfluencerNotification {
  id: string
  title: string
  message: string
  type: 'offer' | 'alert' | 'info'
  isActive: boolean
  branchId?: string
  createdAt: string
}

export interface KartfluencerImportBatch {
  id: string
  fileName: string
  totalRows: number
  successCount: number
  errorCount: number
  errors: Array<{ row: number; message: string }>
  importedBy: string
  importedByName: string
  createdAt: string
}

export interface KartfluencerWalletTransaction {
  id: string
  type: 'milestone_credit' | 'withdrawal' | 'adjustment'
  amount: number
  balance: number
  reelId?: string
  viewTier?: string
  withdrawalId?: string
  description: string
  createdAt: string
  createdBy: string
}

export interface KartfluencerWithdrawal {
  id: string
  influencerId: string
  instagramHandle: string
  amount: number
  upiId: string
  upiName: string
  status: 'pending' | 'processing' | 'completed' | 'rejected'
  method?: 'manual_upi' | 'razorpay'
  paymentProofUrl?: string
  razorpayPayoutId?: string
  rejectionReason?: string
  requestedAt: string
  processedAt?: string
  processedBy?: string
}

export interface KartfluencerStats {
  total: number
  byStatus: Record<KartfluencerStatus, number>
  byTier: Record<KartfluencerTier, number>
  pendingReels: number
  milestoneReadyReels: number
  totalPaidOut: number
  totalViews: number
  pendingWithdrawals: number
}

export interface KartfluencerBookingHistory {
  bookingId: string
  sessionDate: string
  locationId: string
  activities: string[]
  finalAmount: number
  bookingStatus: string
  paymentStatus: string
}

export interface KartfluencerProfileData {
  record: KartfluencerRecord
  reels: KartfluencerReel[]
  wallet: { balance: number; totalEarned: number; totalWithdrawn: number }
  walletHistory: KartfluencerWalletTransaction[]
  bookingHistory: KartfluencerBookingHistory[]
  bookingSummary: {
    totalVisits: number
    totalSpent: number
    firstVisitDate?: string
    lastVisitDate?: string
  }
}

// ── Tickets ──────────────────────────────────────────────────────────────────

export type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed'

export type TicketPriority = 'Low' | 'Normal' | 'High' | 'Critical'

export type RaisedByKind = 'staff' | 'customer'

export type TicketAttachmentKind = 'image' | 'voice' | 'video'

export interface TicketAttachment {
  id: string
  kind: TicketAttachmentKind
  storagePath: string
  url: string
  sizeBytes: number
  mimeType: string
  uploadedAt: string
}

export type TicketLinkedEntityType = 'booking' | 'kart' | 'customer' | 'payment'

export interface TicketLinkedEntity {
  type: TicketLinkedEntityType
  id: string
  label: string
}

export interface TicketAutoContext {
  url?: string
  userAgent?: string
  appVersion?: string
  buildSha?: string
  lastErrorMessage?: string
  lastErrorAt?: string
}

export interface TicketSlaSnapshot {
  responseSeconds: number | null
  resolveSeconds: number
}

export interface Ticket {
  id: string
  schemaVersion: 1 | 2
  title: string
  description: string
  categoryId: string
  priority: TicketPriority
  tags: string[]
  status: TicketStatus

  role: Role
  raisedBy: string
  raisedByName: string
  raisedByKind: RaisedByKind
  branchId: string
  branchDisplayName: string

  // Phase-1 keeps the existing assignee fields under the new names.
  // `assignedTo` literal is preserved for backward compatibility with
  // dashboards that still read it; routing logic lands in Phase 2.
  assignedTo: 'Developer'
  assigneeId: string
  assigneeRole: Role
  assigneeName: string
  watcherIds: string[]

  attachments: TicketAttachment[]
  linkedEntities: TicketLinkedEntity[]
  autoContext: TicketAutoContext

  slaSnapshot: TicketSlaSnapshot | null
  responseDueAt: string | null
  resolveDueAt: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  rootCauseTag: string | null

  escalationLevel: number
  mergedInto: string | null
  reopenedFrom: string | null

  // Legacy fields kept for dashboards still reading the v1 shape.
  // Phase 2 removes consumers; Phase 4 removes the fields themselves.
  location: string
  locationDisplayName: string
  issue: string
  assignedToId: string
  assignedToName: string

  createdAt: string
  updatedAt: string
}

export interface CreateTicketPayload {
  role: Role
  location: string
  locationDisplayName: string
  issue: string
  raisedBy: string
  raisedByName: string
  /** Required from Phase 2 onward — drives routing, priority floor, and SLA. */
  categoryId: string
  /** Optional priority override. Clamped up to the category's `priorityFloor`. */
  priorityOverride?: TicketPriority
  /** Defaults to `'staff'` when omitted. */
  raisedByKind?: RaisedByKind
  /** Optional title override; falls back to a slice of `issue` when omitted. */
  title?: string
  /** Optional rich-capture fields (Phase 3). */
  attachments?: TicketAttachment[]
  linkedEntities?: TicketLinkedEntity[]
  autoContext?: TicketAutoContext
}

// ── Ticket categories ────────────────────────────────────────────────────────

export interface TicketCategory {
  id: string // 'track-safety', 'billing-refund', etc.
  label: string // user-facing
  priorityFloor: TicketPriority // priority cannot go below this when category is selected
  responseSlaSeconds: number | null // null = no response SLA (e.g. feedback)
  resolveSlaSeconds: number
  routingChain: Role[] // ordered: first role in branch is the target; subsequent are escalation hops
  active: boolean
  sortOrder: number
}

export interface CreateTicketCategoryPayload {
  label: string
  priorityFloor: TicketPriority
  responseSlaSeconds: number | null
  resolveSlaSeconds: number
  routingChain: Role[]
  active?: boolean
  sortOrder?: number
}

export const DEFAULT_TICKET_CATEGORIES: ReadonlyArray<TicketCategory> = [
  {
    id: 'track-safety',
    label: 'Track / Safety',
    priorityFloor: 'Critical',
    responseSlaSeconds: 15 * 60,
    resolveSlaSeconds: 2 * 60 * 60,
    routingChain: ['TrackMarshall', 'Incharge', 'Admin', 'Owner'],
    active: true,
    sortOrder: 10,
  },
  {
    id: 'billing-refund',
    label: 'Billing / Refund',
    priorityFloor: 'High',
    responseSlaSeconds: 60 * 60,
    resolveSlaSeconds: 8 * 60 * 60,
    routingChain: ['Cashier', 'Incharge', 'Admin'],
    active: true,
    sortOrder: 20,
  },
  {
    id: 'booking-change',
    label: 'Booking change',
    priorityFloor: 'Normal',
    responseSlaSeconds: 2 * 60 * 60,
    resolveSlaSeconds: 24 * 60 * 60,
    routingChain: ['Telecaller', 'Incharge'],
    active: true,
    sortOrder: 30,
  },
  {
    id: 'app-bug',
    label: 'App bug / tech',
    priorityFloor: 'Normal',
    responseSlaSeconds: 4 * 60 * 60,
    resolveSlaSeconds: 3 * 24 * 60 * 60,
    routingChain: ['Developer', 'Backend'],
    active: true,
    sortOrder: 40,
  },
  {
    id: 'feedback',
    label: 'Feedback / suggestion',
    priorityFloor: 'Low',
    responseSlaSeconds: null,
    resolveSlaSeconds: 7 * 24 * 60 * 60,
    routingChain: ['Editor'],
    active: true,
    sortOrder: 50,
  },
  {
    id: 'other',
    label: 'Other',
    priorityFloor: 'Normal',
    responseSlaSeconds: 4 * 60 * 60,
    resolveSlaSeconds: 24 * 60 * 60,
    routingChain: ['Incharge', 'Admin'],
    active: true,
    sortOrder: 99,
  },
]

// ── Ticket comments ──────────────────────────────────────────────────────────

export interface TicketComment {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  authorKind: 'staff' | 'customer'
  body: string
  internal: boolean // true = staff-only note, hidden from customers
  mentions: string[] // user IDs (Phase 8 ships @mention pings; field exists now for forward compat)
  createdAt: string
  updatedAt: string
}

export interface CreateTicketCommentPayload {
  ticketId: string
  authorId: string
  authorName: string
  authorKind: 'staff' | 'customer'
  body: string
  internal: boolean
  mentions?: string[]
}

// ── Ticket activity ──────────────────────────────────────────────────────────

export type TicketActivityType =
  | 'created'
  | 'status_changed'
  | 'assignee_changed'
  | 'priority_changed'
  | 'category_changed'
  | 'tags_changed'
  | 'comment_added'
  | 'attachment_added'
  | 'attachment_removed'
  | 'linked_entity_added'
  | 'linked_entity_removed'
  | 'resolved'
  | 'reopened'
  | 'merged'
  | 'sla_response_breached'
  | 'sla_resolve_breached'
  | 'escalated'

export interface TicketActivity {
  id: string
  ticketId: string
  type: TicketActivityType
  actorId: string
  actorName: string
  payload: Record<string, unknown>
  createdAt: string
}

// Root-cause tags for resolution
export const TICKET_ROOT_CAUSE_TAGS = [
  'user-error',
  'staff-error',
  'hardware-fault',
  'software-bug',
  'process-gap',
  'third-party-issue',
  'duplicate',
  'wont-fix',
  'other',
] as const

export type TicketRootCauseTag = (typeof TICKET_ROOT_CAUSE_TAGS)[number]

// ─── Booking confirmation (Interakt template routing) ──────────────

/**
 * Singleton config doc at `bookingConfirmationConfig/global` controlling how
 * the booking confirmation WhatsApp template is chosen. Per-sub-game
 * `interaktTemplateId` takes precedence over this default; this exists so
 * admins can ship a sane fallback without filling every activity row.
 */
export interface BookingConfirmationConfig {
  /**
   * Approved Interakt template used when an activity has no per-sub-game
   * override. Required for any send to succeed.
   */
  defaultTemplateId: string
  /** Language code for the default template (e.g. "en"). */
  defaultTemplateLanguage: string
  updatedAt: string
  updatedBy?: string
}

// ─── Staff Monitor ─────────────────────────────────────────────────

export type MonitoredRole = 'Telecaller' | 'Cashier' | 'Incharge' | 'TrackMarshall'

export const MONITORED_ROLES: MonitoredRole[] = [
  'Telecaller',
  'Cashier',
  'Incharge',
  'TrackMarshall',
]

/** Roles that can access the Monitor page — used in the page guard and nav manifest. */
// HR is added — Staff Monitor is one of their primary tools (who's clocked
// in, where, doing what). Accountant intentionally excluded — they audit
// the financial trail, not real-time workforce presence.
export const MONITOR_VIEWER_ROLES: Role[] = ['Owner', 'Admin', 'HR']

export interface StaffPresenceRecord {
  userId: string
  userName: string
  role: MonitoredRole
  /** Canonical branchId (normalized via `normalizeLocationId`). */
  branchId: string
  /** Current deviceSessions/{id}. */
  sessionId: string
  /** ISO timestamp when this session started. */
  loginAt: string
  /** ISO timestamp, refreshed every heartbeat. */
  lastSeenAt: string
  /** Set when user clicks Sign Out. Null while the session is active. */
  explicitLogoutAt: string | null
}

export type StaffSessionEndReason = 'explicit_signout' | 'timeout' | 'new_session_replaced'

export interface StaffSessionLogRecord {
  id: string
  userId: string
  userName: string
  role: MonitoredRole
  branchId: string
  sessionId: string
  loginAt: string
  logoutAt: string
  durationMinutes: number
  endReason: StaffSessionEndReason
  /** Links to trackMarshallShifts or cashier shift doc when one was active. */
  officialShiftId: string | null
}

// ── Ticket notifications ─────────────────────────────────────────────────────

export type TicketNotificationKind =
  | 'assigned_to_me'
  | 'comment_on_my_ticket'
  | 'mentioned'
  | 'escalated_to_me'
  | 'status_changed'
  | 'sla_breached'

export interface TicketNotification {
  id: string
  recipientId: string // pipeline user id
  ticketId: string
  ticketTitle: string
  kind: TicketNotificationKind
  priority: TicketPriority // for sound trigger
  body: string // short summary line
  read: boolean
  createdAt: string
}

// ── Ticket KB & canned responses ────────────────────────────────────────────

export type TicketKbVisibility = 'internal' | 'customer'

export interface TicketKbArticle {
  id: string
  title: string
  body: string // markdown
  tags: string[]
  visibility: TicketKbVisibility
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateTicketKbArticlePayload {
  title: string
  body: string
  tags: string[]
  visibility: TicketKbVisibility
  active?: boolean
  sortOrder?: number
}

export interface TicketCannedResponse {
  id: string
  title: string
  body: string
  categoryIds: string[] // applies to which categories (empty = all)
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateTicketCannedPayload {
  title: string
  body: string
  categoryIds: string[]
  active?: boolean
  sortOrder?: number
}

// ─── HR: Documents ──────────────────────────────────────────────
export type HRDocumentType =
  | 'identity'
  | 'address'
  | 'education'
  | 'experience'
  | 'offer'
  | 'contract'
  | 'payslip'
  | 'medical'
  | 'other'

export interface HRDocument {
  id: string
  employeeId: string
  employeeName: string
  title: string
  documentType: HRDocumentType
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  uploadedByName: string
  uploadedAt: string
  branchId?: string
  notes?: string
  expiresAt?: string
  tags?: string[]
  deletedAt?: string
}

// ─── HR: Calendar / Reminders ───────────────────────────────────
export type HRCalendarKind = 'event' | 'reminder' | 'todo'
export type HRCalendarStatus = 'open' | 'done' | 'cancelled'

export interface HRCalendarEntry {
  id: string
  kind: HRCalendarKind
  title: string
  description?: string
  startsAt: string
  endsAt?: string
  allDay?: boolean
  status: HRCalendarStatus
  assignedTo?: string
  assignedToName?: string
  visibility: 'private' | 'hr' | 'all'
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly'
  reminderMinutesBefore?: number
  branchId?: string
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  deletedAt?: string
}

// ─── HR: Performance Reviews ────────────────────────────────────
export type AppraisalStage = 'self' | 'manager' | 'hr' | 'closed'
export type AppraisalRating = 1 | 2 | 3 | 4 | 5

export interface AppraisalGoal {
  id: string
  title: string
  weight: number
  selfRating?: AppraisalRating
  selfComment?: string
  managerRating?: AppraisalRating
  managerComment?: string
}

export interface HRAppraisal {
  id: string
  cycleLabel: string
  employeeId: string
  employeeName: string
  employeeRole: Role
  managerId?: string
  managerName?: string
  stage: AppraisalStage
  selfRating?: AppraisalRating
  selfSummary?: string
  selfSubmittedAt?: string
  managerRating?: AppraisalRating
  managerSummary?: string
  managerSubmittedAt?: string
  finalRating?: AppraisalRating
  finalSummary?: string
  hrSignedOffAt?: string
  hrSignedOffBy?: string
  goals: AppraisalGoal[]
  branchId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

// ─── HR: Payroll ────────────────────────────────────────────────
export type PayrollRunStatus = 'draft' | 'review' | 'approved' | 'paid' | 'cancelled'

export interface PayrollComponent {
  label: string
  amount: number
  kind: 'earning' | 'deduction'
}

export interface HRPayrollSlip {
  id: string
  runId: string
  employeeId: string
  employeeName: string
  employeeRole: Role
  branchId?: string
  monthIso: string
  baseSalary: number
  workingDays: number
  presentDays: number
  lopDays: number
  overtimeHours: number
  earnings: PayrollComponent[]
  deductions: PayrollComponent[]
  incentiveAmount: number
  grossPay: number
  totalDeductions: number
  netPay: number
  status: PayrollRunStatus
  generatedAt: string
  generatedBy: string
  paidAt?: string
  notes?: string
}

export interface HRPayrollRun {
  id: string
  monthIso: string // 'YYYY-MM'
  label: string
  branchId?: string
  status: PayrollRunStatus
  totalEmployees: number
  totalGross: number
  totalDeductions: number
  totalNet: number
  totalLopDays: number
  createdBy: string
  createdByName: string
  createdAt: string
  approvedBy?: string
  approvedAt?: string
  paidAt?: string
  notes?: string
}

// ─── HR: Kart Monitor (TrackMarshal) ────────────────────────────
// The canonical kart fleet record lives in
// src/pipeline/features/track/services/kartService.ts (KartRecord,
// KartDeepCleanLogRecord). HR's /hr/kart-monitor view reads that data
// directly — there is no separate `karts` or `kartDailyChecks` collection.

// ─── HR: Extended Employee Profile (overlay on users/) ──────────
export interface HREmployeeProfileExt {
  designation?: string
  dateOfJoining?: string
  reportingManagerId?: string
  reportingManagerName?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelation?: string
  bankAccountNumber?: string
  bankIfsc?: string
  bankName?: string
  panNumber?: string
  aadhaarLast4?: string
  address?: string
  bloodGroup?: string
  baseSalary?: number
}

// User types
export interface User {
  id: string
  phone?: string
  email?: string
  displayName: string
  photoURL?: string
  height?: number // in cm
  weight?: number // in kg
  emergencyContact?: {
    name: string
    phone: string
    relation: string
  }
  tires: number
  walletBalance?: number
  tier: string // 'bronze' | 'silver' | 'gold' | 'platinum' or any other string from API
  referralCode: string
  referredBy?: string
  createdAt: Date
  updatedAt: Date
  isVerified?: boolean
  // ── Account restriction flags (Owner-managed) ────────────────────
  locked?: boolean
}

// ── Branch Location (unified registry) ────────────────────────────────
export interface BranchLocation {
  slug: string
  branchId: string
  displayName: string
  shortName: string
  enabled: boolean
  firestoreDocId: string
}

// Location types
export type LocationId = string

export interface Location {
  id: LocationId
  name: string
  address: string
  coordinates: {
    lat: number
    lng: number
  }
  image: string
  isOpen: boolean
  comingSoon?: boolean
  openingHours: {
    weekday: string
    weekend: string
  }
}

// Activity types
export type ActivityType = string

export interface Activity {
  id: ActivityType
  apiId?: string // Numeric ID from the API for order submission
  name: string
  description: string
  longDescription?: string
  icon?: string
  image: string
  minAge?: number
  maxParticipants?: number
  duration?: number // in minutes (optional)
  basePrice: number // Required - used for pricing calculations
  peakMultiplier?: number
  available?: boolean
  /**
   * Soft-availability flag for legacy `activities/{id}` docs (helicopter,
   * special items). Mirrors the variant-level flag in the activities
   * hierarchy. When true, the activity is hidden from booking surfaces
   * even if `available: true`.
   */
  temporarilyUnavailable?: boolean
  temporarilyUnavailableReason?: string
  temporarilyUnavailableSince?: string
  temporarilyUnavailableMarkedById?: string
  temporarilyUnavailableMarkedByName?: string
  /** ISO date — when set, the flag auto-restores after this point. Optional. */
  temporarilyUnavailableUntil?: string
  platforms?: ('web' | 'windows' | 'android' | 'ios' | 'pos' | 'bookings')[]
  category?: string
  gameTypeId?: string
  offerPercent?: number // discount percentage (0-100)
  variants?: {
    laps: number
    price: number
    apiId: string
  }[]
  terms?: string[]
  safetyInstructions?: string[]
  locationIds?: string[] // Array of location IDs where this activity is available
  startDate?: string // ISO date string (YYYY-MM-DD) - legacy field
  endDate?: string // ISO date string (YYYY-MM-DD) - legacy field
  // New schedule-based availability (takes precedence over startDate/endDate/locationIds)
  schedule?: {
    locationId: string
    startDate: string // YYYY-MM-DD
    endDate: string // YYYY-MM-DD
  }[]
  // New simplified fields
  branch?: string // Branch/location name
  actualPrice?: number // Original price
  offerPrice?: number // Discounted price
  availableDates?: string[] // Array of available dates (YYYY-MM-DD)
  dateStatuses?: Record<string, 'available' | 'fast_filling' | 'booked_full'> // Per-date availability overrides
  createdDateTime?: string // ISO timestamp when created
  skuPerDay?: number // Daily stock/inventory limit (0 = unlimited)
  /**
   * Runtime-only marker attached to free line items created by a BOGO offer.
   * Lets CartContext re-evaluate how many free units are still earned when the
   * parent (paid) items change. Not persisted in Firestore.
   */
  __bogoTie?: BogoTie
}

/**
 * Declarative tie from a free cart line back to the paid line(s) that earn it,
 * plus the BOGO rule parameters needed to recompute freeQty from current
 * parent quantities.
 */
export interface BogoTie {
  /** Cart item IDs on the "buy" side of this free line. */
  parentIds: string[]
  /** X in "Buy X Get Y Free". */
  buyCount: number
  /** Y in "Buy X Get Y Free". */
  getCount: number
  /**
   * 'per_item' — each parentId earns independently (legacy offer.mixedGames=false).
   * 'mixed'    — pool all parent units and mark the cheapest N as free.
   */
  mode: 'per_item' | 'mixed'
}

// Booking types
export interface TimeSlot {
  time: string // HH:mm format
  available: boolean
  occupancy: number
  maxCapacity: number
}

export interface BookingItem {
  activity: Activity
  quantity: number
  duration: number
  date: string
  timeSlot: string
  price: number
}

/** Unified transaction source discriminator */
export type BookingSource = 'APP_BOOKING' | 'ADMIN_BOOKING' | 'POS'

/** Per-item billing breakdown (vendor splits, GST, serials) */
export interface BillingItem {
  itemName: string
  quantity: number
  unitPrice: number
  gameId?: string
  subGameId?: string
  variantId?: string
  vendorId?: string
  itemDiscount?: number
  itemBaseAmount?: number
  itemGstAmount?: number
  vendorSharePercent?: number
  vendorBase?: number
  vendorGst?: number
  vendorTotal?: number
  companyBase?: number
  companyGst?: number
  companyTotal?: number
  serialStart?: number
  /** When true, the bill printer prints one token per quantity instead of a single aggregated token. Snapshotted from the activity catalog at billing time. */
  printIndividualTokens?: boolean
}

export interface Booking {
  id: string
  userId: string
  locationId: LocationId
  items: BookingItem[]
  totalAmount: number
  discountAmount: number
  finalAmount: number
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded'
  bookingStatus: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'
  qrCode: string
  createdAt: Date
  sessionDate: Date
  tires: number
  paymentId?: string
  paymentMethod?: string
  cashbackAmount?: number
  pdfUrl?: string
  userDisplayName?: string
  userPhone?: string
  couponCode?: string
  couponAmount?: number
  createdByAdminId?: string
  createdByAdminName?: string
  createdByRole?: string
  checkInStatus?: 'pending' | 'completed' | 'boarded'
  passengers?: {
    name: string
    weight: number
    age?: number
    gender?: 'male' | 'female' | 'other'
  }[]
  flightNumber?: string
  razorpayOrderId?: string
  razorpaySignature?: string

  // ── Unified source discriminator ──────────────────────────────────
  source?: BookingSource
  /** Billing origin tag — "BILLING" for POS/admin billing transactions. */
  sourceType?: string

  // ── Billing-level fields (set on payment completion or POS) ───────
  invoiceNumber?: string
  baseAmount?: number
  gstAmount?: number
  gstPercent?: number
  subtotal?: number
  tax?: number
  discount?: number

  // ── Vendor revenue split (transaction-level aggregates) ───────────
  vendorId?: string
  vendorSharePercent?: number
  vendorBase?: number
  vendorGst?: number
  vendorTotal?: number
  companyBase?: number
  companyGst?: number
  companyTotal?: number

  // ── Refund tracking ───────────────────────────────────────────────
  refundStatus?: 'None' | 'Partial' | 'Full'
  refundAmount?: number

  // ── Visit / reschedule ────────────────────────────────────────────
  visitDate?: string
  originalVisitDate?: string
  rescheduledAt?: string
  rescheduledBy?: string
  rescheduledByName?: string
  transactionDate?: string

  // ── Staff attribution ─────────────────────────────────────────────
  handledBy?: string
  handledByRole?: string

  // ── POS-specific fields ───────────────────────────────────────────
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  paymentReference?: string

  // ── Per-item billing breakdown ────────────────────────────────────
  billingItems?: BillingItem[]

  // ── Billing sync metadata ─────────────────────────────────────────
  billingSyncedAt?: Date

  // ── Helicopter counter idempotency guard ──────────────────────────
  helicopterCountIncremented?: boolean
}

// Game types
export type GameType = 'puzzle' | 'memory' | 'sliding' | 'runner' | 'trivia' | 'spin'
export type GameDifficulty = 'easy' | 'medium' | 'hard'

// Spin & Win types
export type SpinSource = 'game_completion' | 'daily_login' | 'booking' | 'referral' | 'bonus'
export type PrizeTier = 'common' | 'grand' | 'mega'

export interface SpinPrize {
  id: string
  name: string
  description: string
  tier: PrizeTier
  type: 'tires' | 'discount' | 'freebie' | 'addon'
  value: number // tires amount or percentage
  icon: string
  color: string
  weight: number // probability weight for random selection
}

export interface SpinResult {
  id: string
  prize: SpinPrize
  spunAt: Date
  source: SpinSource
  claimed: boolean
}

export interface UserSpins {
  available: number
  total: number
  used: number
  history: SpinResult[]
  lastEarnedAt: Date | null
}

export interface GameScore {
  id: string
  gameType: GameType
  difficulty?: GameDifficulty
  score: number
  timeSeconds?: number
  playedAt: Date
}

export interface GameProgress {
  puzzlesCompleted: number
  memoryGamesWon: number
  runnerHighScore: number
  triviaQuestionsAnswered: number
  currentStreak: number
  longestStreak: number
  lastPlayedAt: Date | null
}

export interface DailyChallenge {
  id: string
  date: string
  games: {
    gameType: GameType
    difficulty: GameDifficulty
    bonusTires: number
  }[]
  completed: boolean
}

export interface Prize {
  id: string
  name: string
  description: string
  tiresCost: number
  type: 'discount' | 'addon' | 'session'
  value: number // percentage for discount, 1 for addon/session
  expiresInDays: number
  image: string
}

export interface Achievement {
  id: string
  name: string
  description: string
  icon: string
  unlockedAt: Date | null
  requirement: {
    type: 'bookings' | 'games' | 'tires' | 'streak' | 'referrals'
    count: number
  }
}

// Event types
export interface CorporateInquiry {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string
  groupSize: number
  preferredDate: string
  budget: number
  requirements: string
  status: 'pending' | 'contacted' | 'confirmed' | 'cancelled'
  createdAt: Date
}

export interface BirthdayPackage {
  id: string
  childName: string
  age: number
  theme: 'racing' | 'superhero' | 'princess' | 'jungle'
  guestCount: number
  activities: ActivityType[]
  catering: 'basic' | 'premium' | 'deluxe'
  date: string
  timeSlot: string
  locationId: LocationId
  totalPrice: number
}

export interface Tournament {
  id: string
  name: string
  date: string
  location: LocationId
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'pro'
  entryFee: number
  prizePool: number
  maxParticipants: number
  currentParticipants: number
  registrationDeadline: string
  status: 'upcoming' | 'ongoing' | 'completed'
}

// Notification types
export interface NotificationPreferences {
  push: boolean
  sms: boolean
  email: boolean
  marketing: boolean
  bookingUpdates: boolean
  gameRewards: boolean
}

// Payment types
export interface PaymentMethod {
  id: string
  type: 'upi' | 'card' | 'wallet'
  last4?: string
  upiId?: string
  walletProvider?: string
  isDefault: boolean
}

// Leaderboard types
export interface LeaderboardEntry {
  userId: string
  userName: string
  userPhoto?: string
  score: number
  rank: number
  gameType: GameType
  period: 'weekly' | 'monthly' | 'alltime'
}

// ── Tickets (re-exported from pipeline types) ──────────────────────
// The ticketing system is shared between the pipeline admin app and the
// customer app. The canonical definitions live in `src/pipeline/api/types.ts`
// — this barrel re-exports them so customer-side code can `import type
// { Ticket } from '../types'` without crossing the dual-app import boundary.
export type {
  Ticket,
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketComment,
  TicketAttachment,
  TicketAttachmentKind,
  TicketLinkedEntity,
  TicketLinkedEntityType,
  TicketAutoContext,
  TicketSlaSnapshot,
  RaisedByKind,
  CreateTicketCommentPayload,
  CreateTicketCategoryPayload,
  TicketKbArticle,
  TicketKbVisibility,
} from '../pipeline/api/types'

// Support types
export interface SupportTicket {
  id: string
  userId: string
  subject: string
  description: string
  category: 'booking' | 'payment' | 'technical' | 'feedback' | 'other'
  status: 'open' | 'in-progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high'
  messages: {
    from: 'user' | 'support'
    message: string
    timestamp: Date
  }[]
  createdAt: Date
  updatedAt: Date
}

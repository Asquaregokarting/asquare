import type { AsquareBooking, AsquareBookingActivity } from '../../../api/asquare-bookings'
import type { ActivityCatalogRecord } from '../../../api/types'
import { formatActivityLabel } from '../../../../lib/format-activity'

export const ITEMS_PER_PAGE = 20
export const ASQUARE_WEB_BASE_URL =
  (import.meta.env.VITE_ASQUARE_APP_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'https://asquaregokarting.com'
export const INTERAKT_PAYMENT_REQUEST_HEADER_IMAGE_URL =
  (import.meta.env.VITE_INTERAKT_PAYMENT_REQUEST_HEADER_IMAGE_URL as string | undefined)?.trim() ||
  ''
export const PROTOCOL_MAX_LAPS = 5

export const formatDateInput = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const formatCurrency = (value: number): string =>
  `INR ${Math.round(value || 0).toLocaleString('en-IN')}`

const PAYMENT_METHOD_LABEL_BY_LOWER: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  online: 'UPI',
  card: 'Card',
  razorpay: 'Razorpay',
  link: 'Link',
  wallet: 'Wallet',
  split: 'Split',
  protocol: 'Protocol',
  free: 'Free',
}

/** Display-only normalizer so legacy lowercase Firestore values render with canonical casing. */
export const formatPaymentMethod = (raw?: string | null): string => {
  if (!raw) return 'Unknown'
  return PAYMENT_METHOD_LABEL_BY_LOWER[raw.toLowerCase()] ?? raw
}

/** Render booking items — handles both App (activity.name) and Billing (itemName) formats. */
export const formatBookingItems = (booking: AsquareBooking): string => {
  const bi = (booking as Record<string, unknown>).billingItems as
    | Array<{ itemName?: string; quantity?: number }>
    | undefined
  const displayItems = bi && bi.length > 0 ? bi : booking.items || []
  if (displayItems.length === 0) return 'No items'
  return displayItems
    .map((item: unknown, i: number) => {
      const row = item as { itemName?: string; quantity?: number; activity?: { name?: string } }
      const name =
        row.itemName ||
        (row.activity?.name
          ? formatActivityLabel(row.activity as { name: string; category?: string })
          : 'Activity')
      return `${i + 1}. ${name} ×${row.quantity || 1}`
    })
    .join(' | ')
}

export const normalizeRole = (role?: string): string => role?.trim().toLowerCase() || ''

export const isHelicopter = (booking: AsquareBooking): boolean =>
  (booking.items || []).some((item) =>
    String(item.activity?.name ?? '')
      .toLowerCase()
      .includes('helicopter'),
  )

export const isEventBooking = (booking: AsquareBooking): boolean => {
  const items = booking.items || []
  return items.some((item) => {
    const category = String(item.activity?.category ?? '').toLowerCase()
    const id = String(item.activity?.id ?? '')
    const apiId = String(item.activity?.apiId ?? '')
    return category === 'event' || id.startsWith('evt-') || apiId.startsWith('evt-')
  })
}

export const getCatalogPrice = (activity: ActivityCatalogRecord, branchKey: string): number =>
  Math.max(
    0,
    Number(activity.branchPrices[branchKey] ?? Object.values(activity.branchPrices)[0] ?? 0),
  )

export const formatCatalogMetric = (activity: ActivityCatalogRecord): string => {
  if (typeof activity.laps === 'number' && activity.laps > 0) {
    return `${activity.laps} laps`
  }
  const duration = Math.max(0, Math.floor(Number(activity.durationMinutes ?? 0) || 0))
  return duration > 0 ? `${duration} min` : 'Flexible'
}

export const toBookableCatalogActivity = (
  activity: ActivityCatalogRecord,
  branchKey: string,
): AsquareBookingActivity => {
  const base: AsquareBookingActivity = {
    id: activity.id,
    apiId: activity.legacyActivityId ?? activity.id,
    name: activity.bookingName ?? activity.name,
    category:
      activity.subGameName ??
      activity.subcategory ??
      activity.gameName ??
      activity.category ??
      'General',
    basePrice: getCatalogPrice(activity, branchKey),
    duration: Math.max(1, Math.floor(Number(activity.durationMinutes ?? 0) || 1)),
    available: activity.status === 'Active',
  }
  if (activity.description) base.description = activity.description
  const image = activity.imageUrl ?? activity.image
  if (image) base.image = image
  if (activity.locationKeys) base.locationIds = activity.locationKeys
  // Snapshot the per-sub-game Interakt booking-confirmation template
  // onto the booking item at creation time so a later config change
  // doesn't retroactively alter resends. Empty values fall through to
  // BookingConfirmationConfig.defaultTemplateId in the dispatcher.
  if (activity.interaktTemplateId) base.interaktTemplateId = activity.interaktTemplateId
  if (activity.interaktTemplateLanguage)
    base.interaktTemplateLanguage = activity.interaktTemplateLanguage
  // Snapshot per-token printing preference so booking-flow tickets match
  // POS behavior (one token per qty instead of a single merged token).
  if (activity.printIndividualTokens === true) base.printIndividualTokens = true
  // CRITICAL: propagate vendorId from the catalog to the booking item.
  // The catalog inherits this from `game.metadata.vendorId` (game-level
  // vendor stamp — see activities-firestore.ts buildVariantRecord).
  // Without this propagation, vendor activities booked via the link
  // path (admin/telecaller useCreateBooking → createPendingBooking →
  // createUnifiedBooking → enrichItemsWithBilling) end up with no
  // vendor on the item, the billing pipeline attributes the full price
  // to company, and the vendor is shorted on payout. Past examples:
  // ASG260506144416104BXLL Cricket@Vizag → SEERAMREDDY shorted ₹240.
  if (activity.vendorId) base.vendorId = activity.vendorId
  return base
}

export const isGoKartActivity = (name: string): boolean => {
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

/**
 * True if the booking contains at least one GoKarting line. GoKarting is
 * the only A-Square-operated game (everything else is run by third-party
 * vendors who handle their own customer verification at their counters),
 * so any TrackMarshall scan / "Mark Used" / cashier-marshall fallback
 * applies only to bookings that include a GoKart line.
 *
 * Mixed bookings (GoKart + vendor games) still qualify — the marshall is
 * verifying the GoKart line specifically, not the vendor lines.
 */
export const isGoKartBooking = (booking: AsquareBooking): boolean => {
  const items = booking.items || []
  return items.some((item) => {
    // gameId isn't in the AsquareBookingActivity type but is stamped at
    // runtime by toBookableCatalogActivity / billing path. Read defensively.
    const activity = item.activity as Record<string, unknown> | undefined
    const gameId = String(activity?.gameId ?? '').toLowerCase()
    if (gameId === 'gokarting' || gameId === 'gokart' || gameId === 'go-karting') return true
    const name = String(activity?.name ?? item.itemName ?? '')
    return isGoKartActivity(name)
  })
}

/**
 * True if the booking's payment is online-mediated (Razorpay / UPI / card /
 * link). Used to gate the "Re-check Payment" button — there's no point
 * polling Razorpay for cash, wallet, or free bookings.
 */
export const isOnlinePayment = (booking: AsquareBooking): boolean => {
  if (booking.razorpayOrderId) return true
  const method = String(booking.paymentMethod ?? '').toLowerCase()
  return ['razorpay', 'upi', 'card', 'link'].includes(method)
}

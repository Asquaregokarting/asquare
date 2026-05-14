import { collection, getDocs, query, where, limit } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logger } from '../lib/logger'
import { branchIdToSlug } from '../lib/locations'
import type { EventCampaignRecord } from '../pipeline/features/event-campaigns/event-campaign-types'

const COLLECTION = 'eventCampaigns'

const mapPackageDiscount = (value: unknown): EventCampaignRecord['packageDiscount'] => {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (o.type === 'flat') {
    return {
      type: 'flat',
      flatMode: o.flatMode === 'fixed' ? 'fixed' : 'percentage',
      flatValue: Number(o.flatValue) || 0,
    }
  }
  if (o.type === 'buy_x_get_y') {
    return {
      type: 'buy_x_get_y',
      buyCount: Math.max(1, Math.floor(Number(o.buyCount) || 0)),
      getCount: Math.max(0, Math.floor(Number(o.getCount) || 0)),
    }
  }
  return null
}

const mapRecord = (id: string, data: Record<string, unknown>): EventCampaignRecord => ({
  id,
  title: String(data.title ?? ''),
  slug: String(data.slug ?? ''),
  description: String(data.description ?? ''),
  heroImageUrl: String(data.heroImageUrl ?? ''),
  locationKeys: Array.isArray(data.locationKeys) ? (data.locationKeys as string[]) : [],
  disabledLocationKeys: Array.isArray(data.disabledLocationKeys)
    ? (data.disabledLocationKeys as string[])
    : undefined,
  startDate: String(data.startDate ?? ''),
  endDate: String(data.endDate ?? ''),
  status:
    data.status === 'active' || data.status === 'inactive' || data.status === 'ended'
      ? data.status
      : 'inactive',
  packages: Array.isArray(data.packages) ? (data.packages as EventCampaignRecord['packages']) : [],
  packageDiscount: mapPackageDiscount(data.packageDiscount),
  applicability: {
    showOnline:
      typeof data.applicability === 'object' && data.applicability !== null
        ? (data.applicability as { showOnline?: unknown }).showOnline === true
        : false,
    enableInBooking:
      typeof data.applicability === 'object' && data.applicability !== null
        ? (data.applicability as { enableInBooking?: unknown }).enableInBooking === true
        : false,
    enableInBilling:
      typeof data.applicability === 'object' && data.applicability !== null
        ? (data.applicability as { enableInBilling?: unknown }).enableInBilling === true
        : false,
  },
  couponPolicy: {
    allowCouponUsage:
      typeof data.couponPolicy === 'object' && data.couponPolicy !== null
        ? (data.couponPolicy as { allowCouponUsage?: unknown }).allowCouponUsage === true
        : false,
    grantCoupons:
      typeof data.couponPolicy === 'object' && data.couponPolicy !== null
        ? (data.couponPolicy as { grantCoupons?: unknown }).grantCoupons === true
        : false,
  },
  games: Array.isArray(data.games) ? (data.games as EventCampaignRecord['games']) : undefined,
  offer:
    data.offer && typeof data.offer === 'object'
      ? (data.offer as EventCampaignRecord['offer'])
      : null,
  promoText: String(data.promoText ?? ''),
  endedNotificationMessage:
    typeof data.endedNotificationMessage === 'string' ? data.endedNotificationMessage : null,
  endedNotificationSentAt:
    typeof data.endedNotificationSentAt === 'string' ? data.endedNotificationSentAt : null,
  createdBy: String(data.createdBy ?? ''),
  createdAt: String(data.createdAt ?? ''),
  updatedAt: String(data.updatedAt ?? ''),
})

/** Fetch an active event campaign by its URL slug */
export async function getActiveEvent(slug: string): Promise<EventCampaignRecord | null> {
  try {
    const q = query(
      collection(db, COLLECTION),
      where('slug', '==', slug),
      where('status', '==', 'active'),
      limit(1),
    )
    const snap = await getDocs(q)
    if (snap.empty) return null
    const d = snap.docs[0]
    const record = mapRecord(d.id, d.data() as Record<string, unknown>)

    const today = new Date().toISOString().slice(0, 10)
    if (record.startDate && today < record.startDate) return null
    if (record.endDate && today > record.endDate) return null

    return record
  } catch (err) {
    logger.error('event.fetch_by_slug_failed', err, { slug })
    return null
  }
}

/** Fetch all active events for a given location (branchId), filtered by date and games */
export async function listActiveEventsForLocation(
  locationId: string,
): Promise<EventCampaignRecord[]> {
  try {
    const q = query(collection(db, COLLECTION), where('status', '==', 'active'))
    const snap = await getDocs(q)
    if (snap.empty) return []

    const today = new Date().toISOString().slice(0, 10)
    const slug = branchIdToSlug(locationId)

    return snap.docs
      .map((d) => mapRecord(d.id, d.data() as Record<string, unknown>))
      .filter((evt) => {
        if (!evt.applicability.showOnline) return false
        const legacyGameCount = evt.games?.length ?? 0
        const enabledPackageCount = (evt.packages ?? []).filter((p) => p.enabled !== false).length
        if (legacyGameCount === 0 && enabledPackageCount === 0) return false
        // Pre-start bookings are allowed on purpose — an event can be
        // listed and sold before its startDate; only hide once ended.
        if (evt.endDate && today > evt.endDate) return false
        if (evt.locationKeys.length === 0) return true
        const matchesBranch =
          evt.locationKeys.includes(slug) || evt.locationKeys.includes(locationId)
        if (!matchesBranch) return false
        const disabled = evt.disabledLocationKeys ?? []
        if (disabled.includes(slug) || disabled.includes(locationId)) return false
        return true
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
  } catch (err) {
    logger.error('event.list_active_for_location_failed', err, { locationId })
    return []
  }
}

/** Fetch an event by slug regardless of status (for ended/inactive display) */
export async function getEventBySlug(slug: string): Promise<EventCampaignRecord | null> {
  try {
    const q = query(collection(db, COLLECTION), where('slug', '==', slug), limit(1))
    const snap = await getDocs(q)
    if (snap.empty) return null
    const d = snap.docs[0]
    return mapRecord(d.id, d.data() as Record<string, unknown>)
  } catch (err) {
    logger.error('event.fetch_by_slug_failed', err, { slug })
    return null
  }
}

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  limit,
} from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../../lib/firebase'
import { branchIdToSlug, slugToBranchId } from '../../../lib/locations'

/**
 * Match a stored event-campaign location key against a target locationKey,
 * tolerating slug-vs-branchId mismatch. EventCampaign forms historically
 * stored either branchIds ('0' / '1' / '2') or slugs ('visakhapatnam',
 * 'kakinada', 'rajahmundry') depending on which version of the form
 * created the record. The POS / booking caller passes a slug. Without
 * normalization, branchId-shaped data (e.g. Summer Vibes locationKeys
 * ['0','1','2']) silently fails the equality check and the campaign
 * disappears from POS. Compare both representations.
 */
const matchesLocation = (storedKey: unknown, targetSlug: string): boolean => {
  const stored = String(storedKey ?? '')
  if (!stored) return false
  if (stored === targetSlug) return true
  const targetBranchId = slugToBranchId(targetSlug)
  if (stored === targetBranchId) return true
  // Also normalize the stored value to slug and compare.
  return branchIdToSlug(stored) === targetSlug
}
import type {
  EventCampaignApplicability,
  EventCampaignCouponPolicy,
  EventCampaignRecord,
  EventGameConfig,
  EventOfferConfig,
  EventPackage,
  EventPackageDiscount,
  EventPackageItem,
} from './event-campaign-types'

const COLLECTION = 'eventCampaigns'

const getDb = () => initializeFirestore()

const nowIso = () => new Date().toISOString()

const stripUndefined = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T

export const __cleanEventDataForTest = (data: Record<string, unknown>): Record<string, unknown> =>
  cleanEventData(data)

const cleanEventData = (data: Record<string, unknown>): Record<string, unknown> => {
  const cleaned = stripUndefined(data)
  if (Array.isArray(cleaned.games)) {
    cleaned.games = (cleaned.games as Record<string, unknown>[]).map((g) => stripUndefined(g))
  }
  if (cleaned.offer && typeof cleaned.offer === 'object') {
    cleaned.offer = stripUndefined(cleaned.offer as Record<string, unknown>)
  }
  if (Array.isArray(cleaned.packages)) {
    cleaned.packages = (cleaned.packages as Record<string, unknown>[]).map((pkg) => {
      const cleanPkg = stripUndefined(pkg)
      if (Array.isArray(cleanPkg.items)) {
        cleanPkg.items = (cleanPkg.items as Record<string, unknown>[]).map((it) =>
          stripUndefined(it),
        )
      }
      return cleanPkg
    })
  }
  if (cleaned.applicability && typeof cleaned.applicability === 'object') {
    cleaned.applicability = stripUndefined(cleaned.applicability as Record<string, unknown>)
  }
  if (cleaned.couponPolicy && typeof cleaned.couponPolicy === 'object') {
    cleaned.couponPolicy = stripUndefined(cleaned.couponPolicy as Record<string, unknown>)
  }
  if (cleaned.packageDiscount && typeof cleaned.packageDiscount === 'object') {
    cleaned.packageDiscount = stripUndefined(cleaned.packageDiscount as Record<string, unknown>)
  }
  return cleaned
}

const mapApplicability = (value: unknown): EventCampaignApplicability => {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    showOnline: source.showOnline === true,
    enableInBooking: source.enableInBooking === true,
    enableInBilling: source.enableInBilling === true,
  }
}

const mapCouponPolicy = (value: unknown): EventCampaignCouponPolicy => {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    allowCouponUsage: source.allowCouponUsage === true,
    grantCoupons: source.grantCoupons === true,
  }
}

const mapPackageDiscount = (value: unknown): EventPackageDiscount | null => {
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

export const __mapPackagesForTest = (value: unknown): EventPackage[] => mapPackages(value)

const mapPackages = (value: unknown): EventPackage[] => {
  if (!Array.isArray(value)) return []
  return value.map((raw) => {
    const pkg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const items = Array.isArray(pkg.items)
      ? (pkg.items as Record<string, unknown>[]).map(
          (it): EventPackageItem => ({
            id: String(it.id ?? ''),
            type: it.type === 'thirdParty' ? 'thirdParty' : 'company',
            name: String(it.name ?? ''),
            price: Number(it.price ?? 0),
            vendorId: typeof it.vendorId === 'string' ? it.vendorId : undefined,
            revenueShare: typeof it.revenueShare === 'boolean' ? it.revenueShare : undefined,
            printIndividualTokens:
              typeof it.printIndividualTokens === 'boolean' ? it.printIndividualTokens : undefined,
            enabled: it.enabled === false ? false : undefined,
          }),
        )
      : []
    return {
      id: String(pkg.id ?? ''),
      title: String(pkg.title ?? ''),
      locationKey: String(pkg.locationKey ?? ''),
      items,
      enabled: pkg.enabled === false ? false : undefined,
    }
  })
}

const mapEventCampaign = (id: string, data: Record<string, unknown>): EventCampaignRecord => ({
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
  packages: mapPackages(data.packages),
  applicability: mapApplicability(data.applicability),
  couponPolicy: mapCouponPolicy(data.couponPolicy),
  packageDiscount: mapPackageDiscount(data.packageDiscount),
  games: Array.isArray(data.games) ? (data.games as EventGameConfig[]) : undefined,
  offer:
    data.offer && typeof data.offer === 'object' ? (data.offer as EventOfferConfig) : undefined,
  promoText: String(data.promoText ?? ''),
  endedNotificationMessage:
    typeof data.endedNotificationMessage === 'string' ? data.endedNotificationMessage : null,
  endedNotificationSentAt:
    typeof data.endedNotificationSentAt === 'string' ? data.endedNotificationSentAt : null,
  interaktTemplateId:
    typeof data.interaktTemplateId === 'string' && data.interaktTemplateId.trim()
      ? data.interaktTemplateId
      : undefined,
  interaktTemplateLanguage:
    typeof data.interaktTemplateLanguage === 'string' && data.interaktTemplateLanguage.trim()
      ? data.interaktTemplateLanguage
      : undefined,
  createdBy: String(data.createdBy ?? ''),
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
})

/**
 * List event campaigns usable in POS billing for a specific branch.
 *
 * Filters:
 * - status === 'active'
 * - today within [startDate, endDate]
 * - applicability.enableInBilling === true
 * - locationKeys includes the given branch slug
 * - at least one package with pkg.locationKey === this branch
 *
 * Returns campaigns with their `packages` array scoped to just the matching branch.
 */
export const listEventCampaignsForPos = async (
  locationKey: string,
): Promise<EventCampaignRecord[]> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return []
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', '==', 'active')))
  const today = new Date().toISOString().slice(0, 10)
  return snap.docs
    .map((d) => mapEventCampaign(d.id, d.data() as Record<string, unknown>))
    .filter((evt) => filterEventForBranch(evt, locationKey, 'enableInBilling', today))
    .map((evt) => scopeCampaignToBranch(evt, locationKey))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/**
 * List event campaigns usable in the booking-link flow for a specific branch.
 *
 * Mirrors `listEventCampaignsForPos` but filters on
 * `applicability.enableInBooking === true` instead of `enableInBilling`.
 */
export const listEventCampaignsForBooking = async (
  locationKey: string,
): Promise<EventCampaignRecord[]> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return []
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', '==', 'active')))
  const today = new Date().toISOString().slice(0, 10)
  return snap.docs
    .map((d) => mapEventCampaign(d.id, d.data() as Record<string, unknown>))
    .filter((evt) => filterEventForBranch(evt, locationKey, 'enableInBooking', today))
    .map((evt) => scopeCampaignToBranch(evt, locationKey))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** Whether the location is in the campaign and not paused. */
const isBranchLive = (evt: EventCampaignRecord, locationKey: string): boolean => {
  if (!evt.locationKeys.some((k) => matchesLocation(k, locationKey))) return false
  const disabled = evt.disabledLocationKeys ?? []
  return !disabled.some((k) => matchesLocation(k, locationKey))
}

/** Common gate used by both POS and booking listing helpers. */
const filterEventForBranch = (
  evt: EventCampaignRecord,
  locationKey: string,
  applicabilityKey: 'enableInBilling' | 'enableInBooking',
  today: string,
): boolean => {
  if (!evt.applicability[applicabilityKey]) return false
  if (evt.startDate && today < evt.startDate) return false
  if (evt.endDate && today > evt.endDate) return false
  if (!isBranchLive(evt, locationKey)) return false
  const branchPackages = (evt.packages ?? []).filter(
    (p) => matchesLocation(p.locationKey, locationKey) && p.enabled !== false,
  )
  return branchPackages.length > 0
}

/** Returns a copy of the campaign with packages/items scoped to the active branch. */
const scopeCampaignToBranch = (
  evt: EventCampaignRecord,
  locationKey: string,
): EventCampaignRecord => ({
  ...evt,
  packages: (evt.packages ?? [])
    .filter((p) => matchesLocation(p.locationKey, locationKey) && p.enabled !== false)
    .map((p) => ({ ...p, items: p.items.filter((it) => it.enabled !== false) })),
})

export const listEventCampaigns = async (filters?: {
  status?: EventCampaignRecord['status']
  locationKey?: string
}): Promise<EventCampaignRecord[]> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return []
  const snap = await getDocs(collection(db, COLLECTION))
  let results = snap.docs.map((d) => mapEventCampaign(d.id, d.data() as Record<string, unknown>))
  if (filters?.status) {
    results = results.filter((c) => c.status === filters.status)
  }
  if (filters?.locationKey) {
    results = results.filter((c) => c.locationKeys.includes(filters.locationKey!))
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const getEventCampaign = async (id: string): Promise<EventCampaignRecord | null> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return null
  const snap = await getDoc(doc(db, COLLECTION, id))
  if (!snap.exists()) return null
  return mapEventCampaign(snap.id, snap.data() as Record<string, unknown>)
}

export const getEventCampaignBySlug = async (slug: string): Promise<EventCampaignRecord | null> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return null
  const q = query(collection(db, COLLECTION), where('slug', '==', slug), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return mapEventCampaign(d.id, d.data() as Record<string, unknown>)
}

export const createEventCampaign = async (
  data: Omit<EventCampaignRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<EventCampaignRecord> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) throw new Error('Firestore not configured.')
  const now = nowIso()
  const id = `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const record: EventCampaignRecord = { ...data, id, createdAt: now, updatedAt: now }
  await setDoc(
    doc(db, COLLECTION, id),
    cleanEventData(record as unknown as Record<string, unknown>),
  )
  return record
}

export const updateEventCampaign = async (
  id: string,
  updates: Partial<Omit<EventCampaignRecord, 'id' | 'createdAt'>>,
): Promise<void> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) throw new Error('Firestore not configured.')
  await setDoc(
    doc(db, COLLECTION, id),
    cleanEventData({ ...updates, updatedAt: nowIso() } as Record<string, unknown>),
    { merge: true },
  )
}

export const deleteEventCampaign = async (id: string): Promise<void> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) throw new Error('Firestore not configured.')
  await deleteDoc(doc(db, COLLECTION, id))
}

export const isSlugUnique = async (slug: string, excludeId?: string): Promise<boolean> => {
  await ensureAnonymousAuth()
  const db = getDb()
  if (!db) return true
  const q = query(collection(db, COLLECTION), where('slug', '==', slug), limit(1))
  const snap = await getDocs(q)
  if (snap.empty) return true
  return excludeId != null && snap.docs[0].id === excludeId
}

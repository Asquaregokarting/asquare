import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newClientRequestId } from '../../../../hooks/useSubmitGuard'
import { AsquareBookingActivity, asquareBookingsApi } from '../../../api/asquare-bookings'
import { listBranchActivityCatalog } from '../../../api/activity-catalog-firestore'
import { ActivityCatalogRecord } from '../../../api/types'
import { pipelineCustomersApi } from '../../../api/pipeline-customers'
import { lookupMemberByPhone, type MemberRecord } from '../../../api/asquare-members'
import { slugToBranchId } from '../../../../lib/locations'
import { fmtDateIST } from '../../../../lib/date-format'
import { logger } from '../../../../lib/logger'
import type { ComboRecord } from '../../../features/combos/combo-types'
import { listCombos } from '../../../features/combos/combo-firestore'
import type {
  EventCampaignRecord,
  EventPackage,
} from '../../../features/event-campaigns/event-campaign-types'
import { listEventCampaignsForBooking } from '../../../features/event-campaigns/event-campaigns-firestore'
import {
  computePackageDiscount,
  type PackageDiscountLine,
  type PackageDiscountResult,
} from '../../../features/event-campaigns/event-pricing'
import {
  applyMemberCoupons,
  buildMemberCouponSentinel,
  COUPON_ELIGIBLE_CATEGORY,
  projectEarnedCoupons,
} from './coupon-application'
import {
  formatCurrency,
  formatDateInput,
  getCatalogPrice,
  INTERAKT_PAYMENT_REQUEST_HEADER_IMAGE_URL,
  isGoKartActivity,
  PROTOCOL_MAX_LAPS,
  toBookableCatalogActivity,
} from './bookings-utils'

interface Actor {
  id: string
  name: string
  role: string
}

interface Session {
  token?: string
  user: {
    id: string
    name: string
    role: string
    maxDiscountPercent?: number
  }
}

export const useCreateBooking = (
  actor: Actor,
  session: Session | null,
  role: string,
  locations: Array<{ id: string; name: string }>,
  onBookingCreated: () => void,
) => {
  const canSendBookingLinks = ['owner', 'admin', 'cashier', 'telecaller', 'thirdparty'].includes(
    role,
  )

  // Customer state
  const [createLocation, setCreateLocation] = useState(() => locations[0]?.id ?? 'visakhapatnam')
  const [createDate, setCreateDate] = useState(formatDateInput(new Date()))
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false)
  const [customerLookupMessage, setCustomerLookupMessage] = useState<string | null>(null)
  const [customerNameEdited, setCustomerNameEdited] = useState(false)
  const [customerLookupSource, setCustomerLookupSource] = useState<
    'firestore' | 'website' | 'none' | null
  >(null)
  const [memberInsight, setMemberInsight] = useState<MemberRecord | null>(null)
  const [memberLookupLoading, setMemberLookupLoading] = useState(false)

  // Activity catalog state
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [activityCatalog, setActivityCatalog] = useState<ActivityCatalogRecord[]>([])
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([])
  const [activityQty, setActivityQty] = useState<Record<string, number>>({})
  const [activitySearchTerm, setActivitySearchTerm] = useState('')
  const [activityCategoryFilter, setActivityCategoryFilter] = useState('')
  const [activeCatalogGameKey, setActiveCatalogGameKey] = useState<string | null>(null)
  const [activeCatalogSubGameKey, setActiveCatalogSubGameKey] = useState<string | null>(null)

  // Combo state
  const [combos, setCombos] = useState<ComboRecord[]>([])
  const [selectedComboIds, setSelectedComboIds] = useState<string[]>([])
  const [comboQty, setComboQty] = useState<Record<string, number>>({})

  // Event-campaign state — packages surfaced alongside activities/combos when
  // `applicability.enableInBooking === true`. Composite key for a selected package
  // is `${campaignId}::${packageId}`.
  const [eventCampaigns, setEventCampaigns] = useState<EventCampaignRecord[]>([])
  const [selectedEventPackageIds, setSelectedEventPackageIds] = useState<string[]>([])
  const [eventPackageQty, setEventPackageQty] = useState<Record<string, number>>({})

  // Benefit state
  const [discountPercent, setDiscountPercent] = useState<number>(0)
  const [benefitMode, setBenefitMode] = useState<'discount' | 'coupon'>('discount')
  const [isProtocol, setIsProtocol] = useState(false)
  const [protocolReason, setProtocolReason] = useState('')

  // Submit state
  const [sendingLink, setSendingLink] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Synchronous re-entry guard — rejects a double-click on the same tick
  // before React schedules `sendingLink` → disabled.
  const inFlightSendRef = useRef(false)
  // Idempotency token — kept across retries, cleared on success.
  const clientRequestIdRef = useRef<string | null>(null)

  const activeBranchKey = useMemo(
    () => asquareBookingsApi.locationToBranchId(createLocation),
    [createLocation],
  )
  const normalizedCustomerPhone = useMemo(
    () => asquareBookingsApi.normalizePhone(customerPhone),
    [customerPhone],
  )

  // Sync createLocation once the async locations list loads so we don't stay
  // pinned to a default slug the user has no access to (which causes event
  // campaigns / activities to appear only after the user manually switches).
  useEffect(() => {
    if (locations.length === 0) return
    if (locations.some((l) => l.id === createLocation)) return
    setCreateLocation(locations[0].id)
  }, [locations, createLocation])

  // ── Activity catalog loading ─────────────────────────────────────────────
  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true)
    try {
      const token = session?.token
      if (!token) {
        setActivityCatalog([])
        setSelectedActivityIds([])
        return
      }
      const [activities, branchCombos] = await Promise.all([
        listBranchActivityCatalog(activeBranchKey),
        listCombos(slugToBranchId(createLocation)).catch(() => [] as ComboRecord[]),
      ])
      const { isCurrentlyUnavailable, isOnSurface } =
        await import('../../../api/activity-availability')
      // Honor the operator's per-game `platforms` setting from
      // Activities → Hierarchy. Legacy docs without the field set are
      // visible everywhere (see `isOnSurface`).
      const activeActivities = activities
        .filter(
          (activity) =>
            activity.status === 'Active' &&
            !isCurrentlyUnavailable(activity) &&
            isOnSurface(activity, 'bookings'),
        )
        .sort((left, right) => {
          const gameCompare = String(left.gameName ?? left.category ?? '').localeCompare(
            String(right.gameName ?? right.category ?? ''),
          )
          if (gameCompare !== 0) return gameCompare
          const subGameCompare = String(left.subGameName ?? left.subcategory ?? '').localeCompare(
            String(right.subGameName ?? right.subcategory ?? ''),
          )
          if (subGameCompare !== 0) return subGameCompare
          return String(left.variantLabel ?? left.name).localeCompare(
            String(right.variantLabel ?? right.name),
          )
        })
      setActivityCatalog(activeActivities)
      setCombos(branchCombos)
      const validIds = new Set(activeActivities.map((a) => a.id))
      setSelectedActivityIds((current) =>
        current.filter(
          (id) => validIds.has(id) && Math.max(0, Math.floor(activityQty[id] ?? 0)) > 0,
        ),
      )
    } catch (reason) {
      setActivityCatalog([])
      setCombos([])
      setError(reason instanceof Error ? reason.message : 'Failed to load activities.')
    } finally {
      setActivitiesLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchKey, createDate, session?.token])

  useEffect(() => {
    void loadActivities()
  }, [loadActivities])

  // ── Event campaigns (packages selectable during booking) ─────────────────
  useEffect(() => {
    let cancelled = false
    listEventCampaignsForBooking(createLocation)
      .then((list) => {
        if (!cancelled) setEventCampaigns(list)
      })
      .catch(() => {
        if (!cancelled) setEventCampaigns([])
      })
    return () => {
      cancelled = true
    }
  }, [createLocation])

  // Drop any selected package that is no longer in the available list
  // (e.g. campaign ended, was disabled, or branch switched).
  useEffect(() => {
    const availableKeys = new Set<string>()
    for (const evt of eventCampaigns) {
      for (const pkg of evt.packages ?? []) {
        availableKeys.add(`${evt.id}::${pkg.id}`)
      }
    }
    setSelectedEventPackageIds((current) =>
      current.filter((k) => availableKeys.has(k) && (eventPackageQty[k] ?? 0) > 0),
    )
  }, [eventCampaigns]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Customer lookup ──────────────────────────────────────────────────────
  useEffect(() => {
    setCustomerLookupMessage(null)
    setCustomerNameEdited(false)
  }, [normalizedCustomerPhone])

  useEffect(() => {
    if (normalizedCustomerPhone.length !== 10) {
      setCustomerLookupLoading(false)
      setMemberLookupLoading(false)
      setCustomerLookupSource(null)
      setMemberInsight(null)
      setBenefitMode('discount')
      if (!normalizedCustomerPhone) setCustomerLookupMessage(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCustomerLookupLoading(true)
      setMemberLookupLoading(true)
      void Promise.allSettled([
        pipelineCustomersApi.lookupWithFallback(normalizedCustomerPhone),
        lookupMemberByPhone(normalizedCustomerPhone),
      ])
        .then(([customerResult, memberResult]) => {
          if (cancelled) return
          if (customerResult.status === 'fulfilled') {
            const result = customerResult.value
            if (!result.record) {
              setCustomerLookupSource('none')
              setCustomerLookupMessage(
                'New customer \u2014 record will be saved on booking creation.',
              )
            } else {
              const canAutofillName = !customerNameEdited || !customerName.trim()
              if (canAutofillName && result.record.name.trim())
                setCustomerName(result.record.name.trim())
              if (!customerEmail.trim() && result.record.email?.trim())
                setCustomerEmail(result.record.email.trim())
              setCustomerLookupSource(result.source as 'firestore' | 'website')
              setCustomerLookupMessage(
                result.source === 'firestore'
                  ? `Customer found: ${result.record.name}`
                  : `Matched from website account: ${result.record.name}`,
              )
            }
          } else {
            setCustomerLookupSource(null)
            setCustomerLookupMessage(
              customerResult.reason instanceof Error
                ? customerResult.reason.message
                : 'Customer lookup failed.',
            )
          }
          if (memberResult.status === 'fulfilled' && memberResult.value) {
            const member = memberResult.value
            setMemberInsight(member)
            if (
              (!customerName.trim() || !customerNameEdited) &&
              member.name.trim() &&
              !customerName.trim()
            ) {
              setCustomerName(member.name.trim())
            }
            if (!customerEmail.trim() && member.email?.trim()) setCustomerEmail(member.email.trim())
          } else {
            if (memberResult.status === 'rejected') {
              logger.warn('bookings_module.member_lookup_failed', { reason: memberResult.reason })
            }
            setMemberInsight(null)
            setBenefitMode('discount')
          }
        })
        .finally(() => {
          if (!cancelled) {
            setCustomerLookupLoading(false)
            setMemberLookupLoading(false)
          }
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [customerNameEdited, normalizedCustomerPhone]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Catalog grouping / filtering ─────────────────────────────────────────
  const activityCategories = useMemo(() => {
    const cats = Array.from(
      new Set(
        activityCatalog.map((a) => String(a.gameName ?? a.category ?? '').trim()).filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b))
    if (combos.length > 0 && !isProtocol) cats.push('Combos')
    if (eventCampaigns.length > 0 && !isProtocol) cats.push('Events')
    return cats
  }, [activityCatalog, combos, eventCampaigns, isProtocol])

  useEffect(() => {
    if (activityCategories.length === 0) return
    if (activityCategoryFilter && activityCategories.includes(activityCategoryFilter)) return
    const goKart = activityCategories.find((c) => isGoKartActivity(c))
    setActivityCategoryFilter(goKart ?? activityCategories[0])
  }, [activityCategories]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredCombos = useMemo(() => {
    if (isProtocol || activityCategoryFilter !== 'Combos') return []
    const q = activitySearchTerm.trim().toLowerCase()
    return combos.filter((c) => !q || c.name.toLowerCase().includes(q))
  }, [combos, activitySearchTerm, activityCategoryFilter, isProtocol])

  const normalizedActivitySearch = useMemo(
    () => activitySearchTerm.trim().toLowerCase(),
    [activitySearchTerm],
  )

  const visibleCatalogActivities = useMemo(() => {
    if (activityCategoryFilter === 'Combos') return []
    return activityCatalog.filter((activity) => {
      if (activity.visibleInBooking === false) return false
      const gameName = String(activity.gameName ?? activity.category ?? '')
      const subGameName = String(activity.subGameName ?? activity.subcategory ?? '')
      const variantName = String(activity.variantLabel ?? activity.name ?? '')
      const matchesCategory = !activityCategoryFilter || gameName === activityCategoryFilter
      const searchBlob =
        `${gameName} ${subGameName} ${variantName} ${activity.bookingName ?? ''} ${(activity.badges ?? []).join(' ')}`.toLowerCase()
      const matchesSearch =
        !normalizedActivitySearch || searchBlob.includes(normalizedActivitySearch)
      return matchesCategory && matchesSearch
    })
  }, [activityCatalog, activityCategoryFilter, normalizedActivitySearch])

  const groupedCatalogActivities = useMemo(
    () =>
      visibleCatalogActivities.reduce<
        Array<{
          key: string
          title: string
          imageUrl?: string
          subGames: Array<{ key: string; title: string; activities: ActivityCatalogRecord[] }>
        }>
      >((groups, activity) => {
        const gameKey = String(
          activity.gameId ?? activity.gameName ?? activity.category ?? activity.id,
        )
        const gameTitle = String(activity.gameName ?? activity.category ?? 'Game')
        const subGameKey = String(
          activity.subGameId ?? activity.subGameName ?? activity.subcategory ?? 'general',
        )
        const subGameTitle = String(activity.subGameName ?? activity.subcategory ?? 'General')
        const existingGame = groups.find((g) => g.key === gameKey)
        if (!existingGame) {
          groups.push({
            key: gameKey,
            title: gameTitle,
            imageUrl: activity.imageUrl ?? activity.image,
            subGames: [{ key: subGameKey, title: subGameTitle, activities: [activity] }],
          })
          return groups
        }
        const existingSubGame = existingGame.subGames.find((sg) => sg.key === subGameKey)
        if (!existingSubGame) {
          existingGame.subGames.push({
            key: subGameKey,
            title: subGameTitle,
            activities: [activity],
          })
        } else {
          existingSubGame.activities.push(activity)
        }
        return groups
      }, []),
    [visibleCatalogActivities],
  )

  const activeCatalogGroup = useMemo(
    () => groupedCatalogActivities.find((g) => g.key === activeCatalogGameKey) ?? null,
    [groupedCatalogActivities, activeCatalogGameKey],
  )

  const activeCatalogSubGame = useMemo(() => {
    if (!activeCatalogGroup || !activeCatalogSubGameKey) return null
    return activeCatalogGroup.subGames.find((sg) => sg.key === activeCatalogSubGameKey) ?? null
  }, [activeCatalogGroup, activeCatalogSubGameKey])

  useEffect(() => {
    if (activityCategoryFilter && !activityCategories.includes(activityCategoryFilter)) {
      const goKart = activityCategories.find((c) => isGoKartActivity(c))
      setActivityCategoryFilter(goKart ?? activityCategories[0] ?? '')
    }
  }, [activityCategories, activityCategoryFilter])

  useEffect(() => {
    if (activeCatalogGameKey && !activeCatalogGroup) {
      setActiveCatalogGameKey(null)
      setActiveCatalogSubGameKey(null)
    }
  }, [activeCatalogGameKey, activeCatalogGroup])

  useEffect(() => {
    if (!activeCatalogGameKey && activeCatalogSubGameKey) {
      setActiveCatalogSubGameKey(null)
      return
    }
    if (activeCatalogSubGameKey && !activeCatalogSubGame) {
      setActiveCatalogSubGameKey(null)
    }
  }, [activeCatalogGameKey, activeCatalogSubGameKey, activeCatalogSubGame])

  // ── Cart derived data ────────────────────────────────────────────────────
  const selectedActivities = useMemo(
    () => activityCatalog.filter((a) => selectedActivityIds.includes(a.id)),
    [activityCatalog, selectedActivityIds],
  )

  const selectedCombos = useMemo(
    () => combos.filter((c) => selectedComboIds.includes(c.id)),
    [combos, selectedComboIds],
  )

  const comboTotal = useMemo(
    () =>
      selectedCombos.reduce(
        (sum, c) => sum + c.comboPrice * Math.max(1, Math.floor(comboQty[c.id] ?? 1)),
        0,
      ),
    [selectedCombos, comboQty],
  )

  // ── Event packages: selection, pricing, campaign-level discounts ─────────
  interface SelectedEventPackage {
    key: string
    campaign: EventCampaignRecord
    pkg: EventPackage
    qty: number
    unitPrice: number
    lineTotal: number
  }

  const selectedEventPackages = useMemo<SelectedEventPackage[]>(() => {
    const out: SelectedEventPackage[] = []
    for (const key of selectedEventPackageIds) {
      const [campaignId, packageId] = key.split('::')
      const campaign = eventCampaigns.find((e) => e.id === campaignId)
      if (!campaign) continue
      const pkg = (campaign.packages ?? []).find((p) => p.id === packageId)
      if (!pkg) continue
      const unitPrice = (pkg.items ?? []).reduce((s, it) => s + Number(it.price ?? 0), 0)
      const qty = Math.max(1, Math.floor(eventPackageQty[key] ?? 1))
      out.push({ key, campaign, pkg, qty, unitPrice, lineTotal: unitPrice * qty })
    }
    return out
  }, [selectedEventPackageIds, eventCampaigns, eventPackageQty])

  const eventPackagesSubtotal = useMemo(
    () => selectedEventPackages.reduce((s, l) => s + l.lineTotal, 0),
    [selectedEventPackages],
  )

  // Campaign-level discount (flat / BxGy) — mirrors POS via `computePackageDiscount`.
  const packageDiscountByEvent = useMemo(() => {
    const byEvent = new Map<string, PackageDiscountResult>()
    const linesByEvent = new Map<string, PackageDiscountLine[]>()
    for (const line of selectedEventPackages) {
      const campaignId = line.campaign.id
      const list = linesByEvent.get(campaignId) ?? []
      list.push({ packageId: line.pkg.id, unitPrice: line.unitPrice, quantity: line.qty })
      linesByEvent.set(campaignId, list)
    }
    for (const [campaignId, lines] of linesByEvent) {
      const evt = eventCampaigns.find((e) => e.id === campaignId)
      byEvent.set(campaignId, computePackageDiscount(lines, evt?.packageDiscount ?? null))
    }
    return byEvent
  }, [selectedEventPackages, eventCampaigns])

  const packageFlatDiscountTotal = useMemo(
    () => Array.from(packageDiscountByEvent.values()).reduce((s, r) => s + r.flatValue, 0),
    [packageDiscountByEvent],
  )
  const packageBxgyDiscountTotal = useMemo(
    () => Array.from(packageDiscountByEvent.values()).reduce((s, r) => s + r.bxgyFreeValue, 0),
    [packageDiscountByEvent],
  )

  const totalAmount = useMemo(
    () =>
      selectedActivities.reduce((sum, a) => {
        const qty = Math.max(1, Math.floor(activityQty[a.id] ?? 1))
        return sum + getCatalogPrice(a, activeBranchKey) * qty
      }, 0) +
      comboTotal +
      eventPackagesSubtotal,
    [activeBranchKey, selectedActivities, activityQty, comboTotal, eventPackagesSubtotal],
  )

  const companyTotal = useMemo(
    () =>
      selectedActivities
        .filter((a) => !a.vendorId)
        .reduce((sum, a) => {
          const qty = Math.max(1, Math.floor(activityQty[a.id] ?? 1))
          return sum + getCatalogPrice(a, activeBranchKey) * qty
        }, 0),
    [activeBranchKey, selectedActivities, activityQty],
  )

  const vendorTotal = useMemo(
    () =>
      selectedActivities
        .filter((a) => !!a.vendorId)
        .reduce((sum, a) => {
          const qty = Math.max(1, Math.floor(activityQty[a.id] ?? 1))
          return sum + getCatalogPrice(a, activeBranchKey) * qty
        }, 0),
    [activeBranchKey, selectedActivities, activityQty],
  )

  // Coupon application — activity lines are always considered (category gate
  // handled inside `applyMemberCoupons`). Event package lines are only included
  // when that event's `couponPolicy.allowCouponUsage === true`; they are passed
  // with the canonical gokarting category so they compete equally with activity
  // lines, preserving greedy-fill order.
  const couponApplication = useMemo(() => {
    const activityLines = selectedActivities.map((a) => ({
      category: String(a.category ?? '').toLowerCase(),
      price: getCatalogPrice(a, activeBranchKey),
      qty: Math.max(1, Math.floor(activityQty[a.id] ?? 1)),
    }))
    const eventLines = selectedEventPackages.map((l) => ({
      category: l.campaign.couponPolicy.allowCouponUsage ? COUPON_ELIGIBLE_CATEGORY : 'event',
      price: l.unitPrice,
      qty: l.qty,
    }))
    return applyMemberCoupons({
      items: [...activityLines, ...eventLines],
      couponsAvailable:
        benefitMode === 'coupon' && memberInsight ? memberInsight.coupons150Available : 0,
    })
  }, [
    activeBranchKey,
    activityQty,
    benefitMode,
    memberInsight,
    selectedActivities,
    selectedEventPackages,
  ])

  const couponDiscount = couponApplication.couponDiscount
  const flatDiscount =
    benefitMode === 'discount' ? Math.round((companyTotal * discountPercent) / 100) : 0
  const packageDiscountAmount = packageFlatDiscountTotal + packageBxgyDiscountTotal
  const discountAmount = flatDiscount + couponDiscount + packageDiscountAmount
  const finalAmount = Math.max(0, totalAmount - discountAmount)

  const perLineCouponDiscount = useMemo(() => {
    const map = new Map<string, { units: number; discount: number }>()
    selectedActivities.forEach((a, idx) => {
      map.set(a.id, {
        units: couponApplication.perLineUnitsApplied[idx] ?? 0,
        discount: couponApplication.perLineDiscount[idx] ?? 0,
      })
    })
    const offset = selectedActivities.length
    selectedEventPackages.forEach((line, idx) => {
      map.set(line.key, {
        units: couponApplication.perLineUnitsApplied[offset + idx] ?? 0,
        discount: couponApplication.perLineDiscount[offset + idx] ?? 0,
      })
    })
    return map
  }, [couponApplication, selectedActivities, selectedEventPackages])

  // ₹150 coupons are earned only from spend on campaigns with
  // `couponPolicy.grantCoupons === true`. Event packages whose campaign opts
  // out do NOT contribute to the earning threshold.
  const nonGrantingEventSpend = useMemo(
    () =>
      selectedEventPackages
        .filter((l) => !l.campaign.couponPolicy.grantCoupons)
        .reduce((s, l) => s + l.lineTotal, 0),
    [selectedEventPackages],
  )
  const projectedEarnedCoupons = useMemo(() => {
    if (!memberInsight) return 0
    const earnable = Math.max(0, finalAmount - nonGrantingEventSpend)
    return projectEarnedCoupons(memberInsight.totalBillAmount, earnable)
  }, [finalAmount, memberInsight, nonGrantingEventSpend])

  const couponModeAvailable =
    !isProtocol && memberInsight !== null && memberInsight.coupons150Available > 0
  const hasCompanyItems = companyTotal > 0
  const hasVendorItems = vendorTotal > 0
  const cartIsAllVendor = hasVendorItems && !hasCompanyItems

  // Auto-reset benefit mode when unavailable
  useEffect(() => {
    if (!couponModeAvailable && benefitMode === 'coupon') setBenefitMode('discount')
  }, [benefitMode, couponModeAvailable])

  useEffect(() => {
    if (cartIsAllVendor && discountPercent > 0) setDiscountPercent(0)
  }, [cartIsAllVendor, discountPercent])

  // ── Cart helpers ─────────────────────────────────────────────────────────
  const increaseActivityQty = useCallback((activityId: string, currentQty: number) => {
    const nextQty = Math.max(0, Math.floor(currentQty)) + 1
    setActivityQty((c) => ({ ...c, [activityId]: nextQty }))
    setSelectedActivityIds((c) => (c.includes(activityId) ? c : [...c, activityId]))
  }, [])

  const decreaseActivityQty = useCallback((activityId: string, currentQty: number) => {
    const nextQty = Math.max(0, Math.max(0, Math.floor(currentQty)) - 1)
    setActivityQty((c) => ({ ...c, [activityId]: nextQty }))
    setSelectedActivityIds((c) => (nextQty === 0 ? c.filter((id) => id !== activityId) : c))
  }, [])

  const addCombo = useCallback(
    (combo: ComboRecord) => {
      if (selectedComboIds.includes(combo.id)) {
        setComboQty((p) => ({ ...p, [combo.id]: (p[combo.id] ?? 1) + 1 }))
      } else {
        setSelectedComboIds((p) => [...p, combo.id])
        setComboQty((p) => ({ ...p, [combo.id]: 1 }))
      }
    },
    [selectedComboIds],
  )

  const removeCombo = useCallback((comboId: string) => {
    setSelectedComboIds((p) => p.filter((id) => id !== comboId))
    setComboQty((p) => ({ ...p, [comboId]: 0 }))
  }, [])

  const increaseComboQty = useCallback((comboId: string) => {
    setComboQty((p) => ({ ...p, [comboId]: (p[comboId] ?? 1) + 1 }))
  }, [])

  const decreaseComboQty = useCallback(
    (comboId: string) => {
      const next = Math.max(0, (comboQty[comboId] ?? 1) - 1)
      setComboQty((p) => ({ ...p, [comboId]: next }))
      if (next === 0) setSelectedComboIds((p) => p.filter((id) => id !== comboId))
    },
    [comboQty],
  )

  const removeActivity = useCallback((activityId: string) => {
    setActivityQty((c) => ({ ...c, [activityId]: 0 }))
    setSelectedActivityIds((c) => c.filter((id) => id !== activityId))
  }, [])

  const addEventPackage = useCallback((campaignId: string, packageId: string) => {
    const key = `${campaignId}::${packageId}`
    setSelectedEventPackageIds((p) => (p.includes(key) ? p : [...p, key]))
    setEventPackageQty((p) => ({ ...p, [key]: Math.max(1, Math.floor(p[key] ?? 0)) + 1 }))
  }, [])

  const removeEventPackage = useCallback((key: string) => {
    setSelectedEventPackageIds((p) => p.filter((k) => k !== key))
    setEventPackageQty((p) => ({ ...p, [key]: 0 }))
  }, [])

  const increaseEventPackageQty = useCallback((key: string) => {
    setEventPackageQty((p) => ({ ...p, [key]: Math.max(1, Math.floor(p[key] ?? 1)) + 1 }))
    setSelectedEventPackageIds((p) => (p.includes(key) ? p : [...p, key]))
  }, [])

  const decreaseEventPackageQty = useCallback(
    (key: string) => {
      const next = Math.max(0, Math.floor(eventPackageQty[key] ?? 1) - 1)
      setEventPackageQty((p) => ({ ...p, [key]: next }))
      if (next === 0) setSelectedEventPackageIds((p) => p.filter((k) => k !== key))
    },
    [eventPackageQty],
  )

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSendLink = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // Synchronous re-entry guard. State alone loses to fast double-clicks
      // because the second handler observes the stale `sendingLink === false`.
      if (inFlightSendRef.current) return
      setError(null)
      setSuccess(null)

      if (!canSendBookingLinks)
        return setError('Your role does not have permission to create booking links.')

      const name = customerName.trim()
      const phone = asquareBookingsApi.normalizePhone(customerPhone)
      if (!name) return setError('Customer name is required.')
      if (phone.length !== 10) return setError('Enter a valid 10-digit mobile number.')
      if (!selectedActivities.length && !selectedCombos.length && !selectedEventPackages.length)
        return setError('Select at least one activity, combo, or event package.')

      if (isProtocol) {
        const hasNonGoKart = selectedActivities.some((a) => {
          const actName = [a.category, a.subcategory, a.name].filter(Boolean).join(' ')
          return !isGoKartActivity(actName)
        })
        if (hasNonGoKart)
          return setError(
            'Protocol is only allowed for Go-Karting activities. Remove non-Go-Karting items.',
          )
        const totalQty = selectedActivities.reduce(
          (sum, a) => sum + Math.max(1, Math.floor(activityQty[a.id] ?? 1)),
          0,
        )
        if (totalQty > PROTOCOL_MAX_LAPS)
          return setError(
            `Protocol is limited to ${PROTOCOL_MAX_LAPS} laps maximum. Currently: ${totalQty}.`,
          )
        if (!protocolReason.trim())
          return setError('Please provide a reason for the protocol booking.')
      }

      if (discountPercent > 0 && cartIsAllVendor) {
        setDiscountPercent(0)
        return setError('Discount cannot apply — all selected items are vendor-supplied.')
      }

      const activityItems = selectedActivities.map((activity) => {
        const qty = Math.max(1, Math.floor(activityQty[activity.id] ?? 1))
        const bookableActivity = toBookableCatalogActivity(activity, activeBranchKey)
        const price = Number(bookableActivity.basePrice ?? 0)
        return {
          activity: { ...bookableActivity, available: true },
          quantity: qty,
          duration: Number(bookableActivity.duration ?? 15),
          date: createDate,
          timeSlot: 'Flexible',
          price,
        }
      })

      const comboItems = selectedCombos.flatMap((combo) => {
        const qty = Math.max(1, Math.floor(comboQty[combo.id] ?? 1))
        return combo.items.map((ci) => ({
          activity: {
            id: ci.activityId,
            apiId: ci.activityId,
            name: `${combo.name} — ${ci.itemName}`,
            category: combo.name,
            basePrice: ci.adjustedPrice,
            duration: 15,
            available: true,
            // Mirror catalog IDs onto activity too so any downstream
            // consumer that reads activity.gameTypeId stays consistent.
            gameTypeId: ci.gameId,
            vendorId: ci.vendorId,
          } as AsquareBookingActivity & { available: boolean },
          quantity: qty,
          duration: 15,
          date: createDate,
          timeSlot: 'Flexible' as const,
          price: ci.adjustedPrice,
          // Top-level catalog IDs — required so the booking is NOT
          // orphaned by `items[].gameId` checks downstream. Comes
          // straight from the combo doc; no fuzzy matching.
          itemName: `${combo.name} • ${ci.itemName}`,
          unitPrice: ci.adjustedPrice,
          gameId: ci.gameId,
          subGameId: ci.subGameId,
          variantId: ci.variantId,
          vendorId: ci.vendorId,
        }))
      })

      // Event packages flatten into one booking line per package item, mirroring
      // how POS explodes `eventPackageItems` at checkout. Campaign-level flat /
      // BxGy discounts are already folded into `discountAmount`, so each line
      // carries its original unit price.
      const eventPackageItems = selectedEventPackages.flatMap((line) =>
        line.pkg.items.map((it) => ({
          activity: {
            id: `evt-${line.campaign.id}-${line.pkg.id}-${it.id}`,
            apiId: `evt-${line.campaign.id}-${line.pkg.id}-${it.id}`,
            name: `${line.campaign.title} — ${line.pkg.title} — ${it.name}`,
            category: 'Event',
            basePrice: Number(it.price ?? 0),
            duration: 15,
            available: true,
            vendorId: it.vendorId,
            // Snapshot the campaign's per-event Interakt template at
            // booking-creation time so resends keep using the template
            // active when the booking was made.
            ...(line.campaign.interaktTemplateId
              ? { interaktTemplateId: line.campaign.interaktTemplateId }
              : {}),
            ...(line.campaign.interaktTemplateLanguage
              ? { interaktTemplateLanguage: line.campaign.interaktTemplateLanguage }
              : {}),
            // Snapshot per-event-package-item token printing preference so
            // helicopter / per-seat event items print N tokens while go-kart
            // event items merge into a single quantity-N token. The flag is
            // also bubbled to the item top-level below for the printer.
            ...(it.printIndividualTokens === true ? { printIndividualTokens: true } : {}),
          } as AsquareBookingActivity & { available: boolean },
          quantity: line.qty,
          duration: 15,
          date: createDate,
          timeSlot: 'Flexible' as const,
          price: Number(it.price ?? 0),
        })),
      )

      const items = [...activityItems, ...comboItems, ...eventPackageItems]

      // Defensive re-check: between when the picker loaded its catalog and
      // the staff clicked Submit, an admin may have flagged one of the
      // selected activities as temporarily unavailable. Re-fetch the catalog
      // once and refuse to submit if any selected item is now down.
      try {
        const { isCurrentlyUnavailable, isOnSurface } =
          await import('../../../api/activity-availability')
        const freshCatalog = await listBranchActivityCatalog(activeBranchKey)
        const nowDown = selectedActivities
          .map((a) => freshCatalog.find((c) => c.id === a.id))
          .filter(
            (c): c is ActivityCatalogRecord =>
              !!c && (isCurrentlyUnavailable(c) || !isOnSurface(c, 'bookings')),
          )
        if (nowDown.length > 0) {
          const names = nowDown.map((c) => c.bookingName ?? c.name).join(', ')
          setError(
            `Cannot create booking — the following activity(ies) are no longer bookable: ${names}. Refresh and pick a different game.`,
          )
          return
        }
      } catch (catalogErr) {
        // Catalog re-check failure is non-fatal — staff is in front of a
        // paying customer; better to proceed than block on a transient read
        // failure. Log loud so it's visible if it becomes common.
        logger.error('use_create_booking.availability_recheck_failed', catalogErr)
      }

      inFlightSendRef.current = true
      setSendingLink(true)
      // Reuse token across retries so the server idempotency check dedups
      // if a prior attempt actually wrote before failing on a side effect.
      if (!clientRequestIdRef.current) clientRequestIdRef.current = newClientRequestId()
      const clientRequestId = clientRequestIdRef.current
      try {
        if (isProtocol) {
          const { createUnifiedBooking } = await import('../../../../lib/unified-booking')
          const result = await createUnifiedBooking({
            source: 'ADMIN_BOOKING',
            clientRequestId,
            userId: `offline_${phone}`,
            customerName: name,
            customerPhone: phone,
            customerEmail: customerEmail.trim() || undefined,
            items: items.map((i) => ({
              itemName: i.activity.name,
              quantity: i.quantity,
              unitPrice: 0,
              activity: i.activity,
              duration: i.duration,
              date: i.date,
              timeSlot: i.timeSlot,
              // Bubble per-token printing flag so it persists on the booking
              // item (printer reads it from item top-level, not activity).
              printIndividualTokens:
                (i.activity as { printIndividualTokens?: boolean }).printIndividualTokens === true
                  ? true
                  : undefined,
            })),
            totalAmount: 0,
            discountAmount: 0,
            finalAmount: 0,
            paymentMethod: 'Protocol',
            paymentStatus: 'completed',
            locationId: createLocation,
            sessionDate: createDate,
            createdByAdminId: actor.id,
            createdByAdminName: actor.name,
            createdByRole: actor.role,
            isProtocol: true,
            protocolStatus: role === 'owner' ? 'approved' : 'pending_approval',
            protocolReason: protocolReason.trim(),
          })
          // Protocol bookings are created with paymentStatus='completed', so
          // write vendor-ledger credits for any event-package items. Owner-
          // approved protocols go straight to confirmed; pending-approval ones
          // are still treated as paid (at ₹0) for ledger purposes — the ledger
          // entry amounts are zero because unitPrice is zero, so the call is
          // a no-op in that case.
          try {
            const { onBookingPaidById } = await import('../../../../lib/booking-vendor-payout')
            await onBookingPaidById(result.id)
          } catch (err) {
            logger.error('bookings_module.protocol_vendor_payout_failed', err, {
              bookingId: result.id,
            })
          }
          setSuccess(
            role === 'owner'
              ? `Protocol booking ${result.id} created and auto-approved.`
              : `Protocol booking ${result.id} created — awaiting Owner approval.`,
          )
        } else {
          const isCouponMode = benefitMode === 'coupon' && couponApplication.couponsApplied > 0
          const orderNumber = await asquareBookingsApi.createPendingBooking({
            userId: `offline_${phone}`,
            clientRequestId,
            locationId: createLocation,
            items,
            totalAmount,
            discountAmount,
            finalAmount,
            paymentMethod: 'link',
            mobile: phone,
            name,
            email: customerEmail.trim() || 'offline@pipeline.local',
            scheduleDate: createDate,
            adminId: actor.id,
            adminName: actor.name,
            adminRole: actor.role,
            couponCode: isCouponMode
              ? buildMemberCouponSentinel(couponApplication.couponsApplied)
              : undefined,
            couponAmount: isCouponMode ? couponApplication.couponDiscount : undefined,
          })

          const linkResult = await asquareBookingsApi.sendPaymentLink(
            orderNumber,
            undefined,
            INTERAKT_PAYMENT_REQUEST_HEADER_IMAGE_URL,
          )
          if (!linkResult.success) {
            setError(
              `Booking ${orderNumber} created, but link failed: ${linkResult.message || 'Unknown error'}`,
            )
          } else {
            setSuccess(`Booking ${orderNumber} created and payment link triggered.`)
            const firstActivity = selectedActivities[0]
            if (firstActivity && linkResult.link) {
              void asquareBookingsApi
                .triggerInteraktPaymentRequest({
                  orderNumber,
                  customerName: name,
                  activityName: firstActivity.bookingName ?? firstActivity.name,
                  bookingDate: fmtDateIST(new Date(createDate)),
                  locationName:
                    locations.find((l) => l.id === createLocation)?.name || createLocation,
                  paymentAmount: formatCurrency(finalAmount),
                  paymentLink: linkResult.link,
                })
                .catch((err) => {
                  logger.error('bookings_module.interakt_payment_request_failed', err)
                  setError(
                    `WhatsApp payment request failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                  )
                })
            }
          }
        }

        try {
          await pipelineCustomersApi.upsertCustomer({
            phone,
            name,
            email: customerEmail.trim() || undefined,
            source: 'booking',
            locationId: createLocation,
            createdBy: actor.id,
          })
        } catch {
          /* non-critical */
        }

        // Reset form
        setCustomerName('')
        setCustomerPhone('')
        setCustomerEmail('')
        setCustomerLookupMessage(null)
        setCustomerLookupSource(null)
        setCustomerNameEdited(false)
        setMemberInsight(null)
        setBenefitMode('discount')
        setSelectedActivityIds([])
        setActivityQty({})
        setSelectedComboIds([])
        setComboQty({})
        setSelectedEventPackageIds([])
        setEventPackageQty({})
        setDiscountPercent(0)
        setIsProtocol(false)
        setProtocolReason('')
        // Successful write — drop the idempotency token so the next booking
        // gets a fresh one.
        clientRequestIdRef.current = null
        onBookingCreated()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Failed to create booking.')
      } finally {
        // Release the synchronous re-entry guard. The token survives errors
        // so a retry hits the same server-side dedup check.
        inFlightSendRef.current = false
        setSendingLink(false)
      }
    },

    [
      canSendBookingLinks,
      customerName,
      customerPhone,
      customerEmail,
      selectedActivities,
      selectedCombos,
      selectedEventPackages,
      isProtocol,
      protocolReason,
      discountPercent,
      cartIsAllVendor,
      activeBranchKey,
      activityQty,
      comboQty,
      createDate,
      createLocation,
      actor,
      role,
      benefitMode,
      couponApplication,
      totalAmount,
      discountAmount,
      finalAmount,
      locations,
      onBookingCreated,
    ],
  )

  return {
    // Customer
    createLocation,
    setCreateLocation,
    createDate,
    setCreateDate,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    customerLookupLoading,
    customerLookupMessage,
    customerNameEdited,
    setCustomerNameEdited,
    customerLookupSource,
    memberInsight,
    memberLookupLoading,
    normalizedCustomerPhone,
    // Catalog
    activitiesLoading,
    activityCatalog,
    activitySearchTerm,
    setActivitySearchTerm,
    activityCategoryFilter,
    setActivityCategoryFilter,
    activityCategories,
    activeCatalogGameKey,
    setActiveCatalogGameKey,
    activeCatalogSubGameKey,
    setActiveCatalogSubGameKey,
    activeCatalogGroup,
    activeCatalogSubGame,
    visibleCatalogActivities,
    groupedCatalogActivities,
    filteredCombos,
    // Event packages
    eventCampaigns,
    selectedEventPackages,
    selectedEventPackageIds,
    eventPackageQty,
    addEventPackage,
    removeEventPackage,
    increaseEventPackageQty,
    decreaseEventPackageQty,
    eventPackagesSubtotal,
    packageDiscountByEvent,
    packageFlatDiscountTotal,
    packageBxgyDiscountTotal,
    // Cart
    selectedActivityIds,
    setSelectedActivityIds,
    activityQty,
    setActivityQty,
    selectedActivities,
    selectedCombos,
    selectedComboIds,
    comboQty,
    increaseActivityQty,
    decreaseActivityQty,
    removeActivity,
    addCombo,
    removeCombo,
    increaseComboQty,
    decreaseComboQty,
    // Pricing
    activeBranchKey,
    totalAmount,
    companyTotal,
    vendorTotal,
    discountPercent,
    setDiscountPercent,
    flatDiscount,
    couponDiscount,
    discountAmount,
    finalAmount,
    benefitMode,
    setBenefitMode,
    couponApplication,
    perLineCouponDiscount,
    projectedEarnedCoupons,
    couponModeAvailable,
    hasCompanyItems,
    hasVendorItems,
    cartIsAllVendor,
    // Protocol
    isProtocol,
    setIsProtocol,
    protocolReason,
    setProtocolReason,
    // Submit
    sendingLink,
    handleSendLink,
    canSendBookingLinks,
    error,
    setError,
    success,
    setSuccess,
  }
}

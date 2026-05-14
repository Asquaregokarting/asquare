import { useEffect, useMemo, useState } from 'react'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { FilterBar, FilterField } from '../../components/ui/FilterBar'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { asquareCouponsApi, AsquareCoupon, CouponGameAssociation } from '../../api/asquare-coupons'
import { billingApi } from '../../api/billing'
import { activitiesApi } from '../../api/activities'
import {
  acceptEventCoupon,
  listVendorEventNotifications,
  rejectEventCoupon,
  sendEventCouponNotifications,
} from '../../api/event-coupon-notifications'
import { ActivityLocationTreeRecord, EventCouponNotification } from '../../api/types'
import { useAuth } from '../../features/auth/auth-context'
import { getLocationDisplayName, getAllLocations } from '../../../lib/locations'
import { fmtDateTimeFullIST, fmtDateIST } from '../../../lib/date-format'
import { logger } from '../../../lib/logger'

export type CouponsView = 'list' | 'userCoupons' | 'gameCoupons'

const subnav = [
  { label: 'All Coupons', to: '/coupons/list' },
  { label: 'Game Coupons', to: '/coupons/game-coupons' },
  { label: 'User Coupons', to: '/coupons/user-coupons' },
]

const titleMap: Record<CouponsView, string> = {
  list: 'Coupons',
  gameCoupons: 'Game Coupons',
  userCoupons: 'User Coupons',
}

type CouponFormData = Omit<AsquareCoupon, 'id' | 'createdAt' | 'updatedAt' | 'usedCount'>

const emptyCouponForm: CouponFormData = {
  code: '',
  description: '',
  type: 'discount',
  category: 'individual',
  minAmount: 0,
  discount: 0,
  isPercentage: false,
  startDate: '',
  expiryDate: '',
  maxUsageCount: undefined,
  isActive: true,
  isNewUserOnly: false,
  isForHelicopterOnly: false,
  applyPerTicket: false,
  minTickets: 0,
  applicableGames: [],
  visibility: [],
}

interface UserCouponRow {
  id: string
  userId: string
  couponId: string
  couponCode: string
  assignedAt: { toDate: () => Date } | null
  [key: string]: unknown
}

const CouponsModule = ({ view = 'list' }: { view?: CouponsView }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // List view state
  const [coupons, setCoupons] = useState<AsquareCoupon[]>([])
  const [search, setSearch] = useState('')

  // Form drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<AsquareCoupon | null>(null)
  const [form, setForm] = useState<CouponFormData>(emptyCouponForm)
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<AsquareCoupon | null>(null)

  // Multi-select state
  const [selectedCouponIds, setSelectedCouponIds] = useState<Set<string>>(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  const toggleCouponSelection = (id: string) => {
    setSelectedCouponIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkActivate = async (activate: boolean) => {
    if (selectedCouponIds.size === 0) return
    setBulkActionLoading(true)
    setError(null)
    try {
      await Promise.all(
        Array.from(selectedCouponIds).map((id) =>
          asquareCouponsApi.updateCoupon(id, { isActive: activate }),
        ),
      )
      setSuccess(`${selectedCouponIds.size} coupon(s) ${activate ? 'activated' : 'deactivated'}.`)
      setSelectedCouponIds(new Set())
      const result = await asquareCouponsApi.listCoupons()
      setCoupons(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed.')
    } finally {
      setBulkActionLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedCouponIds.size === 0) return
    if (
      !window.confirm(`Delete ${selectedCouponIds.size} selected coupon(s)? This cannot be undone.`)
    )
      return
    setBulkActionLoading(true)
    setError(null)
    try {
      await Promise.all(
        Array.from(selectedCouponIds).map((id) => asquareCouponsApi.deleteCoupon(id)),
      )
      setSuccess(`${selectedCouponIds.size} coupon(s) deleted.`)
      setSelectedCouponIds(new Set())
      const result = await asquareCouponsApi.listCoupons()
      setCoupons(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed.')
    } finally {
      setBulkActionLoading(false)
    }
  }

  // Game coupons view state
  const { session } = useAuth()
  const [hierarchy, setHierarchy] = useState<ActivityLocationTreeRecord[]>([])
  const [selectedGames, setSelectedGames] = useState<CouponGameAssociation[]>([])
  const [gameSearch, setGameSearch] = useState('')
  const [gameLocationFilter, setGameLocationFilter] = useState('All')

  const isVendor = session?.user.role === 'ThirdParty'

  // Vendor coupon state (for ThirdParty users)
  const [vendorCoupons, setVendorCoupons] = useState<AsquareCoupon[]>([])
  const [vendorGames, setVendorGames] = useState<CouponGameAssociation[]>([])
  const [vendorCouponForm, setVendorCouponForm] = useState({
    code: '',
    mobile: '',
    discount: '',
    isPercentage: false,
  })
  const [vendorFormOpen, setVendorFormOpen] = useState(false)
  const [vendorSaving, setVendorSaving] = useState(false)
  const [vendorError, setVendorError] = useState<string | null>(null)
  const [eventNotifications, setEventNotifications] = useState<EventCouponNotification[]>([])
  const [respondingTo, setRespondingTo] = useState<string | null>(null)

  // Load vendor's own coupons + games when ThirdParty user views list
  useEffect(() => {
    if (!isVendor || view !== 'list' || !session) return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const [allCoupons, hierarchyResult, notifs] = await Promise.all([
          asquareCouponsApi.listCoupons(),
          activitiesApi.listHierarchy(session.token),
          listVendorEventNotifications(session.user.id),
        ])
        setVendorCoupons(allCoupons.filter((c) => c.createdByVendorId === session.user.id))
        setEventNotifications(notifs)
        const myGames: CouponGameAssociation[] = []
        for (const loc of hierarchyResult.locations) {
          for (const game of loc.games) {
            const meta = game.metadata as Record<string, unknown> | undefined
            const vid =
              (meta?.vendorId as string | undefined) || (meta?.vendorUserId as string | undefined)
            if (vid === session.user.id) {
              myGames.push({ locationId: loc.id, gameId: game.id, gameLabel: game.name })
              for (const sg of game.subGames) {
                myGames.push({
                  locationId: loc.id,
                  gameId: game.id,
                  gameLabel: game.name,
                  subGameId: sg.id,
                  subGameLabel: sg.name,
                })
              }
            }
          }
        }
        setVendorGames(myGames)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load coupons.')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [isVendor, view, session?.user.id, session?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateVendorCoupon = async () => {
    if (!session) return
    setVendorError(null)
    if (!vendorCouponForm.code.trim()) {
      setVendorError('Coupon code is required.')
      return
    }
    if (!/^[6-9]\d{9}$/.test(vendorCouponForm.mobile.replace(/\D/g, ''))) {
      setVendorError('Enter a valid 10-digit mobile number.')
      return
    }
    const discVal = Number(vendorCouponForm.discount)
    if (!discVal || discVal <= 0) {
      setVendorError('Discount must be greater than 0.')
      return
    }
    if (vendorCouponForm.isPercentage && discVal > 100) {
      setVendorError('Percentage cannot exceed 100.')
      return
    }
    if (vendorGames.length === 0) {
      setVendorError('No games found for your account.')
      return
    }

    setVendorSaving(true)
    try {
      const mobileDigits = vendorCouponForm.mobile.replace(/\D/g, '')
      const normalizedMobile =
        mobileDigits.length === 12 && mobileDigits.startsWith('91')
          ? mobileDigits.slice(2)
          : mobileDigits
      await asquareCouponsApi.createCoupon({
        code: vendorCouponForm.code.trim(),
        description: `Vendor coupon for mobile ${normalizedMobile}`,
        type: 'discount',
        category: 'individual',
        minAmount: 0,
        discount: discVal,
        isPercentage: vendorCouponForm.isPercentage,
        isActive: true,
        isNewUserOnly: false,
        isForHelicopterOnly: false,
        applyPerTicket: false,
        minTickets: 0,
        startDate: '',
        expiryDate: '',
        applicableGames: vendorGames,
        createdByVendorId: session.user.id,
        createdByVendorName: session.user.name,
        allowedMobile: normalizedMobile,
        visibility: ['billing'],
      })
      const all = await asquareCouponsApi.listCoupons()
      setVendorCoupons(all.filter((c) => c.createdByVendorId === session.user.id))
      setVendorCouponForm({ code: '', mobile: '', discount: '', isPercentage: false })
      setVendorFormOpen(false)
      setSuccess('Coupon created successfully.')
    } catch (err) {
      setVendorError(err instanceof Error ? err.message : 'Failed to create coupon.')
    } finally {
      setVendorSaving(false)
    }
  }

  const handleDeleteVendorCoupon = async (coupon: AsquareCoupon) => {
    if (!window.confirm(`Delete coupon "${coupon.code}"?`)) return
    try {
      await asquareCouponsApi.deleteCoupon(coupon.id)
      setVendorCoupons((prev) => prev.filter((c) => c.id !== coupon.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.')
    }
  }

  const handleAcceptEvent = async (notif: EventCouponNotification) => {
    setRespondingTo(notif.id)
    setError(null)
    try {
      await acceptEventCoupon(notif.id)
      setEventNotifications((prev) =>
        prev.map((n) =>
          n.id === notif.id
            ? { ...n, status: 'accepted', respondedAt: new Date().toISOString() }
            : n,
        ),
      )
      setSuccess(
        `Accepted event coupon "${notif.couponCode}". Your games are included in the discount.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept.')
    } finally {
      setRespondingTo(null)
    }
  }

  const handleRejectEvent = async (notif: EventCouponNotification) => {
    if (
      !window.confirm(
        `Reject event coupon "${notif.couponCode}"? Your games will be removed from this discount.`,
      )
    )
      return
    setRespondingTo(notif.id)
    setError(null)
    try {
      const vendorGames2 = notif.games.map((g) => ({
        gameId: g.gameId,
        locationId: g.locationId,
        subGameId: g.subGameId,
      }))
      await rejectEventCoupon(notif.id, notif.couponId, vendorGames2)
      setEventNotifications((prev) =>
        prev.map((n) =>
          n.id === notif.id
            ? { ...n, status: 'rejected', respondedAt: new Date().toISOString() }
            : n,
        ),
      )
      setSuccess(`Rejected event coupon "${notif.couponCode}". Your games have been excluded.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject.')
    } finally {
      setRespondingTo(null)
    }
  }

  // Coupon usage tracking
  const [usageCoupon, setUsageCoupon] = useState<AsquareCoupon | null>(null)
  const [usageData, setUsageData] = useState<
    Array<{
      customerName: string
      customerPhone: string
      amount: number
      discount: number
      date: string
      invoiceNumber: string
    }>
  >([])
  const [usageLoading, setUsageLoading] = useState(false)

  const viewCouponUsage = async (coupon: AsquareCoupon) => {
    setUsageCoupon(coupon)
    setUsageLoading(true)
    try {
      const token = session?.token ?? ''
      const { transactions } = await billingApi.listTransactions(token)
      const used = transactions
        .filter((txn) => txn.couponCode === coupon.code)
        .map((txn) => ({
          customerName: txn.customerName ?? '—',
          customerPhone: txn.customerPhone ?? '—',
          amount: txn.totalAmount,
          discount: txn.couponDiscount ?? txn.discount ?? 0,
          date: txn.transactionDate ? fmtDateIST(txn.transactionDate) : '—',
          invoiceNumber: txn.invoiceNumber,
        }))
      setUsageData(used)
    } catch {
      setUsageData([])
    } finally {
      setUsageLoading(false)
    }
  }

  // User coupons view state
  const [userCouponsEnabled, setUserCouponsEnabled] = useState(false)
  const [userCoupons, setUserCoupons] = useState<UserCouponRow[]>([])
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [deleteUserCouponTarget, setDeleteUserCouponTarget] = useState<UserCouponRow | null>(null)
  // User coupons filtering/sorting
  const [ucSearch, setUcSearch] = useState('')
  const [ucStatusFilter, setUcStatusFilter] = useState<'all' | 'active' | 'used'>('all')
  const [ucTypeFilter, setUcTypeFilter] = useState<string>('all')
  const [ucSourceFilter, setUcSourceFilter] = useState<string>('all')
  const [ucSortKey, setUcSortKey] = useState<string>('createdAt')
  const [ucSortDir, setUcSortDir] = useState<'asc' | 'desc'>('desc')

  // Fetch coupons + hierarchy for gameCoupons view
  useEffect(() => {
    if (view !== 'gameCoupons') return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const [couponResult, hierarchyResult] = await Promise.all([
          asquareCouponsApi.listCoupons(),
          session?.token
            ? activitiesApi.listHierarchy(session.token)
            : Promise.resolve({ locations: [] as ActivityLocationTreeRecord[] }),
        ])
        setCoupons(couponResult)
        setHierarchy(hierarchyResult.locations)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data.')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [view, session?.token])

  // Exclude vendor-created coupons from admin views — they are managed in ThirdParty dashboard
  const ownerCoupons = useMemo(() => coupons.filter((c) => !c.createdByVendorId), [coupons])

  // Game coupons filtered list (owner coupons only)
  const gameCoupons = useMemo(
    () => ownerCoupons.filter((c) => c.applicableGames.length > 0),
    [ownerCoupons],
  )

  const addGameToSelection = (assoc: CouponGameAssociation) => {
    setSelectedGames((prev) => {
      const exists = prev.some(
        (g) =>
          g.locationId === assoc.locationId &&
          g.gameId === assoc.gameId &&
          g.subGameId === assoc.subGameId,
      )
      if (exists) return prev
      return [...prev, assoc]
    })
  }

  const removeGameFromSelection = (idx: number) => {
    setSelectedGames((prev) => prev.filter((_, i) => i !== idx))
  }

  const selectAllGames = () => {
    const allGames: CouponGameAssociation[] = []
    const filtered =
      gameLocationFilter === 'All'
        ? hierarchy
        : hierarchy.filter((loc) => loc.id === gameLocationFilter)
    for (const loc of filtered) {
      for (const game of loc.games) {
        allGames.push({ locationId: loc.id, gameId: game.id, gameLabel: game.name })
        for (const sg of game.subGames) {
          allGames.push({
            locationId: loc.id,
            gameId: game.id,
            gameLabel: game.name,
            subGameId: sg.id,
            subGameLabel: sg.name,
          })
        }
      }
    }
    setSelectedGames((prev) => {
      const existing = new Set(prev.map((g) => `${g.locationId}:${g.gameId}:${g.subGameId ?? ''}`))
      const toAdd = allGames.filter(
        (g) => !existing.has(`${g.locationId}:${g.gameId}:${g.subGameId ?? ''}`),
      )
      return [...prev, ...toAdd]
    })
  }

  // Fetch coupons list
  useEffect(() => {
    if (view !== 'list') return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await asquareCouponsApi.listCoupons()
        setCoupons(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load coupons.')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [view])

  // Fetch user coupons
  useEffect(() => {
    if (view !== 'userCoupons') return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const [enabled, recent] = await Promise.all([
          asquareCouponsApi.getUserCouponsEnabled(),
          asquareCouponsApi.listRecentUserCoupons(),
        ])
        setUserCouponsEnabled(enabled)
        setUserCoupons(
          recent.map((doc) => ({
            id: doc.id,
            userId: doc.userId,
            couponId: doc.couponId,
            couponCode: doc.couponCode,
            assignedAt:
              doc.assignedAt &&
              typeof (doc.assignedAt as { toDate?: unknown }).toDate === 'function'
                ? (doc.assignedAt as { toDate: () => Date })
                : null,
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load user coupons.')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [view])

  const filteredCoupons = ownerCoupons.filter((coupon) => {
    if (!search) return true
    const term = search.toLowerCase()
    return (
      coupon.code.toLowerCase().includes(term) ||
      coupon.description.toLowerCase().includes(term) ||
      coupon.type.toLowerCase().includes(term)
    )
  })

  // Derive unique types and sources for filter dropdowns
  const ucTypes = useMemo(
    () => [
      ...new Set(userCoupons.map((c) => String((c as Record<string, unknown>).type ?? 'discount'))),
    ],
    [userCoupons],
  )
  const ucSources = useMemo(
    () => [
      ...new Set(
        userCoupons.map((c) => String((c as Record<string, unknown>).source ?? 'unknown')),
      ),
    ],
    [userCoupons],
  )

  // Filtered + sorted user coupons
  const filteredUserCoupons = useMemo(() => {
    let rows = [...userCoupons]

    // Search
    if (ucSearch) {
      const term = ucSearch.toLowerCase()
      rows = rows.filter((r) => {
        const d = r as Record<string, unknown>
        return (
          r.userId.toLowerCase().includes(term) ||
          r.couponCode.toLowerCase().includes(term) ||
          String(d.description ?? '')
            .toLowerCase()
            .includes(term)
        )
      })
    }

    // Status filter
    if (ucStatusFilter !== 'all') {
      const wantUsed = ucStatusFilter === 'used'
      rows = rows.filter((r) => (r as Record<string, unknown>).isUsed === wantUsed)
    }

    // Type filter
    if (ucTypeFilter !== 'all') {
      rows = rows.filter(
        (r) => String((r as Record<string, unknown>).type ?? 'discount') === ucTypeFilter,
      )
    }

    // Source filter
    if (ucSourceFilter !== 'all') {
      rows = rows.filter(
        (r) => String((r as Record<string, unknown>).source ?? 'unknown') === ucSourceFilter,
      )
    }

    // Sort
    rows.sort((a, b) => {
      const da = a as Record<string, unknown>
      const db = b as Record<string, unknown>
      let cmp = 0
      switch (ucSortKey) {
        case 'couponCode':
          cmp = a.couponCode.localeCompare(b.couponCode)
          break
        case 'userId':
          cmp = a.userId.localeCompare(b.userId)
          break
        case 'discount':
          cmp = Number(da.discount ?? 0) - Number(db.discount ?? 0)
          break
        case 'type':
          cmp = String(da.type ?? '').localeCompare(String(db.type ?? ''))
          break
        case 'source':
          cmp = String(da.source ?? '').localeCompare(String(db.source ?? ''))
          break
        case 'isUsed':
          cmp = (da.isUsed ? 1 : 0) - (db.isUsed ? 1 : 0)
          break
        case 'createdAt':
        default: {
          const ta = a.assignedAt ? a.assignedAt.toDate().getTime() : 0
          const tb = b.assignedAt ? b.assignedAt.toDate().getTime() : 0
          cmp = ta - tb
          break
        }
      }
      return ucSortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [userCoupons, ucSearch, ucStatusFilter, ucTypeFilter, ucSourceFilter, ucSortKey, ucSortDir])

  // Stats
  const ucStats = useMemo(() => {
    const total = userCoupons.length
    const active = userCoupons.filter((r) => !(r as Record<string, unknown>).isUsed).length
    const used = total - active
    const totalValue = userCoupons.reduce(
      (sum, r) => sum + Number((r as Record<string, unknown>).discount ?? 0),
      0,
    )
    return { total, active, used, totalValue }
  }, [userCoupons])

  const toggleUcSort = (key: string) => {
    if (ucSortKey === key) {
      setUcSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setUcSortKey(key)
      setUcSortDir('asc')
    }
  }

  const ucSortIndicator = (key: string) =>
    ucSortKey === key ? (ucSortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const openCreateDrawer = (withGames = false) => {
    setEditingCoupon(null)
    setForm({ ...emptyCouponForm, ...(withGames ? {} : { applicableGames: [] }) })
    setSelectedGames([])
    setGameLocationFilter('All')
    setGameSearch('')
    setDrawerOpen(true)
  }

  const openEditDrawer = (coupon: AsquareCoupon) => {
    setEditingCoupon(coupon)
    setForm({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      category: coupon.category,
      minAmount: coupon.minAmount,
      discount: coupon.discount,
      isPercentage: coupon.isPercentage,
      startDate: coupon.startDate,
      expiryDate: coupon.expiryDate,
      maxUsageCount: coupon.maxUsageCount,
      isActive: coupon.isActive,
      isNewUserOnly: coupon.isNewUserOnly,
      isForHelicopterOnly: coupon.isForHelicopterOnly,
      applyPerTicket: coupon.applyPerTicket,
      minTickets: coupon.minTickets,
      applicableGames: coupon.applicableGames,
      visibility: coupon.visibility,
    })
    setSelectedGames(coupon.applicableGames)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    if (form.visibility.length === 0) {
      setError('Select at least one visibility option (Customer App or Billing).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saveData = { ...form, applicableGames: selectedGames }
      let newCouponId: string | undefined
      if (editingCoupon) {
        await asquareCouponsApi.updateCoupon(editingCoupon.id, saveData)
        newCouponId = editingCoupon.id
      } else {
        newCouponId = await asquareCouponsApi.createCoupon(saveData)
      }

      // For event coupons: send notifications to affected vendors
      if (
        saveData.category === 'event' &&
        newCouponId &&
        selectedGames.length > 0 &&
        !editingCoupon
      ) {
        try {
          // Group selected games by vendorId using the hierarchy metadata
          const vendorGameMap = new Map<
            string,
            { vendorName: string; games: CouponGameAssociation[] }
          >()
          for (const loc of hierarchy) {
            for (const game of loc.games) {
              const meta = game.metadata as Record<string, unknown> | undefined
              const vendorId =
                (meta?.vendorId as string | undefined) || (meta?.vendorUserId as string | undefined)
              const vendorName = meta?.vendorName as string | undefined
              if (!vendorId) continue
              // Check if any selectedGames reference this game
              const matchingGames = selectedGames.filter(
                (sg) => sg.gameId === game.id && sg.locationId === loc.id,
              )
              if (matchingGames.length === 0) continue
              const existing = vendorGameMap.get(vendorId) ?? {
                vendorName: vendorName ?? vendorId,
                games: [],
              }
              existing.games.push(...matchingGames)
              vendorGameMap.set(vendorId, existing)
            }
          }

          if (vendorGameMap.size > 0) {
            const discountLabel = saveData.isPercentage
              ? `${saveData.discount}%`
              : `INR ${saveData.discount}`
            const sent = await sendEventCouponNotifications(
              newCouponId,
              saveData.code.toUpperCase(),
              saveData.description,
              discountLabel,
              selectedGames,
              vendorGameMap,
            )
            if (sent > 0) {
              setError(null)
              // Show success inline (will be cleared by drawer close)
            }
          }
        } catch {
          // Non-critical: coupon was created, notifications failed
          logger.warn('coupons_module.vendor_notifications_failed')
        }
      }

      setDrawerOpen(false)
      setEditingCoupon(null)
      setSelectedGames([])
      // Refresh list
      const result = await asquareCouponsApi.listCoupons()
      setCoupons(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save coupon.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setError(null)
    try {
      await asquareCouponsApi.deleteCoupon(deleteTarget.id)
      setDeleteTarget(null)
      const result = await asquareCouponsApi.listCoupons()
      setCoupons(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete coupon.')
    }
  }

  const handleToggleUserCoupons = async () => {
    setTogglingEnabled(true)
    setError(null)
    try {
      const next = !userCouponsEnabled
      await asquareCouponsApi.setUserCouponsEnabled(next)
      setUserCouponsEnabled(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle user coupons.')
    } finally {
      setTogglingEnabled(false)
    }
  }

  const handleDeleteUserCoupon = async () => {
    if (!deleteUserCouponTarget) return
    setError(null)
    try {
      await asquareCouponsApi.deleteUserCoupon(
        deleteUserCouponTarget.userId,
        deleteUserCouponTarget.id,
      )
      setDeleteUserCouponTarget(null)
      const recent = await asquareCouponsApi.listRecentUserCoupons()
      setUserCoupons(
        recent.map((doc) => ({
          id: doc.id,
          userId: doc.userId,
          couponId: doc.couponId,
          couponCode: doc.couponCode,
          assignedAt:
            doc.assignedAt && typeof (doc.assignedAt as { toDate?: unknown }).toDate === 'function'
              ? (doc.assignedAt as { toDate: () => Date })
              : null,
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user coupon.')
    }
  }

  const vendorSubnav = [{ label: 'My Coupons', to: '/coupons/list' }]

  return (
    <ModulePageLayout
      moduleTab="Coupons"
      title={isVendor ? 'My Coupons' : titleMap[view]}
      subtitle={
        isVendor
          ? 'Create and manage coupons for your games.'
          : 'Manage discount coupons and user coupon assignments.'
      }
      breadcrumbs={['Pipeline', 'Coupons', isVendor ? 'My Coupons' : titleMap[view]]}
      subnav={isVendor ? vendorSubnav : subnav}
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

      {/* ── VENDOR VIEW (ThirdParty) ── */}
      {isVendor && view === 'list' ? (
        <>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted">
              {vendorCoupons.length} coupon{vendorCoupons.length !== 1 ? 's' : ''} ·{' '}
              {vendorGames.length} game{vendorGames.length !== 1 ? 's' : ''} linked
            </span>
            <button
              type="button"
              onClick={() => {
                setVendorFormOpen(true)
                setVendorError(null)
              }}
              className="ui-btn ui-btn-info min-h-10"
            >
              Create Coupon
            </button>
          </div>

          {/* Create Vendor Coupon Form */}
          {vendorFormOpen && (
            <div className="mb-4 rounded-xl border border-accent/20 bg-surface p-4 space-y-3">
              <h4 className="text-sm font-semibold text-text">New Coupon</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Coupon Code
                  </label>
                  <input
                    type="text"
                    className="ui-field min-h-10"
                    value={vendorCouponForm.code}
                    onChange={(e) =>
                      setVendorCouponForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. VENDOR50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Customer Mobile Number
                  </label>
                  <input
                    type="tel"
                    className="ui-field min-h-10"
                    value={vendorCouponForm.mobile}
                    onChange={(e) => setVendorCouponForm((p) => ({ ...p, mobile: e.target.value }))}
                    placeholder="10-digit mobile"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Discount Value
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="ui-field min-h-10"
                    value={vendorCouponForm.discount}
                    onChange={(e) =>
                      setVendorCouponForm((p) => ({ ...p, discount: e.target.value }))
                    }
                    placeholder={vendorCouponForm.isPercentage ? 'e.g. 20' : 'e.g. 500'}
                  />
                </div>
                <div className="flex items-end gap-4 pb-2">
                  <label className="flex items-center gap-1.5 text-sm text-text">
                    <input
                      type="radio"
                      name="vDiscType"
                      checked={!vendorCouponForm.isPercentage}
                      onChange={() => setVendorCouponForm((p) => ({ ...p, isPercentage: false }))}
                    />
                    Flat (INR)
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-text">
                    <input
                      type="radio"
                      name="vDiscType"
                      checked={vendorCouponForm.isPercentage}
                      onChange={() => setVendorCouponForm((p) => ({ ...p, isPercentage: true }))}
                    />
                    Percentage (%)
                  </label>
                </div>
              </div>
              <p className="text-[10px] text-muted">
                Coupon applies only to your {vendorGames.length} game
                {vendorGames.length !== 1 ? 's' : ''} and is valid only when the billing mobile
                number matches the number entered above.
              </p>
              {vendorError && <p className="text-xs text-critical">{vendorError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={vendorSaving}
                  onClick={() => void handleCreateVendorCoupon()}
                  className="ui-btn ui-btn-info"
                >
                  {vendorSaving ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setVendorFormOpen(false)}
                  className="ui-btn ui-btn-neutral"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Event Coupon Invitations */}
          {eventNotifications.filter((n) => n.status !== 'rejected').length > 0 && (
            <div className="mb-4 space-y-2">
              <h4 className="text-sm font-semibold text-text">Event Coupon Invitations</h4>
              {eventNotifications
                .filter((n) => n.status !== 'rejected')
                .map((notif) => (
                  <div
                    key={notif.id}
                    className={`rounded-xl border p-3 ${
                      notif.status === 'pending'
                        ? 'border-warning/30 bg-warning/5'
                        : notif.status === 'accepted'
                          ? 'border-success/30 bg-success/5'
                          : 'border-critical/30 bg-critical/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-text">{notif.couponCode}</span>
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                            {notif.discountLabel} OFF
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              notif.status === 'pending'
                                ? 'bg-warning/15 text-warning'
                                : notif.status === 'accepted'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-critical/15 text-critical'
                            }`}
                          >
                            {notif.status === 'pending'
                              ? 'PENDING'
                              : notif.status === 'accepted'
                                ? 'ACCEPTED'
                                : 'REJECTED'}
                          </span>
                        </div>
                        {notif.couponDescription && (
                          <p className="mt-0.5 text-xs text-muted">{notif.couponDescription}</p>
                        )}
                        <p className="mt-1 text-xs text-muted">
                          Your games:{' '}
                          {notif.games
                            .map(
                              (g) => g.gameLabel + (g.subGameLabel ? ` > ${g.subGameLabel}` : ''),
                            )
                            .join(', ')}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted">
                          {fmtDateIST(notif.createdAt)}
                          {notif.respondedAt
                            ? ` · Responded: ${fmtDateIST(notif.respondedAt)}`
                            : ''}
                        </p>
                      </div>
                      {notif.status === 'pending' && (
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            disabled={respondingTo === notif.id}
                            onClick={() => void handleAcceptEvent(notif)}
                            className="ui-btn min-h-8 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1 text-xs font-bold text-success disabled:opacity-50"
                          >
                            {respondingTo === notif.id ? '...' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            disabled={respondingTo === notif.id}
                            onClick={() => void handleRejectEvent(notif)}
                            className="ui-btn min-h-8 rounded-lg border border-critical/40 bg-critical/10 px-2.5 py-1 text-xs font-bold text-critical disabled:opacity-50"
                          >
                            {respondingTo === notif.id ? '...' : 'Reject'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Vendor Coupons Table */}
          <h4 className="text-sm font-semibold text-text mb-2">My Coupons</h4>
          <DataTable
            columns={[
              {
                key: 'code',
                header: 'Code',
                render: (row) => <span className="font-semibold">{row.code}</span>,
              },
              {
                key: 'discount',
                header: 'Discount',
                render: (row) => (row.isPercentage ? `${row.discount}%` : `INR ${row.discount}`),
              },
              { key: 'mobile', header: 'Mobile', render: (row) => row.allowedMobile ?? '—' },
              {
                key: 'games',
                header: 'Games',
                render: (row) => (
                  <span className="text-xs text-muted">
                    {row.applicableGames.length} game{row.applicableGames.length !== 1 ? 's' : ''}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusBadge tone={row.isActive ? 'success' : 'muted'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                ),
              },
              { key: 'used', header: 'Used', render: (row) => String(row.usedCount) },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDeleteVendorCoupon(row)
                    }}
                    className="ui-btn ui-btn-danger min-h-8 px-2.5 py-1 text-xs"
                  >
                    Delete
                  </button>
                ),
              },
            ]}
            rows={vendorCoupons}
            rowKey={(row) => row.id}
            emptyMessage={
              loading
                ? 'Loading...'
                : 'No coupons yet. Create one to offer discounts on your games.'
            }
          />
        </>
      ) : null}

      {/* ── OWNER/ADMIN VIEWS ── */}
      {!isVendor && view === 'list' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, description, type"
              />
            </FilterField>
            <div className="flex items-end gap-2">
              {selectedCouponIds.size > 0 && (
                <>
                  <span className="self-center text-xs font-semibold text-accent">
                    {selectedCouponIds.size} selected
                  </span>
                  <button
                    type="button"
                    disabled={bulkActionLoading}
                    onClick={() => void handleBulkActivate(true)}
                    className="ui-btn ui-btn-success min-h-10 text-xs"
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    disabled={bulkActionLoading}
                    onClick={() => void handleBulkActivate(false)}
                    className="ui-btn ui-btn-neutral min-h-10 text-xs"
                  >
                    Deactivate
                  </button>
                  <button
                    type="button"
                    disabled={bulkActionLoading}
                    onClick={() => void handleBulkDelete()}
                    className="ui-btn ui-btn-danger min-h-10 text-xs"
                  >
                    Delete
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => openCreateDrawer()}
                className="ui-btn ui-btn-info min-h-10"
              >
                Create Coupon
              </button>
            </div>
          </FilterBar>

          <DataTable
            columns={[
              {
                key: 'select',
                header: '',
                render: (row) => (
                  <input
                    type="checkbox"
                    checked={selectedCouponIds.has(row.id)}
                    onChange={() => toggleCouponSelection(row.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 cursor-pointer"
                  />
                ),
              },
              {
                key: 'code',
                header: 'Code',
                render: (row) => <span className="font-semibold">{row.code}</span>,
              },
              { key: 'type', header: 'Type', render: (row) => row.type },
              {
                key: 'discount',
                header: 'Discount',
                render: (row) => (row.isPercentage ? `${row.discount}%` : `INR ${row.discount}`),
              },
              { key: 'minAmount', header: 'Min Amount', render: (row) => `INR ${row.minAmount}` },
              { key: 'expiry', header: 'Expiry', render: (row) => row.expiryDate || '-' },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusBadge tone={row.isActive ? 'success' : 'muted'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                ),
              },
              { key: 'usedCount', header: 'Used Count', render: (row) => String(row.usedCount) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void viewCouponUsage(row)
                      }}
                      className="ui-btn ui-btn-info min-h-8 px-2.5 py-1 text-xs"
                    >
                      Usage
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditDrawer(row)
                      }}
                      className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(row)
                      }}
                      className="ui-btn ui-btn-danger min-h-8 px-2.5 py-1 text-xs"
                    >
                      Delete
                    </button>
                  </>
                ),
              },
            ]}
            rows={filteredCoupons}
            rowKey={(row) => row.id}
            emptyMessage={loading ? 'Loading coupons...' : 'No coupons found.'}
          />

          {drawerOpen && (
            <div
              className="fixed inset-0 z-40 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setDrawerOpen(false)
                  setEditingCoupon(null)
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-xl border border-border/70 bg-panel shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
                  <h3 className="font-display text-xl tracking-tight text-text">
                    {editingCoupon ? 'Edit Coupon' : 'Create Coupon'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false)
                      setEditingCoupon(null)
                    }}
                    className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                  >
                    Close
                  </button>
                </div>
                <form
                  className="flex-1 overflow-y-auto p-6 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSave()
                  }}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Code</span>
                      <input
                        className="ui-field min-h-10"
                        value={form.code}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                        placeholder="e.g. SUMMER20"
                        required
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Description</span>
                      <input
                        className="ui-field min-h-10"
                        value={form.description}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Coupon description"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Type</span>
                      <select
                        className="ui-field min-h-10"
                        value={form.type}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            type: e.target.value as AsquareCoupon['type'],
                          }))
                        }
                      >
                        <option value="discount">Discount</option>
                        <option value="addon">Addon</option>
                        <option value="session">Session</option>
                        <option value="cashback">Cashback</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Min Amount</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.minAmount}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, minAmount: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Discount</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.discount}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, discount: Number(e.target.value) }))
                        }
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Expiry Date</span>
                      <input
                        className="ui-field min-h-10"
                        type="date"
                        value={form.expiryDate}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, expiryDate: e.target.value }))
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Min Tickets</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.minTickets}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, minTickets: Number(e.target.value) }))
                        }
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isPercentage}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isPercentage: e.target.checked }))
                        }
                      />{' '}
                      Is Percentage
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isActive: e.target.checked }))
                        }
                      />{' '}
                      Active
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isNewUserOnly}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isNewUserOnly: e.target.checked }))
                        }
                      />{' '}
                      New User Only
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isForHelicopterOnly}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isForHelicopterOnly: e.target.checked }))
                        }
                      />{' '}
                      Helicopter Only
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.applyPerTicket}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, applyPerTicket: e.target.checked }))
                        }
                      />{' '}
                      Apply Per Ticket
                    </label>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      Coupon Visibility <span className="text-red-500">*</span>
                    </p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <label className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={form.visibility.includes('customerApp')}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              visibility: e.target.checked
                                ? [...prev.visibility, 'customerApp']
                                : prev.visibility.filter((v) => v !== 'customerApp'),
                            }))
                          }
                        />
                        Customer App{' '}
                        <span className="text-xs text-muted">— discoverable by customers</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          checked={form.visibility.includes('billing')}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              visibility: e.target.checked
                                ? [...prev.visibility, 'billing']
                                : prev.visibility.filter((v) => v !== 'billing'),
                            }))
                          }
                        />
                        Billing{' '}
                        <span className="text-xs text-muted">— usable at POS / in-store</span>
                      </label>
                    </div>
                    {form.visibility.length === 0 && (
                      <p className="text-xs text-red-500">Select at least one visibility option.</p>
                    )}
                  </div>
                </form>
                <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false)
                      setEditingCoupon(null)
                    }}
                    className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave()}
                    className="ui-btn ui-btn-success min-h-10 px-4 text-sm"
                  >
                    {saving ? 'Saving...' : editingCoupon ? 'Save Changes' : 'Create Coupon'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Coupon Usage Dialog */}
          {usageCoupon && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget) setUsageCoupon(null)
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border/70 bg-panel shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Coupon Usage
                    </p>
                    <h3 className="mt-0.5 font-display text-lg text-text">
                      {usageCoupon.code}{' '}
                      <span className="text-sm font-normal text-muted">
                        —{' '}
                        {usageCoupon.isPercentage
                          ? `${usageCoupon.discount}%`
                          : `INR ${usageCoupon.discount}`}{' '}
                        off
                      </span>
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUsageCoupon(null)}
                    className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                  >
                    Close
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {usageLoading ? (
                    <p className="text-sm text-muted text-center py-6">Loading usage data...</p>
                  ) : usageData.length === 0 ? (
                    <p className="text-sm text-muted text-center py-6">
                      No one has used this coupon yet.
                    </p>
                  ) : (
                    <>
                      <p className="mb-3 text-xs text-muted">
                        {usageData.length} transaction{usageData.length !== 1 ? 's' : ''} used this
                        coupon
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                              <th className="px-3 py-2">Customer</th>
                              <th className="px-3 py-2">Phone</th>
                              <th className="px-3 py-2">Invoice</th>
                              <th className="px-3 py-2">Date</th>
                              <th className="px-3 py-2 text-right">Discount</th>
                              <th className="px-3 py-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {usageData.map((row, i) => (
                              <tr key={i} className="border-b border-border/40">
                                <td className="px-3 py-2 font-medium text-text">
                                  {row.customerName}
                                </td>
                                <td className="px-3 py-2 text-muted">{row.customerPhone}</td>
                                <td className="px-3 py-2 font-mono text-xs text-muted">
                                  {row.invoiceNumber}
                                </td>
                                <td className="px-3 py-2 text-muted">{row.date}</td>
                                <td className="px-3 py-2 text-right text-success font-semibold">
                                  -INR {Math.round(row.discount).toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-text">
                                  INR {Math.round(row.amount).toLocaleString('en-IN')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <ConfirmDialog
            open={deleteTarget !== null}
            title="Delete Coupon"
            description={
              <>
                Are you sure you want to delete coupon <strong>{deleteTarget?.code}</strong>? This
                action cannot be undone.
              </>
            }
            confirmLabel="Delete"
            onConfirm={() => void handleDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        </>
      ) : null}

      {view === 'gameCoupons' ? (
        <>
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, description"
              />
            </FilterField>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => openCreateDrawer(true)}
                className="ui-btn ui-btn-info min-h-10"
              >
                Create Game Coupon
              </button>
            </div>
          </FilterBar>

          <DataTable
            columns={[
              {
                key: 'code',
                header: 'Code',
                render: (row) => <span className="font-semibold">{row.code}</span>,
              },
              {
                key: 'category',
                header: 'Category',
                render: (row) => (
                  <StatusBadge tone={row.category === 'event' ? 'info' : 'muted'}>
                    {row.category === 'event' ? 'Event' : 'Individual'}
                  </StatusBadge>
                ),
              },
              {
                key: 'discount',
                header: 'Discount',
                render: (row) => (row.isPercentage ? `${row.discount}%` : `INR ${row.discount}`),
              },
              {
                key: 'games',
                header: 'Applicable Games',
                render: (row) => (
                  <span
                    className="text-xs text-muted"
                    title={row.applicableGames
                      .map((g) => `${g.gameLabel}${g.subGameLabel ? ` > ${g.subGameLabel}` : ''}`)
                      .join(', ')}
                  >
                    {row.applicableGames.length} game{row.applicableGames.length !== 1 ? 's' : ''}
                  </span>
                ),
              },
              {
                key: 'validity',
                header: 'Validity',
                render: (row) => {
                  const parts: string[] = []
                  if (row.startDate) parts.push(`From: ${row.startDate}`)
                  if (row.expiryDate) parts.push(`To: ${row.expiryDate}`)
                  return parts.length > 0 ? (
                    <span className="text-xs">{parts.join(' | ')}</span>
                  ) : (
                    '-'
                  )
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusBadge tone={row.isActive ? 'success' : 'muted'}>
                    {row.isActive ? 'Active' : 'Inactive'}
                  </StatusBadge>
                ),
              },
              { key: 'usedCount', header: 'Used', render: (row) => String(row.usedCount) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditDrawer(row)
                      }}
                      className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(row)
                      }}
                      className="ui-btn ui-btn-danger min-h-8 px-2.5 py-1 text-xs"
                    >
                      Delete
                    </button>
                  </>
                ),
              },
            ]}
            rows={gameCoupons.filter((c) => {
              if (!search) return true
              const term = search.toLowerCase()
              return (
                c.code.toLowerCase().includes(term) || c.description.toLowerCase().includes(term)
              )
            })}
            rowKey={(row) => row.id}
            emptyMessage={
              loading
                ? 'Loading game coupons...'
                : 'No game coupons found. Create one to link coupons to specific games.'
            }
          />

          {/* Game coupon create/edit modal */}
          {drawerOpen && (
            <div
              className="fixed inset-0 z-40 grid place-items-center bg-base/70 p-4 backdrop-blur-sm"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setDrawerOpen(false)
                  setEditingCoupon(null)
                  setSelectedGames([])
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-xl border border-border/70 bg-panel shadow-2xl"
              >
                <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
                  <h3 className="font-display text-xl tracking-tight text-text">
                    {editingCoupon ? 'Edit Game Coupon' : 'Create Game Coupon'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false)
                      setEditingCoupon(null)
                      setSelectedGames([])
                    }}
                    className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                  >
                    Close
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Code</span>
                      <input
                        className="ui-field min-h-10"
                        value={form.code}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                        placeholder="e.g. RACE50"
                        required
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Description</span>
                      <input
                        className="ui-field min-h-10"
                        value={form.description}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, description: e.target.value }))
                        }
                        placeholder="Coupon description"
                      />
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    <span>Category</span>
                    <div className="flex gap-3 text-sm text-text">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="category"
                          value="individual"
                          checked={form.category === 'individual'}
                          onChange={() => setForm((prev) => ({ ...prev, category: 'individual' }))}
                        />{' '}
                        Individual
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="category"
                          value="event"
                          checked={form.category === 'event'}
                          onChange={() => setForm((prev) => ({ ...prev, category: 'event' }))}
                        />{' '}
                        Event
                      </label>
                    </div>
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Discount</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.discount}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, discount: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Min Amount</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.minAmount}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, minAmount: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Max Usage</span>
                      <input
                        className="ui-field min-h-10"
                        type="number"
                        min={0}
                        value={form.maxUsageCount ?? ''}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            maxUsageCount: e.target.value ? Number(e.target.value) : undefined,
                          }))
                        }
                        placeholder="Unlimited"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Start Date</span>
                      <input
                        className="ui-field min-h-10"
                        type="date"
                        value={form.startDate}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, startDate: e.target.value }))
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      <span>Expiry Date</span>
                      <input
                        className="ui-field min-h-10"
                        type="date"
                        value={form.expiryDate}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, expiryDate: e.target.value }))
                        }
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isPercentage}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isPercentage: e.target.checked }))
                        }
                      />{' '}
                      Percentage Discount
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, isActive: e.target.checked }))
                        }
                      />{' '}
                      Active
                    </label>
                  </div>

                  {/* ── Dual-Panel Game Selector ── */}
                  <div className="border-t border-border pt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                      Applicable Games
                    </p>
                    <div className="flex gap-3">
                      {/* Left Panel: Available Games */}
                      <div className="flex-1 rounded-lg border border-border bg-surface p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="text-xs font-semibold text-muted">Available Games</p>
                          <button
                            type="button"
                            onClick={selectAllGames}
                            className="text-[10px] font-semibold text-accent hover:underline"
                          >
                            Select All
                          </button>
                        </div>
                        <select
                          className="ui-field mb-2 h-7 w-full text-xs"
                          value={gameLocationFilter}
                          onChange={(e) => setGameLocationFilter(e.target.value)}
                        >
                          <option value="All">All Locations</option>
                          {getAllLocations().map((loc) => (
                            <option key={loc.branchId} value={loc.branchId}>
                              {loc.shortName}
                            </option>
                          ))}
                        </select>
                        <input
                          className="ui-field mb-2 h-7 w-full text-xs"
                          placeholder="Search games..."
                          value={gameSearch}
                          onChange={(e) => setGameSearch(e.target.value)}
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {hierarchy
                            .filter(
                              (loc) =>
                                gameLocationFilter === 'All' || loc.id === gameLocationFilter,
                            )
                            .map((loc) => {
                              const q = gameSearch.toLowerCase()
                              const filteredGames = loc.games.filter(
                                (g) =>
                                  !q ||
                                  g.name.toLowerCase().includes(q) ||
                                  g.subGames.some((sg) => sg.name.toLowerCase().includes(q)),
                              )
                              if (filteredGames.length === 0) return null
                              return (
                                <div key={loc.id}>
                                  <p className="text-[10px] font-bold uppercase text-accent">
                                    {getLocationDisplayName(loc.id) || loc.name}
                                  </p>
                                  {filteredGames.map((game) => (
                                    <div key={game.id} className="ml-2">
                                      <div className="flex items-center justify-between py-0.5">
                                        <span className="text-xs text-text">{game.name}</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            addGameToSelection({
                                              locationId: loc.id,
                                              gameId: game.id,
                                              gameLabel: game.name,
                                            })
                                          }
                                          className="text-[10px] font-semibold text-accent hover:underline"
                                        >
                                          Add &gt;
                                        </button>
                                      </div>
                                      {game.subGames.map((sg) => (
                                        <div
                                          key={sg.id}
                                          className="ml-3 flex items-center justify-between py-0.5"
                                        >
                                          <span className="text-xs text-muted">{sg.name}</span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              addGameToSelection({
                                                locationId: loc.id,
                                                gameId: game.id,
                                                gameLabel: game.name,
                                                subGameId: sg.id,
                                                subGameLabel: sg.name,
                                              })
                                            }
                                            className="text-[10px] font-semibold text-accent hover:underline"
                                          >
                                            Add &gt;
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              )
                            })}
                          {hierarchy.length === 0 && (
                            <p className="text-xs text-muted">Loading games...</p>
                          )}
                        </div>
                      </div>

                      {/* Right Panel: Selected Games */}
                      <div className="flex-1 rounded-lg border border-border bg-surface p-2">
                        <p className="mb-1.5 text-xs font-semibold text-muted">
                          Selected ({selectedGames.length})
                        </p>
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {selectedGames.length === 0 ? (
                            <p className="text-xs text-muted">
                              No games selected. Add games from the left panel.
                            </p>
                          ) : (
                            selectedGames.map((g, i) => (
                              <div
                                key={`${g.locationId}-${g.gameId}-${g.subGameId ?? ''}`}
                                className="flex items-center justify-between rounded bg-accent/5 px-2 py-1"
                              >
                                <span className="text-xs text-text">
                                  <span className="text-[10px] text-muted">
                                    {getLocationDisplayName(g.locationId) || g.locationId}
                                  </span>{' '}
                                  {g.gameLabel}
                                  {g.subGameLabel ? ` > ${g.subGameLabel}` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeGameFromSelection(i)}
                                  className="text-xs text-critical hover:underline"
                                >
                                  &lt; Remove
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false)
                      setEditingCoupon(null)
                      setSelectedGames([])
                    }}
                    className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saving || selectedGames.length === 0}
                    onClick={() => void handleSave()}
                    className="ui-btn ui-btn-success min-h-10 px-4 text-sm"
                  >
                    {saving ? 'Saving...' : editingCoupon ? 'Save Changes' : 'Create Coupon'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <ConfirmDialog
            open={deleteTarget !== null}
            title="Delete Game Coupon"
            description={
              <>
                Are you sure you want to delete coupon <strong>{deleteTarget?.code}</strong>? This
                action cannot be undone.
              </>
            }
            confirmLabel="Delete"
            onConfirm={() => void handleDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        </>
      ) : null}

      {view === 'userCoupons' ? (
        <>
          {/* Toggle + Stats */}
          <div className="ui-toolbar flex flex-wrap items-center gap-4 py-3.5">
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={userCouponsEnabled}
                disabled={togglingEnabled}
                onChange={() => void handleToggleUserCoupons()}
              />
              <span className="font-semibold">
                User Coupons {userCouponsEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
            {togglingEnabled && <span className="text-xs text-muted">Updating...</span>}
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="rounded-lg bg-surface px-2.5 py-1 text-muted">
                Total: <strong className="text-text">{ucStats.total}</strong>
              </span>
              <span className="rounded-lg bg-success/10 px-2.5 py-1 text-success">
                Active: <strong>{ucStats.active}</strong>
              </span>
              <span className="rounded-lg bg-red-500/10 px-2.5 py-1 text-red-400">
                Used: <strong>{ucStats.used}</strong>
              </span>
              <span className="rounded-lg bg-accent/10 px-2.5 py-1 text-accent">
                Value: <strong>₹{ucStats.totalValue.toLocaleString()}</strong>
              </span>
            </div>
          </div>

          {/* Search + Filters */}
          <FilterBar>
            <FilterField label="Search">
              <input
                className="ui-field min-h-10"
                value={ucSearch}
                onChange={(e) => setUcSearch(e.target.value)}
                placeholder="User ID, code, description"
              />
            </FilterField>
            <FilterField label="Status">
              <select
                className="ui-field min-h-10"
                value={ucStatusFilter}
                onChange={(e) => setUcStatusFilter(e.target.value as 'all' | 'active' | 'used')}
                title="Filter by status"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="used">Used</option>
              </select>
            </FilterField>
            <FilterField label="Type">
              <select
                className="ui-field min-h-10"
                value={ucTypeFilter}
                onChange={(e) => setUcTypeFilter(e.target.value)}
                title="Filter by type"
              >
                <option value="all">All</option>
                {ucTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Source">
              <select
                className="ui-field min-h-10"
                value={ucSourceFilter}
                onChange={(e) => setUcSourceFilter(e.target.value)}
                title="Filter by source"
              >
                <option value="all">All</option>
                {ucSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
            {(ucSearch ||
              ucStatusFilter !== 'all' ||
              ucTypeFilter !== 'all' ||
              ucSourceFilter !== 'all') && (
              <button
                type="button"
                className="ui-btn ui-btn-neutral min-h-10 text-xs self-end"
                onClick={() => {
                  setUcSearch('')
                  setUcStatusFilter('all')
                  setUcTypeFilter('all')
                  setUcSourceFilter('all')
                }}
              >
                Clear Filters
              </button>
            )}
          </FilterBar>

          {/* Results count */}
          {filteredUserCoupons.length !== userCoupons.length && (
            <p className="text-xs text-muted pb-2">
              Showing {filteredUserCoupons.length} of {userCoupons.length} coupons
            </p>
          )}

          {/* Sortable Table */}
          <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border/60 text-sm">
                <thead className="bg-surface/45">
                  <tr>
                    {[
                      { key: 'userId', label: 'User ID' },
                      { key: 'couponCode', label: 'Code' },
                      { key: 'discount', label: 'Discount' },
                      { key: 'type', label: 'Type' },
                      { key: 'source', label: 'Source' },
                      { key: 'isUsed', label: 'Status' },
                      { key: 'createdAt', label: 'Created' },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleUcSort(col.key)}
                        className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted text-left cursor-pointer select-none hover:text-text transition-colors"
                      >
                        {col.label}
                        {ucSortIndicator(col.key)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.09em] text-muted text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/55">
                  {filteredUserCoupons.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-muted" colSpan={8}>
                        {loading ? 'Loading user coupons...' : 'No user coupons found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredUserCoupons.map((row) => {
                      const d = row as Record<string, unknown>
                      return (
                        <tr
                          key={row.id}
                          className="align-middle transition-colors hover:bg-panel/50"
                        >
                          <td className="px-4 py-3 text-text text-xs">{row.userId}</td>
                          <td className="px-4 py-3 text-text font-mono font-semibold">
                            {row.couponCode}
                          </td>
                          <td className="px-4 py-3 text-text">
                            ₹{String(d.discount ?? d.value ?? '—')}
                          </td>
                          <td className="px-4 py-3 text-text capitalize">
                            {String(d.type ?? 'discount')}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {String(d.source ?? '—')}
                          </td>
                          <td className="px-4 py-3">
                            {d.isUsed ? (
                              <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-bold text-red-400">
                                Used
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-text text-xs">
                            {row.assignedAt ? fmtDateTimeFullIST(row.assignedAt) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteUserCouponTarget(row)
                              }}
                              className="ui-btn ui-btn-danger min-h-8 px-2.5 py-1 text-xs"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ConfirmDialog
            open={deleteUserCouponTarget !== null}
            title="Delete User Coupon"
            description={
              <>
                Are you sure you want to remove the coupon{' '}
                <strong>{deleteUserCouponTarget?.couponCode}</strong> assignment for user{' '}
                <strong>{deleteUserCouponTarget?.userId}</strong>?
              </>
            }
            confirmLabel="Delete"
            onConfirm={() => void handleDeleteUserCoupon()}
            onCancel={() => setDeleteUserCouponTarget(null)}
          />
        </>
      ) : null}
    </ModulePageLayout>
  )
}

export default CouponsModule

import { FormEvent, useEffect, useState } from 'react'
import { fmtDateIST } from '../../../lib/date-format'
import { Navigate } from 'react-router-dom'
import {
  ActivityLocationTreeRecord,
  EventCouponNotification,
  VendorRegistrationRecord,
} from '../../api/types'
import { vendorRegistrationApi } from '../../api/vendor-registration'
import { AsquareCoupon, asquareCouponsApi, CouponGameAssociation } from '../../api/asquare-coupons'
import { activitiesApi } from '../../api/activities'
import {
  acceptEventCoupon,
  listVendorEventNotifications,
  rejectEventCoupon,
} from '../../api/event-coupon-notifications'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { rolePathMap } from '../../features/dashboard/role-config'
import { getLocationShortName } from '../../../lib/locations'

const branchLabel = (id: string) => getLocationShortName(id) || '—'

const ThirdPartyDashboard = () => {
  const { session } = useAuth()
  const [loading, setLoading] = useState(true)
  const [_error, setError] = useState<string | null>(null)
  const [_success, setSuccess] = useState<string | null>(null)
  const [registrationRecord, setRegistrationRecord] = useState<VendorRegistrationRecord | null>(
    null,
  )
  const [eventNotifications, setEventNotifications] = useState<EventCouponNotification[]>([])
  const [respondingTo, setRespondingTo] = useState<string | null>(null)

  // Vendor coupon state
  const [vendorCoupons, setVendorCoupons] = useState<AsquareCoupon[]>([])
  const [vendorGames, setVendorGames] = useState<CouponGameAssociation[]>([])
  const [showCouponForm, setShowCouponForm] = useState(false)
  const [couponForm, setCouponForm] = useState({
    code: '',
    mobile: '',
    discount: '',
    isPercentage: false,
  })
  const [couponSaving, setCouponSaving] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || session.user.role !== 'ThirdParty') return

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      vendorRegistrationApi.getMine(session.token).catch(() => null),
      listVendorEventNotifications(session.user.id).catch(() => [] as EventCouponNotification[]),
      asquareCouponsApi.listCoupons().catch(() => [] as AsquareCoupon[]),
      activitiesApi
        .listHierarchy(session.token)
        .catch(() => ({ locations: [] as ActivityLocationTreeRecord[] })),
    ])
      .then(([reg, notifs, allCoupons, hierarchyResult]) => {
        if (cancelled) return
        setRegistrationRecord(reg)
        setEventNotifications(notifs)
        // Filter to only this vendor's coupons
        setVendorCoupons(allCoupons.filter((c) => c.createdByVendorId === session.user.id))
        // Extract this vendor's games from hierarchy
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
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [session])

  const handleAcceptEvent = async (notif: EventCouponNotification) => {
    if (!session) return
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
      setSuccess(`Accepted event coupon "${notif.couponCode}". Your games are included.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept.')
    } finally {
      setRespondingTo(null)
    }
  }

  const handleRejectEvent = async (notif: EventCouponNotification) => {
    if (!session) return
    if (
      !window.confirm(
        `Reject event coupon "${notif.couponCode}"? Your games will be removed from this discount.`,
      )
    )
      return
    setRespondingTo(notif.id)
    setError(null)
    try {
      const vendorGames = notif.games.map((g) => ({
        gameId: g.gameId,
        locationId: g.locationId,
        subGameId: g.subGameId,
      }))
      await rejectEventCoupon(notif.id, notif.couponId, vendorGames)
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

  const handleCreateVendorCoupon = async (e: FormEvent) => {
    e.preventDefault()
    setCouponError(null)
    if (!session) return
    if (!couponForm.code.trim()) {
      setCouponError('Coupon code is required.')
      return
    }
    if (!/^[6-9]\d{9}$/.test(couponForm.mobile.replace(/\D/g, ''))) {
      setCouponError('Enter a valid 10-digit mobile number.')
      return
    }
    const discountVal = Number(couponForm.discount)
    if (!discountVal || discountVal <= 0) {
      setCouponError('Discount must be greater than 0.')
      return
    }
    if (couponForm.isPercentage && discountVal > 100) {
      setCouponError('Percentage cannot exceed 100.')
      return
    }
    if (vendorGames.length === 0) {
      setCouponError('No games found for your vendor account.')
      return
    }

    setCouponSaving(true)
    try {
      const mobileDigits = couponForm.mobile.replace(/\D/g, '')
      const normalizedMobile =
        mobileDigits.length === 12 && mobileDigits.startsWith('91')
          ? mobileDigits.slice(2)
          : mobileDigits
      await asquareCouponsApi.createCoupon({
        code: couponForm.code.trim(),
        description: `Vendor coupon for mobile ${normalizedMobile}`,
        type: 'discount',
        category: 'individual',
        minAmount: 0,
        discount: discountVal,
        isPercentage: couponForm.isPercentage,
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
      // Refresh vendor coupons
      const all = await asquareCouponsApi.listCoupons()
      setVendorCoupons(all.filter((c) => c.createdByVendorId === session.user.id))
      setCouponForm({ code: '', mobile: '', discount: '', isPercentage: false })
      setShowCouponForm(false)
      setSuccess('Vendor coupon created successfully.')
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : 'Failed to create coupon.')
    } finally {
      setCouponSaving(false)
    }
  }

  const handleDeleteVendorCoupon = async (coupon: AsquareCoupon) => {
    if (!session) return
    if (!window.confirm(`Delete coupon "${coupon.code}"?`)) return
    try {
      await asquareCouponsApi.deleteCoupon(coupon.id)
      setVendorCoupons((prev) => prev.filter((c) => c.id !== coupon.id))
      setSuccess('Coupon deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete coupon.')
    }
  }

  if (!session) return <Navigate replace to="/login" />
  if (session.user.role !== 'ThirdParty')
    return <Navigate replace to={rolePathMap[session.user.role]} />

  if (!loading && registrationRecord) {
    return (
      <ModulePageLayout
        moduleTab="Dashboard"
        title="Partner Dashboard"
        subtitle="Welcome to A Square GoKarting partner operations."
        breadcrumbs={['Pipeline', 'Dashboard', 'Third Party']}
      >
        {/* Welcome Hero */}
        <section className="relative overflow-hidden rounded-3xl border border-info/20 bg-panel/70 p-6 shadow-panel backdrop-blur-xl lg:p-8">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-info/5 blur-3xl" />
          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-info">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
              </span>
              Partner Account Active
            </div>

            <h3 className="font-display text-4xl font-bold tracking-tight text-text lg:text-5xl">
              Welcome to A Square Entertainment
            </h3>
            <p className="mt-3 max-w-xl text-base text-muted">
              Your vendor account has been approved and activated. You now have access to your
              partner dashboard and operational visibility.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 max-w-lg">
              <div className="rounded-2xl border border-border/50 bg-surface/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Vendor Name
                </p>
                <p className="mt-1.5 text-xl font-bold text-text">
                  {registrationRecord.vendorName}
                </p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-surface/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Company Name
                </p>
                <p className="mt-1.5 text-xl font-bold text-text">
                  {registrationRecord.companyName}
                </p>
              </div>
            </div>

            <p className="mt-5 text-xs text-muted">
              Branch:{' '}
              <span className="font-semibold text-text">
                {branchLabel(registrationRecord.branchId)}
              </span>
              {registrationRecord.reviewedAt
                ? ` · Approved on ${fmtDateIST(registrationRecord.reviewedAt)}`
                : ''}
            </p>
          </div>
        </section>

        {/* Event Coupon Notifications */}
        {eventNotifications.filter((n) => n.status !== 'rejected').length > 0 && (
          <section className="space-y-3">
            <h4 className="font-display text-lg font-bold text-text">Event Coupon Invitations</h4>
            {eventNotifications
              .filter((n) => n.status !== 'rejected')
              .map((notif) => (
                <div
                  key={notif.id}
                  className={`rounded-2xl border p-4 ${
                    notif.status === 'pending'
                      ? 'border-warning/30 bg-warning/5'
                      : notif.status === 'accepted'
                        ? 'border-success/30 bg-success/5'
                        : 'border-critical/30 bg-critical/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
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
                        <p className="mt-1 text-xs text-muted">{notif.couponDescription}</p>
                      )}
                      <p className="mt-1.5 text-xs text-muted">
                        Your games:{' '}
                        {notif.games
                          .map((g) => g.gameLabel + (g.subGameLabel ? ` > ${g.subGameLabel}` : ''))
                          .join(', ')}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        Received: {fmtDateIST(notif.createdAt)}
                        {notif.respondedAt ? ` · Responded: ${fmtDateIST(notif.respondedAt)}` : ''}
                      </p>
                    </div>
                    {notif.status === 'pending' && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={respondingTo === notif.id}
                          onClick={() => void handleAcceptEvent(notif)}
                          className="rounded-xl border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-bold text-success transition hover:bg-success/20 disabled:opacity-50"
                        >
                          {respondingTo === notif.id ? '...' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          disabled={respondingTo === notif.id}
                          onClick={() => void handleRejectEvent(notif)}
                          className="rounded-xl border border-critical/40 bg-critical/10 px-3 py-1.5 text-xs font-bold text-critical transition hover:bg-critical/20 disabled:opacity-50"
                        >
                          {respondingTo === notif.id ? '...' : 'Reject'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </section>
        )}

        {/* Vendor Coupon Management */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-lg font-bold text-text">My Coupons</h4>
            <button
              type="button"
              onClick={() => {
                setShowCouponForm(true)
                setCouponError(null)
              }}
              className="rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-panel uppercase tracking-wider transition hover:shadow-md"
            >
              Create Coupon
            </button>
          </div>

          {/* Create Coupon Form */}
          {showCouponForm && (
            <div className="rounded-2xl border border-accent/20 bg-surface/60 p-4">
              <form className="space-y-3" onSubmit={handleCreateVendorCoupon}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Coupon Code
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-border/40 bg-surface px-3 py-2.5 text-sm text-text"
                      value={couponForm.code}
                      onChange={(e) =>
                        setCouponForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))
                      }
                      placeholder="e.g. VENDOR50"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Customer Mobile Number
                    </label>
                    <input
                      type="tel"
                      className="w-full rounded-xl border border-border/40 bg-surface px-3 py-2.5 text-sm text-text"
                      value={couponForm.mobile}
                      onChange={(e) => setCouponForm((p) => ({ ...p, mobile: e.target.value }))}
                      placeholder="10-digit mobile"
                      required
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
                      className="w-full rounded-xl border border-border/40 bg-surface px-3 py-2.5 text-sm text-text"
                      value={couponForm.discount}
                      onChange={(e) => setCouponForm((p) => ({ ...p, discount: e.target.value }))}
                      placeholder={couponForm.isPercentage ? 'e.g. 20' : 'e.g. 500'}
                      required
                    />
                  </div>
                  <div className="flex items-end gap-3 pb-1">
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="radio"
                        name="discType"
                        checked={!couponForm.isPercentage}
                        onChange={() => setCouponForm((p) => ({ ...p, isPercentage: false }))}
                      />
                      Flat (INR)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="radio"
                        name="discType"
                        checked={couponForm.isPercentage}
                        onChange={() => setCouponForm((p) => ({ ...p, isPercentage: true }))}
                      />
                      Percentage (%)
                    </label>
                  </div>
                </div>
                <p className="text-[10px] text-muted">
                  This coupon will apply to all your games ({vendorGames.length} game
                  {vendorGames.length !== 1 ? 's' : ''}) and is valid only for the mobile number
                  entered above.
                </p>
                {couponError && <p className="text-xs text-critical">{couponError}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={couponSaving}
                    className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-panel uppercase tracking-wider disabled:opacity-50"
                  >
                    {couponSaving ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCouponForm(false)}
                    className="rounded-xl border border-border/40 px-4 py-2 text-xs font-semibold text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Vendor Coupons List */}
          {vendorCoupons.length > 0 ? (
            <div className="space-y-2">
              {vendorCoupons.map((coupon) => (
                <div
                  key={coupon.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-surface/40 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-text">{coupon.code}</span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                        {coupon.isPercentage ? `${coupon.discount}%` : `INR ${coupon.discount}`} OFF
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${coupon.isActive ? 'bg-success/15 text-success' : 'bg-muted/15 text-muted'}`}
                      >
                        {coupon.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      Mobile: {coupon.allowedMobile ?? '—'} · Used: {coupon.usedCount} times
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteVendorCoupon(coupon)}
                    className="rounded-lg border border-critical/30 bg-critical/10 px-2.5 py-1 text-xs font-semibold text-critical transition hover:bg-critical/20"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : !showCouponForm ? (
            <p className="text-xs text-muted">
              No coupons created yet. Create a coupon to offer discounts on your games.
            </p>
          ) : null}
        </section>

        <div className="rounded-xl border border-border/40 bg-surface/40 px-4 py-3 text-xs text-muted">
          To view your complete vendor registration details including banking information, visit{' '}
          <span className="font-semibold text-text">Settings → Profile</span>.
        </div>
      </ModulePageLayout>
    )
  }

  return (
    <ModulePageLayout
      moduleTab="Dashboard"
      title="Partner Dashboard"
      subtitle="Welcome to A Square GoKarting partner operations."
      breadcrumbs={['Pipeline', 'Dashboard', 'Third Party']}
    >
      {loading ? (
        <p className="text-sm text-muted">Loading partner dashboard...</p>
      ) : (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
          <p className="text-sm text-warning">
            Your vendor registration is pending approval. Please contact an Owner or Admin for
            assistance.
          </p>
        </div>
      )}
    </ModulePageLayout>
  )
}

export default ThirdPartyDashboard

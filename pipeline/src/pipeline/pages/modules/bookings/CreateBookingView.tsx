import { useMemo } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { MetricStrip } from '../../../components/ui/MetricStrip'
import { useCreateBooking } from './useCreateBooking'
import { COUPON_FACE_VALUE } from './coupon-application'
import {
  ASQUARE_WEB_BASE_URL,
  formatCatalogMetric,
  formatCurrency,
  getCatalogPrice,
  normalizeRole,
  PROTOCOL_MAX_LAPS,
} from './bookings-utils'

const CreateBookingView = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const ADMIN_LOCATIONS = useMemo(
    () => enabledLocations.map((l) => ({ id: l.slug, name: l.displayName })),
    [enabledLocations],
  )
  const role = normalizeRole(session?.user.role)
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }

  const cb = useCreateBooking(actor, session, role, ADMIN_LOCATIONS, () => {})

  return (
    <div className="space-y-5">
      {cb.error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {cb.error}
        </p>
      )}
      {cb.success && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {cb.success}
        </p>
      )}

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold text-text">Create Booking Link</h3>
            <p className="mt-1 text-sm text-muted">
              Pull customer identity from the website API, then build a branch-aware activity cart
              from Firestore.
            </p>
          </div>
          <a
            href={ASQUARE_WEB_BASE_URL}
            target="_blank"
            rel="noreferrer"
            className="ui-btn ui-btn-neutral min-h-9 px-3 py-1.5 text-xs"
          >
            Open Asquare
          </a>
        </div>

        <form onSubmit={(e) => void cb.handleSendLink(e)} className="mt-5 space-y-5">
          {/* Customer fields */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <select
              value={cb.createLocation}
              onChange={(e) => cb.setCreateLocation(e.target.value)}
              className="ui-field min-h-11"
            >
              {ADMIN_LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={cb.createDate}
              onChange={(e) => cb.setCreateDate(e.target.value)}
              className="ui-field min-h-11"
            />
            <div className="lg:col-span-2">
              <input
                type="tel"
                value={cb.customerPhone}
                onChange={(e) => cb.setCustomerPhone(e.target.value)}
                placeholder="10-digit mobile"
                className="ui-field min-h-11 w-full"
              />
              <p
                className={`mt-1 text-xs ${cb.customerLookupSource === 'firestore' ? 'text-emerald-500' : cb.customerLookupSource === 'website' ? 'text-blue-400' : 'text-muted'}`}
              >
                {cb.customerLookupLoading
                  ? 'Looking up customer...'
                  : (cb.customerLookupMessage ??
                    'Customer name will auto-fill when a matching phone number is found.')}
              </p>
            </div>
            <input
              type="text"
              value={cb.customerName}
              onChange={(e) => {
                cb.setCustomerName(e.target.value)
                cb.setCustomerNameEdited(true)
              }}
              placeholder="Customer name"
              className="ui-field min-h-11"
            />
          </div>

          <input
            type="email"
            value={cb.customerEmail}
            onChange={(e) => cb.setCustomerEmail(e.target.value)}
            placeholder="Email (optional)"
            className="ui-field min-h-11 w-full"
          />

          {/* Member Insight Panel */}
          {cb.memberInsight ? (
            <div className="rounded-2xl border border-accent/30 bg-accent/5 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-accent">
                    Member Insight
                  </span>
                  {cb.memberInsight.membership && (
                    <span className="ui-pill border-info/40 bg-info/10 text-info px-2 py-0.5 text-[10px]">
                      {cb.memberInsight.membership}
                    </span>
                  )}
                  {cb.memberInsight.coupons150Available > 0 ? (
                    <span className="ui-pill border-success/40 bg-success/10 text-success px-2 py-0.5 text-[10px]">
                      {cb.memberInsight.coupons150Available} ₹150 coupon
                      {cb.memberInsight.coupons150Available === 1 ? '' : 's'} available
                    </span>
                  ) : (
                    <span className="ui-pill border-muted/40 bg-muted/15 text-muted px-2 py-0.5 text-[10px]">
                      No ₹150 coupons available
                    </span>
                  )}
                  {cb.memberInsight.totalVisits >= 10 && (
                    <span className="ui-pill border-warning/40 bg-warning/15 text-warning px-2 py-0.5 text-[10px]">
                      LOYAL · {cb.memberInsight.totalVisits}+ visits
                    </span>
                  )}
                </div>
                {cb.memberLookupLoading && (
                  <span className="text-[11px] text-muted">Refreshing…</span>
                )}
              </div>
              <div className="mt-3">
                <MetricStrip
                  items={[
                    {
                      id: 'coupons',
                      label: '₹150 Coupons',
                      value: String(cb.memberInsight.coupons150Available),
                    },
                    {
                      id: 'spend',
                      label: 'Total Spend',
                      value: formatCurrency(cb.memberInsight.totalBillAmount),
                    },
                    {
                      id: 'visits',
                      label: 'Total Visits',
                      value: String(cb.memberInsight.totalVisits),
                    },
                    {
                      id: 'redeemed',
                      label: 'Coupons Used',
                      value: String(cb.memberInsight.coupons150Redeemed),
                    },
                  ]}
                />
              </div>
            </div>
          ) : cb.memberLookupLoading && cb.normalizedCustomerPhone.length === 10 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-surface/60 px-4 py-3 text-xs text-muted">
              Checking member records…
            </div>
          ) : null}

          {/* Two-column: Catalog + Cart */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr,0.95fr]">
            {/* Activity Catalog */}
            <div className="rounded-2xl border border-border bg-panel/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Activity Catalog
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    Showing {ADMIN_LOCATIONS.find((l) => l.id === cb.createLocation)?.name} pricing
                    for {cb.createDate}.
                  </p>
                </div>
                <div className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  Branch {cb.activeBranchKey}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1.5fr,1fr]">
                <input
                  type="text"
                  value={cb.activitySearchTerm}
                  onChange={(e) => cb.setActivitySearchTerm(e.target.value)}
                  placeholder="Search activities & combos"
                  className="ui-field min-h-12 flex-1 text-base text-white"
                />
                <select
                  value={cb.activityCategoryFilter}
                  onChange={(e) => cb.setActivityCategoryFilter(e.target.value)}
                  className="ui-field min-h-12 flex-1 text-base text-white"
                >
                  {cb.activityCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {cb.activityCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => cb.setActivityCategoryFilter(cat)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${cb.activityCategoryFilter === cat ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border bg-surface text-muted'}`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-4">
                {cb.activitiesLoading ? (
                  <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
                    Loading Firestore activity catalog...
                  </p>
                ) : cb.activityCategoryFilter === 'Events' ? (
                  cb.eventCampaigns.length === 0 ? (
                    <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
                      No event packages are enabled for booking at this branch.
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {cb.eventCampaigns.map((evt) => {
                        const q = cb.activitySearchTerm.trim().toLowerCase()
                        const visiblePackages = (evt.packages ?? []).filter(
                          (p) =>
                            !q ||
                            p.title.toLowerCase().includes(q) ||
                            evt.title.toLowerCase().includes(q),
                        )
                        if (visiblePackages.length === 0) return null
                        return (
                          <div
                            key={evt.id}
                            className="rounded-2xl border border-accent/30 bg-accent/5 p-4"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <h4 className="text-sm font-semibold text-text">{evt.title}</h4>
                                {evt.promoText && (
                                  <p className="mt-0.5 text-[11px] text-muted">{evt.promoText}</p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {!evt.couponPolicy.allowCouponUsage && (
                                  <span className="ui-pill border-muted/40 bg-muted/10 text-muted px-2 py-0.5 text-[10px]">
                                    No coupon use
                                  </span>
                                )}
                                {!evt.couponPolicy.grantCoupons && (
                                  <span className="ui-pill border-muted/40 bg-muted/10 text-muted px-2 py-0.5 text-[10px]">
                                    No coupon earn
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {visiblePackages.map((pkg) => {
                                const key = `${evt.id}::${pkg.id}`
                                const qty = Math.max(0, Math.floor(cb.eventPackageQty[key] ?? 0))
                                const unitPrice = (pkg.items ?? []).reduce(
                                  (s, it) => s + Number(it.price ?? 0),
                                  0,
                                )
                                const selected = cb.selectedEventPackageIds.includes(key)
                                return (
                                  <article
                                    key={key}
                                    className={`rounded-2xl border p-3.5 transition md:p-4 ${selected ? 'border-accent/50 bg-accent/10 shadow-sm' : 'border-border bg-surface/95 hover:border-accent/30'}`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                                            Event
                                          </span>
                                          <p className="text-sm font-semibold text-text">
                                            {pkg.title}
                                          </p>
                                        </div>
                                        <p className="mt-1 text-[11px] text-muted">
                                          {(pkg.items ?? []).map((i) => i.name).join(', ') ||
                                            'No items'}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-sm font-semibold text-text">
                                          {formatCurrency(unitPrice)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 py-2">
                                      <div>
                                        <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
                                          Quantity
                                        </p>
                                        <p className="text-sm font-semibold text-text">{qty}</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => cb.decreaseEventPackageQty(key)}
                                          disabled={qty === 0}
                                          className="ui-btn ui-btn-neutral h-8 w-8 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          -
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => cb.addEventPackage(evt.id, pkg.id)}
                                          className="ui-btn ui-btn-info h-8 px-3 text-xs"
                                        >
                                          Add
                                        </button>
                                      </div>
                                    </div>
                                  </article>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : cb.activityCategoryFilter === 'Combos' ? (
                  cb.filteredCombos.length === 0 ? (
                    <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
                      {cb.activitySearchTerm.trim()
                        ? 'No combos matched this search.'
                        : 'No combos available for this location.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {cb.filteredCombos.map((combo) => {
                        const selected = cb.selectedComboIds.includes(combo.id)
                        const qty = selected
                          ? Math.max(1, Math.floor(cb.comboQty[combo.id] ?? 1))
                          : 0
                        const savings = combo.originalTotal - combo.comboPrice
                        return (
                          <article
                            key={combo.id}
                            className={`rounded-2xl border p-3.5 transition md:p-4 ${selected ? 'border-accent/50 bg-accent/10 shadow-sm' : 'border-border bg-surface/95 hover:border-accent/30'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                                    Combo
                                  </span>
                                  <p className="text-sm font-semibold text-text">{combo.name}</p>
                                </div>
                                <p className="mt-1 text-[11px] text-muted">
                                  {combo.items.map((i) => i.itemName).join(', ')}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-text">
                                  {formatCurrency(combo.comboPrice)}
                                </p>
                                {combo.originalTotal > combo.comboPrice && (
                                  <p className="text-[10px] text-muted line-through">
                                    {formatCurrency(combo.originalTotal)}
                                  </p>
                                )}
                              </div>
                            </div>
                            {savings > 0 && (
                              <p className="mt-1.5 text-[10px] font-semibold text-green-600">
                                Save {formatCurrency(savings)}
                              </p>
                            )}
                            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 py-2">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
                                  Quantity
                                </p>
                                <p className="text-sm font-semibold text-text">{qty}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => cb.decreaseComboQty(combo.id)}
                                  disabled={qty === 0}
                                  className="ui-btn ui-btn-neutral h-8 w-8 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cb.addCombo(combo)}
                                  className="ui-btn ui-btn-info h-8 px-3 text-xs"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )
                ) : cb.groupedCatalogActivities.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
                    No activities matched this search or game filter.
                  </p>
                ) : cb.activeCatalogGroup ? (
                  <section className="rounded-2xl border border-border bg-surface/90 transition-all duration-200">
                    <div className="border-b border-border bg-panel/60 px-5 py-4">
                      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                        <button
                          type="button"
                          onClick={() => {
                            if (cb.activeCatalogSubGame) {
                              cb.setActiveCatalogSubGameKey(null)
                              return
                            }
                            cb.setActiveCatalogGameKey(null)
                            cb.setActiveCatalogSubGameKey(null)
                          }}
                          className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text transition hover:border-accent/40 hover:text-accent"
                        >
                          Back
                        </button>
                        <span>Activity Catalog</span>
                        <span className="text-muted">&rarr;</span>
                        <span className="font-semibold text-text">
                          {cb.activeCatalogGroup.title}
                        </span>
                        {cb.activeCatalogSubGame && (
                          <>
                            <span className="text-muted">&rarr;</span>
                            <span className="font-semibold text-text">
                              {cb.activeCatalogSubGame.title}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="p-5 transition-all duration-200 md:p-6">
                      {cb.activeCatalogSubGame ? (
                        <>
                          <div className="mb-5 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-lg font-semibold text-text">
                                {cb.activeCatalogSubGame.title}
                              </h4>
                              <p className="text-xs text-muted">
                                {cb.activeCatalogSubGame.activities.length} lap options
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {cb.activeCatalogSubGame.activities.map((activity) => {
                              const selected = cb.selectedActivityIds.includes(activity.id)
                              const qty = selected
                                ? Math.max(1, Math.floor(cb.activityQty[activity.id] ?? 1))
                                : 0
                              const price = getCatalogPrice(activity, cb.activeBranchKey)
                              return (
                                <article
                                  key={activity.id}
                                  className={`rounded-2xl border p-3.5 transition md:p-4 ${selected ? 'border-accent/50 bg-accent/10 shadow-sm' : 'border-border bg-surface/95 hover:border-accent/30'}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-text">
                                        {activity.variantLabel ?? activity.name}
                                      </p>
                                      <p className="mt-1 text-[11px] text-muted">
                                        {activity.bookingName ??
                                          `${cb.activeCatalogGroup!.title} • ${cb.activeCatalogSubGame!.title}`}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold text-text">
                                        {formatCurrency(price)}
                                      </p>
                                      <p className="text-[11px] text-muted">
                                        {formatCatalogMetric(activity)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/70 px-3 py-2">
                                    <div>
                                      <p className="text-[11px] uppercase tracking-[0.08em] text-muted">
                                        Quantity
                                      </p>
                                      <p className="text-sm font-semibold text-text">{qty}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => cb.decreaseActivityQty(activity.id, qty)}
                                        disabled={qty === 0}
                                        className="ui-btn ui-btn-neutral h-8 w-8 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        -
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => cb.increaseActivityQty(activity.id, qty)}
                                        className="ui-btn ui-btn-info h-8 px-3 text-xs"
                                      >
                                        Add
                                      </button>
                                    </div>
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="mb-5 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-lg font-semibold text-text">
                                {cb.activeCatalogGroup.title}
                              </h4>
                              <p className="text-xs text-muted">
                                {cb.activeCatalogGroup.subGames.length} variants available
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {cb.activeCatalogGroup.subGames.map((subGame) => {
                              const selectedCount = subGame.activities.filter((a) =>
                                cb.selectedActivityIds.includes(a.id),
                              ).length
                              const prices = subGame.activities
                                .map((a) => getCatalogPrice(a, cb.activeBranchKey))
                                .filter((p) => p > 0)
                              const minPrice = prices.length ? Math.min(...prices) : 0
                              return (
                                <button
                                  key={subGame.key}
                                  type="button"
                                  onClick={() => cb.setActiveCatalogSubGameKey(subGame.key)}
                                  className="group rounded-2xl border border-border bg-panel/45 p-4 text-left shadow-sm transition hover:border-accent/35 hover:bg-panel/60 md:p-5"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-text">
                                        {subGame.title}
                                      </p>
                                      <p className="mt-1 text-xs text-muted">
                                        {subGame.activities.length} lap options
                                      </p>
                                    </div>
                                    {selectedCount > 0 && (
                                      <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                                        {selectedCount} selected
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-4 flex items-center justify-between text-xs">
                                    <span className="text-muted">Starting price</span>
                                    <span className="font-semibold text-text">
                                      {formatCurrency(minPrice)}
                                    </span>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                ) : (
                  <div className="rounded-2xl border border-border bg-surface p-4 md:p-5">
                    <div className="grid justify-items-center gap-4 [grid-template-columns:repeat(auto-fit,minmax(84px,1fr))] sm:gap-5 xl:gap-6">
                      {cb.groupedCatalogActivities.map((group) => (
                        <button
                          key={group.key}
                          type="button"
                          onClick={() => {
                            cb.setActiveCatalogGameKey(group.key)
                            cb.setActiveCatalogSubGameKey(null)
                          }}
                          className="group flex h-full flex-col items-center gap-2 rounded-2xl border border-transparent p-1.5 transition hover:border-accent/30 hover:bg-panel/30"
                        >
                          <div className="relative h-[76px] w-[76px] overflow-hidden rounded-2xl border border-border bg-panel shadow-sm transition group-hover:border-accent/40">
                            {group.imageUrl ? (
                              <img
                                src={group.imageUrl}
                                alt={group.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#fde68a_0%,transparent_46%),linear-gradient(145deg,#0f172a,#1e293b)] text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
                                {group.title.slice(0, 3)}
                              </div>
                            )}
                          </div>
                          <span className="w-[84px] text-center text-[11px] font-semibold leading-tight text-text">
                            {group.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Sidebar */}
            <aside className="rounded-2xl border border-border bg-panel p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                Booking Summary
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border border-border bg-surface px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Location</p>
                  <p className="mt-1 font-semibold text-text">
                    {ADMIN_LOCATIONS.find((l) => l.id === cb.createLocation)?.name ??
                      cb.createLocation}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Date</p>
                  <p className="mt-1 font-semibold text-text">{cb.createDate}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Customer</p>
                  <p className="mt-1 font-semibold text-text">
                    {cb.customerName.trim() || 'Pending name'}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Mobile</p>
                  <p className="mt-1 font-semibold text-text">
                    {cb.normalizedCustomerPhone || 'Pending phone'}
                  </p>
                </div>
              </div>

              {/* Selected items */}
              <div className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Selected Activities</p>
                  <p className="text-xs text-muted">
                    {cb.selectedActivityIds.length +
                      cb.selectedComboIds.length +
                      cb.selectedEventPackageIds.length}{' '}
                    items
                  </p>
                </div>
                {cb.selectedActivities.length === 0 &&
                cb.selectedCombos.length === 0 &&
                cb.selectedEventPackages.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    Choose activities, combos, or event packages from the left catalog to build the
                    booking.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {cb.selectedActivities.map((activity) => {
                      const qty = Math.max(1, Math.floor(cb.activityQty[activity.id] ?? 1))
                      const price = getCatalogPrice(activity, cb.activeBranchKey)
                      const lineCoupon = cb.perLineCouponDiscount.get(activity.id) ?? {
                        units: 0,
                        discount: 0,
                      }
                      const lineSubtotal = price * qty
                      const lineNet = lineSubtotal - lineCoupon.discount
                      const isCouponEligible =
                        String(activity.category ?? '').toLowerCase() === 'gokarting'
                      const inCouponMode = cb.benefitMode === 'coupon' && cb.memberInsight !== null
                      return (
                        <div
                          key={activity.id}
                          className="rounded-xl border border-border/70 bg-panel/40 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-text">
                                {activity.variantLabel ?? activity.name}
                              </p>
                              <p className="text-xs text-muted">
                                {activity.bookingName ?? activity.name}
                              </p>
                              {activity.vendorId && (
                                <span className="mt-1 inline-block rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                                  Vendor
                                </span>
                              )}
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => cb.decreaseActivityQty(activity.id, qty)}
                                  disabled={qty === 0}
                                  className="ui-btn ui-btn-neutral h-7 w-7 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  -
                                </button>
                                <span className="min-w-[28px] text-center text-sm font-semibold text-text">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => cb.increaseActivityQty(activity.id, qty)}
                                  className="ui-btn ui-btn-info h-7 w-7 px-0 text-sm"
                                >
                                  +
                                </button>
                                <span className="text-xs text-muted">
                                  {formatCatalogMetric(activity)}
                                </span>
                                {inCouponMode && !isCouponEligible && (
                                  <span className="text-[10px] text-muted/80 italic">
                                    not coupon-eligible
                                  </span>
                                )}
                                {cb.benefitMode === 'discount' &&
                                  cb.discountPercent > 0 &&
                                  !!activity.vendorId && (
                                    <span className="text-[10px] text-muted/80 italic">
                                      full price (vendor)
                                    </span>
                                  )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-right">
                              <button
                                type="button"
                                onClick={() => cb.removeActivity(activity.id)}
                                aria-label={`Remove ${activity.variantLabel ?? activity.name}`}
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-accent"
                              >
                                &times;
                              </button>
                              {lineCoupon.units > 0 ? (
                                <>
                                  <p className="text-[11px] text-muted line-through">
                                    {formatCurrency(lineSubtotal)}
                                  </p>
                                  <p className="text-[11px] text-success">
                                    &minus;{formatCurrency(lineCoupon.discount)} ({lineCoupon.units}
                                    &times;₹{COUPON_FACE_VALUE})
                                  </p>
                                  <p className="text-sm font-semibold text-text">
                                    {formatCurrency(lineNet)}
                                  </p>
                                </>
                              ) : (
                                <p className="text-sm font-semibold text-text">
                                  {formatCurrency(lineSubtotal)}
                                </p>
                              )}
                              <p className="text-[11px] text-muted">{formatCurrency(price)} each</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {cb.selectedEventPackages.map((line) => {
                      const lineCoupon = cb.perLineCouponDiscount.get(line.key) ?? {
                        units: 0,
                        discount: 0,
                      }
                      const lineNet = line.lineTotal - lineCoupon.discount
                      return (
                        <div
                          key={`event-${line.key}`}
                          className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-text">
                                <span className="mr-1 inline-block rounded bg-accent/20 px-1 py-0.5 text-[10px] font-bold uppercase text-accent">
                                  Event
                                </span>
                                {line.campaign.title} — {line.pkg.title}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {(line.pkg.items ?? []).map((i) => i.name).join(', ')}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => cb.decreaseEventPackageQty(line.key)}
                                  disabled={line.qty === 0}
                                  className="ui-btn ui-btn-neutral h-7 w-7 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  -
                                </button>
                                <span className="min-w-[28px] text-center text-sm font-semibold text-text">
                                  {line.qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => cb.increaseEventPackageQty(line.key)}
                                  className="ui-btn ui-btn-info h-7 w-7 px-0 text-sm"
                                >
                                  +
                                </button>
                                {!line.campaign.couponPolicy.allowCouponUsage && (
                                  <span className="text-[10px] italic text-muted/80">
                                    no coupon use
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-right">
                              <button
                                type="button"
                                onClick={() => cb.removeEventPackage(line.key)}
                                aria-label={`Remove ${line.pkg.title}`}
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-accent"
                              >
                                &times;
                              </button>
                              {lineCoupon.units > 0 ? (
                                <>
                                  <p className="text-[11px] text-muted line-through">
                                    {formatCurrency(line.lineTotal)}
                                  </p>
                                  <p className="text-[11px] text-success">
                                    &minus;{formatCurrency(lineCoupon.discount)} ({lineCoupon.units}
                                    &times;₹{COUPON_FACE_VALUE})
                                  </p>
                                  <p className="text-sm font-semibold text-text">
                                    {formatCurrency(lineNet)}
                                  </p>
                                </>
                              ) : (
                                <p className="text-sm font-semibold text-text">
                                  {formatCurrency(line.lineTotal)}
                                </p>
                              )}
                              <p className="text-[11px] text-muted">
                                {formatCurrency(line.unitPrice)} each
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {cb.selectedCombos.map((combo) => {
                      const qty = Math.max(1, Math.floor(cb.comboQty[combo.id] ?? 1))
                      const lineTotal = combo.comboPrice * qty
                      return (
                        <div
                          key={`combo-${combo.id}`}
                          className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-text">
                                <span className="mr-1 inline-block rounded bg-accent/20 px-1 py-0.5 text-[10px] font-bold uppercase text-accent">
                                  Combo
                                </span>
                                {combo.name}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {combo.items.map((i) => i.itemName).join(', ')}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => cb.decreaseComboQty(combo.id)}
                                  disabled={qty === 0}
                                  className="ui-btn ui-btn-neutral h-7 w-7 px-0 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  -
                                </button>
                                <span className="min-w-[28px] text-center text-sm font-semibold text-text">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => cb.increaseComboQty(combo.id)}
                                  className="ui-btn ui-btn-info h-7 w-7 px-0 text-sm"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1 text-right">
                              <button
                                type="button"
                                onClick={() => cb.removeCombo(combo.id)}
                                aria-label={`Remove combo ${combo.name}`}
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-accent"
                              >
                                &times;
                              </button>
                              <p className="text-sm font-semibold text-text">
                                {formatCurrency(lineTotal)}
                              </p>
                              <p className="text-[11px] text-muted">
                                {formatCurrency(combo.comboPrice)} each
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Protocol Toggle */}
              <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={cb.isProtocol}
                      onChange={(e) => {
                        const on = e.target.checked
                        cb.setIsProtocol(on)
                        if (on) {
                          cb.setDiscountPercent(0)
                          cb.setBenefitMode('discount')
                          cb.setSelectedActivityIds([])
                          cb.setActivityQty({})
                          // Event packages and combos are incompatible with
                          // protocol (Go-Karting only, ₹0). Clear them too.
                          cb.selectedEventPackageIds.forEach((k) => cb.removeEventPackage(k))
                          cb.selectedComboIds.forEach((id) => cb.removeCombo(id))
                        }
                      }}
                    />
                    <div className="h-5 w-9 rounded-full bg-muted/30 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
                  </label>
                  <div>
                    <span className="text-sm font-semibold text-text">Protocol</span>
                    <p className="text-[11px] text-muted">
                      Free Go-Karting (max {PROTOCOL_MAX_LAPS} laps) — Owner approval required
                    </p>
                  </div>
                </div>
                {cb.isProtocol && (
                  <input
                    className="ui-field mt-2 min-h-10 w-full"
                    placeholder="Reason for protocol *"
                    value={cb.protocolReason}
                    onChange={(e) => cb.setProtocolReason(e.target.value)}
                  />
                )}
                {cb.isProtocol && (
                  <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    Protocol: ₹0 — Go-Karting only, max {PROTOCOL_MAX_LAPS} laps. Pending Owner
                    approval.
                  </div>
                )}
              </div>

              {/* Benefit Mode */}
              {!cb.isProtocol && (
                <div className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.09em] text-muted">
                    Apply Benefit
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${cb.benefitMode === 'discount' ? 'border-accent/50 bg-accent/10 text-text' : 'border-border bg-panel/30 text-muted'}`}
                    >
                      <input
                        type="radio"
                        name="benefit-mode"
                        value="discount"
                        checked={cb.benefitMode === 'discount'}
                        onChange={() => cb.setBenefitMode('discount')}
                        className="accent-accent"
                      />
                      Discount
                    </label>
                    <label
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${cb.benefitMode === 'coupon' ? 'border-success/50 bg-success/10 text-text' : cb.couponModeAvailable ? 'border-border bg-panel/30 text-muted' : 'border-border/50 bg-panel/10 text-muted/50 cursor-not-allowed'}`}
                    >
                      <input
                        type="radio"
                        name="benefit-mode"
                        value="coupon"
                        checked={cb.benefitMode === 'coupon'}
                        onChange={() => cb.setBenefitMode('coupon')}
                        disabled={!cb.couponModeAvailable}
                        className="accent-success"
                      />
                      ₹150 Coupon
                      {cb.memberInsight && (
                        <span className="ml-auto text-[10px] text-muted">
                          ({cb.memberInsight.coupons150Available} left)
                        </span>
                      )}
                    </label>
                  </div>
                  {cb.benefitMode === 'discount' ? (
                    (() => {
                      const maxDiscount =
                        role === 'owner' ? 95 : (session?.user.maxDiscountPercent ?? 0)
                      if (maxDiscount <= 0)
                        return <p className="mt-2 text-xs text-muted">No discount permission</p>
                      if (cb.cartIsAllVendor)
                        return (
                          <p className="mt-2 text-xs text-warning">
                            Discount not available — all items are vendor-supplied.
                          </p>
                        )
                      return (
                        <select
                          value={cb.discountPercent}
                          onChange={(e) => cb.setDiscountPercent(Number(e.target.value))}
                          className="ui-field mt-2 min-h-10 w-full"
                          aria-label="Discount percentage"
                        >
                          <option value={0}>No Discount</option>
                          {[
                            5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90,
                            95,
                          ]
                            .filter((p) => p <= maxDiscount)
                            .map((p) => (
                              <option key={p} value={p}>
                                {p}%
                              </option>
                            ))}
                        </select>
                      )
                    })()
                  ) : cb.memberInsight ? (
                    <div className="mt-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[11px] text-success">
                      {cb.couponApplication.couponsApplied} of{' '}
                      {cb.memberInsight.coupons150Available} coupon
                      {cb.memberInsight.coupons150Available === 1 ? '' : 's'} applied automatically
                      to {cb.couponApplication.couponsApplied} Go-Karting unit
                      {cb.couponApplication.couponsApplied === 1 ? '' : 's'} in cart order.
                      {cb.couponApplication.couponsApplied === 0 && (
                        <span className="block text-muted">
                          Add a Go-Karting variant to use coupons.
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Pricing Summary */}
              <div
                className={`mt-4 rounded-2xl border px-4 py-4 ${cb.isProtocol ? 'border-warning/30 bg-warning/10' : 'border-accent/30 bg-accent/10'}`}
              >
                {!cb.isProtocol && cb.discountAmount > 0 && (
                  <>
                    {cb.hasCompanyItems && cb.hasVendorItems ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-muted">Company items</p>
                          <p className="text-sm text-muted">{formatCurrency(cb.companyTotal)}</p>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-muted">Vendor items (full price)</p>
                          <p className="text-sm text-muted">{formatCurrency(cb.vendorTotal)}</p>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted">Subtotal</p>
                        <p className="text-sm text-muted line-through">
                          {formatCurrency(cb.totalAmount)}
                        </p>
                      </div>
                    )}
                    {cb.couponDiscount > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted">
                          Coupons ({cb.couponApplication.couponsApplied}&times; ₹{COUPON_FACE_VALUE}
                          )
                        </p>
                        <p className="text-sm text-success">-{formatCurrency(cb.couponDiscount)}</p>
                      </div>
                    )}
                    {cb.flatDiscount > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-muted">
                          Discount ({cb.discountPercent}%
                          {cb.hasVendorItems ? ' on company items' : ''})
                        </p>
                        <p className="text-sm text-success">-{formatCurrency(cb.flatDiscount)}</p>
                      </div>
                    )}
                  </>
                )}
                {!cb.isProtocol &&
                  cb.packageFlatDiscountTotal + cb.packageBxgyDiscountTotal > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-muted">Event package discount</p>
                      <p className="text-sm text-success">
                        -{formatCurrency(cb.packageFlatDiscountTotal + cb.packageBxgyDiscountTotal)}
                      </p>
                    </div>
                  )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">Total</p>
                  <p
                    className={`text-xl font-semibold ${cb.isProtocol ? 'text-warning' : 'text-accent'}`}
                  >
                    {cb.isProtocol ? '₹0 (Protocol)' : formatCurrency(cb.finalAmount)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {cb.isProtocol
                    ? 'Protocol booking will be created pending Owner approval.'
                    : 'Razorpay payment link will be generated for this exact amount.'}
                </p>
                {!cb.isProtocol && cb.projectedEarnedCoupons > 0 && (
                  <p className="mt-2 rounded-lg border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
                    Earns +{cb.projectedEarnedCoupons} ₹150 coupon
                    {cb.projectedEarnedCoupons === 1 ? '' : 's'} for next visit
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  cb.sendingLink ||
                  !cb.canSendBookingLinks ||
                  (cb.selectedActivityIds.length === 0 &&
                    cb.selectedComboIds.length === 0 &&
                    cb.selectedEventPackageIds.length === 0)
                }
                className={`mt-4 min-h-11 w-full text-sm disabled:cursor-not-allowed disabled:opacity-50 ui-btn ${cb.isProtocol ? 'ui-btn-warning' : 'ui-btn-primary'}`}
              >
                {cb.sendingLink
                  ? 'Sending...'
                  : cb.isProtocol
                    ? 'Create Protocol Booking'
                    : 'Send Payment Link'}
              </button>
            </aside>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateBookingView

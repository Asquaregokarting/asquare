import { Eye, EyeOff, Pause, Play, Plus, Trash2 } from 'lucide-react'
import type {
  EventPackage,
  EventPackageItem,
  EventPackageItemType,
} from '../../../features/event-campaigns/event-campaign-types'
import {
  calculatePackageTotal,
  isPackageEnabled,
  isItemEnabled,
} from '../../../features/event-campaigns/event-pricing'
import type { VendorDetailsRecord } from '../../../api/types'
import type { BranchLocation } from '../../../../types'
import { resolveLocation } from '../../../../lib/locations'

interface Props {
  packages: EventPackage[]
  onChange: (packages: EventPackage[]) => void
  locations: BranchLocation[]
  /** Locations on the campaign that are paused — used to surface a warning on packages tied to them */
  disabledLocationKeys?: string[]
  vendors: VendorDetailsRecord[]
  vendorsLoading: boolean
}

const newPackage = (): EventPackage => ({
  id: crypto.randomUUID(),
  title: '',
  locationKey: '',
  items: [],
})

const newItem = (): EventPackageItem => ({
  id: crypto.randomUUID(),
  type: 'company',
  name: '',
  price: 0,
})

const formatCurrency = (value: number): string =>
  `₹ ${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const PackagesSection = ({
  packages,
  onChange,
  locations,
  disabledLocationKeys = [],
  vendors,
  vendorsLoading,
}: Props) => {
  const addPackage = () => onChange([...packages, newPackage()])

  const removePackage = (id: string) => onChange(packages.filter((p) => p.id !== id))

  const updatePackage = (id: string, patch: Partial<EventPackage>) =>
    onChange(packages.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const togglePackageEnabled = (id: string) => {
    const pkg = packages.find((p) => p.id === id)
    if (!pkg) return
    updatePackage(id, { enabled: isPackageEnabled(pkg) ? false : true })
  }

  const addItem = (pkgId: string) => {
    const pkg = packages.find((p) => p.id === pkgId)
    if (!pkg) return
    updatePackage(pkgId, { items: [...pkg.items, newItem()] })
  }

  const removeItem = (pkgId: string, itemId: string) => {
    const pkg = packages.find((p) => p.id === pkgId)
    if (!pkg) return
    updatePackage(pkgId, { items: pkg.items.filter((it) => it.id !== itemId) })
  }

  const updateItem = (pkgId: string, itemId: string, patch: Partial<EventPackageItem>) => {
    const pkg = packages.find((p) => p.id === pkgId)
    if (!pkg) return
    updatePackage(pkgId, {
      items: pkg.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    })
  }

  const toggleItemEnabled = (pkgId: string, itemId: string) => {
    const pkg = packages.find((p) => p.id === pkgId)
    if (!pkg) return
    const item = pkg.items.find((it) => it.id === itemId)
    if (!item) return
    updateItem(pkgId, itemId, { enabled: isItemEnabled(item) ? false : true })
  }

  const liveCount = packages.filter(isPackageEnabled).length
  const pausedCount = packages.length - liveCount

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Packages <span className="text-critical">*</span>
          </h3>
          <p className="mt-1 text-xs text-muted">
            Each package is one branch-bound bundle. Pause a whole package or individual items to
            keep them as drafts without removing them.
          </p>
        </div>
        {packages.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> {liveCount} live
            {pausedCount > 0 && (
              <>
                <span className="text-border">/</span>
                <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {pausedCount} paused
              </>
            )}
          </div>
        )}
      </header>

      <div className="mt-4 space-y-4">
        {packages.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/50 bg-panel/30 px-4 py-6 text-center text-xs text-muted">
            No packages yet. Add one to get started.
          </p>
        )}

        {packages.map((pkg, pkgIndex) => {
          const enabled = isPackageEnabled(pkg)
          const total = calculatePackageTotal(pkg)
          const locationPaused = !!pkg.locationKey && disabledLocationKeys.includes(pkg.locationKey)
          const enabledItemCount = pkg.items.filter(isItemEnabled).length
          const totalItemCount = pkg.items.length

          return (
            <article
              key={pkg.id}
              className={`group/pkg relative overflow-hidden rounded-xl border bg-panel/40 transition ${
                enabled ? 'border-border/70' : 'border-warning/40 bg-warning/[0.04]'
              }`}
            >
              <div
                className={`flex flex-wrap items-center gap-2 border-b px-4 py-2.5 ${
                  enabled ? 'border-border/50 bg-panel/60' : 'border-warning/20 bg-warning/[0.06]'
                }`}
              >
                <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  Package {pkgIndex + 1}
                </span>
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    enabled ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-success' : 'bg-warning'}`}
                  />
                  {enabled ? 'Live' : 'Paused'}
                </span>
                {locationPaused && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                    Location paused
                  </span>
                )}
                <p className="ml-1 truncate text-sm font-semibold text-text">
                  {pkg.title || <span className="text-muted">Untitled package</span>}
                </p>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => togglePackageEnabled(pkg.id)}
                    title={enabled ? 'Pause package' : 'Resume package'}
                    className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold uppercase tracking-wider transition ${
                      enabled
                        ? 'bg-surface text-muted hover:bg-warning/10 hover:text-warning'
                        : 'bg-warning/15 text-warning hover:bg-warning/25'
                    }`}
                  >
                    {enabled ? (
                      <>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removePackage(pkg.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-critical/10 hover:text-critical"
                    title="Remove package"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div
                className={`p-4 transition ${enabled ? '' : 'opacity-60 saturate-[0.7]'}`}
                aria-disabled={enabled ? 'false' : 'true'}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`pkg-title-${pkg.id}`}
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted"
                    >
                      Title
                    </label>
                    <input
                      id={`pkg-title-${pkg.id}`}
                      type="text"
                      value={pkg.title}
                      onChange={(e) => updatePackage(pkg.id, { title: e.target.value })}
                      placeholder="e.g. Weekend Combo"
                      className="ui-field min-h-10 w-full px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`pkg-location-${pkg.id}`}
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted"
                    >
                      Location <span className="text-critical">*</span>
                    </label>
                    <select
                      id={`pkg-location-${pkg.id}`}
                      value={pkg.locationKey}
                      onChange={(e) => updatePackage(pkg.id, { locationKey: e.target.value })}
                      className="ui-field min-h-10 w-full px-3 text-sm"
                    >
                      <option value="">— Select a location —</option>
                      {locations.map((loc) => {
                        const paused = disabledLocationKeys.includes(loc.slug)
                        return (
                          <option key={loc.slug} value={loc.slug}>
                            {loc.shortName ?? loc.slug}
                            {paused ? ' (paused)' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Items
                    </p>
                    {totalItemCount > 0 && (
                      <p className="text-[10px] text-muted">
                        {enabledItemCount} / {totalItemCount} active
                      </p>
                    )}
                  </div>

                  <div className="mt-2 space-y-2">
                    {pkg.items.length === 0 && (
                      <p className="rounded-lg border border-dashed border-border/50 bg-surface/40 px-3 py-4 text-center text-xs text-muted">
                        No items yet.
                      </p>
                    )}

                    {pkg.items.map((item, itemIndex) => (
                      <PackageItemRow
                        key={item.id}
                        item={item}
                        index={itemIndex}
                        vendors={vendors}
                        vendorsLoading={vendorsLoading}
                        locationKey={pkg.locationKey}
                        onChange={(patch) => updateItem(pkg.id, item.id, patch)}
                        onRemove={() => removeItem(pkg.id, item.id)}
                        onToggleEnabled={() => toggleItemEnabled(pkg.id, item.id)}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => addItem(pkg.id)}
                    className="mt-3 flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border/50 px-3 py-2 text-xs font-semibold text-muted transition hover:border-accent/40 hover:text-accent"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Item
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
                  <p className="text-sm font-semibold text-text">Package Total</p>
                  <p className="text-lg font-semibold text-accent">{formatCurrency(total)}</p>
                </div>
              </div>
            </article>
          )
        })}

        <button
          type="button"
          onClick={addPackage}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 px-4 py-2 text-sm font-semibold text-muted transition hover:border-accent/40 hover:text-accent"
        >
          <Plus className="h-4 w-4" />
          Add Package
        </button>
      </div>
    </section>
  )
}

interface PackageItemRowProps {
  item: EventPackageItem
  index: number
  vendors: VendorDetailsRecord[]
  vendorsLoading: boolean
  locationKey: string
  onChange: (patch: Partial<EventPackageItem>) => void
  onRemove: () => void
  onToggleEnabled: () => void
}

const PackageItemRow = ({
  item,
  index,
  vendors,
  vendorsLoading,
  locationKey,
  onChange,
  onRemove,
  onToggleEnabled,
}: PackageItemRowProps) => {
  const enabled = isItemEnabled(item)
  // Normalize locationKey to a canonical slug so it matches however vendor.branchId is stored
  // (e.g. "0" numeric id vs "visakhapatnam" slug — both resolve to the same location)
  const locationSlug = locationKey ? (resolveLocation(locationKey)?.slug ?? locationKey) : ''
  const setType = (next: EventPackageItemType) => {
    if (next === 'company') {
      onChange({ type: 'company', vendorId: undefined, revenueShare: undefined })
    } else {
      onChange({
        type: 'thirdParty',
        revenueShare: item.revenueShare ?? true,
      })
    }
  }

  const showRevenueShareHint =
    item.type === 'thirdParty' && item.revenueShare === true && !item.vendorId

  return (
    <div
      className={`space-y-2 rounded-lg border p-3 transition ${
        enabled ? 'border-border/50 bg-surface/60' : 'border-warning/30 bg-warning/[0.04]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Item {index + 1}
        </span>
        {!enabled && (
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning">
            Paused
          </span>
        )}
        <div className={`flex flex-wrap items-center gap-3 ${enabled ? '' : 'opacity-60'}`}>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
            <input
              type="radio"
              name={`item-type-${item.id}`}
              checked={item.type === 'company'}
              onChange={() => setType('company')}
            />
            Company Game
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
            <input
              type="radio"
              name={`item-type-${item.id}`}
              checked={item.type === 'thirdParty'}
              onChange={() => setType('thirdParty')}
            />
            Third Party Game
          </label>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleEnabled}
            title={enabled ? 'Pause item' : 'Resume item'}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
              enabled
                ? 'text-muted hover:bg-warning/10 hover:text-warning'
                : 'bg-warning/15 text-warning hover:bg-warning/25'
            }`}
          >
            {enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-critical/10 hover:text-critical"
            title="Remove item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={`space-y-2 ${enabled ? '' : 'opacity-60'}`}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px]">
          <input
            type="text"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Game name"
            aria-label={`Item ${index + 1} name`}
            className={`ui-field min-h-9 w-full px-2 text-sm ${enabled ? '' : 'line-through decoration-warning/50'}`}
          />
          <input
            type="number"
            min="0"
            step="1"
            value={item.price === 0 ? '' : item.price}
            onChange={(e) => onChange({ price: Number(e.target.value) || 0 })}
            placeholder="Price (₹)"
            aria-label={`Item ${index + 1} price`}
            className="ui-field min-h-9 w-full px-2 text-sm"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={item.printIndividualTokens === true}
            onChange={(e) =>
              onChange({ printIndividualTokens: e.target.checked ? true : undefined })
            }
          />
          Print one token per quantity
          <span className="text-[10px] text-muted">
            (e.g. helicopter seats — uncheck for go-kart variants)
          </span>
        </label>

        {item.type === 'thirdParty' && (
          <div className="space-y-2 rounded-md border border-border/40 bg-panel/30 p-2">
            <div>
              <label
                htmlFor={`item-vendor-${item.id}`}
                className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted"
              >
                Vendor
              </label>
              <select
                id={`item-vendor-${item.id}`}
                value={item.vendorId ?? ''}
                onChange={(e) =>
                  onChange({ vendorId: e.target.value ? e.target.value : undefined })
                }
                disabled={vendorsLoading}
                className="ui-field min-h-9 w-full px-2 text-sm disabled:opacity-50"
              >
                <option value="">
                  {vendorsLoading ? 'Loading vendors…' : '— No vendor linked —'}
                </option>
                {(() => {
                  const groups = new Map<string, { displayName: string; vendors: typeof vendors }>()

                  for (const v of vendors) {
                    if (!v.branchId) continue
                    const loc = resolveLocation(v.branchId)
                    const key = loc?.slug ?? v.branchId
                    const label = loc?.displayName ?? v.branchId
                    if (!groups.has(key)) groups.set(key, { displayName: label, vendors: [] })
                    groups.get(key)!.vendors.push(v)
                  }

                  const currentSlug = locationSlug
                  const sorted = [...groups.entries()].sort(([a], [b]) => {
                    if (a === currentSlug) return -1
                    if (b === currentSlug) return 1
                    return a.localeCompare(b)
                  })

                  return (
                    <>
                      {sorted.map(([slug, { displayName, vendors: grpVendors }]) => (
                        <optgroup
                          key={slug}
                          label={
                            slug === currentSlug ? `${displayName} (this location)` : displayName
                          }
                        >
                          {grpVendors.map((v) => (
                            <option key={v.userId} value={v.userId}>
                              {v.vendorName} ({v.revenueShare}/{100 - v.revenueShare})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </>
                  )
                })()}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Revenue Share
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
                <input
                  type="radio"
                  name={`item-rs-${item.id}`}
                  checked={item.revenueShare === true}
                  onChange={() => onChange({ revenueShare: true })}
                />
                Yes
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
                <input
                  type="radio"
                  name={`item-rs-${item.id}`}
                  checked={item.revenueShare === false}
                  onChange={() => onChange({ revenueShare: false })}
                />
                No
              </label>
            </div>

            {showRevenueShareHint && (
              <p className="text-[11px] text-warning">
                No vendor linked — revenue share will be ignored and 100% routed to third-party
                accounting.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PackagesSection

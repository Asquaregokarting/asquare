import { useState, useEffect, useMemo } from 'react'
import type { ActivityCatalogRecord } from '../../api/types'
import { listBranchActivityCatalog } from '../../api/activity-catalog-firestore'
import { listAllCombos, createCombo, updateCombo, deleteCombo } from './combo-firestore'
import type { ComboRecord, ComboItem } from './combo-types'
import { calculateCombo } from './combo-types'
import { useLocations } from '../../hooks/useLocations'

const currency = (n: number) => `INR ${Math.round(n).toLocaleString('en-IN')}`

interface Props {
  locationKey: string
}

const ComboBuilder = ({ locationKey: initialLocationKey }: Props) => {
  const { enabledLocations } = useLocations()
  const LOCATION_OPTIONS = useMemo(
    () => enabledLocations.map((l) => ({ key: l.slug, branch: l.branchId, label: l.shortName })),
    [enabledLocations],
  )
  const [locationKey, setLocationKey] = useState(initialLocationKey || '0')
  const [activities, setActivities] = useState<ActivityCatalogRecord[]>([])
  const [combos, setCombos] = useState<ComboRecord[]>([])
  const [loading, setLoading] = useState(false)

  // Builder state
  const [comboName, setComboName] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pricingMode, setPricingMode] = useState<'discount' | 'fixed'>('discount')
  const [discountPercent, setDiscountPercent] = useState('10')
  const [fixedPrice, setFixedPrice] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  // Resolve branch key — works with both slug ("vizag") and numeric ("0") formats
  const branchKey = LOCATION_OPTIONS.find((l) => l.key === locationKey)?.branch ?? locationKey

  useEffect(() => {
    setLoading(true)
    const loadActivities = listBranchActivityCatalog(branchKey)
      .then(async (acts) => {
        const { isCurrentlyUnavailable } = await import('../../api/activity-availability')
        // Don't let admins add a currently-unavailable activity to a NEW
        // combo (auto-expire honored). Existing combos that already include
        // it stay intact — that's a separate combo-hygiene concern.
        setActivities(acts.filter((a) => a.status === 'Active' && !isCurrentlyUnavailable(a)))
      })
      .catch(() => setActivities([]))
    const loadCombos = listAllCombos()
      .then((cmbs) => setCombos(cmbs))
      .catch(() => setCombos([]))
    Promise.all([loadActivities, loadCombos]).finally(() => setLoading(false))
  }, [branchKey])

  const selectedActivities = useMemo(
    () => activities.filter((a) => selectedIds.has(a.id)),
    [activities, selectedIds],
  )

  const calculation = useMemo(() => {
    if (selectedActivities.length < 2) return null
    const items = selectedActivities.map((a) => ({
      originalPrice: a.branchPrices[branchKey] ?? Object.values(a.branchPrices)[0] ?? 0,
    }))
    return calculateCombo(
      items,
      pricingMode,
      pricingMode === 'discount' ? Number(discountPercent) || 0 : undefined,
      pricingMode === 'fixed' ? Number(fixedPrice) || 0 : undefined,
    )
  }, [selectedActivities, pricingMode, discountPercent, fixedPrice, branchKey])

  const originalTotal = selectedActivities.reduce(
    (s, a) => s + (a.branchPrices[branchKey] ?? Object.values(a.branchPrices)[0] ?? 0),
    0,
  )

  const toggleActivity = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredActivities = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return activities
    return activities.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.subcategory ?? '').toLowerCase().includes(q),
    )
  }, [activities, search])

  const handleSave = async () => {
    if (!comboName.trim() || !calculation || selectedActivities.length < 2) return
    setSaving(true)
    try {
      const items: ComboItem[] = selectedActivities.map((a, i) => ({
        activityId: a.id,
        itemName: [a.category, a.subcategory, a.name].filter(Boolean).join(' — '),
        originalPrice: a.branchPrices[branchKey] ?? Object.values(a.branchPrices)[0] ?? 0,
        adjustedPrice: calculation.adjustedPrices[i],
        vendorId: a.vendorId,
        gameId: a.gameId,
        subGameId: a.subGameId,
        variantId: a.variantId,
      }))

      const comboData = {
        name: comboName.trim(),
        locationKey,
        items,
        pricingMode,
        discountPercent: pricingMode === 'discount' ? Number(discountPercent) || 0 : undefined,
        comboPrice: calculation.comboPrice,
        originalTotal,
        status: 'Active' as const,
      }

      if (editingId) {
        await updateCombo(editingId, comboData)
      } else {
        await createCombo(comboData)
      }
      // Reload
      const cmbs = await listAllCombos()
      setCombos(cmbs)
      resetForm()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save combo.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (combo: ComboRecord) => {
    setEditingId(combo.id)
    setComboName(combo.name)
    setSelectedIds(new Set(combo.items.map((i) => i.activityId)))
    setPricingMode(combo.pricingMode)
    setDiscountPercent(String(combo.discountPercent ?? '10'))
    setFixedPrice(String(combo.pricingMode === 'fixed' ? combo.comboPrice : ''))
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this combo?')) return
    await deleteCombo(id)
    setCombos((prev) => prev.filter((c) => c.id !== id))
  }

  const handleToggleStatus = async (combo: ComboRecord) => {
    const nextStatus: ComboRecord['status'] = combo.status === 'Active' ? 'Inactive' : 'Active'
    await updateCombo(combo.id, { status: nextStatus })
    setCombos((prev) => prev.map((c) => (c.id === combo.id ? { ...c, status: nextStatus } : c)))
  }

  const resetForm = () => {
    setComboName('')
    setSelectedIds(new Set())
    setPricingMode('discount')
    setDiscountPercent('10')
    setFixedPrice('')
    setEditingId(null)
  }

  if (loading) return <p className="text-sm text-muted">Loading activities...</p>

  return (
    <div className="space-y-6">
      {/* ── Location Selector ── */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Location</span>
        {LOCATION_OPTIONS.map((loc) => (
          <button
            key={loc.key}
            type="button"
            onClick={() => {
              setLocationKey(loc.branch)
              setSelectedIds(new Set())
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              branchKey === loc.branch
                ? 'bg-accent text-white'
                : 'border border-border bg-panel text-muted hover:text-text'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {/* ── Builder ── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-display text-lg font-semibold text-text mb-4">
          {editingId ? 'Edit Combo' : 'Create New Combo'}
        </h3>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: Activity Selector */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              Combo Name
            </label>
            <input
              className="ui-field min-h-10 w-full mb-3"
              value={comboName}
              onChange={(e) => setComboName(e.target.value)}
              placeholder="e.g. Family Fun Pack"
            />

            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              Select Activities (min 2)
            </label>
            <input
              className="ui-field min-h-9 w-full mb-2"
              placeholder="Search activities..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border/50 divide-y divide-border/30">
              {filteredActivities.map((a) => {
                const price = a.branchPrices[branchKey] ?? Object.values(a.branchPrices)[0] ?? 0
                const selected = selectedIds.has(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleActivity(a.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                      selected ? 'bg-accent/10 text-accent' : 'hover:bg-panel/50 text-text'
                    }`}
                  >
                    <div>
                      <span className="font-medium">{a.category}</span>
                      {a.subcategory ? (
                        <span className="text-muted"> — {a.subcategory}</span>
                      ) : null}
                      <span className="text-muted"> — {a.name}</span>
                      {a.vendorId && (
                        <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          Vendor
                        </span>
                      )}
                    </div>
                    <span className="font-semibold whitespace-nowrap">{currency(price)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right: Pricing & Preview */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted">
              Pricing Mode
            </label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setPricingMode('discount')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  pricingMode === 'discount'
                    ? 'bg-accent text-white'
                    : 'border border-border text-muted hover:text-text'
                }`}
              >
                Discount %
              </button>
              <button
                type="button"
                onClick={() => setPricingMode('fixed')}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                  pricingMode === 'fixed'
                    ? 'bg-accent text-white'
                    : 'border border-border text-muted hover:text-text'
                }`}
              >
                Fixed Price
              </button>
            </div>

            {pricingMode === 'discount' ? (
              <div className="mb-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Discount (%)
                </label>
                <input
                  className="ui-field min-h-10 w-full"
                  type="number"
                  min="0"
                  max="100"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                />
              </div>
            ) : (
              <div className="mb-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Final Combo Price (INR)
                </label>
                <input
                  className="ui-field min-h-10 w-full"
                  type="number"
                  min="0"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder={String(originalTotal)}
                />
              </div>
            )}

            {/* Calculation Preview */}
            {selectedActivities.length >= 2 && calculation ? (
              <div className="rounded-lg border border-border bg-panel/50 p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Original Total</span>
                  <span className="text-text line-through">{currency(originalTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Discount</span>
                  <span className="text-success font-semibold">
                    -{currency(originalTotal - calculation.comboPrice)}
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold border-t border-border pt-2">
                  <span className="text-text">Combo Price</span>
                  <span className="text-accent">{currency(calculation.comboPrice)}</span>
                </div>

                <div className="border-t border-border/50 pt-3 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Per-Item Breakdown
                  </p>
                  {selectedActivities.map((a, i) => (
                    <div key={a.id} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-text">
                          {a.category} — {a.name}
                        </span>
                        {a.vendorId ? (
                          <span className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-medium text-warning">
                            Vendor Split
                          </span>
                        ) : (
                          <span className="ml-1 rounded bg-success/15 px-1 py-0.5 text-[9px] font-medium text-success">
                            Company
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-muted line-through mr-2">
                          {currency(
                            a.branchPrices[branchKey] ?? Object.values(a.branchPrices)[0] ?? 0,
                          )}
                        </span>
                        <span className="font-semibold text-text">
                          {currency(calculation.adjustedPrices[i])}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : selectedActivities.length < 2 ? (
              <p className="text-sm text-muted py-4 text-center">
                Select at least 2 activities to build a combo.
              </p>
            ) : null}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={
                  saving || !comboName.trim() || selectedActivities.length < 2 || !calculation
                }
                onClick={handleSave}
                className="ui-btn ui-btn-primary disabled:opacity-50 flex-1"
              >
                {saving ? 'Saving...' : editingId ? 'Update Combo' : 'Create Combo'}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="ui-btn ui-btn-neutral">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Existing Combos ── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text mb-3">Saved Combos</h3>
        {combos.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center rounded-lg border border-border/30 bg-surface/30">
            No combos created yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {combos.map((combo) => (
              <div
                key={combo.id}
                className="rounded-xl border border-border bg-surface p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-text">{combo.name}</h4>
                  <button
                    type="button"
                    onClick={() => void handleToggleStatus(combo)}
                    title={combo.status === 'Active' ? 'Click to disable' : 'Click to enable'}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition hover:opacity-80 ${
                      combo.status === 'Active'
                        ? 'bg-success/15 text-success'
                        : 'bg-muted/15 text-muted'
                    }`}
                  >
                    {combo.status}
                  </button>
                </div>
                <p className="text-xs text-muted">
                  {combo.items.length} items &middot; {combo.locationKey}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-muted line-through text-xs">
                    {currency(combo.originalTotal)}
                  </span>
                  <span className="font-display text-xl font-bold text-accent">
                    {currency(combo.comboPrice)}
                  </span>
                  <span className="text-xs text-success">
                    -
                    {Math.round(
                      ((combo.originalTotal - combo.comboPrice) / combo.originalTotal) * 100,
                    )}
                    %
                  </span>
                </div>
                <div className="space-y-1 pt-1 border-t border-border/40">
                  {combo.items.map((item) => (
                    <div key={item.activityId} className="flex justify-between text-xs">
                      <span className="text-muted truncate mr-2">{item.itemName}</span>
                      <span className="text-text font-medium whitespace-nowrap">
                        {currency(item.adjustedPrice)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(combo)}
                    className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs flex-1"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(combo.id)}
                    className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ComboBuilder

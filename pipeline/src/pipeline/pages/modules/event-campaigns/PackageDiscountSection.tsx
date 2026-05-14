import type {
  EventPackageDiscount,
  EventPackageDiscountType,
} from '../../../features/event-campaigns/event-campaign-types'

interface Props {
  value: EventPackageDiscount | null
  onChange: (next: EventPackageDiscount | null) => void
}

const resolveType = (value: EventPackageDiscount | null): EventPackageDiscountType => {
  if (!value) return 'none'
  return value.type
}

const clampPercent = (n: number): number => Math.min(100, Math.max(0, Math.round(n)))
const clampNonNeg = (n: number): number => Math.max(0, Math.round(n))
const clampBuy = (n: number): number => Math.max(1, Math.floor(n))
const clampGet = (n: number): number => Math.max(0, Math.floor(n))

const PackageDiscountSection = ({ value, onChange }: Props) => {
  const type = resolveType(value)

  const setType = (next: EventPackageDiscountType) => {
    if (next === 'none') {
      onChange(null)
      return
    }
    if (next === 'flat') {
      onChange({ type: 'flat', flatMode: 'percentage', flatValue: 0 })
      return
    }
    onChange({ type: 'buy_x_get_y', buyCount: 2, getCount: 1 })
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Discount Type</h3>
      <p className="mt-1 text-xs text-muted">
        Choose how packages are discounted at sale time. Applies across the selected packages from
        this campaign.
      </p>

      <div className="mt-4 flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
          <input
            type="radio"
            name="package-discount-type"
            checked={type === 'none'}
            onChange={() => setType('none')}
          />
          None
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
          <input
            type="radio"
            name="package-discount-type"
            checked={type === 'flat'}
            onChange={() => setType('flat')}
          />
          Flat Discount
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
          <input
            type="radio"
            name="package-discount-type"
            checked={type === 'buy_x_get_y'}
            onChange={() => setType('buy_x_get_y')}
          />
          Buy X Get Y
        </label>
      </div>

      {value && type !== 'none' ? (
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={value.enabled !== false}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          <span>
            Offer enabled
            {value.enabled === false && (
              <span className="ml-2 rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                Paused
              </span>
            )}
          </span>
        </label>
      ) : null}

      {type === 'flat' && value?.type === 'flat' ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border/70 bg-panel/40 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Mode
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
              <input
                type="radio"
                name="package-discount-flat-mode"
                checked={value.flatMode !== 'fixed'}
                onChange={() => onChange({ ...value, flatMode: 'percentage' })}
              />
              Percentage
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-text">
              <input
                type="radio"
                name="package-discount-flat-mode"
                checked={value.flatMode === 'fixed'}
                onChange={() => onChange({ ...value, flatMode: 'fixed' })}
              />
              Fixed (₹)
            </label>
          </div>
          <div>
            <label
              htmlFor="package-discount-flat-value"
              className="mb-1 block text-xs font-semibold text-muted"
            >
              Value {value.flatMode === 'fixed' ? '(₹)' : '(%)'}
            </label>
            <input
              id="package-discount-flat-value"
              type="number"
              min="0"
              step="1"
              value={value.flatValue ?? 0}
              onChange={(e) => {
                const raw = Number(e.target.value) || 0
                const next = value.flatMode === 'fixed' ? clampNonNeg(raw) : clampPercent(raw)
                onChange({ ...value, flatValue: next })
              }}
              className="ui-field min-h-9 w-32 px-2 text-sm"
            />
          </div>
        </div>
      ) : null}

      {type === 'buy_x_get_y' && value?.type === 'buy_x_get_y' ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border/70 bg-panel/40 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor="package-discount-buy-count"
                className="mb-1 block text-xs font-semibold text-muted"
              >
                Buy Count
              </label>
              <input
                id="package-discount-buy-count"
                type="number"
                min="1"
                step="1"
                value={value.buyCount ?? 2}
                onChange={(e) =>
                  onChange({ ...value, buyCount: clampBuy(Number(e.target.value) || 0) })
                }
                className="ui-field min-h-9 w-full px-2 text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="package-discount-get-count"
                className="mb-1 block text-xs font-semibold text-muted"
              >
                Get Count
              </label>
              <input
                id="package-discount-get-count"
                type="number"
                min="0"
                step="1"
                value={value.getCount ?? 1}
                onChange={(e) =>
                  onChange({ ...value, getCount: clampGet(Number(e.target.value) || 0) })
                }
                className="ui-field min-h-9 w-full px-2 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted">
            When the customer selects {(value.buyCount ?? 2) + (value.getCount ?? 1)} of the
            <em className="not-italic"> same </em>package, {value.getCount ?? 1} become free. Mixing
            different packages does not qualify — each package is counted on its own. Scales with
            multiples.
          </p>
        </div>
      ) : null}
    </section>
  )
}

export default PackageDiscountSection

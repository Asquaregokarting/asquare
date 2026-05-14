import { Plus, Trash2 } from 'lucide-react'
import type { VariantDraft, VariantMetric } from './activity-draft-utils'
import { METRIC_LABELS } from './activity-draft-utils'

interface VariantTableEditorProps {
  variants: VariantDraft[]
  onUpdate: (variantKey: string, updater: (v: VariantDraft) => VariantDraft) => void
  onDelete: (variantKey: string, variantLabel: string) => void
  onAdd: () => void
  disabled: boolean
  isCompanyGame?: boolean
}

const METRIC_OPTIONS: { value: VariantMetric; label: string }[] = [
  { value: 'duration', label: 'Duration' },
  { value: 'laps', label: 'Laps' },
  { value: 'bullets', label: 'Bullets' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'rounds', label: 'Rounds' },
  { value: 'balls', label: 'Balls' },
  { value: 'shots', label: 'Shots' },
]

export const VariantTableEditor = ({
  variants,
  onUpdate,
  onDelete,
  onAdd,
  disabled,
  isCompanyGame,
}: VariantTableEditorProps) => {
  if (variants.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-border/60 bg-surface/30 px-4 py-6 text-center">
          <p className="text-sm text-muted">No variants yet</p>
          <p className="mt-1 text-xs text-muted/60">Add a variant to define pricing and metrics.</p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border/50 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Variant
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-border/50 sm:block">
        <table className="min-w-full divide-y divide-border/40 text-sm">
          <thead className="bg-surface/40">
            <tr>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Label
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Price (₹)
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Metric
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Value
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Active
              </th>
              {isCompanyGame && (
                <>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Normal POS
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Protocol
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Offers
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Booking
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Offer Price (₹)
                  </th>
                </>
              )}
              <th
                className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
                title="Print one token per quantity instead of a single aggregated token"
              >
                Indiv. Tokens
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Notes
              </th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {variants.map((variant) => {
              const priceNum = Number(variant.price)
              const metricNum = Number(variant.metricValue)
              const priceWarn = !variant.label.trim()
                ? false
                : !Number.isFinite(priceNum) || priceNum <= 0
              const metricWarn = !variant.label.trim()
                ? false
                : !Number.isFinite(metricNum) || metricNum <= 0

              return (
                <tr key={variant.key} className="transition-colors hover:bg-surface/30">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={variant.label}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({ ...v, label: e.target.value }))
                      }
                      disabled={disabled}
                      placeholder="Label"
                      className="ui-field min-h-8 w-full min-w-[100px] px-2 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={variant.price}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({ ...v, price: e.target.value }))
                      }
                      disabled={disabled}
                      placeholder="0"
                      className={`ui-field min-h-8 w-full min-w-[80px] px-2 text-sm ${priceWarn ? 'ring-1 ring-warning/40' : ''}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={variant.metricType}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({
                          ...v,
                          metricType: e.target.value as VariantMetric,
                        }))
                      }
                      disabled={disabled}
                      className="ui-field min-h-8 w-full min-w-[90px] px-2 text-sm"
                    >
                      {METRIC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={variant.metricValue}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({
                          ...v,
                          metricValue: e.target.value,
                        }))
                      }
                      disabled={disabled}
                      placeholder={METRIC_LABELS[variant.metricType] ?? 'Value'}
                      className={`ui-field min-h-8 w-full min-w-[70px] px-2 text-sm ${metricWarn ? 'ring-1 ring-warning/40' : ''}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={variant.active}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({
                          ...v,
                          active: e.target.checked,
                        }))
                      }
                      disabled={disabled}
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  </td>
                  {isCompanyGame && (
                    <>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={variant.visibleInPOS}
                          onChange={(e) =>
                            onUpdate(variant.key, (v) => ({ ...v, visibleInPOS: e.target.checked }))
                          }
                          disabled={disabled}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={variant.visibleInProtocol}
                          onChange={(e) =>
                            onUpdate(variant.key, (v) => ({
                              ...v,
                              visibleInProtocol: e.target.checked,
                            }))
                          }
                          disabled={disabled}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={variant.visibleInOffers}
                          onChange={(e) =>
                            onUpdate(variant.key, (v) => ({
                              ...v,
                              visibleInOffers: e.target.checked,
                              offerPrice: e.target.checked ? v.offerPrice : '',
                            }))
                          }
                          disabled={disabled}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={variant.visibleInBooking}
                          onChange={(e) =>
                            onUpdate(variant.key, (v) => ({
                              ...v,
                              visibleInBooking: e.target.checked,
                            }))
                          }
                          disabled={disabled}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {variant.visibleInOffers ? (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={variant.offerPrice}
                            onChange={(e) =>
                              onUpdate(variant.key, (v) => ({ ...v, offerPrice: e.target.value }))
                            }
                            disabled={disabled}
                            placeholder="0"
                            className={`ui-field min-h-8 w-full min-w-[80px] px-2 text-sm ${
                              !Number.isFinite(Number(variant.offerPrice)) ||
                              Number(variant.offerPrice) <= 0
                                ? 'ring-1 ring-warning/40'
                                : ''
                            }`}
                          />
                        ) : (
                          <span className="text-xs text-muted/40 px-2">—</span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={variant.printIndividualTokens}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({
                          ...v,
                          printIndividualTokens: e.target.checked,
                        }))
                      }
                      disabled={disabled}
                      className="h-4 w-4 cursor-pointer rounded border-border"
                      title="Print one token per quantity instead of a single aggregated token"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      value={variant.notes}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({ ...v, notes: e.target.value }))
                      }
                      disabled={disabled}
                      placeholder="Notes"
                      className="ui-field min-h-8 w-full min-w-[80px] px-2 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => onDelete(variant.key, variant.label || 'this variant')}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-critical/10 hover:text-critical"
                        title="Delete variant"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {variants.map((variant) => (
          <div
            key={variant.key}
            className="rounded-xl border border-border/40 bg-surface/30 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={variant.label}
                onChange={(e) => onUpdate(variant.key, (v) => ({ ...v, label: e.target.value }))}
                disabled={disabled}
                placeholder="Variant label"
                className="ui-field min-h-8 flex-1 px-2 text-sm font-medium"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onDelete(variant.key, variant.label || 'this variant')}
                  className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:text-critical"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Price
                </label>
                <input
                  type="number"
                  min="0"
                  value={variant.price}
                  onChange={(e) => onUpdate(variant.key, (v) => ({ ...v, price: e.target.value }))}
                  disabled={disabled}
                  className="ui-field mt-1 min-h-8 w-full px-2 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {METRIC_LABELS[variant.metricType] ?? 'Value'}
                </label>
                <input
                  type="number"
                  min="1"
                  value={variant.metricValue}
                  onChange={(e) =>
                    onUpdate(variant.key, (v) => ({
                      ...v,
                      metricValue: e.target.value,
                    }))
                  }
                  disabled={disabled}
                  className="ui-field mt-1 min-h-8 w-full px-2 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={variant.metricType}
                onChange={(e) =>
                  onUpdate(variant.key, (v) => ({
                    ...v,
                    metricType: e.target.value as VariantMetric,
                  }))
                }
                disabled={disabled}
                className="ui-field min-h-8 flex-1 px-2 text-sm"
              >
                {METRIC_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-text">
                <input
                  type="checkbox"
                  checked={variant.active}
                  onChange={(e) =>
                    onUpdate(variant.key, (v) => ({
                      ...v,
                      active: e.target.checked,
                    }))
                  }
                  disabled={disabled}
                  className="h-4 w-4 rounded border-border"
                />
                Active
              </label>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-text">
              <input
                type="checkbox"
                checked={variant.printIndividualTokens}
                onChange={(e) =>
                  onUpdate(variant.key, (v) => ({
                    ...v,
                    printIndividualTokens: e.target.checked,
                  }))
                }
                disabled={disabled}
                className="h-4 w-4 rounded border-border"
              />
              Print individual tokens
            </label>
            {isCompanyGame && (
              <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/20">
                <label className="flex items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={variant.visibleInPOS}
                    onChange={(e) =>
                      onUpdate(variant.key, (v) => ({ ...v, visibleInPOS: e.target.checked }))
                    }
                    disabled={disabled}
                    className="h-4 w-4 rounded border-border"
                  />
                  Normal POS
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={variant.visibleInProtocol}
                    onChange={(e) =>
                      onUpdate(variant.key, (v) => ({ ...v, visibleInProtocol: e.target.checked }))
                    }
                    disabled={disabled}
                    className="h-4 w-4 rounded border-border"
                  />
                  Protocol
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={variant.visibleInOffers}
                    onChange={(e) =>
                      onUpdate(variant.key, (v) => ({
                        ...v,
                        visibleInOffers: e.target.checked,
                        offerPrice: e.target.checked ? v.offerPrice : '',
                      }))
                    }
                    disabled={disabled}
                    className="h-4 w-4 rounded border-border"
                  />
                  Offers
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={variant.visibleInBooking}
                    onChange={(e) =>
                      onUpdate(variant.key, (v) => ({ ...v, visibleInBooking: e.target.checked }))
                    }
                    disabled={disabled}
                    className="h-4 w-4 rounded border-border"
                  />
                  Booking
                </label>
                {variant.visibleInOffers && (
                  <div className="w-full">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Offer Price
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={variant.offerPrice}
                      onChange={(e) =>
                        onUpdate(variant.key, (v) => ({ ...v, offerPrice: e.target.value }))
                      }
                      disabled={disabled}
                      className="ui-field mt-1 min-h-8 w-full px-2 text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add variant */}
      {!disabled && (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border/50 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Variant
        </button>
      )}
    </div>
  )
}

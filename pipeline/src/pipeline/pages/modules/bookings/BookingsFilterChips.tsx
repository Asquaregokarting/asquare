import { useState } from 'react'

interface Props {
  // Booking-status chip filter (single-select; 'all' = no filter).
  statusFilter: string
  setStatusFilter: (v: string) => void
  // Payment-status chip filter (single-select; 'all' = no filter).
  paymentStatusFilter: string
  setPaymentStatusFilter: (v: string) => void
  // Events-only toggle (event campaigns).
  eventsOnly: boolean
  setEventsOnly: (next: boolean) => void
  // Advanced filters (open in disclosure).
  gameFilter: string
  setGameFilter: (v: string) => void
  uniqueGames: string[]
  paymentMethodFilter: string
  setPaymentMethodFilter: (v: string) => void
  uniquePaymentMethods: string[]
  initiatedByFilter: string
  setInitiatedByFilter: (v: string) => void
  uniqueInitiators: string[]
  checkInFilter: string
  setCheckInFilter: (v: string) => void
  amountMin: string
  setAmountMin: (v: string) => void
  amountMax: string
  setAmountMax: (v: string) => void
  onClear: () => void
}

interface ChipOption {
  value: string
  label: string
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info'
}

/**
 * Toggleable filter chip group. The "All" pseudo-value clears the filter
 * back to no selection. Active chip uses the per-tone color treatment so
 * a Failed-only filter is visually red, Refunded-only is info-blue, etc.
 * Inactive chips stay quiet so the active selection reads as the loud
 * signal (matches PRODUCT.md "discrepancy is the loudest signal").
 */
const ChipRow = ({
  options,
  active,
  onChange,
  ariaLabel,
}: {
  options: ChipOption[]
  active: string
  onChange: (v: string) => void
  ariaLabel: string
}) => (
  <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-1.5">
    {options.map((opt) => {
      const isActive = active === opt.value
      const toneClass = !isActive
        ? 'border-border/55 bg-panel text-muted hover:text-text hover:border-border'
        : opt.tone === 'critical'
          ? 'border-critical/55 bg-critical/12 text-critical'
          : opt.tone === 'warning'
            ? 'border-warning/55 bg-warning/12 text-warning'
            : opt.tone === 'success'
              ? 'border-success/55 bg-success/12 text-success'
              : opt.tone === 'info'
                ? 'border-info/55 bg-info/12 text-info'
                : 'border-accent/55 bg-accent/12 text-accent'
      return (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={isActive}
          onClick={() => onChange(opt.value)}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors ${toneClass}`}
        >
          {opt.label}
        </button>
      )
    })}
  </div>
)

const STATUS_OPTIONS: ChipOption[] = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed', tone: 'success' },
  { value: 'pending', label: 'Pending', tone: 'warning' },
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
]

const PAYMENT_OPTIONS: ChipOption[] = [
  { value: 'all', label: 'Any payment' },
  { value: 'pending', label: 'Pending', tone: 'warning' },
  { value: 'completed', label: 'Paid', tone: 'success' },
  { value: 'failed', label: 'Failed', tone: 'critical' },
  { value: 'refunded', label: 'Refunded', tone: 'info' },
  { value: 'disputed', label: 'Disputed', tone: 'warning' },
]

export const BookingsFilterChips = ({
  statusFilter,
  setStatusFilter,
  paymentStatusFilter,
  setPaymentStatusFilter,
  eventsOnly,
  setEventsOnly,
  gameFilter,
  setGameFilter,
  uniqueGames,
  paymentMethodFilter,
  setPaymentMethodFilter,
  uniquePaymentMethods,
  initiatedByFilter,
  setInitiatedByFilter,
  uniqueInitiators,
  checkInFilter,
  setCheckInFilter,
  amountMin,
  setAmountMin,
  amountMax,
  setAmountMax,
  onClear,
}: Props) => {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const advancedActiveCount =
    Number(gameFilter !== 'all') +
    Number(paymentMethodFilter !== 'all') +
    Number(initiatedByFilter !== 'all') +
    Number(checkInFilter !== 'all') +
    Number(amountMin.trim() !== '') +
    Number(amountMax.trim() !== '')

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ChipRow
          options={STATUS_OPTIONS}
          active={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Booking status filter"
        />
        <span aria-hidden className="hidden h-4 w-px bg-border/60 sm:inline-block" />
        <ChipRow
          options={PAYMENT_OPTIONS}
          active={paymentStatusFilter}
          onChange={setPaymentStatusFilter}
          ariaLabel="Payment status filter"
        />
        <span aria-hidden className="hidden h-4 w-px bg-border/60 sm:inline-block" />
        <button
          type="button"
          role="switch"
          aria-checked={eventsOnly}
          onClick={() => setEventsOnly(!eventsOnly)}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors ${
            eventsOnly
              ? 'border-accent/55 bg-accent/12 text-accent'
              : 'border-border/55 bg-panel text-muted hover:text-text hover:border-border'
          }`}
        >
          {eventsOnly ? 'Events only ✓' : 'Events only'}
        </button>
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted hover:text-text"
        >
          Advanced{advancedActiveCount > 0 && ` (${advancedActiveCount})`}
          <span
            aria-hidden
            className={`transition-transform duration-150 ${advancedOpen ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
      </div>

      {/* Advanced disclosure — animated via opacity + translateY (NOT
          height; animating layout properties is banned). When closed the
          panel is hidden via display:none so it doesn't catch tab focus. */}
      <div
        className={`grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6 ${
          advancedOpen ? 'opacity-100' : 'pointer-events-none hidden opacity-0'
        }`}
      >
        <select
          value={gameFilter}
          onChange={(e) => setGameFilter(e.target.value)}
          aria-label="Filter by game"
          className="ui-field min-h-9 text-xs"
        >
          <option value="all">All games</option>
          {uniqueGames.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={paymentMethodFilter}
          onChange={(e) => setPaymentMethodFilter(e.target.value)}
          aria-label="Filter by payment method"
          className="ui-field min-h-9 text-xs"
        >
          <option value="all">All methods</option>
          {uniquePaymentMethods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={initiatedByFilter}
          onChange={(e) => setInitiatedByFilter(e.target.value)}
          aria-label="Filter by initiator"
          className="ui-field min-h-9 text-xs"
        >
          <option value="all">All initiators</option>
          {uniqueInitiators.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={checkInFilter}
          onChange={(e) => setCheckInFilter(e.target.value)}
          aria-label="Filter by check-in"
          className="ui-field min-h-9 text-xs"
        >
          <option value="all">Any check-in</option>
          <option value="pending">Pending</option>
          <option value="completed">Checked-in</option>
          <option value="boarded">Boarded</option>
        </select>
        <input
          type="number"
          inputMode="numeric"
          value={amountMin}
          onChange={(e) => setAmountMin(e.target.value)}
          placeholder="Min ₹"
          aria-label="Minimum amount"
          className="ui-field min-h-9 text-xs tabular-nums"
        />
        <input
          type="number"
          inputMode="numeric"
          value={amountMax}
          onChange={(e) => setAmountMax(e.target.value)}
          placeholder="Max ₹"
          aria-label="Maximum amount"
          className="ui-field min-h-9 text-xs tabular-nums"
        />
        <button
          type="button"
          onClick={onClear}
          className="col-span-1 sm:col-span-3 lg:col-span-6 inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[11px] uppercase tracking-[0.08em] text-muted hover:text-critical"
        >
          Clear all filters
        </button>
      </div>
    </div>
  )
}

export default BookingsFilterChips

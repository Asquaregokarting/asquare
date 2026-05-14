import { useMemo, useState } from 'react'
import { Phone } from 'lucide-react'
import { useCouponOutreachInbox } from '../../../features/coupon-outreach/useCouponOutreachInbox'
import {
  computeKpis,
  formatRupees,
  relativeDateLabel,
  sortInboxItems,
} from '../../../features/coupon-outreach/coupon-outreach-utils'
import type {
  CouponOutreachItem,
  CouponOutreachStatus,
  CustomerValueTier,
} from '../../../api/coupon-outreach'
import CouponMemberDetailSlideOver from './CouponMemberDetailSlideOver'

const STATUS_FILTERS: { value: CouponOutreachStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
]

const TIER_FILTERS: { value: CustomerValueTier | ''; label: string }[] = [
  { value: '', label: 'All Tiers' },
  { value: 'high', label: 'High Value' },
  { value: 'mid', label: 'Mid Value' },
  { value: 'low', label: 'Low Value' },
]

const TIER_PILL: Record<CustomerValueTier, string> = {
  high: 'border-warning/40 bg-warning/15 text-warning',
  mid: 'border-info/40 bg-info/15 text-info',
  low: 'border-muted/40 bg-muted/15 text-muted',
}

const STATUS_PILL: Record<CouponOutreachStatus, string> = {
  pending: 'border-info/30 bg-info/10 text-info',
  contacted: 'border-warning/30 bg-warning/10 text-warning',
  done: 'border-success/30 bg-success/10 text-success',
  skipped: 'border-muted/30 bg-muted/15 text-muted',
}

const CouponOutreachInboxView = () => {
  const { batch, items, loading, error, busy, actionError, refresh, updateStatus } =
    useCouponOutreachInbox()

  const [statusFilter, setStatusFilter] = useState<CouponOutreachStatus | ''>('')
  const [tierFilter, setTierFilter] = useState<CustomerValueTier | ''>('')
  const [search, setSearch] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)

  const sorted = useMemo(() => sortInboxItems(items), [items])
  const filtered = useMemo(() => {
    return sorted.filter((it) => {
      if (statusFilter && it.status !== statusFilter) return false
      if (tierFilter && it.snapshot.customerValueTier !== tierFilter) return false
      if (search) {
        const needle = search.trim().toLowerCase()
        if (!it.name.toLowerCase().includes(needle) && !it.phone.includes(needle)) {
          return false
        }
      }
      return true
    })
  }, [sorted, statusFilter, tierFilter, search])

  const kpis = useMemo(() => computeKpis(items), [items])

  return (
    <div className="ui-section-stack">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-text">
            {kpis.pending}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Pending
          </p>
        </div>
        <div className="rounded-xl border border-warning/35 bg-warning/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-warning">
            {kpis.contacted}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">
            Contacted
          </p>
        </div>
        <div className="rounded-xl border border-success/35 bg-success/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-success">
            {kpis.done}
          </p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-success">
            Done
          </p>
        </div>
      </div>

      {/* Batch context line */}
      {batch ? (
        <p className="text-xs text-muted">
          Showing batch <span className="text-text">{batch.date}</span> · Total assigned to you:{' '}
          {items.length}
        </p>
      ) : null}

      {/* Filters */}
      <div className="ui-toolbar grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CouponOutreachStatus | '')}
          className="ui-field min-h-9 text-xs"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as CustomerValueTier | '')}
          className="ui-field min-h-9 text-xs"
          aria-label="Filter by value tier"
        >
          {TIER_FILTERS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ui-field min-h-9 text-xs col-span-2 sm:col-span-1"
        />
        <button
          type="button"
          onClick={() => void refresh()}
          className="ui-btn ui-btn-neutral min-h-9 text-xs"
        >
          Refresh
        </button>
      </div>

      {/* Errors */}
      {error ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {actionError}
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading your call list…</div>
      ) : !batch ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
          No outreach batch has been generated yet today. Check back after 10:30 AM.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface/80 px-5 py-10 text-center text-sm text-muted">
          No members match the current filters.
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-panel shadow-sm overflow-hidden">
          <div className="divide-y divide-border/30">
            {filtered.map((item) => (
              <CouponRow
                key={item.phone}
                item={item}
                onSelect={() => setSelectedPhone(item.phone)}
              />
            ))}
          </div>
        </div>
      )}

      {selectedPhone && batch ? (
        <CouponMemberDetailSlideOver
          dateStr={batch.date}
          phone={selectedPhone}
          busy={busy}
          actionError={actionError}
          onClose={() => setSelectedPhone(null)}
          onUpdateStatus={async (phone, status, note) => {
            await updateStatus(phone, status, note)
          }}
        />
      ) : null}
    </div>
  )
}

const CouponRow = ({ item, onSelect }: { item: CouponOutreachItem; onSelect: () => void }) => {
  const tier = item.snapshot.customerValueTier
  return (
    <div className="px-3 py-3 sm:px-4 hover:bg-surface/60 transition">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm text-text truncate">
              {item.name || 'Customer'}
            </span>
            <span className={`ui-pill border px-1.5 py-0.5 text-[10px] ${TIER_PILL[tier]}`}>
              {tier.toUpperCase()}
            </span>
            <span
              className={`ui-pill border px-1.5 py-0.5 text-[10px] ${STATUS_PILL[item.status]}`}
            >
              {item.status}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>{item.phone}</span>
            <span>{item.snapshot.coupons150Available} ₹150 coupons</span>
            <span>{formatRupees(item.snapshot.totalBillAmount)} spend</span>
            <span>{item.snapshot.totalVisits} visits</span>
            <span>Last visit {relativeDateLabel(item.snapshot.lastVisitDate)}</span>
          </div>
        </div>
        <a
          href={`tel:${item.phone}`}
          className="shrink-0 rounded-lg border border-info/30 bg-info/10 p-2 text-info hover:bg-info/20 transition"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Call ${item.name || item.phone}`}
        >
          <Phone size={14} />
        </a>
      </div>
    </div>
  )
}

export default CouponOutreachInboxView

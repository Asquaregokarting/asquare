import { useState } from 'react'
import { X, Phone, Mail, MapPin, Award, Tag } from 'lucide-react'
import { useCouponMemberDetail } from '../../../features/coupon-outreach/useCouponMemberDetail'
import {
  formatRupees,
  relativeDateLabel,
} from '../../../features/coupon-outreach/coupon-outreach-utils'
import type { CouponOutreachStatus, CustomerValueTier } from '../../../api/coupon-outreach'
import { MetricStrip } from '../../../components/ui/MetricStrip'

interface Props {
  dateStr: string
  phone: string
  busy: boolean
  actionError?: string | null
  onClose: () => void
  onUpdateStatus: (
    phone: string,
    status: CouponOutreachStatus,
    note?: string,
  ) => Promise<void> | void
}

const TIER_BADGE: Record<CustomerValueTier, string> = {
  high: 'border-warning/40 bg-warning/15 text-warning',
  mid: 'border-info/40 bg-info/15 text-info',
  low: 'border-muted/40 bg-muted/15 text-muted',
}

const TIER_LABEL: Record<CustomerValueTier, string> = {
  high: 'High Value',
  mid: 'Mid Value',
  low: 'Low Value',
}

const CouponMemberDetailSlideOver = ({
  dateStr,
  phone,
  busy,
  actionError,
  onClose,
  onUpdateStatus,
}: Props) => {
  const { item, loading, error } = useCouponMemberDetail(dateStr, phone)
  const [note, setNote] = useState('')

  if (loading && !item) {
    return (
      <>
        <div
          className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l border-border/70 bg-panel shadow-panel">
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Loading member details…
          </div>
        </div>
      </>
    )
  }

  if (error || !item) {
    return (
      <>
        <div
          className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border/70 bg-panel shadow-panel">
          <div className="flex items-center justify-between border-b border-border/45 px-4 py-3">
            <h2 className="text-lg font-semibold text-text">Member</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-text transition"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
            {error ?? "Member not found in today's batch."}
          </div>
        </div>
      </>
    )
  }

  const tier = item.snapshot.customerValueTier

  const metrics = [
    {
      id: 'coupons',
      label: '₹150 Coupons Available',
      value: String(item.snapshot.coupons150Available),
    },
    {
      id: 'visits',
      label: 'Total Visits',
      value: String(item.snapshot.totalVisits),
    },
    {
      id: 'spend',
      label: 'Total Spend',
      value: formatRupees(item.snapshot.totalBillAmount),
    },
    {
      id: 'lastVisit',
      label: 'Last Visit',
      value: relativeDateLabel(item.snapshot.lastVisitDate),
    },
  ]

  const handleAction = (status: CouponOutreachStatus) => {
    void onUpdateStatus(item.phone, status, note.trim() || undefined)
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-base/65 backdrop-blur-sm sm:hidden" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border/70 bg-panel shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/45 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-text">{item.name || 'Customer'}</h2>
            <p className="text-xs text-muted">{item.phone}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted transition hover:text-text"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Tier + status */}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <span className={`ui-pill border px-2 py-0.5 text-xs ${TIER_BADGE[tier]}`}>
              {TIER_LABEL[tier]}
            </span>
            <span className="ui-pill border-muted/30 bg-muted/15 text-muted px-2 py-0.5 text-xs">
              {item.status}
            </span>
            {item.snapshot.membership ? (
              <span className="ui-pill border-info/30 bg-info/10 text-info px-2 py-0.5 text-xs">
                {item.snapshot.membership}
              </span>
            ) : null}
          </div>

          {/* Metric strip */}
          <div className="px-4 py-3">
            <MetricStrip items={metrics} />
          </div>

          {/* Customer value breakdown */}
          <div className="space-y-2 border-t border-border/40 px-4 py-3 text-sm">
            {item.email ? (
              <div className="flex items-center gap-2 text-muted">
                <Mail size={14} />
                <span className="text-text">{item.email}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-muted">
              <Phone size={14} />
              <a href={`tel:${item.phone}`} className="text-info hover:underline">
                {item.phone}
              </a>
            </div>
            {item.snapshot.lastVisitLocation ? (
              <div className="flex items-center gap-2 text-muted">
                <MapPin size={14} />
                <span className="text-text">Last seen at {item.snapshot.lastVisitLocation}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-muted">
              <Award size={14} />
              <span className="text-text">
                {item.snapshot.coupons150Redeemed} redeemed · {item.snapshot.coupons150Available}{' '}
                unused
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted">
              <Tag size={14} />
              <span className="text-text">Star status {item.snapshot.starStatus}</span>
            </div>
          </div>

          {/* Coupon breakdown panel */}
          <div className="mx-4 mb-3 rounded-lg border border-border/50 bg-surface/40 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              ₹150 Coupons
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-display text-2xl font-semibold text-text">
                  {Math.floor(item.snapshot.totalBillAmount / 600)}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">Earned</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold text-text">
                  {item.snapshot.coupons150Redeemed}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">Redeemed</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold text-success">
                  {item.snapshot.coupons150Available}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">Available</p>
              </div>
            </div>
          </div>

          {/* Action area */}
          {actionError ? (
            <div className="mx-4 mb-2 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              {actionError}
            </div>
          ) : null}

          <div className="border-t border-border/40 px-4 py-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Outcome
            </h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)"
              rows={3}
              className="ui-field w-full text-sm"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={`tel:${item.phone}`}
                className="ui-btn ui-btn-info flex items-center justify-center gap-1 text-xs"
              >
                <Phone size={14} /> Call
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleAction('contacted')}
                className="ui-btn ui-btn-neutral text-xs"
              >
                Mark Contacted
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleAction('done')}
                className="ui-btn ui-btn-primary text-xs"
              >
                Mark Done
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleAction('skipped')}
                className="ui-btn ui-btn-neutral text-xs"
              >
                Skip
              </button>
            </div>
          </div>

          {/* Reassignment metadata */}
          {item.reassignedAt ? (
            <div className="border-t border-border/40 px-4 py-3 text-xs text-muted">
              Reassigned {relativeDateLabel(item.reassignedAt)}
              {item.reassignedReason ? ` · ${item.reassignedReason}` : ''}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

export default CouponMemberDetailSlideOver

import { useEffect, useMemo, useState } from 'react'
import type { VendorLedgerEntry, VendorInvoice } from '../../api/types'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { logger } from '../../../lib/logger'

type ReasonKey =
  | 'counted'
  | 'in_locked_invoice'
  | 'excluded_cancelled'
  | 'excluded_full_refund'
  | 'excluded_payment_pending'
  | 'orphan_no_booking'
  | 'pending_regen'

const REASON_LABEL: Record<ReasonKey, string> = {
  counted: 'In a pending invoice',
  in_locked_invoice: 'In a locked invoice (already paid out)',
  excluded_cancelled: 'Excluded — booking cancelled',
  excluded_full_refund: 'Excluded — booking refunded in full',
  excluded_payment_pending: 'Excluded — payment not completed',
  orphan_no_booking: 'Orphan — booking missing (regen will clean up)',
  pending_regen: 'No invoice yet — regen needed',
}

const REASON_TONE: Record<ReasonKey, string> = {
  counted: 'text-success',
  in_locked_invoice: 'text-info',
  excluded_cancelled: 'text-warning',
  excluded_full_refund: 'text-warning',
  excluded_payment_pending: 'text-warning',
  orphan_no_booking: 'text-critical',
  pending_regen: 'text-warning',
}

interface BookingMeta {
  paymentStatus: string
  cancelled: boolean
  bookingStatus: string
  refundStatus: string
}

const dayOf = (raw: string | undefined): string => (raw ? String(raw).slice(0, 10) : '')

const findInvoiceFor = (
  invoices: VendorInvoice[],
  vendorId: string,
  dateDay: string,
): VendorInvoice | undefined =>
  invoices.find(
    (i) => i.vendorId === vendorId && i.periodStart <= dateDay && i.periodEnd >= dateDay,
  )

const useBookingMeta = (
  refIds: string[],
): { metaMap: Map<string, BookingMeta>; loading: boolean } => {
  const [metaMap, setMetaMap] = useState<Map<string, BookingMeta>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!db || refIds.length === 0) {
      setMetaMap(new Map())
      return
    }
    setLoading(true)
    const next = new Map<string, BookingMeta>()

    // Cap to bound Firestore reads. The 500 cap is the same one used by
    // `audit-ledger-invoice-gap.cjs` for parity with the script.
    const idsToFetch = refIds.slice(0, 500)

    const run = async () => {
      try {
        // Chunked `where(documentId(), 'in', chunk)` queries — Firestore
        // limits `in` to 30 elements per query.
        for (let i = 0; i < idsToFetch.length; i += 30) {
          const chunk = idsToFetch.slice(i, i + 30)
          const q = query(collection(db!, 'billingTransactions'), where(documentId(), 'in', chunk))
          const snap = await getDocs(q)
          snap.forEach((d) => {
            const data = d.data() as Record<string, unknown>
            next.set(d.id, {
              paymentStatus: String(data.paymentStatus ?? ''),
              cancelled: data.cancelled === true,
              bookingStatus: String(data.bookingStatus ?? ''),
              refundStatus: String(data.refundStatus ?? ''),
            })
          })
        }
        if (!cancelled) setMetaMap(next)
      } catch (err) {
        logger.error('ledger_reconciliation_panel.booking_meta_failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refIds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  return { metaMap, loading }
}

interface Props {
  entries: VendorLedgerEntry[]
  vendorInvoices: VendorInvoice[]
  /** Used to format currency the same way the rest of the page does. */
  currency: (n: number) => string
}

export const LedgerReconciliationPanel = ({ entries, vendorInvoices, currency }: Props) => {
  const credits = useMemo(() => entries.filter((e) => e.type === 'credit'), [entries])

  const refIds = useMemo(() => {
    const set = new Set<string>()
    for (const c of credits) {
      if (c.referenceId) set.add(c.referenceId)
    }
    return [...set]
  }, [credits])

  const { metaMap, loading } = useBookingMeta(refIds)

  const buckets = useMemo(() => {
    const result: Record<ReasonKey, { count: number; amount: number }> = {
      counted: { count: 0, amount: 0 },
      in_locked_invoice: { count: 0, amount: 0 },
      excluded_cancelled: { count: 0, amount: 0 },
      excluded_full_refund: { count: 0, amount: 0 },
      excluded_payment_pending: { count: 0, amount: 0 },
      orphan_no_booking: { count: 0, amount: 0 },
      pending_regen: { count: 0, amount: 0 },
    }

    for (const c of credits) {
      const dateDay = dayOf(c.date)
      const refId = c.referenceId

      let reason: ReasonKey

      if (refId) {
        const meta = metaMap.get(refId)
        if (refIds.length > 0 && metaMap.size === 0 && loading) {
          // While loading, treat unresolved as counted to avoid alarming flicker.
          reason = 'counted'
        } else if (!meta) {
          reason = 'orphan_no_booking'
        } else if (meta.paymentStatus !== 'completed') {
          reason = 'excluded_payment_pending'
        } else if (meta.refundStatus === 'Full') {
          reason = 'excluded_full_refund'
        } else if (meta.cancelled || meta.bookingStatus === 'cancelled') {
          reason = 'excluded_cancelled'
        } else {
          const inv = findInvoiceFor(vendorInvoices, c.vendorId, dateDay)
          reason = !inv
            ? 'pending_regen'
            : inv.status === 'locked'
              ? 'in_locked_invoice'
              : 'counted'
        }
      } else {
        const inv = findInvoiceFor(vendorInvoices, c.vendorId, dateDay)
        reason = !inv ? 'pending_regen' : inv.status === 'locked' ? 'in_locked_invoice' : 'counted'
      }

      result[reason].count++
      result[reason].amount += c.amount
    }

    return result
  }, [credits, metaMap, vendorInvoices, refIds.length, loading])

  const grossCredits = credits.reduce((s, c) => s + c.amount, 0)

  // Hide the panel entirely on empty windows so it doesn't clutter the page.
  if (credits.length === 0) return null

  return (
    <section
      aria-label="Ledger to invoice reconciliation"
      className="mb-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <header className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">Ledger ↔ Invoice reconciliation</h3>
          <p className="text-xs text-muted">
            Where each credit in this window is being routed. Reach zero in every "Excluded" /
            "Orphan" / "No invoice yet" row to make Ledger Net match Pending Settlement totals.
          </p>
        </div>
        <span className="text-xs text-muted">
          {loading ? 'Resolving bookings…' : `${refIds.length} bookings checked`}
        </span>
      </header>

      <ul className="divide-y divide-border/40 text-sm">
        {(Object.keys(REASON_LABEL) as ReasonKey[]).map((k) => {
          const b = buckets[k]
          if (b.count === 0) return null
          const pct = grossCredits > 0 ? (b.amount / grossCredits) * 100 : 0
          return (
            <li
              key={k}
              className="flex items-center justify-between gap-3 py-2"
              data-testid={`recon-row-${k}`}
            >
              <span className={`flex-1 truncate ${REASON_TONE[k]}`}>{REASON_LABEL[k]}</span>
              <span className="tabular-nums text-muted">{b.count} entries</span>
              <span className="w-24 text-right tabular-nums text-text">{currency(b.amount)}</span>
              <span className="w-12 text-right tabular-nums text-muted">{pct.toFixed(1)}%</span>
            </li>
          )
        })}
      </ul>

      <footer className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-sm">
        <span className="font-semibold text-text">Total credits in window</span>
        <span className="font-semibold tabular-nums text-text">{currency(grossCredits)}</span>
      </footer>
    </section>
  )
}

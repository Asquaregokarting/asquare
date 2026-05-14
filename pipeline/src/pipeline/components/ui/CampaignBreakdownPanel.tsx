import { useEffect, useMemo, useState } from 'react'
import type { TransactionRecord, VendorInvoice, VendorLedgerEntry } from '../../api/types'
import type { EventCampaignRecord } from '../../features/event-campaigns/event-campaign-types'
import {
  buildCampaignResolver,
  type CampaignResolver,
} from '../../features/event-campaigns/campaign-matching'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { logger } from '../../../lib/logger'

interface Props {
  /**
   * Either a list of vendor invoices (Invoices tab) — we'll walk their
   * `entries[]` — or a flat list of ledger entries (Settlements tab).
   * Pass whichever the host already has on hand.
   */
  invoices?: VendorInvoice[]
  ledgerEntries?: VendorLedgerEntry[]
  campaigns: EventCampaignRecord[]
  currency: (n: number) => string
  title?: string
  /**
   * Optional: pre-fetched transactions to avoid the targeted refetch. When
   * absent, the panel does its own chunked `where(documentId(), 'in', ...)`
   * query to resolve campaignId per booking.
   */
  transactions?: TransactionRecord[]
}

const flattenEntries = (
  invoices: VendorInvoice[] | undefined,
  ledgerEntries: VendorLedgerEntry[] | undefined,
): VendorLedgerEntry[] => {
  if (ledgerEntries && ledgerEntries.length > 0) return ledgerEntries
  if (invoices) {
    const out: VendorLedgerEntry[] = []
    for (const inv of invoices) for (const e of inv.entries ?? []) out.push(e)
    return out
  }
  return []
}

export const CampaignBreakdownPanel = ({
  invoices,
  ledgerEntries,
  campaigns,
  currency,
  title = 'Campaign breakdown',
  transactions,
}: Props) => {
  const entries = useMemo(() => flattenEntries(invoices, ledgerEntries), [invoices, ledgerEntries])

  const refIds = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.referenceId) set.add(e.referenceId)
    return [...set]
  }, [entries])

  // If transactions are provided, resolve campaignId via item-name token
  // matching against the EventCampaign config (no fetch). Otherwise fetch
  // each booking's items[] + gameId and apply the same matcher.
  const resolver: CampaignResolver = useMemo(() => buildCampaignResolver(campaigns), [campaigns])
  const [campaignByRef, setCampaignByRef] = useState<Map<string, string | undefined>>(
    () => new Map(),
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (transactions && transactions.length > 0) {
      const map = new Map<string, string | undefined>()
      const txnById = new Map(transactions.map((t) => [t.id, t]))
      for (const id of refIds) {
        const t = txnById.get(id)
        map.set(id, t ? resolver.fromTxn(t) : undefined)
      }
      setCampaignByRef(map)
      return
    }

    let cancelled = false
    if (!db || refIds.length === 0) {
      setCampaignByRef(new Map())
      return
    }
    setLoading(true)
    const next = new Map<string, string | undefined>()

    const run = async () => {
      try {
        const idsToFetch = refIds.slice(0, 500)
        for (let i = 0; i < idsToFetch.length; i += 30) {
          const chunk = idsToFetch.slice(i, i + 30)
          const q = query(collection(db!, 'billingTransactions'), where(documentId(), 'in', chunk))
          const snap = await getDocs(q)
          snap.forEach((d) => {
            const data = d.data() as Record<string, unknown>
            // Pass through the resolver — handles both the legacy
            // `gameId === event-{X}-pkg-...` pattern AND the modern
            // item-name token match against EventCampaign config.
            next.set(d.id, resolver.fromTxn(data as unknown as TransactionRecord))
          })
        }
        if (!cancelled) setCampaignByRef(next)
      } catch (err) {
        logger.error('campaign_breakdown_panel.fetch_failed', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refIds.join('|'), transactions, resolver]) // eslint-disable-line react-hooks/exhaustive-deps

  const breakdown = useMemo(() => {
    const map = new Map<string | undefined, { credit: number; debit: number }>()
    for (const e of entries) {
      const cid = e.referenceId ? campaignByRef.get(e.referenceId) : undefined
      const acc = map.get(cid) ?? { credit: 0, debit: 0 }
      if (e.type === 'credit') acc.credit += e.amount
      else acc.debit += e.amount
      map.set(cid, acc)
    }
    const titleById = new Map(campaigns.map((c) => [c.id, c.title]))
    type Row = {
      campaignId: string | undefined
      label: string
      credit: number
      debit: number
      net: number
    }
    const rows: Row[] = []
    for (const [cid, agg] of map.entries()) {
      rows.push({
        campaignId: cid,
        label: cid ? (titleById.get(cid) ?? cid) : 'Non-event',
        credit: agg.credit,
        debit: agg.debit,
        net: agg.credit - agg.debit,
      })
    }
    rows.sort((a, b) => b.net - a.net)
    return rows
  }, [entries, campaignByRef, campaigns])

  if (entries.length === 0) return null
  if (breakdown.length <= 1 && !loading) return null

  return (
    <section
      aria-label={title}
      className="mb-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <span className="text-xs text-muted">
          {loading ? 'Resolving bookings…' : 'Net = credits − debits'}
        </span>
      </header>
      <ul className="divide-y divide-border/40 text-sm">
        {breakdown.map((row) => (
          <li
            key={row.campaignId ?? '__non_event__'}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-2"
          >
            <span className={row.campaignId ? 'text-success' : 'text-text'}>{row.label}</span>
            <span className="tabular-nums text-muted">+{currency(row.credit)}</span>
            <span className="tabular-nums text-warning">−{currency(row.debit)}</span>
            <span className="tabular-nums font-semibold text-text">{currency(row.net)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

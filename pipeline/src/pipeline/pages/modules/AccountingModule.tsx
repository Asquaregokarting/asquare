import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { accountingApi } from '../../api/accounting'
import { ModalShell } from '../../components/ui/ModalShell'
import { StatusBadge } from '../../components/ui/StatusBadge'
import {
  generateFirestoreWeeklyInvoices,
  getPeriodEnd,
  getPeriodStart,
  lockFirestoreVendorInvoice,
  unlockFirestoreVendorInvoice,
  validateInvoiceBeforeLock,
  VendorSettlementSummary,
} from '../../api/accounting-firestore'
import {
  applyLedgerToBillingTruth,
  detectLedgerVsBillingDrift,
} from '../../api/reconciliation-firestore'
import {
  CompanyInvoice,
  LetterheadConfig,
  TransactionRecord,
  VendorDetailsRecord,
  VendorInvoice,
  VendorLedgerEntry,
} from '../../api/types'

// ─── Game label helpers ──────────────────────────────────────────────────────
// Derives a "game" label for a ledger entry by finding the originating
// billing transaction (via referenceId) and pulling the first segment of
// the relevant items' itemName ("category — subcategory — name" format).
const extractGameLabelFromItemName = (itemName: string | undefined): string => {
  if (!itemName) return ''
  const first = itemName.split(' — ')[0]?.trim()
  return first || itemName.trim()
}

// Resolves which billing items map to this ledger row's vendor.
//
// 1. Exact `vendorId` match — POS / standalone bookings.
// 2. Event-package fallback — these bookings carry no per-item vendorId on
//    `txn.items` (vendor attribution comes from `__eventPackage.items[]` on
//    the original booking, which we don't have here). For those cases we
//    pick a single representative item so Tickets/Variant don't sum across
//    every sub-game in the package (which is what produced the spurious 30s
//    on Summer Vibes rows).
//
// `representative` is true when we used the fallback — callers use it to
// switch from SUM to MAX of `quantity`.
type TxnItem = NonNullable<TransactionRecord['items']>[number]

// Resolves which billing items map to this ledger row's vendor.
//
// 1. Exact `vendorId` match — POS / standalone bookings.
// 2. Event-package vendor game names — for event-package bookings the per-
//    item vendorId isn't on `txn.items` (it lives on `__eventPackage.items[]`
//    of the booking, which TransactionRecord doesn't carry). The caller
//    passes the vendor's *configured* game names from the EventCampaign form
//    (the "Game name" inputs). We filter sub-game lines whose trailing
//    segment contains any of those names — so Raju Dangeti's row on a
//    Summer Vibes booking surfaces only the "VR" line, not every game in the
//    combo.
// 3. Representative fallback — no match either way: return the full list but
//    flag the caller so it doesn't sum quantities across every sub-line.
const itemsForLedgerEntry = (
  entry: VendorLedgerEntry,
  txn: TransactionRecord | undefined,
  vendorGameNames?: string[],
): { items: TxnItem[]; representative: boolean; hintMatched: boolean } | null => {
  const all = Array.isArray(txn?.items) ? txn.items : []
  if (all.length === 0) return null
  if (!entry.vendorId) return { items: all, representative: false, hintMatched: false }
  const direct = all.filter((it) => it.vendorId === entry.vendorId)
  if (direct.length > 0) return { items: direct, representative: false, hintMatched: false }
  if (vendorGameNames && vendorGameNames.length > 0) {
    const needles = vendorGameNames.map((n) => n.toLowerCase().trim()).filter((n) => n.length > 0)
    if (needles.length > 0) {
      const hintMatched = all.filter((it) => {
        const itemName = (it.itemName ?? '').toLowerCase()
        const tail = itemName.split(' — ').pop() ?? itemName
        return needles.some((n) => tail.includes(n) || itemName.includes(n))
      })
      if (hintMatched.length > 0) {
        return { items: hintMatched, representative: false, hintMatched: true }
      }
    }
  }
  return { items: all, representative: true, hintMatched: false }
}

const getGameLabelsForLedgerEntry = (
  entry: VendorLedgerEntry,
  txn: TransactionRecord | undefined,
  vendorGameNames?: string[],
): string[] => {
  const resolved = itemsForLedgerEntry(entry, txn, vendorGameNames)
  if (!resolved) return []
  if (resolved.representative) {
    const eventLabels = new Set<string>()
    for (const it of resolved.items) {
      const label = extractGameLabelFromItemName(it.itemName)
      if (label) eventLabels.add(label)
      if (eventLabels.size >= 1) break
    }
    return Array.from(eventLabels)
  }
  const labels = new Set<string>()
  for (const it of resolved.items) {
    const label = extractGameLabelFromItemName(it.itemName)
    if (label) labels.add(label)
  }
  return Array.from(labels)
}

const getTicketCountForLedgerEntry = (
  entry: VendorLedgerEntry,
  txn: TransactionRecord | undefined,
  vendorGameNames?: string[],
): number => {
  const resolved = itemsForLedgerEntry(entry, txn, vendorGameNames)
  if (!resolved) return 0
  if (resolved.representative) {
    // Event-package items all share the same `quantity` (= package count).
    // Use MAX so we report package count once instead of summing every line.
    let max = 0
    for (const it of resolved.items) {
      const q = Number(it.quantity) || 0
      if (q > max) max = q
    }
    return max
  }
  return resolved.items.reduce((sum, it) => sum + (it.quantity ?? 0), 0)
}

const getVariantLabelsForLedgerEntry = (
  entry: VendorLedgerEntry,
  txn: TransactionRecord | undefined,
  vendorGameNames?: string[],
): string[] => {
  const resolved = itemsForLedgerEntry(entry, txn, vendorGameNames)
  if (!resolved) return []
  // Hint match: show the vendor's *configured* game names from the
  // EventCampaign form, but only those that actually appear in this booking
  // (a vendor configured across multiple combos has 3-4 games on file; we
  // don't want to list all of them on every booking).
  if (resolved.hintMatched && vendorGameNames && vendorGameNames.length > 0) {
    const matched = new Set<string>()
    for (const it of resolved.items) {
      const itemName = (it.itemName ?? '').toLowerCase()
      for (const game of vendorGameNames) {
        const needle = game.toLowerCase().trim()
        if (needle && itemName.includes(needle)) matched.add(game)
      }
    }
    if (matched.size > 0) return Array.from(matched)
  }
  // Trailing ` — ` segment is the game / variant name.
  const labels = new Set<string>()
  for (const it of resolved.items) {
    const parts = it.itemName?.split(' — ')
    const variant = parts?.[parts.length - 1]?.trim()
    if (variant && parts && parts.length > 1) labels.add(variant)
  }
  return Array.from(labels)
}
import { vendorDetailsApi } from '../../api/vendor-details'
import { TaxBillModal } from '../../components/TaxBillModal'
import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { DataTable } from '../../components/ui/DataTable'
import { DetailPanel } from '../../components/ui/DetailPanel'
import { SummaryCards } from '../../components/ui/SummaryCards'
import { LedgerReconciliationPanel } from '../../components/ui/LedgerReconciliationPanel'
import {
  type CampaignFilter,
  matchesCampaignFilter,
  useCampaignResolver,
  useEventCampaigns,
} from '../../features/event-campaigns/campaign-matching'
import { CampaignBreakdownPanel } from '../../components/ui/CampaignBreakdownPanel'
import { useAuth } from '../../features/auth/auth-context'
// generateLetterheadPdf pulls in jspdf + jspdf-autotable (~600 KB).
// We import it dynamically inside the click handlers below so the
// AccountingModule chunk doesn't pay that cost on first mount.
import { useLocations } from '../../hooks/useLocations'
import { getLocationDisplayName, resolveLocation } from '../../../lib/locations'
import { todayIST, fmtDateShortIST, fmtDateTimeIST } from '../../lib/ist-date'
import {
  downloadVendorInvoiceExcel,
  downloadInvoicesZip,
  downloadVendorSummaryExcel,
} from '../../features/invoice-export/invoice-excel-export'

export type AccountingView = 'ledger' | 'invoices' | 'settlements' | 'reports' | 'discrepancies'

const subnav = [
  { label: 'Ledger', to: '/accounting/ledger' },
  { label: 'Invoices', to: '/accounting/invoices' },
  { label: 'Settlements', to: '/accounting/settlements' },
  { label: 'Reports', to: '/accounting/reports' },
  { label: 'Discrepancies', to: '/accounting/discrepancies' },
]

const titleMap: Record<AccountingView, string> = {
  ledger: 'Vendor Ledger',
  invoices: 'Weekly Invoices',
  settlements: 'Settlements',
  reports: 'Accounting Reports',
  discrepancies: 'Vendor Discrepancies',
}

const subtitleMap: Record<AccountingView, string> = {
  ledger: 'All vendor credit entries from billing transactions.',
  invoices: 'Weekly (Saturday–Friday) invoices per vendor and company totals.',
  settlements: 'Aggregate settlement status per vendor.',
  reports: 'Revenue split, GST breakdown, and location-wise analytics.',
  discrepancies: 'Vendor attribution incidents — open notices and resolved corrections.',
}

const currency = (n: number) => `INR ${Math.round(n).toLocaleString('en-IN')}`

const fmtDate = fmtDateTimeIST
const fmtDateShort = fmtDateShortIST

// ─── Invoice status pill ─────────────────────────────────────────────────────
// Thin adapter over the canonical StatusBadge primitive. Keeps the local
// "draft / pending / locked" vocabulary at the call site, but reuses the
// system-wide tone palette (border + bg + text) instead of re-rolling one.
const InvoiceStatusBadge = ({ status }: { status: 'draft' | 'pending' | 'locked' }) => {
  const tone = status === 'locked' ? 'success' : status === 'pending' ? 'info' : 'warning'
  const label = status === 'locked' ? 'Locked' : status === 'pending' ? 'Pending Payout' : 'Draft'
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

// ─── Discrepancies View ─────────────────────────────────────────────────────
const DiscrepanciesView = ({
  isOwner,
  vendorDetailsList,
}: {
  isOwner: boolean
  vendorDetailsList: VendorDetailsRecord[]
}) => {
  type Record = import('../../api/types').VendorDiscrepancyRecord
  const { session: authSession } = useAuth()
  const [items, setItems] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [resolveTarget, setResolveTarget] = useState<Record | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { vendorDiscrepanciesApi } = await import('../../api/vendor-discrepancies')
      setItems(await vendorDiscrepanciesApi.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load discrepancies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handlePreview = useCallback(async (record: Record) => {
    const { generateVendorDiscrepancyHtml } =
      await import('../../features/vendor-attribution/discrepancyReport')
    const html = generateVendorDiscrepancyHtml(record)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [])

  const sendNotice = useCallback(
    async (record: Record) => {
      setActing(record.id)
      setError(null)
      try {
        const { vendorDiscrepanciesApi } = await import('../../api/vendor-discrepancies')
        await vendorDiscrepanciesApi.sendNotice(record)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send WhatsApp notice to vendor')
      } finally {
        setActing(null)
      }
    },
    [refresh],
  )

  const resolvePrefill = useMemo<Partial<AdjustmentDraft> | undefined>(() => {
    if (!resolveTarget) return undefined
    const linkedIds = resolveTarget.affectedBookings.map((b) => b.bookingId).join(', ')
    return {
      vendorId: resolveTarget.vendorId,
      amount: String(resolveTarget.grossAmount),
      reason: `Discrepancy correction for ${resolveTarget.reference} — ${resolveTarget.gameLabel} bookings missing vendor attribution.`,
      linkedBookingIds: linkedIds,
      locationId: resolveTarget.branchId,
      entryType: 'discrepancy_correction',
    }
  }, [resolveTarget])

  const handleResolve = useCallback(
    async (draft: AdjustmentDraft) => {
      if (!resolveTarget) return
      const userId = authSession?.user?.id ?? 'unknown'
      const userName = authSession?.user?.name ?? authSession?.user?.email ?? userId
      const vendorMatch = vendorDetailsList.find(
        (d) =>
          d.userId === draft.vendorId ||
          d.vendorName?.toLowerCase() === draft.vendorId.toLowerCase() ||
          d.mobileNumber === draft.vendorId,
      )
      const resolvedVendorId = vendorMatch?.userId ?? draft.vendorId
      const ledgerEntry = await accountingApi.createLedgerAdjustment({
        vendorId: resolvedVendorId,
        vendorName: vendorMatch?.vendorName ?? resolveTarget.vendorName,
        amount: Number(draft.amount),
        reason: draft.reason,
        linkedBookingIds: draft.linkedBookingIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        locationId: draft.locationId.trim() || undefined,
        entryType: 'discrepancy_correction',
        createdBy: userId,
        createdByName: userName,
      })
      const { vendorDiscrepanciesApi } = await import('../../api/vendor-discrepancies')
      await vendorDiscrepanciesApi.markResolved(resolveTarget.id, ledgerEntry.id)
      await refresh()
    },
    [resolveTarget, authSession, vendorDetailsList, refresh],
  )

  if (!isOwner) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-6 text-sm text-muted">
        This view is restricted to Owner / Admin users.
      </p>
    )
  }

  return (
    <>
      <SummaryCards
        items={[
          {
            id: 'open',
            label: 'Open',
            tone: 'warning',
            value: String(items.filter((i) => i.status === 'pending').length),
          },
          {
            id: 'notified',
            label: 'Notified',
            tone: 'info',
            value: String(items.filter((i) => i.status === 'notified').length),
          },
          {
            id: 'resolved',
            label: 'Resolved',
            tone: 'success',
            value: String(items.filter((i) => i.status === 'resolved').length),
          },
        ]}
      />
      {error ? (
        <p className="mb-3 rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-xs text-critical">
          {error}
        </p>
      ) : null}
      <DataTable
        columns={[
          { key: 'reference', header: 'Reference', render: (r) => r.reference },
          { key: 'vendor', header: 'Vendor', render: (r) => r.vendorName || r.vendorId },
          { key: 'branch', header: 'Branch', render: (r) => r.branchDisplayName ?? r.branchId },
          { key: 'game', header: 'Game', render: (r) => r.gameLabel },
          {
            key: 'bookings',
            header: 'Bookings',
            render: (r) => String(r.affectedBookings.length),
          },
          { key: 'gross', header: 'Gross', render: (r) => currency(r.grossAmount) },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span
                className={
                  r.status === 'resolved'
                    ? 'text-success font-semibold'
                    : r.status === 'notified'
                      ? 'text-info font-semibold'
                      : 'text-warning font-semibold'
                }
              >
                {r.status}
              </span>
            ),
          },
          { key: 'detected', header: 'Detected', render: (r) => fmtDate(r.detectedAt) },
          {
            key: 'actions',
            header: 'Actions',
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handlePreview(r)}
                  className="ui-btn ui-btn-neutral text-[10px] px-2 py-1"
                >
                  Preview
                </button>
                {r.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={acting === r.id || !r.vendorPhone}
                    onClick={() => void sendNotice(r)}
                    title={
                      r.vendorPhone ? 'Send WhatsApp notice to vendor' : 'No vendor phone on file'
                    }
                    className="ui-btn ui-btn-neutral text-[10px] px-2 py-1 disabled:opacity-50"
                  >
                    {acting === r.id ? 'Sending…' : 'Send Notice'}
                  </button>
                ) : null}
                {r.status !== 'resolved' ? (
                  <button
                    type="button"
                    onClick={() => setResolveTarget(r)}
                    className="ui-btn ui-btn-primary text-[10px] px-2 py-1"
                  >
                    Resolve &amp; Credit
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
        rows={items}
        rowKey={(r) => r.id}
        emptyMessage={loading ? 'Loading discrepancies…' : 'No discrepancies recorded.'}
      />
      <LedgerAdjustmentModal
        open={resolveTarget !== null}
        onClose={() => setResolveTarget(null)}
        vendorDetailsList={vendorDetailsList}
        prefill={resolvePrefill}
        onSubmit={handleResolve}
      />
    </>
  )
}

// ─── Ledger View ──────────────────────────────────────────────────────────────
interface AdjustmentDraft {
  vendorId: string
  amount: string
  reason: string
  linkedBookingIds: string
  locationId: string
  entryType: 'manual_adjustment' | 'discrepancy_correction'
}

const emptyDraft: AdjustmentDraft = {
  vendorId: '',
  amount: '',
  reason: '',
  linkedBookingIds: '',
  locationId: '',
  entryType: 'discrepancy_correction',
}

const LedgerAdjustmentModal = ({
  open,
  onClose,
  vendorDetailsList,
  defaultVendorId,
  prefill,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  vendorDetailsList: VendorDetailsRecord[]
  defaultVendorId?: string
  prefill?: Partial<AdjustmentDraft>
  onSubmit: (draft: AdjustmentDraft) => Promise<void>
}) => {
  const [draft, setDraft] = useState<AdjustmentDraft>(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft({ ...emptyDraft, vendorId: defaultVendorId ?? '', ...prefill })
      setError(null)
    }
  }, [open, defaultVendorId, prefill])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!draft.vendorId.trim()) {
      setError('Vendor is required')
      return
    }
    const amt = Number(draft.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive number')
      return
    }
    if (!draft.reason.trim()) {
      setError('Reason is required')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(draft)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to write adjustment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} maxWidth="max-w-xl">
      <form onSubmit={submit} className="p-5">
        <h3 className="mb-3 text-base font-semibold text-text">Add Vendor Ledger Adjustment</h3>
        <p className="mb-4 text-xs text-muted">
          Writes a manual credit (or debit) into <code>vendorLedger</code>. The entry rolls into the
          next weekly invoice for the selected vendor and is shown as a discrepancy correction on
          their settlements page.
        </p>
        <div className="space-y-3">
          <div>
            <label htmlFor="adj-vendor" className="mb-1 block text-xs font-medium text-muted">
              Vendor <span className="text-critical">*</span>
            </label>
            <input
              id="adj-vendor"
              list="adj-vendor-options"
              className="ui-field w-full"
              placeholder="Vendor name / ID / phone..."
              value={draft.vendorId}
              onChange={(e) => setDraft({ ...draft, vendorId: e.target.value })}
            />
            <datalist id="adj-vendor-options">
              {vendorDetailsList.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {`${d.vendorName ?? d.userId}${d.mobileNumber ? ` · ${d.mobileNumber}` : ''}`}
                </option>
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="adj-type" className="mb-1 block text-xs font-medium text-muted">
                Adjustment type
              </label>
              <select
                id="adj-type"
                className="ui-field w-full"
                value={draft.entryType}
                onChange={(e) =>
                  setDraft({ ...draft, entryType: e.target.value as AdjustmentDraft['entryType'] })
                }
              >
                <option value="discrepancy_correction">Discrepancy correction</option>
                <option value="manual_adjustment">Manual adjustment</option>
              </select>
            </div>
            <div>
              <label htmlFor="adj-amount" className="mb-1 block text-xs font-medium text-muted">
                Credit amount (INR) <span className="text-critical">*</span>
              </label>
              <input
                id="adj-amount"
                type="number"
                min="1"
                step="1"
                className="ui-field w-full"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label htmlFor="adj-reason" className="mb-1 block text-xs font-medium text-muted">
              Reason <span className="text-critical">*</span>
            </label>
            <textarea
              id="adj-reason"
              rows={3}
              className="ui-field w-full"
              placeholder="e.g. Trampoline Park bookings on 30 Mar 2026 missed vendor attribution due to billing pipeline bug."
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="adj-bookings" className="mb-1 block text-xs font-medium text-muted">
              Linked booking IDs (comma-separated)
            </label>
            <input
              id="adj-bookings"
              className="ui-field w-full"
              placeholder="ASG2603301955281032134, ASG260330195650101R80M"
              value={draft.linkedBookingIds}
              onChange={(e) => setDraft({ ...draft, linkedBookingIds: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="adj-location" className="mb-1 block text-xs font-medium text-muted">
              Location (optional — for invoice grouping)
            </label>
            <input
              id="adj-location"
              className="ui-field w-full"
              placeholder="kakinada"
              value={draft.locationId}
              onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
            />
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-md border border-critical/40 bg-critical/5 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="ui-btn ui-btn-neutral text-xs"
          >
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="ui-btn ui-btn-primary text-xs">
            {submitting ? 'Writing…' : 'Write Credit'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

const LedgerView = ({
  entries,
  loading,
  isVendor,
  isOwner = false,
  vendorDetailsList = [],
  transactions = [],
  vendorInvoices = [],
  onAfterBackfill,
}: {
  entries: VendorLedgerEntry[]
  loading: boolean
  isVendor: boolean
  isOwner?: boolean
  vendorDetailsList?: VendorDetailsRecord[]
  transactions?: TransactionRecord[]
  vendorInvoices?: VendorInvoice[]
  onAfterBackfill?: () => void
}) => {
  const { session: authSession } = useAuth()
  const vendorNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of vendorDetailsList) {
      if (d.vendorName) {
        map.set(d.userId, d.vendorName)
        if (d.mobileNumber) map.set(d.mobileNumber, d.vendorName)
      }
    }
    return map
  }, [vendorDetailsList])

  // Searchable combobox needs the inverse lookup too: name/phone → vendorId.
  const vendorIdLookupByQuery = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of vendorDetailsList) {
      if (d.userId) {
        if (d.vendorName) map.set(d.vendorName.toLowerCase(), d.userId)
        if (d.mobileNumber) map.set(d.mobileNumber, d.userId)
        map.set(d.userId, d.userId)
      }
    }
    return map
  }, [vendorDetailsList])

  // Map vendorId → mobileNumber for free-text matches on phone.
  const vendorPhoneById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of vendorDetailsList) {
      if (d.userId && d.mobileNumber) map.set(d.userId, d.mobileNumber)
    }
    return map
  }, [vendorDetailsList])

  // Map vendorId → set of game names sourced from EventCampaign packages.
  // The configured "Game name" inputs in the EventCampaign form
  // (`packages[].items[].name`) are the authoritative label to display in
  // the ledger Variant column for event-package bookings, where
  // `txn.items[].vendorId` is empty.
  const [vendorGameNamesById, setVendorGameNamesById] = useState<Map<string, string[]>>(
    () => new Map(),
  )
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { listEventCampaigns } =
          await import('../../features/event-campaigns/event-campaigns-firestore')
        const campaigns = await listEventCampaigns()
        if (cancelled) return
        const next = new Map<string, Set<string>>()
        for (const c of campaigns) {
          for (const pkg of c.packages ?? []) {
            for (const it of pkg.items ?? []) {
              const vid = typeof it.vendorId === 'string' ? it.vendorId.trim() : ''
              const name = typeof it.name === 'string' ? it.name.trim() : ''
              if (!vid || !name) continue
              const set = next.get(vid) ?? new Set<string>()
              set.add(name)
              next.set(vid, set)
            }
          }
        }
        const flat = new Map<string, string[]>()
        for (const [vid, set] of next.entries()) flat.set(vid, Array.from(set))
        setVendorGameNamesById(flat)
      } catch {
        /* non-fatal — falls back to itemName parsing */
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Index transactions by id for O(1) lookup when resolving game labels
  // for each ledger entry.
  const txnMap = useMemo(() => {
    const map = new Map<string, TransactionRecord>()
    for (const t of transactions) map.set(t.id, t)
    return map
  }, [transactions])

  // Active EventCampaigns — populates the Campaign filter dropdown so the
  // owner can scope ledger math to a single campaign (e.g. "Summer Vibes
  // only") or hide all campaign revenue. Hook is shared across views.
  const campaigns = useEventCampaigns()
  const campaignResolver = useCampaignResolver(campaigns)

  // Resolve each ledger entry's campaignId once (booking lookup → name-token
  // match against the EventCampaign config), so the filter / KPI split can
  // run in O(n) without re-walking every render.
  const campaignIdByEntryId = useMemo(() => {
    const map = new Map<string, string | undefined>()
    for (const e of entries) {
      const txn = e.referenceId ? txnMap.get(e.referenceId) : undefined
      map.set(e.id, txn ? campaignResolver.fromTxn(txn) : undefined)
    }
    return map
  }, [entries, txnMap, campaignResolver])

  // Pre-compute game labels per ledger entry id, so we don't redo the
  // lookup on every filter/render pass.
  const gameLabelsByEntryId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const e of entries) {
      map.set(
        e.id,
        getGameLabelsForLedgerEntry(
          e,
          txnMap.get(e.referenceId),
          vendorGameNamesById.get(e.vendorId),
        ),
      )
    }
    return map
  }, [entries, txnMap, vendorGameNamesById])

  const ticketCountByEntryId = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      map.set(
        e.id,
        getTicketCountForLedgerEntry(
          e,
          txnMap.get(e.referenceId),
          vendorGameNamesById.get(e.vendorId),
        ),
      )
    }
    return map
  }, [entries, txnMap, vendorGameNamesById])

  const variantLabelsByEntryId = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const e of entries) {
      map.set(
        e.id,
        getVariantLabelsForLedgerEntry(
          e,
          txnMap.get(e.referenceId),
          vendorGameNamesById.get(e.vendorId),
        ),
      )
    }
    return map
  }, [entries, txnMap, vendorGameNamesById])

  const [vendorFilter, setVendorFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('All')
  const [gameFilter, setGameFilter] = useState('All')
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>({ kind: 'all' })
  const [search, setSearch] = useState('')
  // Default range is the current accounting week (Saturday → today IST) so
  // entries from earlier in the week aren't hidden behind a today-only filter
  // — that surprised users who couldn't see ledger rows that did exist.
  const [fromDate, setFromDate] = useState(getPeriodStart())
  const [toDate, setToDate] = useState(todayIST())
  type SortKey = 'date' | 'vendor' | 'tickets' | 'total' | 'type'
  const [sortBy, setSortBy] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const locations = useMemo(() => {
    const locs = Array.from(new Set(entries.map((e) => e.locationId ?? '').filter(Boolean)))
    return ['All', ...locs]
  }, [entries])

  const games = useMemo(() => {
    const set = new Set<string>()
    for (const labels of gameLabelsByEntryId.values()) {
      for (const l of labels) set.add(l)
    }
    return ['All', ...Array.from(set).sort()]
  }, [gameLabelsByEntryId])

  // Resolve a free-text vendor query (name | phone | id) to a vendorId we can
  // match exactly. Falls back to the raw query so partial vendorId substrings
  // still match (back-compat with the old text filter).
  const resolvedVendorFilter = useMemo(() => {
    if (!vendorFilter) return ''
    const trimmed = vendorFilter.trim()
    return (
      vendorIdLookupByQuery.get(trimmed.toLowerCase()) ??
      vendorIdLookupByQuery.get(trimmed) ??
      trimmed
    )
  }, [vendorFilter, vendorIdLookupByQuery])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      const entryDate = (e.date || e.createdAt || '').slice(0, 10)
      if (entryDate < fromDate || entryDate > toDate) return false
      if (resolvedVendorFilter && !e.vendorId.includes(resolvedVendorFilter)) return false
      if (locationFilter !== 'All' && e.locationId !== locationFilter) return false
      if (gameFilter !== 'All') {
        const labels = gameLabelsByEntryId.get(e.id) ?? []
        if (!labels.includes(gameFilter)) return false
      }
      if (!matchesCampaignFilter(campaignIdByEntryId.get(e.id), campaignFilter)) return false
      if (q) {
        const vendorName = (e.vendorName ?? vendorNameMap.get(e.vendorId) ?? '').toLowerCase()
        const phone = (vendorPhoneById.get(e.vendorId) ?? '').toLowerCase()
        const variants = (variantLabelsByEntryId.get(e.id) ?? []).join(' ').toLowerCase()
        const tickets = String(ticketCountByEntryId.get(e.id) ?? '')
        const total = String(e.amount ?? '')
        const type = (e.type ?? '').toLowerCase()
        const haystack = [
          e.referenceId,
          e.invoiceNumber,
          e.vendorId,
          vendorName,
          phone,
          variants,
          tickets,
          total,
          type,
        ]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase())
          .join(' | ')
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [
    entries,
    fromDate,
    toDate,
    resolvedVendorFilter,
    locationFilter,
    gameFilter,
    campaignFilter,
    campaignIdByEntryId,
    search,
    gameLabelsByEntryId,
    variantLabelsByEntryId,
    ticketCountByEntryId,
    vendorNameMap,
    vendorPhoneById,
  ])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const rows = [...filtered]
    rows.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return (a.date || a.createdAt || '').localeCompare(b.date || b.createdAt || '') * dir
        case 'vendor': {
          const an = (a.vendorName ?? vendorNameMap.get(a.vendorId) ?? a.vendorId).toLowerCase()
          const bn = (b.vendorName ?? vendorNameMap.get(b.vendorId) ?? b.vendorId).toLowerCase()
          return an.localeCompare(bn) * dir
        }
        case 'tickets':
          return (
            ((ticketCountByEntryId.get(a.id) ?? 0) - (ticketCountByEntryId.get(b.id) ?? 0)) * dir
          )
        case 'total':
          return ((a.amount ?? 0) - (b.amount ?? 0)) * dir
        case 'type':
          return (a.type ?? '').localeCompare(b.type ?? '') * dir
        default:
          return 0
      }
    })
    return rows
  }, [filtered, sortBy, sortDir, vendorNameMap, ticketCountByEntryId])

  // KPI math: credits and debits computed separately so the UI can show both
  // gross and net. `totalNet` is what an invoice for the same window would
  // sum to, making the ledger directly comparable to the invoice card.
  const totalCredit = filtered.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0)
  const totalDebit = filtered.filter((e) => e.type === 'debit').reduce((s, e) => s + e.amount, 0)
  const totalNet = totalCredit - totalDebit

  // Per-campaign breakdown of the currently filtered window. Surfaces
  // "Summer Vibes ₹X / non-event ₹Y" alongside the totals when the user
  // is viewing all entries (Campaign filter = 'all'), so they can see the
  // event's contribution without flipping the filter.
  const campaignBreakdown = useMemo(() => {
    const map = new Map<string | undefined, { credit: number; debit: number }>()
    for (const e of filtered) {
      const cid = campaignIdByEntryId.get(e.id)
      const acc = map.get(cid) ?? { credit: 0, debit: 0 }
      if (e.type === 'credit') acc.credit += e.amount
      else acc.debit += e.amount
      map.set(cid, acc)
    }
    const campaignTitleById = new Map(campaigns.map((c) => [c.id, c.title]))
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
        label: cid ? (campaignTitleById.get(cid) ?? cid) : 'Non-event',
        credit: agg.credit,
        debit: agg.debit,
        net: agg.credit - agg.debit,
      })
    }
    rows.sort((a, b) => b.net - a.net)
    return rows
  }, [filtered, campaignIdByEntryId, campaigns])

  const [eventBackfillRunning, setEventBackfillRunning] = useState(false)
  const [eventBackfillResult, setEventBackfillResult] = useState<{
    scanned: number
    written: number
    errors: number
  } | null>(null)

  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustmentDefaultVendor, setAdjustmentDefaultVendor] = useState<string | undefined>(
    undefined,
  )

  const submitAdjustment = useCallback(
    async (draft: AdjustmentDraft) => {
      const userId = authSession?.user?.id ?? 'unknown'
      const userName = authSession?.user?.name ?? authSession?.user?.email ?? userId
      const vendorMatch = vendorDetailsList.find(
        (d) =>
          d.userId === draft.vendorId ||
          d.vendorName?.toLowerCase() === draft.vendorId.toLowerCase() ||
          d.mobileNumber === draft.vendorId,
      )
      const resolvedVendorId = vendorMatch?.userId ?? draft.vendorId
      await accountingApi.createLedgerAdjustment({
        vendorId: resolvedVendorId,
        vendorName: vendorMatch?.vendorName,
        amount: Number(draft.amount),
        reason: draft.reason,
        linkedBookingIds: draft.linkedBookingIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        locationId: draft.locationId.trim() || undefined,
        entryType: draft.entryType,
        createdBy: userId,
        createdByName: userName,
      })
      onAfterBackfill?.()
    },
    [authSession, vendorDetailsList, onAfterBackfill],
  )

  const runEventBackfill = async () => {
    setEventBackfillRunning(true)
    setEventBackfillResult(null)
    try {
      const { backfillEventBookingVendorLedger } =
        await import('../../../lib/booking-vendor-payout')
      const res = await backfillEventBookingVendorLedger(fromDate, toDate)
      setEventBackfillResult({
        scanned: res.scanned,
        written: res.written,
        errors: res.errors,
      })
      onAfterBackfill?.()
    } finally {
      setEventBackfillRunning(false)
    }
  }

  return (
    <>
      <SummaryCards
        items={[
          {
            id: 'total-entries',
            label: 'Total Entries',
            value: String(filtered.length),
            tone: 'info',
          },
          {
            id: 'total-credit',
            label: 'Total Credits',
            value: currency(totalCredit),
            tone: 'success',
          },
          {
            id: 'total-debit',
            label: 'Total Debits',
            value: currency(totalDebit),
            tone: 'warning',
          },
          {
            id: 'total-net',
            label: 'Net (Credits − Debits)',
            value: currency(totalNet),
            tone: 'info',
          },
        ]}
      />
      {campaignBreakdown.length > 1 ? (
        <section
          aria-label="Campaign breakdown"
          className="mb-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Campaign breakdown</h3>
            <span className="text-xs text-muted">Net = credits − debits</span>
          </header>
          <ul className="divide-y divide-border/40 text-sm">
            {campaignBreakdown.map((row) => (
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
      ) : null}
      {isOwner && !isVendor ? (
        <LedgerReconciliationPanel
          entries={filtered}
          vendorInvoices={vendorInvoices}
          currency={currency}
        />
      ) : null}
      {isOwner && !isVendor ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Vendor Ledger Adjustments</p>
            <p className="text-xs text-muted">
              Issue an off-cycle credit (or debit) to a vendor — used when a discrepancy notice has
              been sent and the vendor needs to be made whole on the next payout.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAdjustmentDefaultVendor(resolvedVendorFilter || undefined)
              setAdjustmentOpen(true)
            }}
            className="ui-btn ui-btn-primary text-xs"
          >
            + Add Adjustment
          </button>
        </div>
      ) : null}
      {isOwner && !isVendor ? (
        <div className="mb-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">Backfill Event-Booking Ledger</p>
              <p className="text-xs text-muted">
                Writes missing <code>vendorLedger</code> credits for event-package bookings that
                were paid before this fix shipped (e.g. admin payment-link event bookings). Scans
                completed bookings in the From/To range above. Idempotent — safe to re-run.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runEventBackfill()}
                disabled={eventBackfillRunning}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {eventBackfillRunning ? 'Backfilling…' : 'Run Event Backfill'}
              </button>
              {eventBackfillResult ? (
                <span className="text-xs text-muted">
                  Processed {eventBackfillResult.scanned} event booking(s), wrote{' '}
                  {eventBackfillResult.written} ledger entry(ies)
                  {eventBackfillResult.errors > 0 ? `, ${eventBackfillResult.errors} error(s)` : ''}
                  .
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="ledger-from" className="text-xs text-muted">
            From
          </label>
          <input
            id="ledger-from"
            type="date"
            className="ui-field min-h-9"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="ledger-to" className="text-xs text-muted">
            To
          </label>
          <input
            id="ledger-to"
            type="date"
            className="ui-field min-h-9"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <input
          aria-label="Search ledger"
          className="ui-field min-h-9 w-64"
          placeholder="Search name / phone / variant / tickets / total..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!isVendor && (
          <>
            <input
              aria-label="Filter by vendor"
              list="ledger-vendor-options"
              className="ui-field min-h-9 w-56"
              placeholder="Vendor name / ID / phone..."
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
            />
            <datalist id="ledger-vendor-options">
              {vendorDetailsList.map((d) => (
                <option key={d.userId} value={d.vendorName || d.userId}>
                  {`${d.userId}${d.mobileNumber ? ` · ${d.mobileNumber}` : ''}`}
                </option>
              ))}
            </datalist>
          </>
        )}
        <select
          aria-label="Filter by location"
          className="ui-field min-h-9 w-40"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
        >
          {locations.map((l) => (
            <option key={l} value={l}>
              {l === 'All' ? 'All locations' : getLocationDisplayName(l)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by game"
          className="ui-field min-h-9 w-40"
          value={gameFilter}
          onChange={(e) => setGameFilter(e.target.value)}
        >
          {games.map((g) => (
            <option key={g} value={g}>
              {g === 'All' ? 'All games' : g}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by campaign"
          className="ui-field min-h-9 w-44"
          value={
            campaignFilter.kind === 'campaign'
              ? `c:${campaignFilter.campaignId}`
              : campaignFilter.kind === 'exclude_events'
                ? 'exclude'
                : 'all'
          }
          onChange={(e) => {
            const v = e.target.value
            if (v === 'all') setCampaignFilter({ kind: 'all' })
            else if (v === 'exclude') setCampaignFilter({ kind: 'exclude_events' })
            else if (v.startsWith('c:'))
              setCampaignFilter({ kind: 'campaign', campaignId: v.slice(2) })
          }}
        >
          <option value="all">All campaigns</option>
          <option value="exclude">Exclude events</option>
          {campaigns.map((c) => (
            <option key={c.id} value={`c:${c.id}`}>
              {c.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort by"
          className="ui-field min-h-9 w-36"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
        >
          <option value="date">Sort: Date</option>
          {!isVendor && <option value="vendor">Sort: Vendor</option>}
          <option value="tickets">Sort: Tickets</option>
          <option value="total">Sort: Total</option>
          <option value="type">Sort: Type</option>
        </select>
        <button
          type="button"
          aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
          className="ui-btn ui-btn-neutral min-h-9 px-2 text-xs"
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        <span className="text-xs text-muted">{filtered.length} entries</span>
      </div>
      <DataTable
        columns={[
          { key: 'date', header: 'Date', render: (e) => fmtDate(e.date || e.createdAt) },
          ...(!isVendor
            ? [
                {
                  key: 'vendor',
                  header: 'Vendor',
                  render: (e: VendorLedgerEntry) =>
                    e.vendorName ?? vendorNameMap.get(e.vendorId) ?? e.vendorId,
                },
              ]
            : []),
          { key: 'invoice', header: 'Invoice', render: (e) => e.invoiceNumber ?? e.referenceId },
          {
            key: 'tickets',
            header: 'Tickets',
            render: (e) => {
              const count = ticketCountByEntryId.get(e.id) ?? 0
              return count > 0 ? (
                <span className="text-sm font-medium text-text">{count}</span>
              ) : (
                <span className="text-xs text-muted/50">—</span>
              )
            },
          },
          {
            key: 'variant',
            header: 'Variant',
            render: (e) => {
              const labels = variantLabelsByEntryId.get(e.id) ?? []
              return labels.length > 0 ? (
                <span className="text-sm text-text">{labels.join(' / ')}</span>
              ) : (
                <span className="text-xs text-muted/50">—</span>
              )
            },
          },
          {
            key: 'game',
            header: 'Game',
            render: (e) => {
              const labels = gameLabelsByEntryId.get(e.id) ?? []
              return labels.length > 0 ? (
                <span className="text-sm text-text">{labels.join(' / ')}</span>
              ) : (
                <span className="text-xs text-muted/50">—</span>
              )
            },
          },
          {
            key: 'location',
            header: 'Location',
            render: (e) => getLocationDisplayName(e.locationId ?? '') || '—',
          },
          {
            key: 'type',
            header: 'Type',
            render: (e) => (
              <div className="flex flex-col gap-0.5">
                <span
                  className={
                    e.type === 'credit'
                      ? 'text-success font-semibold'
                      : 'text-critical font-semibold'
                  }
                >
                  {e.type}
                </span>
                {e.entryType && e.entryType !== 'sale' ? (
                  <span
                    className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                    title={e.reason ?? ''}
                  >
                    {e.entryType === 'discrepancy_correction' ? 'Discrepancy fix' : 'Adjustment'}
                  </span>
                ) : null}
              </div>
            ),
          },
          {
            key: 'base',
            header: 'Base',
            render: (e) =>
              e.vendorBase !== undefined ? (
                <span className="text-sm text-muted">{currency(e.vendorBase)}</span>
              ) : (
                <span className="text-xs text-muted/50">—</span>
              ),
          },
          {
            key: 'gst',
            header: 'GST',
            render: (e) =>
              e.vendorGst !== undefined ? (
                <span className="text-sm text-muted">{currency(e.vendorGst)}</span>
              ) : (
                <span className="text-xs text-muted/50">—</span>
              ),
          },
          {
            key: 'amount',
            header: 'Total',
            render: (e) => <span className="font-bold text-text">{currency(e.amount)}</span>,
          },
        ]}
        rows={sorted}
        rowKey={(e) => e.id}
        emptyMessage={loading ? 'Loading ledger...' : 'No ledger entries found.'}
      />
      <LedgerAdjustmentModal
        open={adjustmentOpen}
        onClose={() => setAdjustmentOpen(false)}
        vendorDetailsList={vendorDetailsList}
        defaultVendorId={adjustmentDefaultVendor}
        onSubmit={submitAdjustment}
      />
    </>
  )
}

// ─── Period Group type ────────────────────────────────────────────────────────
interface PeriodGroup {
  periodStart: string
  periodEnd: string
  vendorInvoices: VendorInvoice[]
  companyInvoices: CompanyInvoice[]
  totalAmount: number
  invoiceCount: number
  chequeNumber?: string
  letterheadDownloadedAt?: string
}

const MIN_VALID_PERIOD = '2020-01-01'

const groupByPeriod = (vendors: VendorInvoice[], company: CompanyInvoice[]): PeriodGroup[] => {
  const map = new Map<string, PeriodGroup>()
  for (const inv of vendors) {
    if (!inv.periodStart || inv.periodStart < MIN_VALID_PERIOD) continue
    if (!map.has(inv.periodStart)) {
      map.set(inv.periodStart, {
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        vendorInvoices: [],
        companyInvoices: [],
        totalAmount: 0,
        invoiceCount: 0,
      })
    }
    const group = map.get(inv.periodStart)!
    group.vendorInvoices.push(inv)
    group.totalAmount += inv.totalAmount
    group.invoiceCount++
    if (inv.chequeNumber) group.chequeNumber = inv.chequeNumber
    if (inv.letterheadDownloadedAt) {
      if (
        !group.letterheadDownloadedAt ||
        inv.letterheadDownloadedAt < group.letterheadDownloadedAt
      )
        group.letterheadDownloadedAt = inv.letterheadDownloadedAt
    }
  }
  for (const inv of company) {
    if (!inv.periodStart || inv.periodStart < MIN_VALID_PERIOD) continue
    if (!map.has(inv.periodStart)) {
      map.set(inv.periodStart, {
        periodStart: inv.periodStart,
        periodEnd: inv.periodEnd,
        vendorInvoices: [],
        companyInvoices: [],
        totalAmount: 0,
        invoiceCount: 0,
      })
    }
    const group = map.get(inv.periodStart)!
    group.companyInvoices.push(inv)
    if (inv.chequeNumber && !group.chequeNumber) group.chequeNumber = inv.chequeNumber
    if (inv.letterheadDownloadedAt) {
      if (
        !group.letterheadDownloadedAt ||
        inv.letterheadDownloadedAt < group.letterheadDownloadedAt
      )
        group.letterheadDownloadedAt = inv.letterheadDownloadedAt
    }
  }
  return Array.from(map.values()).sort((a, b) => b.periodStart.localeCompare(a.periodStart))
}

// ─── Period Card ──────────────────────────────────────────────────────────────
const PeriodCard = ({
  periodStart,
  periodEnd,
  invoiceCount,
  totalAmount,
  status,
  chequeNumber,
  letterheadDownloadedAt,
  onClick,
}: {
  periodStart: string
  periodEnd: string
  invoiceCount: number
  totalAmount: number
  status: 'pending' | 'completed'
  chequeNumber?: string
  letterheadDownloadedAt?: string
  onClick: () => void
}) => {
  const isPending = status === 'pending'
  const borderClass = isPending
    ? 'border-warning/40 bg-warning/5 hover:bg-warning/10'
    : 'border-success/40 bg-success/5 hover:bg-success/10'
  const badgeClass = isPending ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      onClick={onClick}
      className={`relative flex w-full flex-col gap-2 rounded-xl border p-4 text-left shadow-sm transition-colors ${borderClass}`}
    >
      <p className="text-xs font-semibold text-muted">
        {fmtDateShort(periodStart)} – {fmtDateShort(periodEnd)}
      </p>
      <p className="text-sm text-text">
        {invoiceCount} invoice{invoiceCount !== 1 ? 's' : ''}
      </p>
      <p className="font-display text-xl font-bold text-text">{currency(totalAmount)}</p>
      <span
        className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
      >
        {isPending ? 'Pending Settlement' : 'Completed'}
      </span>
      {chequeNumber && <p className="text-xs text-muted mt-1">Cheque: {chequeNumber}</p>}
      {letterheadDownloadedAt && (
        <p className="text-xs text-muted">Downloaded: {fmtDateShort(letterheadDownloadedAt)}</p>
      )}
    </motion.button>
  )
}

// ─── Unified Invoice Table (vendor + sublease) ───────────────────────────────
const UnifiedInvoiceTable = ({
  invoices,
  loading,
  emptyMessage,
  isOwnerOrAdmin = false,
  busyInvoiceId = null,
  onLockToggle,
  onDownloadExcel,
  excelBusyInvoiceId = null,
}: {
  invoices: VendorInvoice[]
  loading: boolean
  emptyMessage?: string
  /** Owner/Admin gate — only render Lock/Unlock when true. */
  isOwnerOrAdmin?: boolean
  /** Invoice currently mid-flight, button disabled + label "..." */
  busyInvoiceId?: string | null
  /** Action handler — receives the invoice + intended action. */
  onLockToggle?: (inv: VendorInvoice, action: 'lock' | 'unlock') => void
  /** Per-row Excel download — caller fetches transactions and writes the workbook. */
  onDownloadExcel?: (inv: VendorInvoice) => void
  /** Invoice id whose Excel download is in progress. */
  excelBusyInvoiceId?: string | null
}) => {
  const columns = [
    {
      key: 'type',
      header: 'Type',
      render: (inv: VendorInvoice) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            inv.vendorType === 'SubLease' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent'
          }`}
        >
          {inv.vendorType === 'SubLease' ? 'Sublease' : 'Vendor'}
        </span>
      ),
    },
    {
      key: 'vendor',
      header: 'Name',
      render: (inv: VendorInvoice) => {
        const companyName = inv.vendorCompanyName
        const contactName = inv.vendorName ?? inv.vendorId
        if (companyName) {
          return (
            <div>
              <span className="font-medium text-text">{companyName}</span>
              <span className="block text-xs text-muted">{contactName}</span>
            </div>
          )
        }
        return contactName
      },
    },
    {
      key: 'location',
      header: 'Location',
      render: (inv: VendorInvoice) => (
        <span className="text-sm text-muted">
          {getLocationDisplayName(inv.locationId ?? '') || '—'}
        </span>
      ),
    },
    { key: 'txns', header: 'Txns', render: (inv: VendorInvoice) => inv.transactionCount },
    {
      key: 'base',
      header: 'Base',
      render: (inv: VendorInvoice) => (
        <span className="text-sm text-muted">{currency(inv.totalBase)}</span>
      ),
    },
    {
      key: 'gst',
      header: 'GST',
      render: (inv: VendorInvoice) => (
        <span className="text-sm text-muted">{currency(inv.totalGst)}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Total',
      render: (inv: VendorInvoice) => (
        <span className="font-bold text-text">{currency(inv.totalAmount)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (inv: VendorInvoice) => <InvoiceStatusBadge status={inv.status} />,
    },
  ]
  columns.push({
    key: 'actions',
    header: 'Actions',
    render: (inv: VendorInvoice) => {
      const isLocked = inv.status === 'locked'
      const busy = busyInvoiceId === inv.id
      const action: 'lock' | 'unlock' = isLocked ? 'unlock' : 'lock'
      const label = busy ? '…' : isLocked ? 'Unlock' : 'Lock'
      const cls = isLocked
        ? 'ui-btn ui-btn-warning text-[10px] px-2 py-1'
        : 'ui-btn ui-btn-success text-[10px] px-2 py-1'
      const excelBusy = excelBusyInvoiceId === inv.id
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={excelBusy}
            onClick={() =>
              onDownloadExcel ? onDownloadExcel(inv) : void downloadVendorInvoiceExcel(inv)
            }
            className="ui-btn ui-btn-neutral text-[10px] px-2 py-1 disabled:opacity-50"
            title="Download this invoice as Excel (.xlsx) — includes transaction details"
          >
            {excelBusy ? '…' : 'Excel'}
          </button>
          {isOwnerOrAdmin && onLockToggle && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onLockToggle(inv, action)}
              className={`${cls} disabled:opacity-50`}
              title={
                isLocked
                  ? 'Unlock this invoice — allows ledger edits to flow into next regen'
                  : 'Lock this invoice — freezes its totals; future ledger writes will not change it'
              }
            >
              {label}
            </button>
          )}
        </div>
      )
    },
  })
  return (
    <DataTable
      columns={columns}
      rows={invoices}
      rowKey={(inv) => inv.id}
      emptyMessage={loading ? 'Loading invoices...' : (emptyMessage ?? 'No invoices found.')}
    />
  )
}

// ─── Cheque Letterhead Modal ─────────────────────────────────────────────────
export const ChequeLetterheadModal = ({
  open,
  onClose,
  periodStart,
  periodEnd,
  vendorInvoices,
  vendorDetailsList,
  locationFilter,
  session,
  onFinalized,
  mode = 'pending',
  initialChequeNumber = '',
}: {
  open: boolean
  onClose: () => void
  periodStart: string
  periodEnd: string
  vendorInvoices: VendorInvoice[]
  vendorDetailsList: VendorDetailsRecord[]
  locationFilter: string
  session: { user: { id: string; name: string } }
  onFinalized: () => void
  mode?: 'pending' | 'completed'
  initialChequeNumber?: string
}) => {
  const [chequeNumber, setChequeNumber] = useState(initialChequeNumber)
  const [letterheadDate, setLetterheadDate] = useState(() => todayIST())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiddenVendorIds, setHiddenVendorIds] = useState<Set<string>>(new Set())
  const [skipPayoutVendorIds, setSkipPayoutVendorIds] = useState<Set<string>>(new Set())

  const detailsMap = useMemo(
    () => new Map(vendorDetailsList.map((d) => [d.userId, d])),
    [vendorDetailsList],
  )

  const selectableVendors = useMemo(
    () =>
      vendorInvoices.filter((inv) => !(inv.vendorCompanyName ?? '').toLowerCase().includes('mpg')),
    [vendorInvoices],
  )

  const vendorRowStates = useMemo(
    () =>
      selectableVendors.map((inv) => ({
        invoice: inv,
        hidden: hiddenVendorIds.has(inv.vendorId),
        skipPayout: skipPayoutVendorIds.has(inv.vendorId),
      })),
    [selectableVendors, hiddenVendorIds, skipPayoutVendorIds],
  )

  const selectedCount = vendorRowStates.filter((v) => !v.hidden).length
  const totalCount = vendorRowStates.length

  const locationLabel = getLocationDisplayName(locationFilter) || locationFilter

  const buildPdfConfig = (): LetterheadConfig => {
    const visible = vendorRowStates.filter((v) => !v.hidden).map((v) => v.invoice)
    const rows = visible
      .map((inv, idx) => {
        const details = detailsMap.get(inv.vendorId)
        const companyName = inv.vendorCompanyName || details?.particular || ''
        const contactName = inv.vendorName ?? inv.vendorId
        return {
          sNo: idx + 1,
          vendorName: companyName || contactName,
          contactPersonName: companyName ? contactName : '',
          accountNumber: details?.bankAccountNumber ?? '',
          bankName: details?.bankName ?? '',
          branch: details?.branch ?? '',
          ifscCode: details?.ifscCode ?? '',
          amount: inv.totalAmount,
        }
      })
      .filter((row) => row.accountNumber)
    const grandTotal = rows.reduce((s, r) => s + r.amount, 0)
    return {
      chequeNumber: chequeNumber.trim(),
      date: letterheadDate,
      periodStart,
      periodEnd,
      locationLabel,
      vendors: rows,
      grandTotal,
    }
  }

  const toggleHidden = (vendorId: string) => {
    setHiddenVendorIds((prev) => {
      const next = new Set(prev)
      if (next.has(vendorId)) {
        next.delete(vendorId)
        setSkipPayoutVendorIds((prevSkip) => {
          if (!prevSkip.has(vendorId)) return prevSkip
          const nextSkip = new Set(prevSkip)
          nextSkip.delete(vendorId)
          return nextSkip
        })
      } else {
        next.add(vendorId)
      }
      return next
    })
  }

  const selectAllVendors = () => {
    setHiddenVendorIds(new Set())
    setSkipPayoutVendorIds(new Set())
  }

  const clearAllVendors = () => {
    setHiddenVendorIds(new Set(selectableVendors.map((inv) => inv.vendorId)))
  }

  if (!open) return null

  const handleGeneratePreview = async () => {
    if (!chequeNumber.trim()) return
    setGeneratingPdf(true)
    setError(null)
    try {
      const config = buildPdfConfig()
      const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
      const doc = await generateLetterheadPdf(config)
      const blobUrl = doc.output('bloburl') as unknown as string
      setPreviewUrl(blobUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  const handleLockAndDownload = async () => {
    if (!chequeNumber.trim()) return
    setGeneratingPdf(true)
    setError(null)
    try {
      if (mode === 'pending') {
        await accountingApi.finalizePayoutForLocation(
          periodStart,
          chequeNumber.trim(),
          locationFilter,
          session.user.id,
          session.user.name,
        )
      } else {
        await accountingApi.updateChequeForLocation(
          periodStart,
          chequeNumber.trim(),
          locationFilter,
        )
      }

      const config = buildPdfConfig()
      const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
      const pdfDoc = await generateLetterheadPdf(config)
      pdfDoc.save(`Letterhead_${periodStart}_${locationFilter}_${chequeNumber.trim()}.pdf`)

      await accountingApi.markPeriodLetterheadDownloaded(periodStart, locationFilter)

      onFinalized()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate letterhead.')
    } finally {
      setGeneratingPdf(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-4">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border/70 bg-panel shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-text">Letter Head</h3>
            <p className="text-xs text-muted">
              {fmtDateShort(periodStart)} – {fmtDateShort(periodEnd)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-sm">
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted">Cheque Number *</label>
              <input
                className="ui-field min-h-9 w-48"
                placeholder="Enter cheque number"
                value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted">Date</label>
              <input
                type="date"
                className="ui-field min-h-9 w-44"
                value={letterheadDate}
                onChange={(e) => setLetterheadDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={!chequeNumber.trim() || generatingPdf}
                className="ui-btn ui-btn-primary disabled:opacity-50"
              >
                {generatingPdf ? 'Generating...' : 'Generate Preview'}
              </button>
              <button
                type="button"
                onClick={handleLockAndDownload}
                disabled={!chequeNumber.trim() || generatingPdf}
                className="ui-btn ui-btn-neutral disabled:opacity-50"
              >
                {generatingPdf
                  ? 'Processing...'
                  : mode === 'completed'
                    ? 'Update & Download PDF'
                    : 'Lock All & Download PDF'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border/50 bg-surface">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <span className="text-xs font-semibold text-muted">
                Vendors on this letterhead ({selectedCount} of {totalCount} selected)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllVendors}
                  className="ui-btn ui-btn-neutral text-xs"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={clearAllVendors}
                  className="ui-btn ui-btn-neutral text-xs"
                >
                  Clear all
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto">
              {vendorRowStates.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">
                  No vendors for this period.
                </div>
              ) : (
                vendorRowStates.map(({ invoice, hidden }) => {
                  const displayName =
                    invoice.vendorCompanyName || invoice.vendorName || invoice.vendorId
                  return (
                    <label
                      key={invoice.id}
                      className={`flex cursor-pointer items-center gap-3 border-b border-border/30 px-3 py-2 text-sm last:border-b-0 ${
                        hidden ? 'text-muted' : 'text-text'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => toggleHidden(invoice.vendorId)}
                        aria-label={`Include ${displayName}`}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">{displayName}</span>
                      <span className="font-mono text-xs">{currency(invoice.totalAmount)}</span>
                    </label>
                  )
                })
              )}
            </div>
            <div className="flex justify-end border-t border-border/50 px-3 py-2 text-xs">
              <span className="font-semibold text-text">
                Total on letterhead:{' '}
                {currency(
                  vendorRowStates
                    .filter((v) => !v.hidden)
                    .reduce((s, v) => s + v.invoice.totalAmount, 0),
                )}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
            {mode === 'completed'
              ? 'You can update the cheque number. The letterhead will be re-generated and downloaded with the updated number.'
              : 'Entering a cheque number and downloading will lock all invoices for this period and move them to Completed.'}
          </div>

          {!chequeNumber.trim() && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              A cheque number is required before you can proceed.
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          )}

          {/* Preview */}
          {previewUrl ? (
            <iframe
              src={previewUrl}
              className="flex-1 rounded-lg border border-border"
              title="Letterhead Preview"
            />
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-border/50 bg-surface text-sm text-muted">
              Enter a cheque number and click "Generate Preview" to see the letterhead.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Weekly Report Panel (P&L + per-vendor breakdown) ────────────────────────

interface WeeklyReportData {
  periodStart: string
  periodEnd: string
  gross: number
  baseAmount: number
  gstAmount: number
  refundAmount: number
  vendorShare: number
  companyShare: number
  netCompanyPL: number
  transactionCount: number
  cancelledCount: number
  fullyRefundedCount: number
  byLocation: Array<{
    locationId: string
    gross: number
    baseAmount: number
    gstAmount: number
    refundAmount: number
    vendorShare: number
    companyShare: number
    transactionCount: number
  }>
  byPaymentMethod: Array<{ method: string; amount: number; count: number }>
  byVendor: Array<{
    vendorId: string
    locationId: string
    grossGenerated: number
    vendorShare: number
    companyShareFromThem: number
    gstContribution: number
    refundDebit: number
    netVendorShare: number
    entryCount: number
    debitCount: number
  }>
}

const WeeklyReportPanel = ({
  periodStart,
  vendorDetailsList,
}: {
  periodStart: string
  vendorDetailsList: VendorDetailsRecord[]
}) => {
  const [report, setReport] = useState<WeeklyReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    accountingApi
      .getWeeklyReport(periodStart)
      .then((r) => {
        if (!cancelled) setReport(r as WeeklyReportData)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, periodStart])

  const vendorNameFor = (vid: string) => {
    const rec = vendorDetailsList.find((v) => v.userId === vid)
    return rec?.particular || rec?.vendorName || vid
  }

  const downloadCsv = () => {
    if (!report) return
    const lines: string[] = []
    lines.push(`Weekly Full Report,${report.periodStart} to ${report.periodEnd}`)
    lines.push('')
    lines.push('=== P&L Summary ===')
    lines.push(`Metric,Amount (INR)`)
    lines.push(`Gross Revenue,${report.gross}`)
    lines.push(`Base Amount (pre-GST),${report.baseAmount}`)
    lines.push(`GST Collected,${report.gstAmount}`)
    lines.push(`Refunds,${report.refundAmount}`)
    lines.push(`Vendor Share (total),${report.vendorShare}`)
    lines.push(`Company Share (total),${report.companyShare}`)
    lines.push(`Net Company P&L,${report.netCompanyPL}`)
    lines.push(`Transactions,${report.transactionCount}`)
    lines.push(`Cancelled,${report.cancelledCount}`)
    lines.push(`Fully Refunded,${report.fullyRefundedCount}`)
    lines.push('')
    lines.push('=== Per Location ===')
    lines.push('Location,Gross,Base,GST,Refunds,Vendor Share,Company Share,Txns')
    for (const l of report.byLocation) {
      lines.push(
        `${getLocationDisplayName(l.locationId) || l.locationId},${l.gross},${l.baseAmount},${l.gstAmount},${l.refundAmount},${l.vendorShare},${l.companyShare},${l.transactionCount}`,
      )
    }
    lines.push('')
    lines.push('=== Per Payment Method ===')
    lines.push('Method,Amount (net of refund),Txns')
    for (const p of report.byPaymentMethod) {
      lines.push(`${p.method},${p.amount},${p.count}`)
    }
    lines.push('')
    lines.push('=== Per Vendor (expanded) ===')
    lines.push(
      'Vendor,Location,Gross Generated,Vendor Share,Refund Debit,Net Vendor Share,Company Share From Them,GST Contribution,Credit Entries,Debit Entries',
    )
    for (const v of report.byVendor) {
      lines.push(
        `${vendorNameFor(v.vendorId)} (${v.vendorId}),${getLocationDisplayName(v.locationId) || v.locationId},${v.grossGenerated},${v.vendorShare},${v.refundDebit},${v.netVendorShare},${v.companyShareFromThem},${v.gstContribution},${v.entryCount},${v.debitCount}`,
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `weekly-report-${report.periodStart}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ui-btn ui-btn-neutral text-sm"
        >
          Show Full Weekly Report
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-text">
          Full Weekly Report — {fmtDateShort(periodStart)} onwards
        </h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!report}
            className="ui-btn ui-btn-neutral text-xs disabled:opacity-50"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-muted hover:underline"
          >
            Hide
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted py-4 text-center">Loading report…</p>}
      {error && <p className="text-sm text-critical py-2">Failed: {error}</p>}

      {report && !loading && (
        <div className="space-y-5">
          {/* ── A. P&L Summary ── */}
          <section>
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              P&L Summary
            </h5>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-sm">
              <PLStat label="Gross Revenue" value={currency(report.gross)} />
              <PLStat label="Base (pre-GST)" value={currency(report.baseAmount)} />
              <PLStat label="GST Collected" value={currency(report.gstAmount)} />
              <PLStat label="Refunds" value={currency(report.refundAmount)} tone="negative" />
              <PLStat label="Vendor Share" value={currency(report.vendorShare)} />
              <PLStat label="Company Share" value={currency(report.companyShare)} />
              <PLStat
                label="Net Company P&L"
                value={currency(report.netCompanyPL)}
                tone="positive"
              />
              <PLStat label="Transactions" value={`${report.transactionCount}`} />
              {report.cancelledCount > 0 && (
                <PLStat label="Cancelled" value={`${report.cancelledCount}`} tone="negative" />
              )}
              {report.fullyRefundedCount > 0 && (
                <PLStat
                  label="Fully Refunded"
                  value={`${report.fullyRefundedCount}`}
                  tone="negative"
                />
              )}
            </div>
          </section>

          {/* ── A. Per-location ── */}
          <section>
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              Per Location
            </h5>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted text-left border-b border-border/40">
                    <th className="py-1.5 pr-3">Location</th>
                    <th className="py-1.5 pr-3 text-right">Gross</th>
                    <th className="py-1.5 pr-3 text-right">GST</th>
                    <th className="py-1.5 pr-3 text-right">Refunds</th>
                    <th className="py-1.5 pr-3 text-right">Vendor</th>
                    <th className="py-1.5 pr-3 text-right">Company</th>
                    <th className="py-1.5 pr-3 text-right">Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byLocation.map((l) => (
                    <tr key={l.locationId} className="border-b border-border/20">
                      <td className="py-1.5 pr-3 text-text">
                        {getLocationDisplayName(l.locationId) || l.locationId}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text">{currency(l.gross)}</td>
                      <td className="py-1.5 pr-3 text-right text-muted">{currency(l.gstAmount)}</td>
                      <td className="py-1.5 pr-3 text-right text-critical">
                        {currency(l.refundAmount)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">
                        {currency(l.vendorShare)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-accent">
                        {currency(l.companyShare)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">{l.transactionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Payment method breakdown ── */}
          {report.byPaymentMethod.length > 0 && (
            <section>
              <h5 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                Per Payment Method (net of refund)
              </h5>
              <div className="flex flex-wrap gap-2 text-xs">
                {report.byPaymentMethod.map((p) => (
                  <div
                    key={p.method}
                    className="rounded border border-border/40 bg-surface px-2.5 py-1.5"
                  >
                    <div className="text-muted">{p.method}</div>
                    <div className="text-text font-medium">{currency(p.amount)}</div>
                    <div className="text-muted">{p.count} txns</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── C. Per-vendor expanded ── */}
          <section>
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              Per Vendor (Full Breakdown)
            </h5>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted text-left border-b border-border/40">
                    <th className="py-1.5 pr-3">Vendor</th>
                    <th className="py-1.5 pr-3">Location</th>
                    <th className="py-1.5 pr-3 text-right">Gross Generated</th>
                    <th className="py-1.5 pr-3 text-right">Vendor Share</th>
                    <th className="py-1.5 pr-3 text-right">Refund Debit</th>
                    <th className="py-1.5 pr-3 text-right">Net Payable</th>
                    <th className="py-1.5 pr-3 text-right">Company Share</th>
                    <th className="py-1.5 pr-3 text-right">GST</th>
                    <th className="py-1.5 pr-3 text-right">Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byVendor.map((v) => (
                    <tr key={`${v.vendorId}-${v.locationId}`} className="border-b border-border/20">
                      <td className="py-1.5 pr-3 text-text font-medium">
                        {vendorNameFor(v.vendorId)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted">
                        {getLocationDisplayName(v.locationId) || v.locationId}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text">
                        {currency(v.grossGenerated)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">
                        {currency(v.vendorShare)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-critical">
                        {v.refundDebit > 0 ? `-${currency(v.refundDebit)}` : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-accent font-semibold">
                        {currency(v.netVendorShare)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">
                        {currency(v.companyShareFromThem)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">
                        {currency(v.gstContribution)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted">
                        {v.entryCount}
                        {v.debitCount > 0 ? ` (-${v.debitCount})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

const PLStat = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'negative'
}) => {
  const toneClass =
    tone === 'positive' ? 'text-accent' : tone === 'negative' ? 'text-critical' : 'text-text'
  return (
    <div className="rounded border border-border/40 bg-surface px-2.5 py-1.5">
      <div className="text-muted text-[11px]">{label}</div>
      <div className={`font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

// ─── Invoices View (Lifecycle-based) ─────────────────────────────────────────
const InvoicesView = ({
  vendorInvoices,
  companyInvoices,
  loading,
  isOwnerOrAdmin,
  onGenerate,
  generating,
  locationFilter,
  onLocationFilterChange,
  staleInfo,
  isVendor = false,
  vendorDetailsList,
  session,
  onFinalized,
  vendorLocationStatus = 'idle',
  vendorLocationError = null,
  myVendorDetails = null,
  taxBillPeriod = null,
  onTaxBillPeriodChange,
}: {
  vendorInvoices: VendorInvoice[]
  companyInvoices: CompanyInvoice[]
  loading: boolean
  isOwnerOrAdmin: boolean
  onGenerate: () => void
  generating: boolean
  locationFilter: string
  onLocationFilterChange: (loc: string) => void
  staleInfo: { stale: boolean; newTxnCount: number }
  isVendor?: boolean
  vendorDetailsList: VendorDetailsRecord[]
  session: { user: { id: string; name: string; role: string } } | null
  onFinalized: () => void
  vendorLocationStatus?: 'idle' | 'loading' | 'loaded' | 'error'
  vendorLocationError?: string | null
  myVendorDetails?: VendorDetailsRecord | null
  taxBillPeriod?: string | null
  onTaxBillPeriodChange?: (period: string | null) => void
}) => {
  const { enabledLocations } = useLocations()
  const campaigns = useEventCampaigns()
  const currentPeriod = getPeriodStart()
  const currentPeriodEnd = getPeriodEnd(currentPeriod)
  const today = todayIST()

  // ── Lock/Unlock invoice (Owner/Admin only) ──
  const [lockBusyId, setLockBusyId] = useState<string | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [regenBusyPeriod, setRegenBusyPeriod] = useState<string | null>(null)
  const [regenSuccess, setRegenSuccess] = useState<string | null>(null)

  // ── Regenerate invoices for a specific period from underlying truth ──
  // Reads billingTransactions + vendorLedger for the period and rebuilds
  // every NON-LOCKED vendor invoice in it. Locked invoices are skipped
  // (intentional — generateFirestoreWeeklyInvoices honors the lock flag).
  // Use this AFTER you've unlocked the bad invoice(s) and corrected the
  // ledger via the Reconciliation tools — it pulls the freshly-correct
  // ledger state into the pending invoice.
  const handleRegeneratePeriod = useCallback(
    async (periodStart: string, periodEnd: string) => {
      if (!isOwnerOrAdmin) return
      if (
        !window.confirm(
          `Regenerate all UNLOCKED vendor invoices for ${periodStart} → ${periodEnd}?\n\n` +
            `This rebuilds totals from the current billingTransactions + vendorLedger.\n` +
            `Locked invoices in this period are skipped — unlock first if you want them rebuilt.`,
        )
      ) {
        return
      }
      setRegenBusyPeriod(periodStart)
      setLockError(null)
      setRegenSuccess(null)
      try {
        // Pass mid-period date so getPeriodStart picks the right week.
        const result = await generateFirestoreWeeklyInvoices(new Date(`${periodStart}T12:00:00Z`))
        setRegenSuccess(
          `Regenerated ${result.vendorInvoices.length} vendor invoice(s) for ${periodStart} → ${periodEnd}.`,
        )
        onFinalized()
      } catch (err) {
        setLockError(
          `Regenerate failed for ${periodStart}: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        setRegenBusyPeriod(null)
      }
    },
    [isOwnerOrAdmin, onFinalized],
  )
  const handleLockToggle = useCallback(
    async (inv: VendorInvoice, action: 'lock' | 'unlock') => {
      if (!isOwnerOrAdmin) return
      const verb = action === 'lock' ? 'Lock' : 'Unlock'
      const periodLabel = `${inv.periodStart} → ${inv.periodEnd}`
      const vendorLabel = inv.vendorCompanyName || inv.vendorName || inv.vendorId
      if (action === 'lock') {
        // Show pre-lock validation result so admin doesn't lock a drifting invoice.
        try {
          const validation = await validateInvoiceBeforeLock(inv.id, 'vendor')
          if (!validation.valid) {
            const proceed = window.confirm(
              `Pre-lock validation failed for ${vendorLabel} (${periodLabel}):\n\n` +
                validation.errors.join('\n') +
                `\n\nLock anyway? Click OK only if you understand the drift will be frozen as-is.`,
            )
            if (!proceed) return
          }
        } catch {
          /* validation failure non-fatal — proceed to confirm */
        }
      }
      const confirmMsg =
        action === 'lock'
          ? `Lock ${vendorLabel} invoice for ${periodLabel}? Future ledger writes won't change this invoice's totals.`
          : `Unlock ${vendorLabel} invoice for ${periodLabel}? Reconciliation rows can then flow into the next regen.`
      if (!window.confirm(confirmMsg)) return

      setLockBusyId(inv.id)
      setLockError(null)
      try {
        if (action === 'lock') {
          // lockFirestoreVendorInvoice runs validateInvoiceBeforeLock again
          // server-side and throws if it fails — but the user already
          // overrode that, so try-catch and surface a clear error.
          await lockFirestoreVendorInvoice(inv.id)
        } else {
          await unlockFirestoreVendorInvoice(inv.id)
        }
        onFinalized()
      } catch (err) {
        setLockError(
          `${verb} failed for ${vendorLabel}: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        setLockBusyId(null)
      }
    },
    [isOwnerOrAdmin, onFinalized],
  )

  // ── Location matching helpers ──
  const matchesLocation = useCallback(
    (inv: VendorInvoice) => {
      if (!locationFilter || locationFilter === 'All') return true
      if (inv.locationId) return inv.locationId === locationFilter
      return inv.entries.some((e) => e.locationId === locationFilter)
    },
    [locationFilter],
  )

  const matchesLocationCompany = useCallback(
    (inv: CompanyInvoice) => {
      if (!locationFilter || locationFilter === 'All') return true
      return locationFilter in inv.byLocation && inv.byLocation[locationFilter] > 0
    },
    [locationFilter],
  )

  // ── Section 1: Current Week invoices (vendor + sublease unified) ──
  const currentWeekInvoices = useMemo(() => {
    return vendorInvoices.filter(
      (inv) => inv.periodStart === currentPeriod && matchesLocation(inv) && inv.totalAmount > 0,
    )
  }, [vendorInvoices, currentPeriod, matchesLocation])

  const currentWeekCompany = useMemo(() => {
    return companyInvoices.filter(
      (inv) => inv.periodStart === currentPeriod && matchesLocationCompany(inv),
    )
  }, [companyInvoices, currentPeriod, matchesLocationCompany])

  // ── Section 2: Pending Settlement (past period, NOT locked) ──
  const pendingVendors = useMemo(() => {
    return vendorInvoices.filter(
      (inv) =>
        inv.periodEnd < today &&
        inv.status !== 'locked' &&
        matchesLocation(inv) &&
        inv.totalAmount > 0,
    )
  }, [vendorInvoices, today, matchesLocation])

  const pendingCompany = useMemo(() => {
    return companyInvoices.filter(
      (inv) => inv.periodEnd < today && inv.status !== 'locked' && matchesLocationCompany(inv),
    )
  }, [companyInvoices, today, matchesLocationCompany])

  const pendingGroups = useMemo(
    () =>
      groupByPeriod(pendingVendors, pendingCompany).filter(
        (g) => g.invoiceCount > 0 || g.totalAmount > 0,
      ),
    [pendingVendors, pendingCompany],
  )

  // ── Section 3: Completed (locked) ──
  const completedVendors = useMemo(() => {
    return vendorInvoices.filter(
      (inv) => inv.status === 'locked' && matchesLocation(inv) && inv.totalAmount > 0,
    )
  }, [vendorInvoices, matchesLocation])

  const completedCompany = useMemo(() => {
    return companyInvoices.filter((inv) => inv.status === 'locked' && matchesLocationCompany(inv))
  }, [companyInvoices, matchesLocationCompany])

  const completedGroups = useMemo(
    () =>
      groupByPeriod(completedVendors, completedCompany).filter(
        (g) => g.invoiceCount > 0 || g.totalAmount > 0,
      ),
    [completedVendors, completedCompany],
  )

  // ── Expand / modal state ──
  const [expandedPendingPeriod, setExpandedPendingPeriod] = useState<string | null>(null)
  const [expandedCompletedPeriod, setExpandedCompletedPeriod] = useState<string | null>(null)
  const [chequeModalPeriod, setChequeModalPeriod] = useState<{
    periodStart: string
    periodEnd: string
    mode: 'pending' | 'completed'
    initialChequeNumber?: string
  } | null>(null)

  // ── Summary stats ──
  const totalCurrentAmount = currentWeekInvoices.reduce((s, inv) => s + inv.totalAmount, 0)
  const vendorCount = new Set(currentWeekInvoices.map((inv) => inv.vendorId)).size

  // ── Zip-download busy state (keyed by periodStart, plus 'current') ──
  const [zipBusyKey, setZipBusyKey] = useState<string | null>(null)
  const [rowExcelBusyId, setRowExcelBusyId] = useState<string | null>(null)
  const handleDownloadZip = async (
    key: string,
    vendor: VendorInvoice[],
    company: CompanyInvoice[],
    periodStart: string,
    periodEnd: string,
    label?: string,
  ) => {
    if (vendor.length === 0 && company.length === 0) return
    setZipBusyKey(key)
    try {
      // Fetch transactions for every distinct vendor in this batch so each
      // workbook can include full Transactions + Items sheets.
      const distinctVendorIds = Array.from(new Set(vendor.map((v) => v.vendorId)))
      const txnLists = await Promise.all(
        distinctVendorIds.map((vid) => accountingApi.listTransactions(vid).catch(() => [])),
      )
      const allTxns = txnLists.flat()
      await downloadInvoicesZip(vendor, company, periodStart, periodEnd, label, allTxns)
    } finally {
      setZipBusyKey(null)
    }
  }
  const handleDownloadSingleInvoiceExcel = async (inv: VendorInvoice) => {
    setRowExcelBusyId(inv.id)
    try {
      const txns = await accountingApi.listTransactions(inv.vendorId).catch(() => [])
      await downloadVendorInvoiceExcel(inv, txns)
    } finally {
      setRowExcelBusyId(null)
    }
  }

  // ── Expanded group helpers ──
  const expandedPendingGroup =
    pendingGroups.find((g) => g.periodStart === expandedPendingPeriod) ?? null
  const expandedCompletedGroup =
    completedGroups.find((g) => g.periodStart === expandedCompletedPeriod) ?? null

  // ── Invoices for the cheque modal (filtered to period + location) ──
  const chequeModalInvoices = useMemo(() => {
    if (!chequeModalPeriod) return []
    return vendorInvoices.filter(
      (inv) =>
        inv.periodStart === chequeModalPeriod.periodStart &&
        matchesLocation(inv) &&
        inv.totalAmount > 0,
    )
  }, [chequeModalPeriod, vendorInvoices, matchesLocation])

  return (
    <>
      {/* ── Location Filter + Generate ── */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-muted">
          Current week:{' '}
          <strong className="text-text">
            {fmtDateShort(currentPeriod)} – {fmtDateShort(currentPeriodEnd)}
          </strong>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isVendor ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                vendorLocationStatus === 'error'
                  ? 'border-critical/40 bg-critical/5 text-critical'
                  : 'border-border bg-surface text-text'
              }`}
            >
              <span className="text-muted">Location:</span>
              {vendorLocationStatus === 'loading'
                ? 'Loading...'
                : vendorLocationStatus === 'error'
                  ? 'Not available'
                  : enabledLocations.find(
                      (l) => l.slug === locationFilter || l.branchId === locationFilter,
                    )?.displayName || locationFilter}
            </span>
          ) : (
            <select
              className="ui-field min-h-9 w-40"
              value={locationFilter}
              onChange={(e) => onLocationFilterChange(e.target.value)}
            >
              <option value="All">All locations</option>
              {enabledLocations.map((loc) => (
                <option key={loc.slug} value={loc.slug}>
                  {loc.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={zipBusyKey === 'vendor-summary' || vendorInvoices.length === 0}
            onClick={() => {
              setZipBusyKey('vendor-summary')
              void downloadVendorSummaryExcel(vendorInvoices).finally(() => setZipBusyKey(null))
            }}
            className="ui-btn ui-btn-neutral disabled:opacity-50"
            title="Download a single Excel listing every vendor across all locations and all periods (pending + completed totals)"
          >
            {zipBusyKey === 'vendor-summary' ? 'Building…' : 'Vendor Summary (.xlsx)'}
          </button>
          {isOwnerOrAdmin && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              {generating ? 'Generating...' : "Generate This Week's Invoices"}
            </button>
          )}
        </div>
      </div>

      {/* Vendor-specific gate: while the vendor's branchId is still
          resolving (or failed), block invoice render and show the
          loading/error state. Owner/Admin always falls through to the
          invoice list — the dropdown's "All locations" default is the
          canonical "no filter" value, NOT a "no selection" sentinel. */}
      {isVendor && vendorLocationStatus !== 'loaded' ? (
        <div
          className={`rounded-lg border px-6 py-10 text-center ${
            vendorLocationStatus === 'error'
              ? 'border-critical/40 bg-critical/5 text-critical'
              : 'border-border text-muted'
          }`}
        >
          {vendorLocationStatus === 'error'
            ? vendorLocationError || 'Unable to load location. Please refresh or contact admin.'
            : 'Loading your registered location...'}
        </div>
      ) : (
        <>
          {/* ════════════════════════════════════════════════════════════════════════
              SECTION 1: CURRENT WEEK
             ════════════════════════════════════════════════════════════════════════ */}
          <div className="mt-4">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
              <div>
                <h3 className="font-display text-lg font-semibold text-text">Current Week</h3>
                <p className="text-xs text-muted mb-3">
                  {fmtDateShort(currentPeriod)} – {fmtDateShort(currentPeriodEnd)}
                </p>
              </div>
              {(currentWeekInvoices.length > 0 || currentWeekCompany.length > 0) && (
                <button
                  type="button"
                  disabled={zipBusyKey === 'current'}
                  onClick={() =>
                    void handleDownloadZip(
                      'current',
                      currentWeekInvoices,
                      isOwnerOrAdmin ? currentWeekCompany : [],
                      currentPeriod,
                      currentPeriodEnd,
                      'CurrentWeek',
                    )
                  }
                  className="ui-btn ui-btn-neutral text-xs disabled:opacity-50"
                  title="Download every invoice in this period as individual .xlsx files (zipped)"
                >
                  {zipBusyKey === 'current' ? 'Bundling…' : 'Download all (.zip)'}
                </button>
              )}
            </div>

            {staleInfo.stale && isOwnerOrAdmin && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5">
                <span className="text-sm text-warning">
                  {staleInfo.newTxnCount} new transaction(s) detected since last generation
                </span>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={generating}
                  className="rounded-md border border-warning/40 bg-warning/15 px-3 py-1 text-xs font-semibold text-warning hover:bg-warning/25 disabled:opacity-50"
                >
                  {generating ? 'Refreshing...' : 'Refresh Invoices'}
                </button>
              </div>
            )}

            <SummaryCards
              items={[
                {
                  id: 'inv-count',
                  label: 'Invoices',
                  value: String(currentWeekInvoices.length),
                  tone: 'info',
                },
                {
                  id: 'inv-total',
                  label: 'Total Amount',
                  value: currency(totalCurrentAmount),
                  tone: 'success',
                },
                {
                  id: 'inv-vendors',
                  label: 'Vendors / Subleases',
                  value: String(vendorCount),
                  tone: 'muted',
                },
              ]}
            />

            {lockError && (
              <p className="mb-2 rounded-md border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
                {lockError}
                <button type="button" onClick={() => setLockError(null)} className="ml-2 underline">
                  Dismiss
                </button>
              </p>
            )}
            <UnifiedInvoiceTable
              invoices={currentWeekInvoices}
              loading={loading}
              emptyMessage="No invoices for the current week. Generate invoices to create them."
              isOwnerOrAdmin={isOwnerOrAdmin}
              busyInvoiceId={lockBusyId}
              onLockToggle={handleLockToggle}
              onDownloadExcel={handleDownloadSingleInvoiceExcel}
              excelBusyInvoiceId={rowExcelBusyId}
            />

            {/* Company invoice summary for current week */}
            {currentWeekCompany.length > 0 && isOwnerOrAdmin && (
              <DetailPanel title="All location Company Invoice Summary">
                {currentWeekCompany.map((ci) => (
                  <div key={ci.id} className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">Company Owned</span>
                      <span className="text-text font-semibold">
                        {currency(ci.companyOwnedTotal)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Company Share (Vendor Games)</span>
                      <span className="text-text font-semibold">
                        {currency(ci.companyShareTotal)}
                      </span>
                    </div>
                    <div className="border-t border-border/40 pt-2 flex justify-between">
                      <span className="text-text font-bold">Grand Total</span>
                      <span className="text-text font-bold">{currency(ci.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </DetailPanel>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════════════
              SECTION 2: PENDING SETTLEMENT
             ════════════════════════════════════════════════════════════════════════ */}
          <div className="mt-8">
            <h3 className="font-display text-lg font-semibold text-text mb-1">
              Pending Settlement
            </h3>
            <p className="text-xs text-muted mb-3">
              Past-period invoices awaiting cheque entry and letterhead download
            </p>
            <CampaignBreakdownPanel
              invoices={pendingVendors}
              campaigns={campaigns}
              currency={currency}
              title="Pending Settlement — campaign breakdown"
            />

            {expandedPendingGroup ? (
              /* ── Expanded view for a single pending period ── */
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedPendingPeriod(null)}
                  className="mb-3 text-sm text-accent hover:underline"
                >
                  ← Back to periods
                </button>
                <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-text">
                      {fmtDateShort(expandedPendingGroup.periodStart)} –{' '}
                      {fmtDateShort(expandedPendingGroup.periodEnd)}
                    </h4>
                    <p className="text-xs text-muted">
                      {expandedPendingGroup.invoiceCount} invoice
                      {expandedPendingGroup.invoiceCount !== 1 ? 's' : ''} ·{' '}
                      {currency(expandedPendingGroup.totalAmount)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={zipBusyKey === `pending:${expandedPendingGroup.periodStart}`}
                      onClick={() =>
                        void handleDownloadZip(
                          `pending:${expandedPendingGroup.periodStart}`,
                          expandedPendingGroup.vendorInvoices,
                          isOwnerOrAdmin ? expandedPendingGroup.companyInvoices : [],
                          expandedPendingGroup.periodStart,
                          expandedPendingGroup.periodEnd,
                          'Pending',
                        )
                      }
                      className="ui-btn ui-btn-neutral disabled:opacity-50"
                      title="Download every invoice in this period as individual .xlsx files (zipped)"
                    >
                      {zipBusyKey === `pending:${expandedPendingGroup.periodStart}`
                        ? 'Bundling…'
                        : 'Download all (.zip)'}
                    </button>
                    {isOwnerOrAdmin && (
                      <>
                        <button
                          type="button"
                          disabled={regenBusyPeriod === expandedPendingGroup.periodStart}
                          onClick={() =>
                            void handleRegeneratePeriod(
                              expandedPendingGroup.periodStart,
                              expandedPendingGroup.periodEnd,
                            )
                          }
                          className="ui-btn ui-btn-warning disabled:opacity-50"
                          title="Rebuild every UNLOCKED vendor invoice in this period from the current billingTransactions + vendorLedger. Locked invoices are skipped."
                        >
                          {regenBusyPeriod === expandedPendingGroup.periodStart
                            ? 'Regenerating…'
                            : 'Regenerate this period'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setChequeModalPeriod({
                              periodStart: expandedPendingGroup.periodStart,
                              periodEnd: expandedPendingGroup.periodEnd,
                              mode: 'pending',
                            })
                          }
                          className="ui-btn ui-btn-neutral"
                        >
                          Letter Head
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {regenSuccess && (
                  <p className="mb-2 rounded-md border border-success/45 bg-success/10 px-3 py-2 text-xs text-success">
                    {regenSuccess}
                    <button
                      type="button"
                      onClick={() => setRegenSuccess(null)}
                      className="ml-2 underline"
                    >
                      Dismiss
                    </button>
                  </p>
                )}
                <UnifiedInvoiceTable
                  invoices={expandedPendingGroup.vendorInvoices}
                  loading={false}
                  emptyMessage="No invoices for this period."
                  isOwnerOrAdmin={isOwnerOrAdmin}
                  busyInvoiceId={lockBusyId}
                  onLockToggle={handleLockToggle}
                  onDownloadExcel={handleDownloadSingleInvoiceExcel}
                  excelBusyInvoiceId={rowExcelBusyId}
                />
                {!isVendor && (
                  <WeeklyReportPanel
                    periodStart={expandedPendingGroup.periodStart}
                    vendorDetailsList={vendorDetailsList}
                  />
                )}
              </div>
            ) : /* ── Collapsed: one card per period ── */
            pendingGroups.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center rounded-lg border border-border/30 bg-surface/30">
                No pending settlements.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pendingGroups.map((group) => (
                  <PeriodCard
                    key={group.periodStart}
                    periodStart={group.periodStart}
                    periodEnd={group.periodEnd}
                    invoiceCount={group.invoiceCount}
                    totalAmount={group.totalAmount}
                    status="pending"
                    onClick={() => setExpandedPendingPeriod(group.periodStart)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════════════════
              SECTION 3: COMPLETED / HISTORY
             ════════════════════════════════════════════════════════════════════════ */}
          <div className="mt-8">
            <h3 className="font-display text-lg font-semibold text-text mb-3">
              Completed / History
            </h3>

            {expandedCompletedGroup ? (
              /* ── Expanded view for a single completed period ── */
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedCompletedPeriod(null)}
                  className="mb-3 text-sm text-accent hover:underline"
                >
                  ← Back to periods
                </button>
                <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-text">
                      {fmtDateShort(expandedCompletedGroup.periodStart)} –{' '}
                      {fmtDateShort(expandedCompletedGroup.periodEnd)}
                    </h4>
                    {expandedCompletedGroup.chequeNumber && (
                      <p className="text-xs text-muted">
                        Cheque: {expandedCompletedGroup.chequeNumber}
                      </p>
                    )}
                    {expandedCompletedGroup.letterheadDownloadedAt && (
                      <p className="text-xs text-muted">
                        Downloaded: {fmtDateShort(expandedCompletedGroup.letterheadDownloadedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={zipBusyKey === `completed:${expandedCompletedGroup.periodStart}`}
                      onClick={() =>
                        void handleDownloadZip(
                          `completed:${expandedCompletedGroup.periodStart}`,
                          expandedCompletedGroup.vendorInvoices,
                          isOwnerOrAdmin ? expandedCompletedGroup.companyInvoices : [],
                          expandedCompletedGroup.periodStart,
                          expandedCompletedGroup.periodEnd,
                          'Completed',
                        )
                      }
                      className="ui-btn ui-btn-neutral disabled:opacity-50"
                      title="Download every invoice in this period as individual .xlsx files (zipped)"
                    >
                      {zipBusyKey === `completed:${expandedCompletedGroup.periodStart}`
                        ? 'Bundling…'
                        : 'Download all (.zip)'}
                    </button>
                    {isOwnerOrAdmin && (
                      <button
                        type="button"
                        disabled={regenBusyPeriod === expandedCompletedGroup.periodStart}
                        onClick={() =>
                          void handleRegeneratePeriod(
                            expandedCompletedGroup.periodStart,
                            expandedCompletedGroup.periodEnd,
                          )
                        }
                        className="ui-btn ui-btn-warning disabled:opacity-50"
                        title="Rebuild every UNLOCKED vendor invoice in this period. Unlock first if you want a locked invoice rebuilt."
                      >
                        {regenBusyPeriod === expandedCompletedGroup.periodStart
                          ? 'Regenerating…'
                          : 'Regenerate this period'}
                      </button>
                    )}
                    {isOwnerOrAdmin && (
                      <button
                        type="button"
                        onClick={() =>
                          setChequeModalPeriod({
                            periodStart: expandedCompletedGroup.periodStart,
                            periodEnd: expandedCompletedGroup.periodEnd,
                            mode: 'completed',
                            initialChequeNumber: expandedCompletedGroup.chequeNumber,
                          })
                        }
                        className="ui-btn ui-btn-neutral"
                      >
                        Letter Head
                      </button>
                    )}
                    {isVendor && onTaxBillPeriodChange && (
                      <button
                        type="button"
                        onClick={() => onTaxBillPeriodChange(expandedCompletedGroup.periodStart)}
                        className="ui-btn ui-btn-neutral"
                      >
                        Tax Bill
                      </button>
                    )}
                  </div>
                </div>
                <UnifiedInvoiceTable
                  invoices={expandedCompletedGroup.vendorInvoices}
                  loading={false}
                  emptyMessage="No invoices for this period."
                  isOwnerOrAdmin={isOwnerOrAdmin}
                  busyInvoiceId={lockBusyId}
                  onLockToggle={handleLockToggle}
                  onDownloadExcel={handleDownloadSingleInvoiceExcel}
                  excelBusyInvoiceId={rowExcelBusyId}
                />
                {!isVendor && (
                  <WeeklyReportPanel
                    periodStart={expandedCompletedGroup.periodStart}
                    vendorDetailsList={vendorDetailsList}
                  />
                )}
              </div>
            ) : /* ── Collapsed: one card per period ── */
            completedGroups.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center rounded-lg border border-border/30 bg-surface/30">
                No completed settlements yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {completedGroups.map((group) => (
                  <PeriodCard
                    key={group.periodStart}
                    periodStart={group.periodStart}
                    periodEnd={group.periodEnd}
                    invoiceCount={group.invoiceCount}
                    totalAmount={group.totalAmount}
                    status="completed"
                    chequeNumber={group.chequeNumber}
                    letterheadDownloadedAt={group.letterheadDownloadedAt}
                    onClick={() => setExpandedCompletedPeriod(group.periodStart)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Cheque + Letterhead Modal ── */}
      {chequeModalPeriod && session && (
        <ChequeLetterheadModal
          open
          onClose={() => setChequeModalPeriod(null)}
          periodStart={chequeModalPeriod.periodStart}
          periodEnd={chequeModalPeriod.periodEnd}
          vendorInvoices={chequeModalInvoices}
          vendorDetailsList={vendorDetailsList}
          locationFilter={locationFilter}
          session={session}
          mode={chequeModalPeriod.mode}
          initialChequeNumber={chequeModalPeriod.initialChequeNumber}
          onFinalized={() => {
            setChequeModalPeriod(null)
            if (chequeModalPeriod.mode === 'pending') setExpandedPendingPeriod(null)
            onFinalized()
          }}
        />
      )}

      {/* ── Tax Bill Modal (ThirdParty vendors) ── */}
      {taxBillPeriod && expandedCompletedGroup && onTaxBillPeriodChange && (
        <TaxBillModal
          open
          onClose={() => onTaxBillPeriodChange(null)}
          periodStart={expandedCompletedGroup.periodStart}
          periodEnd={expandedCompletedGroup.periodEnd}
          vendorInvoices={expandedCompletedGroup.vendorInvoices}
          vendorDetails={myVendorDetails ?? null}
          locationFilter={locationFilter}
        />
      )}
    </>
  )
}
// ─── Vendor Ledger Modal ──────────────────────────────────────────────────────
//
// Opens from the Settlements vendor list. Fetches the vendor's ledger
// entries for the selected accounting week, displays a running balance
// and per-entry breakdown, and offers a one-click CSV download. No
// money moves — read-only inspection plus export.

const buildVendorLedgerCsv = (
  vendorName: string,
  vendorId: string,
  fromDate: string,
  toDate: string,
  entries: VendorLedgerEntry[],
): string => {
  const lines: string[] = []
  lines.push(`Vendor Ledger,${vendorName},${vendorId}`)
  lines.push(`Period,${fromDate} to ${toDate}`)
  lines.push('')
  lines.push('Date,Type,Amount,Base,GST,Source,Booking / Reference,Invoice,Location,Note')
  let runningBalance = 0
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  for (const e of sorted) {
    const signed = e.type === 'credit' ? e.amount : -e.amount
    runningBalance += signed
    const note = String((e as unknown as { note?: string }).note ?? '').replace(/[\r\n,]+/g, ' ')
    lines.push(
      [
        (e.date || '').slice(0, 10),
        e.type,
        e.amount,
        e.vendorBase ?? '',
        e.vendorGst ?? '',
        e.source || '',
        e.referenceId || '',
        e.invoiceNumber || '',
        e.locationId || '',
        note,
      ].join(','),
    )
  }
  lines.push('')
  lines.push(
    `Total credits,${entries.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0)}`,
  )
  lines.push(
    `Total debits,${entries.filter((e) => e.type === 'debit').reduce((s, e) => s + e.amount, 0)}`,
  )
  lines.push(`Net payable (credits − debits),${runningBalance}`)
  return lines.join('\n')
}

const triggerCsvDownload = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Build a printable PDF of the vendor ledger. Uses jsPDF + autoTable
 * (already in the dependency tree from the letterhead generator).
 *
 * Columns: Date | Day | Description | Branch | Credit | Debit | Balance
 *
 * Footer: Vendor bank details so the operator who issues a transfer
 * can verify the account name + IFSC against the cheque amount in
 * one document. Falls back gracefully when bank fields are blank.
 */
/**
 * Convert a VendorInvoice into a synthetic debit entry representing the
 * payout (cheque / transfer) the company issued to the vendor for that
 * week. The actual `vendorLedger` collection doesn't store payouts —
 * they're tracked on the invoice metadata (`lockedAt`,
 * `payoutInitiatedAt`, `chequeNumber`). For ledger display we render
 * these as virtual debit rows so Credits / Debits / Net mirror what
 * the vendor actually has outstanding.
 *
 * Status mapping:
 *   - `pending`              → not paid yet, no synthetic debit
 *   - `locked` / `settled` / `completed` / `paid` → synthetic debit
 */
const PAYOUT_STATUSES = new Set(['locked', 'settled', 'completed', 'paid'])

const synthPayoutEntries = (vendorId: string, invoices: VendorInvoice[]): VendorLedgerEntry[] => {
  const out: VendorLedgerEntry[] = []
  for (const inv of invoices) {
    if (inv.vendorId !== vendorId) continue
    const status = String(inv.status || '').toLowerCase()
    if (!PAYOUT_STATUSES.has(status)) continue
    const amount = Number(inv.totalAmount) || 0
    if (amount <= 0) continue
    const dateRaw = inv.payoutInitiatedAt || inv.lockedAt || inv.periodEnd || inv.generatedAt || ''
    const cheque = inv.chequeNumber ? ` · cheque ${inv.chequeNumber}` : ''
    out.push({
      id: `synth-payout-${inv.id}`,
      vendorId,
      vendorName: inv.vendorName,
      vendorBase: 0,
      vendorGst: 0,
      amount,
      type: 'debit',
      referenceId: inv.id,
      invoiceNumber: inv.id,
      locationId: inv.locationId || '',
      date: typeof dateRaw === 'string' ? dateRaw : '',
      createdAt: typeof dateRaw === 'string' ? dateRaw : '',
      // Custom synthetic source so the description renderer can recognize
      // these and label them as payouts.
      source: 'payout' as unknown as VendorLedgerEntry['source'],
      entryType: 'manual_adjustment',
      // Stash readable note for the PDF Description / modal table.
      ...({
        note: `Weekly payout — Invoice ${inv.id}${cheque} (${status})`,
      } as Record<string, unknown>),
    } as VendorLedgerEntry)
  }
  return out
}

/**
 * Look up the activity / variant name(s) for a ledger entry by walking
 * the matching transaction's billingItems[] for this vendor. Falls back
 * gracefully when no transaction match. Returns short, comma-joined
 * name string suitable for a PDF cell.
 */
const describeLedgerEntry = (
  entry: VendorLedgerEntry,
  txnByRef: Map<string, TransactionRecord>,
): string => {
  const txn = txnByRef.get(entry.referenceId)
  const fallback = (): string => {
    const note = String((entry as unknown as { note?: string }).note ?? '').trim()
    return note || `${entry.source || ''} ${entry.referenceId || ''}`.trim() || '—'
  }
  if (!txn) return fallback()
  // TransactionRecord.items[] is shaped the same as billingItems[] on
  // bookings (vendorId, itemName, vendorTotal etc.). Pick rows for this
  // vendor; strip combo prefixes; dedupe; comma-join for the PDF cell.
  const items = Array.isArray(txn.items) ? txn.items : []
  const direct = items.filter((it) => it.vendorId === entry.vendorId)
  if (direct.length > 0) {
    const seen = new Set<string>()
    const tidy = direct
      .map((it) => it.itemName || '')
      .filter(Boolean)
      .map((n) => {
        const split = n.match(/^.+?\s+•\s+(.+)$/)
        return split ? split[1] : n
      })
      .filter((n) => {
        if (seen.has(n)) return false
        seen.add(n)
        return true
      })
    if (tidy.length > 0) return tidy.join(', ')
  }
  return fallback()
}

const buildVendorLedgerPdf = async (
  vendorName: string,
  vendorId: string,
  fromDate: string,
  toDate: string,
  entries: VendorLedgerEntry[],
  bank: {
    accountHolder: string
    bankName: string
    accountNumber: string
    ifsc: string
    pan: string
    gst: string
    address: string
    mobile: string
  } | null,
  transactions: TransactionRecord[] = [],
  vendorInvoices: VendorInvoice[] = [],
): Promise<import('jspdf').default> => {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 12

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Vendor Ledger Statement', margin, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Vendor: ${vendorName}`, margin, 26)
  doc.text(`Vendor ID: ${vendorId}`, margin, 31)
  doc.text(`Period: ${fromDate} to ${toDate}`, margin, 36)
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin, 41)

  // ── Summary tiles ────────────────────────────────────────────────────
  // Always rendered, even when one of credits/debits is zero, so the
  // section is visible at a glance.
  let preTotalCredit = 0
  let preTotalDebit = 0
  for (const e of entries) {
    if (e.type === 'credit') preTotalCredit += e.amount
    else if (e.type === 'debit') preTotalDebit += e.amount
  }
  const preNet = preTotalCredit - preTotalDebit
  const tileY = 48
  const tileH = 14
  const tileW = (pageWidth - margin * 2 - 4) / 3
  const renderTile = (
    x: number,
    label: string,
    value: string,
    detail: string,
    color: [number, number, number],
  ) => {
    doc.setDrawColor(220)
    doc.setFillColor(248, 248, 250)
    doc.rect(x, tileY, tileW, tileH, 'FD')
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.text(label.toUpperCase(), x + 2, tileY + 4)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(value, x + 2, tileY + 9.5)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 120, 120)
    doc.text(detail, x + 2, tileY + 13)
  }
  renderTile(
    margin,
    'Credits',
    `INR ${preTotalCredit.toLocaleString('en-IN')}`,
    `${entries.filter((e) => e.type === 'credit').length} entries`,
    [22, 130, 80],
  )
  renderTile(
    margin + tileW + 2,
    'Debits',
    `INR ${preTotalDebit.toLocaleString('en-IN')}`,
    `${entries.filter((e) => e.type === 'debit').length} entries`,
    preTotalDebit > 0 ? [200, 100, 30] : [180, 180, 180],
  )
  renderTile(
    margin + (tileW + 2) * 2,
    'Net payable',
    `INR ${preNet.toLocaleString('en-IN')}`,
    'credits − debits',
    preNet > 0 ? [22, 110, 50] : preNet < 0 ? [200, 60, 50] : [60, 60, 60],
  )
  doc.setTextColor(0, 0, 0)

  // Merge synthetic payout debits (one per locked / settled / completed
  // invoice) into the entries list so the PDF reflects what the vendor
  // has been paid. Filtered to the same date window.
  const fromMs = new Date(`${fromDate}T00:00:00`).getTime()
  const toMs = new Date(`${toDate}T23:59:59`).getTime()
  const synthPayouts = synthPayoutEntries(vendorId, vendorInvoices).filter((e) => {
    const t = new Date(e.date).getTime()
    return Number.isFinite(t) && t >= fromMs && t <= toMs
  })
  entries = [...entries, ...synthPayouts]

  // Index transactions + invoices by booking ID so per-row lookup is O(1).
  const txnByRef = new Map<string, TransactionRecord>()
  for (const t of transactions) {
    if (t.id) txnByRef.set(t.id, t)
  }
  // Invoice status per booking — derived by walking each VendorInvoice's
  // entries[].referenceId. The invoice covers a date range; every entry
  // inside it inherits the invoice's status (Pending / Locked / Settled).
  // If the same booking appears in multiple invoices (rare), we keep
  // the strongest status (Locked / Settled wins over Pending).
  const invoiceStatusByBooking = new Map<string, string>()
  // Firestore stores `status` as lowercase ('locked', 'pending', 'settled')
  // but the audit / UI uses capitalized labels ('Locked', 'Pending').
  // Normalize so the PDF shows the conventional Title Case.
  const titleCaseStatus = (s: string): string =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Pending'
  for (const inv of vendorInvoices) {
    if (inv.vendorId !== vendorId) continue
    const statusLabel = titleCaseStatus(String(inv.status || 'pending'))
    const invEntries = Array.isArray(inv.entries) ? inv.entries : []
    for (const ie of invEntries) {
      const bid = ie.referenceId || ''
      if (!bid) continue
      const existing = invoiceStatusByBooking.get(bid)
      if (existing === 'Locked' || existing === 'Settled') continue
      invoiceStatusByBooking.set(bid, statusLabel)
    }
  }

  // Build per-row data with running balance.
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  let running = 0
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const tableRows: Array<Array<string>> = []
  let totalCredit = 0
  let totalDebit = 0
  for (const e of sorted) {
    const dateStr = (e.date || '').slice(0, 10)
    const d = new Date(`${dateStr}T00:00:00`)
    const day = Number.isFinite(d.getTime()) ? dayNames[d.getDay()] : ''
    const branch = getLocationDisplayName(e.locationId || '') || e.locationId || '—'
    // Description: prefer activity / variant names from billingItems
    // (matched via referenceId → transaction → billingItems[]). Falls
    // back to note → source + ref → '—'. Refund / cancellation rows
    // get a [REFUND] / [CANCEL] prefix so debits stand out at a glance.
    const sourcePrefix =
      e.type === 'debit' && e.source === 'refund'
        ? '[REFUND] '
        : e.type === 'debit' && e.source === 'cancellation'
          ? '[CANCEL] '
          : e.type === 'debit' && (e.source as unknown as string) === 'payout'
            ? '[PAYOUT] '
            : ''
    const description = sourcePrefix + describeLedgerEntry(e, txnByRef)
    const refId = e.referenceId || e.invoiceNumber || ''
    const status = invoiceStatusByBooking.get(refId) || ''
    const credit = e.type === 'credit' ? e.amount : 0
    const debit = e.type === 'debit' ? e.amount : 0
    running += credit - debit
    totalCredit += credit
    totalDebit += debit
    tableRows.push([
      dateStr,
      day,
      description,
      branch,
      status,
      credit > 0 ? credit.toLocaleString('en-IN') : '',
      debit > 0 ? debit.toLocaleString('en-IN') : '',
      running.toLocaleString('en-IN'),
    ])
  }
  // Totals row
  tableRows.push([
    '',
    '',
    'TOTAL',
    '',
    '',
    totalCredit.toLocaleString('en-IN'),
    totalDebit.toLocaleString('en-IN'),
    running.toLocaleString('en-IN'),
  ])

  autoTable(doc, {
    startY: tileY + tileH + 4,
    margin: { left: margin, right: margin },
    head: [
      [
        'Date',
        'Day',
        'Activity / variant',
        'Branch',
        'Status',
        'Credit (INR)',
        'Debit (INR)',
        'Balance (INR)',
      ],
    ],
    body: tableRows,
    headStyles: { fillColor: [40, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 11, halign: 'center' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 22 },
      4: { cellWidth: 18, halign: 'center' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Bold + tinted last row (totals).
      if (data.row.index === tableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = [240, 240, 240]
        return
      }
      // Tint debit rows so refund / cancellation entries are visible at a glance.
      const debitCol = 6
      const cellText = String(data.cell.raw ?? '')
      if (data.column.index === debitCol && cellText && cellText !== '0') {
        data.cell.styles.fillColor = [255, 244, 230]
      }
      // Tint Locked / Settled status cells.
      if (data.column.index === 4) {
        if (cellText === 'Locked' || cellText === 'Settled') {
          data.cell.styles.textColor = [22, 130, 80]
          data.cell.styles.fontStyle = 'bold'
        } else if (cellText === 'Pending') {
          data.cell.styles.textColor = [180, 110, 0]
        }
      }
    },
  })

  // ── Bank details footer ───────────────────────────────────────────────
  type DocWithLastTable = import('jspdf').default & {
    lastAutoTable?: { finalY: number }
  }
  const lastY = (doc as DocWithLastTable).lastAutoTable?.finalY ?? 200
  let footerY = lastY + 10
  // If we're too close to the bottom, push to a new page.
  if (footerY > 260) {
    doc.addPage()
    footerY = 20
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Vendor Bank Details', margin, footerY)
  footerY += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const blank = '—'
  const lines: Array<[string, string]> = bank
    ? [
        ['Account holder', bank.accountHolder || blank],
        ['Bank name', bank.bankName || blank],
        ['Account number', bank.accountNumber || blank],
        ['IFSC code', bank.ifsc || blank],
        ['PAN number', bank.pan || blank],
        ['GST number', bank.gst || blank],
        ['Address', bank.address || blank],
        ['Contact', bank.mobile || blank],
      ]
    : [
        ['Account holder', blank],
        ['Bank name', blank],
        ['Account number', blank],
        ['IFSC code', blank],
      ]
  for (const [label, value] of lines) {
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, margin, footerY)
    doc.setFont('helvetica', 'normal')
    const valueLines = doc.splitTextToSize(value || blank, pageWidth - margin * 2 - 35)
    doc.text(valueLines, margin + 35, footerY)
    footerY += Math.max(5, valueLines.length * 5)
  }

  // Net payable callout.
  footerY += 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(running >= 0 ? 24 : 180, running >= 0 ? 110 : 30, 50)
  doc.text(`Net payable to vendor: INR ${running.toLocaleString('en-IN')}`, margin, footerY)
  doc.setTextColor(0, 0, 0)
  return doc
}

const VendorLedgerModal = ({
  vendor,
  range,
  onClose,
  bank,
  expectedEarned,
  transactions = [],
  vendorInvoices = [],
}: {
  vendor: { vendorId: string; vendorName: string }
  range: { from: string; to: string }
  onClose: () => void
  transactions?: TransactionRecord[]
  vendorInvoices?: VendorInvoice[]
  /** Bank details for the PDF footer; null when not loaded. */
  bank: {
    accountHolder: string
    bankName: string
    accountNumber: string
    ifsc: string
    pan: string
    gst: string
    address: string
    mobile: string
  } | null
  /** What the Settlements row says this vendor earned (from
   *  billingItems[].vendorTotal). Used to detect drift between what the
   *  trigger wrote to the ledger vs what billingItems claims. */
  expectedEarned?: number
}) => {
  const { session } = useAuth()
  const [entries, setEntries] = useState<VendorLedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    accountingApi
      .listLedger(vendor.vendorId)
      .then((all) => {
        if (cancelled) return
        const fromMs = new Date(`${range.from}T00:00:00`).getTime()
        const toMs = new Date(`${range.to}T23:59:59`).getTime()
        // Build a set of in-period transaction IDs. Refund / cancel /
        // manual debits reference a booking via `referenceId` but their
        // own `date` field is often stamped with the BOOKING'S date
        // (per `pickTransactionDate` in the Cloud Function), not the
        // date the debit was actually written. A pure date-window
        // filter therefore drops debits that affect this period's
        // payable — exactly the "missing debits" the user sees.
        // Including any ledger row whose `referenceId` matches an
        // in-period booking covers refunds, cancellations, and manual
        // adjustments without changing the writers.
        const txnIdsInRange = new Set(
          transactions
            .filter((t) => {
              const d = (t.transactionDate ?? '').slice(0, 10)
              return d >= range.from && d <= range.to
            })
            .map((t) => t.id),
        )
        const filtered = all.filter((e) => {
          const t = new Date(e.date).getTime()
          const dateInRange = Number.isFinite(t) && t >= fromMs && t <= toMs
          const refInRange = e.referenceId && txnIdsInRange.has(e.referenceId)
          return dateInRange || refInRange
        })
        // Merge in synthetic payout debits derived from completed /
        // locked weekly invoices, filtered to the same range.
        const payouts = synthPayoutEntries(vendor.vendorId, vendorInvoices).filter((e) => {
          const t = new Date(e.date).getTime()
          return Number.isFinite(t) && t >= fromMs && t <= toMs
        })
        const merged = [...filtered, ...payouts]
        merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        setEntries(merged)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load ledger.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [vendor.vendorId, range.from, range.to, vendorInvoices, transactions, refreshKey])

  // Inline drift fix — the drift banner exposes this as a one-click button
  // so admin doesn't have to navigate to Reconciliation → Ledger Drift,
  // re-scope to the same vendor + period, and apply.
  const handleReconcileDriftNow = async () => {
    if (!session) return
    setReconcileBusy(true)
    setReconcileResult(null)
    try {
      const allRows = await detectLedgerVsBillingDrift(range.from, range.to)
      const myRows = allRows.filter((r) => r.vendorId === vendor.vendorId)
      if (myRows.length === 0) {
        setReconcileResult(
          'No drift rows detected for this vendor in the period. Try reloading — the gap may already be closed.',
        )
        return
      }
      const result = await applyLedgerToBillingTruth(myRows, {
        id: session.user.id,
        name: session.user.name,
      })
      const verifyMsg =
        result.verifyFailures.length > 0
          ? ` · ${result.verifyFailures.length} verify mismatch(es) — open Reconciliation → Ledger Drift to inspect.`
          : ''
      setReconcileResult(
        `Wrote ${result.succeeded.length} corrective row(s) · ` +
          `${currency(result.totalCreditApplied)} credits · ${currency(result.totalDebitApplied)} debits.` +
          verifyMsg +
          ` Now click "Regenerate this period" in Invoices to update the Pending Settlement card.`,
      )
      // Trigger the listLedger effect to re-load entries.
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setReconcileResult(`Failed: ${err instanceof Error ? err.message : 'Reconcile error'}`)
    } finally {
      setReconcileBusy(false)
    }
  }

  const totals = useMemo(() => {
    let credits = 0
    let debits = 0
    for (const e of entries) {
      if (e.type === 'credit') credits += e.amount
      else if (e.type === 'debit') debits += e.amount
    }
    return { credits, debits, net: credits - debits }
  }, [entries])

  const handleDownload = () => {
    const csv = buildVendorLedgerCsv(
      vendor.vendorName,
      vendor.vendorId,
      range.from,
      range.to,
      entries,
    )
    const safeName = vendor.vendorName.replace(/[^a-zA-Z0-9]+/g, '_')
    triggerCsvDownload(
      `ledger-${safeName}-${vendor.vendorId}-${range.from}-to-${range.to}.csv`,
      csv,
    )
  }

  const [pdfBusy, setPdfBusy] = useState(false)
  const handleDownloadPdf = async () => {
    setPdfBusy(true)
    try {
      const doc = await buildVendorLedgerPdf(
        vendor.vendorName,
        vendor.vendorId,
        range.from,
        range.to,
        entries,
        bank,
        transactions,
        vendorInvoices,
      )
      const safeName = vendor.vendorName.replace(/[^a-zA-Z0-9]+/g, '_')
      doc.save(`ledger-${safeName}-${vendor.vendorId}-${range.from}-to-${range.to}.pdf`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to generate PDF.')
    } finally {
      setPdfBusy(false)
    }
  }
  const handlePreviewPdf = async () => {
    setPdfBusy(true)
    try {
      const doc = await buildVendorLedgerPdf(
        vendor.vendorName,
        vendor.vendorId,
        range.from,
        range.to,
        entries,
        bank,
        transactions,
        vendorInvoices,
      )
      const url = doc.output('bloburl') as unknown as string
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened) {
        window.alert('Popup blocked. Allow pop-ups for this site to preview vendor ledger PDFs.')
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to preview PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} maxWidth="max-w-4xl">
      <div className="flex items-start justify-between border-b border-border/60 px-5 py-3">
        <div>
          <h3 className="text-base font-semibold text-text">{vendor.vendorName}</h3>
          <p className="text-xs text-muted">
            <code className="font-mono">{vendor.vendorId}</code> · {range.from} → {range.to} ·{' '}
            {entries.length} ledger entr{entries.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading || entries.length === 0}
            className="ui-btn ui-btn-neutral text-xs disabled:opacity-50"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => void handlePreviewPdf()}
            disabled={loading || entries.length === 0 || pdfBusy}
            className="ui-btn ui-btn-neutral text-xs disabled:opacity-50"
            title="Open the PDF in a new tab without saving to disk."
          >
            {pdfBusy ? 'Working…' : 'Preview PDF'}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={loading || entries.length === 0 || pdfBusy}
            className="ui-btn ui-btn-accent text-xs disabled:opacity-50"
          >
            {pdfBusy ? 'Generating PDF…' : 'Download PDF'}
          </button>
          <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-xs">
            Close
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-border/60 bg-surface px-5 py-2 text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">Credits</p>
          <p className="font-mono text-success">{currency(totals.credits)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">Debits</p>
          <p className="font-mono text-warning">{currency(totals.debits)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted">Net payable</p>
          <p
            className={`font-mono font-semibold ${
              totals.net > 0 ? 'text-success' : totals.net < 0 ? 'text-warning' : 'text-text'
            }`}
          >
            {currency(totals.net)}
          </p>
        </div>
      </div>

      {/* Drift banner — fires when the Settlements row's totalEarned
          (computed from billingItems[].vendorTotal) doesn't match the
          actual ledger sum. Indicates the trigger missed credits or
          debits the billing pipeline says should exist. The Reconciliation
          → Ledger drift tab fixes these via idempotent corrective writes. */}
      {(() => {
        if (typeof expectedEarned !== 'number' || !Number.isFinite(expectedEarned)) {
          return null
        }
        const drift = expectedEarned - totals.net
        if (Math.abs(drift) <= 2) return null
        const direction = drift > 0 ? 'short' : 'over'
        return (
          <div
            className={`border-b px-5 py-2 text-xs ${
              direction === 'short'
                ? 'border-warning/40 bg-warning/5 text-warning'
                : 'border-info/40 bg-info/5 text-info'
            }`}
          >
            <p className="font-semibold">
              ⚠ Drift vs Settlements: {currency(expectedEarned)} earned per billingItems but ledger
              shows {currency(totals.net)} ({direction === 'short' ? '−' : '+'}
              {currency(Math.abs(drift))}).
            </p>
            <p className="mt-0.5 text-[11px] opacity-90">
              The Settlements page computes from{' '}
              <code className="font-mono">billingItems[].vendorTotal</code> (canonical). The ledger
              shows what the trigger actually wrote.{' '}
              {direction === 'short'
                ? 'Trigger missed credits this vendor is owed.'
                : 'Ledger has extra credits not backed by billing.'}{' '}
              Click <strong>Reconcile now</strong> to write the corrective ledger row(s) for this
              vendor in this period — then Regenerate the invoice to refresh the Pending Settlement
              card.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReconcileDriftNow()}
                disabled={reconcileBusy || !session}
                className="ui-btn ui-btn-warning min-h-7 px-3 py-0.5 text-[11px] disabled:opacity-50"
                title={`Detect drift rows for this vendor in ${range.from} → ${range.to} and apply corrective lc-reconcile-/ld-reconcile- ledger writes. Same as Reconciliation → Ledger Drift → Apply, scoped to this vendor.`}
              >
                {reconcileBusy
                  ? 'Reconciling…'
                  : `Reconcile now — ${direction === 'short' ? '+ ' : '− '}${currency(Math.abs(drift))}`}
              </button>
              {reconcileResult ? (
                <span className="text-[11px] text-text/90">{reconcileResult}</span>
              ) : null}
            </div>
          </div>
        )
      })()}

      <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
        {loading ? (
          <p className="text-sm text-muted">Loading ledger…</p>
        ) : error ? (
          <p className="rounded border border-critical/45 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">No ledger entries in this range.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-surface text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1 text-right">Base</th>
                <th className="px-2 py-1 text-right">GST</th>
                <th className="px-2 py-1 text-left">Source</th>
                <th className="px-2 py-1 text-left">Booking</th>
                <th className="px-2 py-1 text-left">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-1 text-muted">{(e.date || '').slice(0, 10)}</td>
                  <td className="px-2 py-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        e.type === 'credit'
                          ? 'border-success/40 bg-success/5 text-success'
                          : 'border-warning/40 bg-warning/5 text-warning'
                      }`}
                    >
                      {e.type}
                    </span>
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono ${
                      e.type === 'credit' ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {e.type === 'credit' ? '+' : '−'}
                    {currency(e.amount)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted">
                    {e.vendorBase != null ? currency(e.vendorBase) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-muted">
                    {e.vendorGst != null ? currency(e.vendorGst) : '—'}
                  </td>
                  <td className="px-2 py-1 text-[10px] text-muted">{e.source || '—'}</td>
                  <td className="px-2 py-1 font-mono text-[10px]">{e.referenceId || '—'}</td>
                  <td className="px-2 py-1 text-[10px] text-muted">{e.locationId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  )
}

// ─── Settlements View ─────────────────────────────────────────────────────────
const SettlementsView = ({
  settlements,
  loading,
  isOwner,
  range,
  onRangeChange,
  onBackfill,
  backfillRunning,
  backfillResult,
  vendorDetailsList = [],
  transactions = [],
  vendorInvoices = [],
}: {
  settlements: VendorSettlementSummary[]
  loading: boolean
  isOwner: boolean
  range: { from: string; to: string }
  onRangeChange: (next: { from: string; to: string }) => void
  onBackfill: (from: string, to: string) => void
  backfillRunning: boolean
  backfillResult: {
    weeksProcessed: number
    vendorInvoicesTouched: number
    errorCount: number
  } | null
  /** Vendor metadata — used to fetch bank details for the PDF footer. */
  vendorDetailsList?: VendorDetailsRecord[]
  /** Transactions — used to enrich PDF Description with activity / variant
   *  names per ledger row (matched by referenceId == booking ID). */
  transactions?: TransactionRecord[]
  /** Invoices — used to surface Locked / Pending status per booking
   *  alongside the ledger row, so the PDF reflects settlement state. */
  vendorInvoices?: VendorInvoice[]
}) => {
  const totalEarned = settlements.reduce((s, v) => s + v.totalEarned, 0)
  const totalPending = settlements.filter((v) => v.pendingInvoices > 0).length

  const campaigns = useEventCampaigns()
  // Vendor invoices whose period intersects the active settlements range
  // — feeds the campaign breakdown panel without re-fetching ledger.
  const invoicesInRange = useMemo(
    () =>
      vendorInvoices.filter((inv) => inv.periodStart <= range.to && inv.periodEnd >= range.from),
    [vendorInvoices, range.from, range.to],
  )

  // Open vendor for the View-ledger modal. null = closed. Stores the
  // minimum identifying pair so the modal can fetch + filter on demand.
  const [openLedgerVendor, setOpenLedgerVendor] = useState<{
    vendorId: string
    vendorName: string
  } | null>(null)

  // Pull bank details (+ contact, address, GST/PAN) for a vendor from
  // the already-loaded vendorDetailsList. Returns null if not found —
  // PDF still renders with placeholders so admin sees the gap.
  const lookupVendorBank = useCallback(
    (vendorId: string) => {
      const v = vendorDetailsList.find((d) => d.userId === vendorId)
      if (!v) return null
      // VendorDetailsRecord doesn't carry panNumber as a typed field —
      // some legacy docs still have it on disk so we read defensively.
      const pan = (v as unknown as Record<string, unknown>).panNumber
      return {
        accountHolder: v.particular || v.vendorName || '',
        bankName: v.bankName || '',
        accountNumber: v.bankAccountNumber || '',
        ifsc: v.ifscCode || '',
        pan: typeof pan === 'string' ? pan : '',
        gst: v.gstNumber || '',
        address: v.address || '',
        mobile: v.mobileNumber || '',
      }
    },
    [vendorDetailsList],
  )

  // Fetch + filter ledger entries scoped to the active accounting week.
  const fetchScopedLedger = useCallback(
    async (vendorId: string): Promise<VendorLedgerEntry[]> => {
      const all = await accountingApi.listLedger(vendorId)
      const fromMs = new Date(`${range.from}T00:00:00`).getTime()
      const toMs = new Date(`${range.to}T23:59:59`).getTime()
      return all.filter((e) => {
        const t = new Date(e.date).getTime()
        return Number.isFinite(t) && t >= fromMs && t <= toMs
      })
    },
    [range.from, range.to],
  )

  // One-shot CSV download from the Actions column.
  const handleDirectDownload = useCallback(
    async (vendorId: string, vendorName: string) => {
      try {
        const filtered = await fetchScopedLedger(vendorId)
        const csv = buildVendorLedgerCsv(vendorName, vendorId, range.from, range.to, filtered)
        const safeName = vendorName.replace(/[^a-zA-Z0-9]+/g, '_')
        triggerCsvDownload(`ledger-${safeName}-${vendorId}-${range.from}-to-${range.to}.csv`, csv)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Failed to download vendor ledger.')
      }
    },
    [range.from, range.to, fetchScopedLedger],
  )

  // One-shot PDF download from the Actions column. Same scope as CSV
  // plus bank details footer rendered into the PDF.
  const handleDirectPdfDownload = useCallback(
    async (vendorId: string, vendorName: string) => {
      try {
        const filtered = await fetchScopedLedger(vendorId)
        const bank = lookupVendorBank(vendorId)
        const doc = await buildVendorLedgerPdf(
          vendorName,
          vendorId,
          range.from,
          range.to,
          filtered,
          bank,
          transactions,
          vendorInvoices,
        )
        const safeName = vendorName.replace(/[^a-zA-Z0-9]+/g, '_')
        doc.save(`ledger-${safeName}-${vendorId}-${range.from}-to-${range.to}.pdf`)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Failed to generate vendor ledger PDF.')
      }
    },
    [range.from, range.to, fetchScopedLedger, lookupVendorBank, transactions, vendorInvoices],
  )

  // Open the PDF in a new tab without forcing download. Useful for a
  // quick eyeball before issuing a cheque — admin closes the tab and
  // moves on, no file sitting in Downloads.
  const handleDirectPdfPreview = useCallback(
    async (vendorId: string, vendorName: string) => {
      try {
        const filtered = await fetchScopedLedger(vendorId)
        const bank = lookupVendorBank(vendorId)
        const doc = await buildVendorLedgerPdf(
          vendorName,
          vendorId,
          range.from,
          range.to,
          filtered,
          bank,
          transactions,
          vendorInvoices,
        )
        // bloburl gives a blob: URL the browser renders inline. Browsers
        // honor the suggested filename if the user later does Save As.
        const url = doc.output('bloburl') as unknown as string
        const opened = window.open(url, '_blank', 'noopener,noreferrer')
        if (!opened) {
          window.alert('Popup blocked. Allow pop-ups for this site to preview vendor ledger PDFs.')
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Failed to preview vendor ledger PDF.')
      }
    },
    [range.from, range.to, fetchScopedLedger, lookupVendorBank, transactions, vendorInvoices],
  )

  // Snap any picked date to its containing Saturday-week boundary so the
  // visible range always represents whole accounting weeks.
  const snapFrom = (value: string) => {
    if (!value) return range.from
    const [y, m, d] = value.split('-').map(Number)
    const start = getPeriodStart(new Date(y, m - 1, d))
    return start
  }
  const snapTo = (value: string) => {
    if (!value) return range.to
    const [y, m, d] = value.split('-').map(Number)
    const start = getPeriodStart(new Date(y, m - 1, d))
    return getPeriodEnd(start)
  }

  const shiftWeeks = (deltaWeeks: number) => {
    const [y, m, d] = range.from.split('-').map(Number)
    const next = new Date(y, m - 1, d + deltaWeeks * 7)
    const from = getPeriodStart(next)
    onRangeChange({ from, to: getPeriodEnd(from) })
  }

  const goToCurrentWeek = () => {
    const from = getPeriodStart()
    onRangeChange({ from, to: getPeriodEnd(from) })
  }

  return (
    <>
      <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text">Accounting Week</p>
            <p className="text-xs text-muted">
              Sat {range.from} 00:00 IST → Fri {range.to} 23:59 IST
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-muted">
              From
              <input
                type="date"
                value={range.from}
                onChange={(e) => {
                  const from = snapFrom(e.target.value)
                  const to = from > range.to ? getPeriodEnd(from) : range.to
                  onRangeChange({ from, to })
                }}
                className="mt-1 rounded border border-border bg-bg px-2 py-1 text-sm text-text"
                disabled={loading}
              />
            </label>
            <label className="flex flex-col text-xs text-muted">
              To
              <input
                type="date"
                value={range.to}
                onChange={(e) => {
                  const to = snapTo(e.target.value)
                  const from = to < range.from ? getPeriodStart(new Date(to)) : range.from
                  onRangeChange({ from, to })
                }}
                className="mt-1 rounded border border-border bg-bg px-2 py-1 text-sm text-text"
                disabled={loading}
              />
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftWeeks(-1)}
                disabled={loading}
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-50"
              >
                ◀ Prev week
              </button>
              <button
                type="button"
                onClick={goToCurrentWeek}
                disabled={loading}
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-50"
              >
                This week
              </button>
              <button
                type="button"
                onClick={() => shiftWeeks(1)}
                disabled={loading}
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text disabled:opacity-50"
              >
                Next week ▶
              </button>
            </div>
          </div>
        </div>
      </div>

      <SummaryCards
        items={[
          {
            id: 'vendors',
            label: 'Active Vendors',
            value: String(settlements.length),
            tone: 'info',
          },
          {
            id: 'earned',
            label: 'Total Vendor Payable',
            value: currency(totalEarned),
            tone: 'success',
          },
          {
            id: 'pending',
            label: 'Vendors with Pending Invoices',
            value: String(totalPending),
            tone: 'warning',
          },
        ]}
      />

      <CampaignBreakdownPanel
        invoices={invoicesInRange}
        campaigns={campaigns}
        currency={currency}
        title="Settlements — campaign breakdown"
        transactions={transactions}
      />

      {isOwner ? (
        <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text">Backfill Vendor Ledger</p>
              <p className="text-xs text-muted">
                Re-runs weekly invoice generation across every Saturday-week in the range above,
                which also writes any missing <code>vendorLedger</code> rows for bookings whose
                original write path bypassed it (Razorpay webhook, customer-app drafts, etc.).
                Locked invoices are untouched.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => onBackfill(range.from, range.to)}
              disabled={backfillRunning}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {backfillRunning ? 'Backfilling…' : 'Run Backfill'}
            </button>
            {backfillResult ? (
              <span className="text-xs text-muted">
                Processed {backfillResult.weeksProcessed} week(s), touched{' '}
                {backfillResult.vendorInvoicesTouched} invoice(s)
                {backfillResult.errorCount > 0 ? `, ${backfillResult.errorCount} error(s)` : ''}.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <DataTable
        columns={[
          {
            key: 'vendor',
            header: 'Vendor',
            render: (v) => {
              const company = v.vendorCompanyName
              const contact = v.vendorName ?? v.vendorId
              if (company) {
                return (
                  <div>
                    <span className="font-medium text-text">{company}</span>
                    <span className="block text-xs text-muted">{contact}</span>
                  </div>
                )
              }
              return contact
            },
          },
          { key: 'txns', header: 'Transactions', render: (v) => v.totalTransactions },
          {
            key: 'base',
            header: 'Total Base',
            render: (v) => <span className="text-sm text-muted">{currency(v.totalBase)}</span>,
          },
          {
            key: 'gst',
            header: 'Total GST',
            render: (v) => <span className="text-sm text-muted">{currency(v.totalGst)}</span>,
          },
          {
            key: 'earned',
            header: 'Total Payable',
            render: (v) => <span className="font-bold text-text">{currency(v.totalEarned)}</span>,
          },
          {
            key: 'pending',
            header: 'Pending Invoices',
            render: (v) =>
              v.pendingInvoices > 0 ? (
                <span className="text-warning font-semibold">{v.pendingInvoices}</span>
              ) : (
                '0'
              ),
          },
          {
            key: 'locked',
            header: 'Settled',
            render: (v) => <span className="text-success">{v.lockedInvoices}</span>,
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (v) => {
              const name = v.vendorCompanyName || v.vendorName || v.vendorId
              return (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setOpenLedgerVendor({ vendorId: v.vendorId, vendorName: name })}
                    className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
                    title={`View ${name}'s ledger entries for ${range.from} to ${range.to}`}
                  >
                    View ledger
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDirectDownload(v.vendorId, name)}
                    className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
                    title={`Download ${name}'s ledger as CSV for ${range.from} to ${range.to}`}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDirectPdfPreview(v.vendorId, name)}
                    className="ui-btn ui-btn-neutral min-h-7 px-2 py-0.5 text-[11px]"
                    title={`Preview ${name}'s ledger PDF in a new tab (no file saved). Same content as the Download PDF button.`}
                  >
                    Preview PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDirectPdfDownload(v.vendorId, name)}
                    className="ui-btn ui-btn-accent min-h-7 px-2 py-0.5 text-[11px]"
                    title={`Download ${name}'s ledger as PDF (with bank details) for ${range.from} to ${range.to}`}
                  >
                    PDF
                  </button>
                </div>
              )
            },
          },
        ]}
        rows={settlements}
        rowKey={(v) => v.vendorId}
        emptyMessage={loading ? 'Loading settlements...' : 'No vendor data available.'}
      />

      {openLedgerVendor ? (
        <VendorLedgerModal
          vendor={openLedgerVendor}
          range={range}
          bank={lookupVendorBank(openLedgerVendor.vendorId)}
          expectedEarned={
            settlements.find((s) => s.vendorId === openLedgerVendor.vendorId)?.totalEarned
          }
          transactions={transactions}
          vendorInvoices={vendorInvoices}
          onClose={() => setOpenLedgerVendor(null)}
        />
      ) : null}
    </>
  )
}

// ─── Reports View ─────────────────────────────────────────────────────────────
const ReportsView = ({
  transactions,
  loading,
  isVendor,
  vendorId,
}: {
  transactions: TransactionRecord[]
  loading: boolean
  isVendor: boolean
  vendorId?: string
}) => {
  const { enabledLocations } = useLocations()
  const todayStr = todayIST()
  const [fromDate, setFromDate] = useState(todayStr)
  const [toDate, setToDate] = useState(todayStr)
  const [locationFilter, setLocationFilter] = useState('All')

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (t.paymentStatus === 'pending' || t.paymentStatus === 'failed') return false
      const txnDate = t.transactionDate.slice(0, 10)
      if (txnDate < fromDate) return false
      if (txnDate > toDate) return false
      if (locationFilter !== 'All' && (t.locationId ?? '') !== locationFilter) return false
      return true
    })
  }, [transactions, fromDate, toDate, locationFilter])

  const totalRevenue = filtered.reduce((s, t) => s + t.totalAmount, 0)
  const totalBase = filtered.reduce((s, t) => s + (t.baseAmount ?? 0), 0)
  const totalGst = filtered.reduce((s, t) => s + (t.gstAmount ?? 0), 0)
  const totalVendorBase = filtered.reduce((s, t) => {
    if (vendorId && t.items?.length)
      return (
        s +
        t.items.filter((i) => i.vendorId === vendorId).reduce((a, i) => a + (i.vendorBase ?? 0), 0)
      )
    return s + (t.vendorBase ?? 0)
  }, 0)
  const totalVendorGst = filtered.reduce((s, t) => {
    if (vendorId && t.items?.length)
      return (
        s +
        t.items.filter((i) => i.vendorId === vendorId).reduce((a, i) => a + (i.vendorGst ?? 0), 0)
      )
    return s + (t.vendorGst ?? 0)
  }, 0)
  const totalVendor = filtered.reduce((s, t) => {
    if (vendorId && t.items?.length)
      return (
        s +
        t.items.filter((i) => i.vendorId === vendorId).reduce((a, i) => a + (i.vendorTotal ?? 0), 0)
      )
    return s + (t.vendorTotal ?? 0)
  }, 0)
  const totalCompanyBase = filtered.reduce((s, t) => s + (t.companyBase ?? 0), 0)
  const totalCompanyGst = filtered.reduce((s, t) => s + (t.companyGst ?? 0), 0)
  const totalCompany = filtered.reduce((s, t) => s + (t.companyTotal ?? t.totalAmount), 0)
  const refundTotal = filtered.reduce((s, t) => s + (t.refundAmount ?? 0), 0)
  const totalDiscount = filtered.reduce((s, t) => s + (t.discount ?? t.couponDiscount ?? 0), 0)
  const couponUsageCount = filtered.filter((t) => t.couponCode).length

  const byLocation = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach((t) => {
      const loc = getLocationDisplayName(t.locationId ?? '') || 'Unknown'
      map[loc] = (map[loc] ?? 0) + t.totalAmount
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const byPayment = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach((t) => {
      if (t.paymentMethod === 'Split') {
        if (t.splitCash) map.Cash = (map.Cash ?? 0) + t.splitCash
        if (t.splitUpi) map.UPI = (map.UPI ?? 0) + t.splitUpi
        if (t.splitCard) map.Card = (map.Card ?? 0) + t.splitCard
      } else {
        map[t.paymentMethod] = (map[t.paymentMethod] ?? 0) + t.totalAmount
      }
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">From</label>
          <input
            type="date"
            className="ui-field min-h-9"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">To</label>
          <input
            type="date"
            className="ui-field min-h-9"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">Location</label>
          <select
            className="ui-field min-h-9"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
          >
            <option value="All">All Locations</option>
            {enabledLocations.map((loc) => (
              <option key={loc.slug} value={loc.slug}>
                {loc.displayName}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-muted">{filtered.length} transactions</span>
      </div>

      <SummaryCards
        items={
          isVendor
            ? [
                {
                  id: 'earned-base',
                  label: 'Your Base',
                  value: currency(totalVendorBase),
                  tone: 'info' as const,
                },
                {
                  id: 'earned-gst',
                  label: 'Your GST Share',
                  value: currency(totalVendorGst),
                  tone: 'muted' as const,
                },
                {
                  id: 'earned',
                  label: 'Your Total Earnings',
                  value: currency(totalVendor),
                  tone: 'success' as const,
                },
                {
                  id: 'txns',
                  label: 'Transactions',
                  value: String(filtered.length),
                  tone: 'muted' as const,
                },
              ]
            : [
                {
                  id: 'revenue',
                  label: 'Gross Revenue',
                  value: currency(totalRevenue),
                  tone: 'info',
                },
                { id: 'base', label: 'Base Amount', value: currency(totalBase), tone: 'muted' },
                { id: 'gst', label: 'GST Collected', value: currency(totalGst), tone: 'muted' },
                {
                  id: 'vendor',
                  label: 'Vendor Payable',
                  value: currency(totalVendor),
                  tone: 'warning' as const,
                },
                {
                  id: 'company',
                  label: 'Company Earnings',
                  value: currency(totalCompany),
                  tone: 'success' as const,
                },
                {
                  id: 'refund',
                  label: 'Refunds Issued',
                  value: currency(refundTotal),
                  tone: 'warning' as const,
                },
                {
                  id: 'discount',
                  label: 'Total Discounts',
                  value: currency(totalDiscount),
                  tone: 'warning' as const,
                },
                {
                  id: 'coupon-usage',
                  label: 'Coupon Transactions',
                  value: String(couponUsageCount),
                  tone: 'info' as const,
                },
              ]
        }
      />

      {!isVendor && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <h4 className="mb-3 text-sm font-semibold text-text">Revenue Split Breakdown</h4>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Vendor Base</p>
              <p className="font-semibold text-text">{currency(totalVendorBase)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Vendor GST</p>
              <p className="font-semibold text-text">{currency(totalVendorGst)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Vendor Total</p>
              <p className="font-bold text-warning">{currency(totalVendor)}</p>
            </div>
            <div className="md:col-span-1" />
            <div>
              <p className="text-xs text-muted">Company Base</p>
              <p className="font-semibold text-text">{currency(totalCompanyBase)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Company GST</p>
              <p className="font-semibold text-text">{currency(totalCompanyGst)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Company Total</p>
              <p className="font-bold text-success">{currency(totalCompany)}</p>
            </div>
          </div>
        </div>
      )}

      {!isVendor && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <DetailPanel title="Revenue by Location">
            {loading ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : byLocation.length === 0 ? (
              <p className="text-sm text-muted">No data.</p>
            ) : (
              <div className="space-y-2">
                {byLocation.map(([loc, amt]) => (
                  <div key={loc} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-text">{loc}</span>
                    <span className="text-sm font-bold text-text">{currency(amt)}</span>
                    <div className="h-2 w-24 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.round((amt / totalRevenue) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailPanel>

          <DetailPanel title="Revenue by Payment Method">
            {loading ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : byPayment.length === 0 ? (
              <p className="text-sm text-muted">No data.</p>
            ) : (
              <div className="space-y-2">
                {byPayment.map(([method, amt]) => (
                  <div key={method} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-text">{method}</span>
                    <span className="text-sm font-bold text-text">{currency(amt)}</span>
                    <div className="h-2 w-24 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-success"
                        style={{ width: `${Math.round((amt / totalRevenue) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailPanel>
        </div>
      )}
    </>
  )
}

// ─── Main Module ───────────────────────────────────────────────────────────────
const AccountingModule = ({ view }: { view: AccountingView }) => {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [ledgerEntries, setLedgerEntries] = useState<VendorLedgerEntry[]>([])
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoice[]>([])
  const [companyInvoices, setCompanyInvoices] = useState<CompanyInvoice[]>([])
  const [settlements, setSettlements] = useState<VendorSettlementSummary[]>([])
  const [transactions, setTransactions] = useState<TransactionRecord[]>([])

  const [vendorDetailsList, setVendorDetailsList] = useState<VendorDetailsRecord[]>([])

  // Invoice location filter. 'All' is the canonical "no filter" sentinel
  // (matches the dropdown's first option value). Earlier this was '' which
  // looked correct in the rendered <select> (browsers fall back to the
  // first option when value doesn't match), but `!locationFilter` then
  // tripped the empty-state branch — so Owner/Admin saw "Select a
  // location above to view invoices" even though "All locations" was
  // visually selected. Vendors get this overwritten with their branchId
  // by the effect below once `vendorDetails.branchId` resolves.
  const [invoiceLocationFilter, setInvoiceLocationFilter] = useState('All')
  const [staleInfo, setStaleInfo] = useState<{ stale: boolean; newTxnCount: number }>({
    stale: false,
    newTxnCount: 0,
  })

  // Accountant gets the same accounting-write access as Admin. This is
  // their primary tool — they need to lock periods, mark vendor
  // invoices as paid, record cheque/UTR numbers, finalize batches,
  // export GST, etc. The destructive admin-only operations (deleting
  // entire invoice docs, system-level backfills) remain gated via
  // separate `isOwner` checks in this file, so Accountant can do their
  // job without being able to nuke historical records.
  const isOwnerOrAdmin =
    session?.user.role === 'Owner' ||
    session?.user.role === 'Admin' ||
    session?.user.role === 'Accountant'
  const isOwner = session?.user.role === 'Owner'
  const isVendor = session?.user.role === 'ThirdParty'
  const isAccountant = session?.user.role === 'Accountant'
  const vendorId = isVendor ? session?.user.id : undefined

  // Settlements date-range state (current accounting week by default; persists across reloads).
  const SETTLEMENTS_RANGE_KEY = 'accounting.settlements.dateRange'
  const [settlementsRange, setSettlementsRange] = useState<{ from: string; to: string }>(() => {
    try {
      const raw =
        typeof window !== 'undefined' ? window.localStorage.getItem(SETTLEMENTS_RANGE_KEY) : null
      if (raw) {
        const parsed = JSON.parse(raw) as { from?: unknown; to?: unknown }
        if (
          typeof parsed.from === 'string' &&
          typeof parsed.to === 'string' &&
          parsed.from &&
          parsed.to
        ) {
          return { from: parsed.from, to: parsed.to }
        }
      }
    } catch {
      /* fall through to default */
    }
    const from = getPeriodStart()
    return { from, to: getPeriodEnd(from) }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(SETTLEMENTS_RANGE_KEY, JSON.stringify(settlementsRange))
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [settlementsRange])

  // Vendor-ledger backfill state (Owner-only)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [backfillResult, setBackfillResult] = useState<{
    weeksProcessed: number
    vendorInvoicesTouched: number
    errorCount: number
  } | null>(null)
  const [vendorLocationStatus, setVendorLocationStatus] = useState<
    'idle' | 'loading' | 'loaded' | 'error'
  >(isVendor ? 'loading' : 'idle')
  const [vendorLocationError, setVendorLocationError] = useState<string | null>(null)
  const [myVendorDetails, setMyVendorDetails] = useState<VendorDetailsRecord | null>(null)
  const [taxBillPeriod, setTaxBillPeriod] = useState<string | null>(null)

  // Load vendor's fixed branchId from vendorDetails
  useEffect(() => {
    if (!isVendor || !session?.token) return
    setVendorLocationStatus('loading')
    vendorDetailsApi
      .getMine(session.token)
      .then((details) => {
        setMyVendorDetails(details)
        // `branchId` is the canonical slug, populated when an Owner/Admin
        // edits the vendor. Self-registered vendors only have the freeform
        // `branch` field (e.g. "Vizag", "Visakhapatnam"). Resolve that
        // against the location registry as a fallback so vendors aren't
        // blocked on an admin action they don't know they need.
        const resolvedFromBranch = details.branch
          ? resolveLocation(details.branch)?.branchId
          : undefined
        const branchId = details.branchId || resolvedFromBranch
        if (branchId) {
          setInvoiceLocationFilter(branchId)
          setVendorLocationStatus('loaded')
        } else {
          setVendorLocationError('No location assigned to your account. Please contact admin.')
          setVendorLocationStatus('error')
        }
      })
      .catch((err) => {
        setVendorLocationError(
          err instanceof Error
            ? err.message
            : 'Unable to load location. Please refresh or contact admin.',
        )
        setVendorLocationStatus('error')
      })
  }, [isVendor, session?.token])

  const allowedSubnav = useMemo(() => {
    if (isOwnerOrAdmin) return subnav
    // Vendors see ledger, invoices, reports. Settlements are admin-only;
    // Discrepancies is the company's incident queue (send notice / mark
    // resolved) — vendors get their individual notices through the
    // public report URL `/r/disc/:reference`, never through this tab.
    const HIDDEN_FROM_VENDORS = new Set(['Settlements', 'Discrepancies'])
    return subnav.filter((s) => !HIDDEN_FROM_VENDORS.has(s.label))
  }, [isOwnerOrAdmin])

  const loadData = async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      if (view === 'ledger') {
        // Transactions are loaded alongside the ledger so each row can
        // display the originating game (derived from txn items via referenceId).
        const [entries, details, txns] = await Promise.all([
          accountingApi.listLedger(vendorId),
          isOwnerOrAdmin
            ? vendorDetailsApi.list(session.token)
            : Promise.resolve([] as VendorDetailsRecord[]),
          accountingApi.listTransactions(vendorId),
        ])
        setLedgerEntries(entries)
        setTransactions(txns)
        if (details.length > 0) setVendorDetailsList(details)
      } else if (view === 'invoices') {
        // ── Auto-generate invoices for any period in the user's window.
        //
        // Server-side `autoGenerateIfDue` is gated by a Firestore lease
        // doc (`accountingMeta/autoGenerationLease`) with a 5-minute
        // cooldown — see `tryAcquireGenerationLease`. So even though
        // the page calls it on every visit, the actual 8-week walk
        // fires at most once per cooldown window across all Owners.
        // After the cooldown elapses the call costs O(1) — a single
        // doc read + transactional set.
        if (isOwnerOrAdmin) {
          try {
            const generated = await accountingApi.autoGenerateIfDue(settlementsRange)
            if (generated) setSuccess('Invoices auto-generated for this period.')
          } catch {
            /* non-critical — continue loading */
          }
        }
        // ── Bounded reads.
        //
        // The invoices view shows the current week PLUS recent past-
        // period sections (Pending Settlement, Completed History).
        // Bounding by `settlementsRange` (current week by default)
        // would empty those sections — the user would need to widen
        // the date filter every visit. Instead use a fixed rolling
        // 12-week window from today: bounded enough to keep the
        // payload constant regardless of how much history has
        // accumulated, wide enough that Pending/Completed stay
        // populated. The Settlements tab handles wider date ranges.
        //
        // Vendor lookup runs in parallel but does NOT gate the table
        // render — it's only consumed by cheque/letterhead metadata
        // in expanded rows.
        const invoiceWindowFrom = (() => {
          const periodStartDate = new Date(`${getPeriodStart()}T12:00:00.000Z`)
          periodStartDate.setUTCDate(periodStartDate.getUTCDate() - 7 * 11)
          return periodStartDate.toISOString().slice(0, 10)
        })()
        const invoiceRange = { from: invoiceWindowFrom }
        const [vi, ci] = await Promise.all([
          accountingApi.listVendorInvoices(vendorId, invoiceRange),
          isOwnerOrAdmin
            ? accountingApi.listCompanyInvoices(invoiceRange)
            : Promise.resolve([] as CompanyInvoice[]),
        ])
        if (isOwnerOrAdmin && vendorDetailsList.length === 0) {
          vendorDetailsApi
            .list(session.token)
            .then((details) => {
              if (details.length > 0) setVendorDetailsList(details)
            })
            .catch(() => undefined)
        }
        // NOTE: Auto-lock removed — past-period invoices now stay unlocked
        // until explicitly settled via the Cheque + Letterhead flow in
        // the Pending Settlement section.
        // NOTE: `backfillVendorType()` removed from page load — that scan
        // belongs in a one-shot `scripts/*.ts` job, not on every Owner
        // refresh. Legacy invoices missing vendorType render with the
        // missing-state in the table, prompting an admin to run the
        // script when convenient. New invoices stamp vendorType at write
        // time in `generateFirestoreWeeklyInvoices`.

        setVendorInvoices(vi)
        setCompanyInvoices(ci)
        // Check for stale invoices (non-blocking)
        if (isOwnerOrAdmin) {
          try {
            const stale = await accountingApi.checkInvoicesStale(getPeriodStart())
            setStaleInfo(stale)
          } catch {
            /* non-critical */
          }
        }
      } else if (view === 'settlements' && isOwnerOrAdmin) {
        const s = await accountingApi.getSettlements(settlementsRange)
        setSettlements(s)
      } else if (view === 'reports') {
        const t = await accountingApi.listTransactions(vendorId)
        setTransactions(t)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounting data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.user.id, settlementsRange.from, settlementsRange.to])

  const onGenerate = async () => {
    setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await accountingApi.generateWeeklyInvoices()
      setSuccess(`Generated ${result.vendorInvoices.length} vendor invoice(s) for this week.`)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoices.')
    } finally {
      setGenerating(false)
    }
  }

  const onBackfillVendorLedger = async (from: string, to: string) => {
    if (!isOwner) return
    setBackfillRunning(true)
    setError(null)
    setSuccess(null)
    setBackfillResult(null)
    try {
      const result = await accountingApi.backfillVendorLedger({ from, to })
      setBackfillResult({
        weeksProcessed: result.weeksProcessed,
        vendorInvoicesTouched: result.vendorInvoicesTouched,
        errorCount: result.errors.length,
      })
      setSuccess(
        `Backfill complete: ${result.weeksProcessed} week(s), ${result.vendorInvoicesTouched} invoice(s) touched.`,
      )
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed.')
    } finally {
      setBackfillRunning(false)
    }
  }

  if (!session) return null
  if (!isOwnerOrAdmin && !isVendor && !isAccountant) {
    return (
      <ModulePageLayout
        moduleTab="Accounting"
        title="Accounting"
        subtitle=""
        breadcrumbs={['Pipeline', 'Accounting']}
      >
        <p className="text-sm text-muted">You do not have access to the Accounting module.</p>
      </ModulePageLayout>
    )
  }

  return (
    <ModulePageLayout
      moduleTab="Accounting"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Accounting', titleMap[view]]}
      subnav={allowedSubnav}
    >
      {error ? (
        <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      ) : null}

      {view === 'ledger' && (
        <LedgerView
          entries={ledgerEntries}
          loading={loading}
          isVendor={isVendor}
          isOwner={isOwner}
          vendorDetailsList={vendorDetailsList}
          transactions={transactions}
          vendorInvoices={vendorInvoices}
          onAfterBackfill={() => void loadData()}
        />
      )}

      {view === 'invoices' && (
        <InvoicesView
          vendorInvoices={vendorInvoices}
          companyInvoices={companyInvoices}
          loading={loading}
          isOwnerOrAdmin={isOwnerOrAdmin}
          onGenerate={onGenerate}
          generating={generating}
          locationFilter={invoiceLocationFilter}
          onLocationFilterChange={setInvoiceLocationFilter}
          staleInfo={staleInfo}
          isVendor={isVendor}
          vendorDetailsList={vendorDetailsList}
          session={session}
          onFinalized={() => {
            setSuccess('All invoices locked and letterhead generated.')
            void loadData()
          }}
          vendorLocationStatus={vendorLocationStatus}
          vendorLocationError={vendorLocationError}
          myVendorDetails={myVendorDetails}
          taxBillPeriod={taxBillPeriod}
          onTaxBillPeriodChange={setTaxBillPeriod}
        />
      )}

      {view === 'settlements' && isOwnerOrAdmin && (
        <SettlementsView
          settlements={settlements}
          loading={loading}
          isOwner={isOwner}
          range={settlementsRange}
          onRangeChange={setSettlementsRange}
          onBackfill={onBackfillVendorLedger}
          backfillRunning={backfillRunning}
          backfillResult={backfillResult}
          vendorDetailsList={vendorDetailsList}
          transactions={transactions}
          vendorInvoices={vendorInvoices}
        />
      )}

      {view === 'reports' && (
        <ReportsView
          transactions={transactions}
          loading={loading}
          isVendor={isVendor}
          vendorId={vendorId}
        />
      )}

      {view === 'discrepancies' && (
        <DiscrepanciesView isOwner={isOwnerOrAdmin} vendorDetailsList={vendorDetailsList} />
      )}
    </ModulePageLayout>
  )
}

export default AccountingModule

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, documentId } from 'firebase/firestore'
import type { VendorInvoice, VendorDetailsRecord } from '../api/types'
import { initializeFirestore } from '../lib/firebase'
import { mapTransactionRecord } from '../api/billing-firestore'
import { fmtDateIST } from '../../lib/date-format'
import { getLocationDisplayName } from '../../lib/locations'
import { amountToWords } from '../lib/generate-tax-bill-pdf'

export interface GameBreakdownItem {
  gameName: string
  sessions: number
  amount: number
}

interface BillingFrom {
  company: string
  name: string
  address: string
  gstin: string
  phone: string
  email: string
}

interface BilledTo {
  company: string
  name: string
  address: string
  gstin: string
}

const defaultBilledTo: BilledTo = {
  company: 'A Square Entertainments',
  name: 'BODDETI ANAND',
  address:
    'Anandapuram Junction, Bus Stop, 16, National Highway, Visakhapatnam, Vellanki, Andhra Pradesh 531163',
  gstin: '37AQKPB9099G3ZB',
}

const fmtINR = (n: number): string => `INR ${Math.round(n).toLocaleString('en-IN')}`

const todayISO = (): string => {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

export const TaxBillModal = ({
  open,
  onClose,
  periodStart,
  periodEnd,
  vendorInvoices,
  vendorDetails,
  locationFilter,
}: {
  open: boolean
  onClose: () => void
  periodStart: string
  periodEnd: string
  vendorInvoices: VendorInvoice[]
  vendorDetails: VendorDetailsRecord | null
  locationFilter: string
}) => {
  // ── Form state ──
  const [billingFrom, setBillingFrom] = useState<BillingFrom>({
    company: '',
    name: '',
    address: '',
    gstin: '',
    phone: '',
    email: '',
  })
  const [billedTo, setBilledTo] = useState<BilledTo>(defaultBilledTo)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Auto-fill from vendor details ──
  useEffect(() => {
    if (!vendorDetails) return
    setBillingFrom({
      company: vendorDetails.particular || vendorDetails.vendorName || '',
      name: vendorDetails.vendorName || '',
      address: vendorDetails.address || '',
      gstin: vendorDetails.gstNumber || '',
      phone: vendorDetails.mobileNumber || '',
      email: vendorDetails.email || '',
    })
  }, [vendorDetails])

  // ── Auto-generate invoice number ──
  useEffect(() => {
    const ps = periodStart.replace(/-/g, '').slice(4)
    const pe = periodEnd.replace(/-/g, '').slice(4)
    const yr = periodStart.slice(0, 4)
    setInvoiceNumber(`INV${yr}${ps}${pe}`)
  }, [periodStart, periodEnd])

  // ── Per-game breakdown from transaction items ──
  const [gameBreakdown, setGameBreakdown] = useState<GameBreakdownItem[]>([])

  useEffect(() => {
    let cancelled = false

    const compute = async () => {
      const fs = initializeFirestore()
      if (!fs) return

      // Collect all transaction referenceIds from invoice entries
      const refIds = new Set<string>()
      const vendorId = vendorInvoices[0]?.vendorId
      if (!vendorId) return
      for (const inv of vendorInvoices) {
        for (const entry of inv.entries ?? []) {
          if (entry.referenceId) refIds.add(entry.referenceId)
        }
      }
      if (refIds.size === 0) return

      // Batch-fetch transactions (Firestore 'in' queries limited to 30)
      const ids = Array.from(refIds)
      const col = collection(fs, 'bookings')
      const txns: Record<string, unknown>[] = []
      for (let i = 0; i < ids.length; i += 30) {
        const batch = ids.slice(i, i + 30)
        const snap = await getDocs(query(col, where(documentId(), 'in', batch)))
        for (const d of snap.docs) {
          txns.push({ id: d.id, ...(d.data() as Record<string, unknown>) })
        }
      }

      // Group by game name
      const gameMap = new Map<string, { sessions: number; amount: number }>()
      for (const raw of txns) {
        const txn = mapTransactionRecord(String(raw.id), raw as Record<string, unknown>)
        const items = txn.items ?? []
        const vendorItems = items.filter((it) => it.vendorId === vendorId)
        const relevantItems = vendorItems.length > 0 ? vendorItems : items

        for (const item of relevantItems) {
          const gameName = (item.itemName ?? '').split(' — ')[0]?.trim() || 'Other'
          const existing = gameMap.get(gameName) ?? { sessions: 0, amount: 0 }
          existing.sessions += item.quantity ?? 1
          existing.amount += item.vendorBase ?? 0
          gameMap.set(gameName, existing)
        }
      }

      if (cancelled) return
      const breakdown = Array.from(gameMap.entries())
        .map(([gameName, data]) => ({ gameName, sessions: data.sessions, amount: data.amount }))
        .sort((a, b) => b.amount - a.amount)
      setGameBreakdown(breakdown)
    }

    void compute()
    return () => {
      cancelled = true
    }
  }, [vendorInvoices])

  // ── Compute totals from vendor invoices ──
  const totals = useMemo(() => {
    let totalBase = 0
    let totalGst = 0
    let totalAmount = 0
    let txnCount = 0
    for (const inv of vendorInvoices) {
      totalBase += inv.totalBase
      totalGst += inv.totalGst
      totalAmount += inv.totalAmount
      txnCount += inv.transactionCount
    }
    const cgst = Math.round((totalGst / 2) * 100) / 100
    const sgst = Math.round((totalGst / 2) * 100) / 100
    return { totalBase, totalGst, totalAmount, txnCount, cgst, sgst }
  }, [vendorInvoices])

  const locationLabel = getLocationDisplayName(locationFilter) || locationFilter

  // ── Generate PDF ──
  const buildConfig = () => ({
    invoiceNumber,
    invoiceDate,
    periodStart,
    periodEnd,
    billingFrom,
    billedTo,
    locationLabel,
    transactionCount: totals.txnCount,
    totalBase: totals.totalBase,
    cgstAmount: totals.cgst,
    sgstAmount: totals.sgst,
    igstAmount: 0,
    grandTotal: totals.totalAmount,
    amountInWords: amountToWords(totals.totalAmount),
    gameBreakdown: gameBreakdown.length > 0 ? gameBreakdown : undefined,
  })

  const handlePreview = async () => {
    setGenerating(true)
    setError(null)
    try {
      const { generateTaxBillPdf } = await import('../lib/generate-tax-bill-pdf')
      const doc = generateTaxBillPdf(buildConfig())
      const blobUrl = doc.output('bloburl') as unknown as string
      setPreviewUrl(blobUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview.')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = async () => {
    setGenerating(true)
    setError(null)
    try {
      const { generateTaxBillPdf } = await import('../lib/generate-tax-bill-pdf')
      const doc = generateTaxBillPdf(buildConfig())
      doc.save(`TaxInvoice_${invoiceNumber}.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF.')
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  const updateFrom = (key: keyof BillingFrom, value: string) =>
    setBillingFrom((prev) => ({ ...prev, [key]: value }))
  const updateTo = (key: keyof BilledTo, value: string) =>
    setBilledTo((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/70 p-4">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border/70 bg-panel shadow-panel">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div>
            <h3 className="font-display text-lg font-semibold text-text">Tax Invoice</h3>
            <p className="text-xs text-muted">
              {fmtDateIST(periodStart)} – {fmtDateIST(periodEnd)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-sm">
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-5">
          {/* Billing From / Billed To */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {/* Billing From */}
            <fieldset className="rounded-lg border border-border p-4 space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                Billing From
              </legend>
              <label className="grid gap-1 text-xs text-muted">
                Company
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billingFrom.company}
                  onChange={(e) => updateFrom('company', e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Name
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billingFrom.name}
                  onChange={(e) => updateFrom('name', e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Address
                <textarea
                  className="ui-field min-h-16 text-sm"
                  value={billingFrom.address}
                  onChange={(e) => updateFrom('address', e.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                GSTIN
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billingFrom.gstin}
                  onChange={(e) => updateFrom('gstin', e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-muted">
                  Phone
                  <input
                    className="ui-field min-h-9 text-sm"
                    value={billingFrom.phone}
                    onChange={(e) => updateFrom('phone', e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted">
                  Email
                  <input
                    className="ui-field min-h-9 text-sm"
                    value={billingFrom.email}
                    onChange={(e) => updateFrom('email', e.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            {/* Billed To */}
            <fieldset className="rounded-lg border border-border p-4 space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted px-1">
                Billed To
              </legend>
              <label className="grid gap-1 text-xs text-muted">
                Company
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billedTo.company}
                  onChange={(e) => updateTo('company', e.target.value)}
                  placeholder="Company name"
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Name
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billedTo.name}
                  onChange={(e) => updateTo('name', e.target.value)}
                  placeholder="Contact name"
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                Address
                <textarea
                  className="ui-field min-h-16 text-sm"
                  value={billedTo.address}
                  onChange={(e) => updateTo('address', e.target.value)}
                  placeholder="Full address"
                />
              </label>
              <label className="grid gap-1 text-xs text-muted">
                GSTIN
                <input
                  className="ui-field min-h-9 text-sm"
                  value={billedTo.gstin}
                  onChange={(e) => updateTo('gstin', e.target.value)}
                  placeholder="e.g. 37AAMCA0812H1ZV"
                />
              </label>
            </fieldset>
          </div>

          {/* Invoice meta */}
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
              Invoice Number
              <input
                className="ui-field min-h-9 text-sm"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
              Invoice Date
              <input
                className="ui-field min-h-9 text-sm"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </label>
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-border bg-surface/50 p-4 space-y-2">
            <p className="text-sm font-medium text-text">
              Vendor revenue for period {fmtDateIST(periodStart)} – {fmtDateIST(periodEnd)}
            </p>
            <p className="text-xs text-muted">
              Location: {locationLabel} · {totals.txnCount} transactions
            </p>
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Base Amount</span>
                <span className="font-medium text-text">{fmtINR(totals.totalBase)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">CGST (9%)</span>
                <span className="text-text">{fmtINR(totals.cgst)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">SGST (9%)</span>
                <span className="text-text">{fmtINR(totals.sgst)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 mt-2">
                <span className="font-bold text-text">Grand Total</span>
                <span className="font-bold text-text">{fmtINR(totals.totalAmount)}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted italic">{amountToWords(totals.totalAmount)}</p>
          </div>

          {/* Preview */}
          {previewUrl && (
            <iframe
              src={previewUrl}
              title="Tax Invoice Preview"
              className="w-full rounded-lg border border-border"
              style={{ height: '500px' }}
            />
          )}

          {error && <p className="text-sm text-critical">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3 shrink-0">
          <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={generating}
            className="ui-btn ui-btn-neutral text-sm"
          >
            {generating ? 'Generating...' : 'Preview PDF'}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={generating}
            className="ui-btn ui-btn-success text-sm"
          >
            {generating ? 'Generating...' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}

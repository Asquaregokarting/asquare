import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type {
  CompanyInvoice,
  TransactionRecord,
  VendorInvoice,
  VendorLedgerEntry,
} from '../../api/types'
import { getLocationDisplayName } from '../../../lib/locations'
import { downloadBlob } from '../incentives-report/download'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0066FF' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }
const FOOTER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
}
const RUPEE_FORMAT = '"₹"#,##0.00'

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.font = HEADER_FONT
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'left' }
}

const sanitize = (s: string): string =>
  s
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Invoice'

const vendorDisplayName = (inv: VendorInvoice): string =>
  inv.vendorCompanyName?.trim() || inv.vendorName?.trim() || inv.vendorId

const addInvoiceSummarySheet = (wb: ExcelJS.Workbook, inv: VendorInvoice): void => {
  const ws = wb.addWorksheet('Invoice')
  ws.addRow([`A Square GoKarting — Vendor Invoice`])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([])

  const rows: Array<[string, string | number]> = [
    ['Vendor / Sublease', vendorDisplayName(inv)],
    ['Vendor ID', inv.vendorId],
    ['Vendor Type', inv.vendorType ?? '—'],
    ['Contact Name', inv.vendorName ?? '—'],
    ['Company Name', inv.vendorCompanyName ?? '—'],
    ['Location', getLocationDisplayName(inv.locationId ?? '') || (inv.locationId ?? '—')],
    ['Period Start', inv.periodStart],
    ['Period End', inv.periodEnd],
    ['Status', inv.status],
    ['Generated At', inv.generatedAt],
    ['Locked At', inv.lockedAt ?? '—'],
    ['Cheque #', inv.chequeNumber ?? '—'],
    ['Payout Initiated At', inv.payoutInitiatedAt ?? '—'],
    ['Payout Initiated By', inv.payoutInitiatedBy ?? '—'],
    ['Letterhead Downloaded At', inv.letterheadDownloadedAt ?? '—'],
    ['Transaction Count', inv.transactionCount],
  ]
  for (const r of rows) {
    const row = ws.addRow(r)
    row.getCell(1).font = { bold: true }
  }

  ws.addRow([])
  const totalsHeader = ws.addRow(['Totals', 'Amount'])
  styleHeaderRow(totalsHeader)
  ws.addRow(['Total Base', inv.totalBase])
  ws.addRow(['Total GST', inv.totalGst])
  const grand = ws.addRow(['Total Amount', inv.totalAmount])
  grand.font = { bold: true }
  grand.fill = FOOTER_FILL

  ws.columns = [{ width: 28 }, { width: 36 }]
  // Format the amount column for the totals block (last 3 rows)
  const lastRow = ws.lastRow?.number ?? 0
  for (let i = lastRow - 2; i <= lastRow; i++) {
    ws.getCell(i, 2).numFmt = RUPEE_FORMAT
  }
}

const addLineItemsSheet = (wb: ExcelJS.Workbook, entries: VendorLedgerEntry[]): void => {
  const ws = wb.addWorksheet('Line Items')
  const header = ws.addRow([
    'Date',
    'Type',
    'Entry Type',
    'Source',
    'Reference',
    'Invoice #',
    'Location',
    'Reason',
    'Created By',
    'Vendor Base',
    'Vendor GST',
    'Amount',
  ])
  styleHeaderRow(header)

  let base = 0
  let gst = 0
  let amount = 0
  for (const e of entries) {
    ws.addRow([
      e.date,
      e.type,
      e.entryType ?? 'sale',
      e.source ?? '—',
      e.referenceId,
      e.invoiceNumber ?? '—',
      getLocationDisplayName(e.locationId ?? '') || (e.locationId ?? '—'),
      e.reason ?? '',
      e.createdByName ?? e.createdBy ?? '',
      e.vendorBase ?? 0,
      e.vendorGst ?? 0,
      e.amount,
    ])
    base += e.vendorBase ?? 0
    gst += e.vendorGst ?? 0
    amount += e.amount
  }

  const totals = ws.addRow(['', '', '', '', '', '', '', '', 'Totals', base, gst, amount])
  totals.font = { bold: true }
  totals.fill = FOOTER_FILL

  ws.columns = [
    { width: 12 },
    { width: 10 },
    { width: 18 },
    { width: 12 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 32 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ]
  ws.getColumn(10).numFmt = RUPEE_FORMAT
  ws.getColumn(11).numFmt = RUPEE_FORMAT
  ws.getColumn(12).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

/**
 * Returns the subset of `transactions` referenced by this invoice's ledger
 * entries (matched on transaction.id, with a fallback on invoiceNumber).
 */
const transactionsForInvoice = (
  inv: VendorInvoice,
  transactions: TransactionRecord[],
): TransactionRecord[] => {
  const refIds = new Set<string>()
  const refInvNums = new Set<string>()
  for (const e of inv.entries ?? []) {
    if (e.referenceId) refIds.add(e.referenceId)
    if (e.invoiceNumber) refInvNums.add(e.invoiceNumber)
  }
  return transactions.filter(
    (t) => refIds.has(t.id) || (t.invoiceNumber && refInvNums.has(t.invoiceNumber)),
  )
}

const addTransactionsSheet = (wb: ExcelJS.Workbook, txns: TransactionRecord[]): void => {
  const ws = wb.addWorksheet('Transactions')
  const header = ws.addRow([
    'Date',
    'Visit Date',
    'Invoice #',
    'Source',
    'Customer',
    'Phone',
    'Location',
    'Payment Method',
    'Payment Status',
    'Coupon',
    'Discount',
    'Wallet Redeemed',
    'Base',
    'GST',
    'Total',
    'Refund Status',
    'Refund Amount',
    'Cancelled',
    'Vendor Base',
    'Vendor GST',
    'Vendor Total',
    'Created By',
  ])
  styleHeaderRow(header)

  let base = 0
  let gst = 0
  let total = 0
  let vBase = 0
  let vGst = 0
  let vTotal = 0
  for (const t of txns) {
    ws.addRow([
      t.transactionDate,
      t.visitDate ?? '',
      t.invoiceNumber,
      t.source ?? '',
      t.customerName ?? '',
      t.customerPhone ?? '',
      getLocationDisplayName(t.locationId ?? '') || (t.locationId ?? ''),
      t.paymentMethod,
      t.paymentStatus ?? '',
      t.couponCode ?? '',
      t.discount ?? 0,
      t.walletRedeemed ?? 0,
      t.baseAmount ?? 0,
      t.gstAmount ?? 0,
      t.totalAmount,
      t.refundStatus,
      t.refundAmount ?? 0,
      t.cancelled ? 'Yes' : '',
      t.vendorBase ?? 0,
      t.vendorGst ?? 0,
      t.vendorTotal ?? 0,
      t.createdByName ?? t.createdBy ?? '',
    ])
    base += t.baseAmount ?? 0
    gst += t.gstAmount ?? 0
    total += t.totalAmount
    vBase += t.vendorBase ?? 0
    vGst += t.vendorGst ?? 0
    vTotal += t.vendorTotal ?? 0
  }

  const totals = ws.addRow([
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'Totals',
    base,
    gst,
    total,
    '',
    '',
    '',
    vBase,
    vGst,
    vTotal,
    '',
  ])
  totals.font = { bold: true }
  totals.fill = FOOTER_FILL

  const widths = [
    12, 12, 16, 10, 22, 14, 16, 14, 14, 14, 12, 14, 14, 12, 14, 14, 14, 10, 14, 12, 14, 18,
  ]
  ws.columns = widths.map((w) => ({ width: w }))
  for (const col of [11, 12, 13, 14, 15, 17, 19, 20, 21]) {
    ws.getColumn(col).numFmt = RUPEE_FORMAT
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

const addTransactionItemsSheet = (
  wb: ExcelJS.Workbook,
  vendorId: string,
  txns: TransactionRecord[],
): void => {
  const ws = wb.addWorksheet('Transaction Items')
  const header = ws.addRow([
    'Date',
    'Invoice #',
    'Customer',
    'Item',
    'Qty',
    'Unit Price',
    'Item Discount',
    'Item Base',
    'Item GST',
    'Vendor Share %',
    'Vendor Base',
    'Vendor GST',
    'Vendor Total',
  ])
  styleHeaderRow(header)

  let qty = 0
  let unit = 0
  let itemBase = 0
  let itemGst = 0
  let vBase = 0
  let vGst = 0
  let vTotal = 0
  for (const t of txns) {
    const items = (t.items ?? []).filter((it) => !it.vendorId || it.vendorId === vendorId)
    // If no item carries a vendorId at all (event-package case), include all items unfiltered
    const final = items.length > 0 ? items : (t.items ?? [])
    for (const it of final) {
      ws.addRow([
        t.transactionDate,
        t.invoiceNumber,
        t.customerName ?? '',
        it.itemName,
        it.quantity,
        it.unitPrice,
        it.itemDiscount ?? 0,
        it.itemBaseAmount ?? 0,
        it.itemGstAmount ?? 0,
        it.vendorSharePercent ?? '',
        it.vendorBase ?? 0,
        it.vendorGst ?? 0,
        it.vendorTotal ?? 0,
      ])
      qty += it.quantity
      unit += it.unitPrice
      itemBase += it.itemBaseAmount ?? 0
      itemGst += it.itemGstAmount ?? 0
      vBase += it.vendorBase ?? 0
      vGst += it.vendorGst ?? 0
      vTotal += it.vendorTotal ?? 0
    }
  }

  const totals = ws.addRow([
    '',
    '',
    '',
    'Totals',
    qty,
    unit,
    '',
    itemBase,
    itemGst,
    '',
    vBase,
    vGst,
    vTotal,
  ])
  totals.font = { bold: true }
  totals.fill = FOOTER_FILL

  ws.columns = [
    { width: 12 },
    { width: 16 },
    { width: 22 },
    { width: 32 },
    { width: 8 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
  ]
  for (const col of [6, 7, 8, 9, 11, 12, 13]) ws.getColumn(col).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

const buildVendorInvoiceWorkbook = (
  inv: VendorInvoice,
  transactions?: TransactionRecord[],
): ExcelJS.Workbook => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()
  addInvoiceSummarySheet(wb, inv)
  addLineItemsSheet(wb, inv.entries ?? [])
  if (transactions && transactions.length > 0) {
    const txns = transactionsForInvoice(inv, transactions)
    if (txns.length > 0) {
      addTransactionsSheet(wb, txns)
      addTransactionItemsSheet(wb, inv.vendorId, txns)
    }
  }
  return wb
}

const buildCompanyInvoiceWorkbook = (inv: CompanyInvoice): ExcelJS.Workbook => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()

  const ws = wb.addWorksheet('Invoice')
  ws.addRow([`A Square GoKarting — Company Invoice`])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([])

  const rows: Array<[string, string | number]> = [
    ['Period Start', inv.periodStart],
    ['Period End', inv.periodEnd],
    ['Status', inv.status],
    ['Generated At', inv.generatedAt],
    ['Locked At', inv.lockedAt ?? '—'],
    ['Cheque #', inv.chequeNumber ?? '—'],
    ['Transaction Count', inv.transactionCount],
  ]
  for (const r of rows) {
    const row = ws.addRow(r)
    row.getCell(1).font = { bold: true }
  }

  ws.addRow([])
  const breakdownHeader = ws.addRow(['Breakdown', 'Base', 'GST', 'Total'])
  styleHeaderRow(breakdownHeader)
  ws.addRow(['Company Owned', inv.companyOwnedBase, inv.companyOwnedGst, inv.companyOwnedTotal])
  ws.addRow([
    'Company Share (Vendor Games)',
    inv.companyShareBase,
    inv.companyShareGst,
    inv.companyShareTotal,
  ])
  const grand = ws.addRow([
    'Grand Total',
    inv.companyOwnedBase + inv.companyShareBase,
    inv.companyOwnedGst + inv.companyShareGst,
    inv.totalAmount,
  ])
  grand.font = { bold: true }
  grand.fill = FOOTER_FILL

  ws.columns = [{ width: 32 }, { width: 18 }, { width: 18 }, { width: 18 }]
  for (const col of [2, 3, 4]) ws.getColumn(col).numFmt = RUPEE_FORMAT

  // By Vendor sheet
  if (Object.keys(inv.byVendor ?? {}).length > 0) {
    const bv = wb.addWorksheet('By Vendor')
    const h = bv.addRow(['Vendor ID', 'Amount'])
    styleHeaderRow(h)
    let total = 0
    for (const [vendorId, amt] of Object.entries(inv.byVendor)) {
      bv.addRow([vendorId, amt])
      total += amt
    }
    const t = bv.addRow(['Total', total])
    t.font = { bold: true }
    t.fill = FOOTER_FILL
    bv.columns = [{ width: 36 }, { width: 18 }]
    bv.getColumn(2).numFmt = RUPEE_FORMAT
    bv.views = [{ state: 'frozen', ySplit: 1 }]
  }

  // By Location sheet
  if (Object.keys(inv.byLocation ?? {}).length > 0) {
    const bl = wb.addWorksheet('By Location')
    const h = bl.addRow(['Location', 'Amount'])
    styleHeaderRow(h)
    let total = 0
    for (const [locId, amt] of Object.entries(inv.byLocation)) {
      bl.addRow([getLocationDisplayName(locId) || locId, amt])
      total += amt
    }
    const t = bl.addRow(['Total', total])
    t.font = { bold: true }
    t.fill = FOOTER_FILL
    bl.columns = [{ width: 28 }, { width: 18 }]
    bl.getColumn(2).numFmt = RUPEE_FORMAT
    bl.views = [{ state: 'frozen', ySplit: 1 }]
  }

  return wb
}

const workbookToBlob = async (wb: ExcelJS.Workbook): Promise<Blob> => {
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const vendorInvoiceFilename = (inv: VendorInvoice): string =>
  `Invoice_${sanitize(vendorDisplayName(inv))}_${inv.periodStart}_${inv.periodEnd}.xlsx`

const companyInvoiceFilename = (inv: CompanyInvoice): string =>
  `Company_${inv.periodStart}_${inv.periodEnd}.xlsx`

export const downloadVendorInvoiceExcel = async (
  inv: VendorInvoice,
  transactions?: TransactionRecord[],
): Promise<void> => {
  const wb = buildVendorInvoiceWorkbook(inv, transactions)
  const blob = await workbookToBlob(wb)
  downloadBlob(vendorInvoiceFilename(inv), blob)
}

export const downloadCompanyInvoiceExcel = async (inv: CompanyInvoice): Promise<void> => {
  const wb = buildCompanyInvoiceWorkbook(inv)
  const blob = await workbookToBlob(wb)
  downloadBlob(companyInvoiceFilename(inv), blob)
}

/**
 * Bundles every invoice in `vendorInvoices` (and optionally `companyInvoices`) into a single
 * .zip — one .xlsx per invoice. Filename collisions get a numeric suffix.
 */
export const downloadInvoicesZip = async (
  vendorInvoices: VendorInvoice[],
  companyInvoices: CompanyInvoice[],
  periodStart: string,
  periodEnd: string,
  zipLabel?: string,
  transactions?: TransactionRecord[],
): Promise<void> => {
  if (vendorInvoices.length === 0 && companyInvoices.length === 0) return

  const zip = new JSZip()
  const used = new Set<string>()
  const uniqueName = (name: string): string => {
    if (!used.has(name)) {
      used.add(name)
      return name
    }
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let i = 2
    while (used.has(`${stem}_${i}${ext}`)) i++
    const finalName = `${stem}_${i}${ext}`
    used.add(finalName)
    return finalName
  }

  for (const inv of vendorInvoices) {
    const wb = buildVendorInvoiceWorkbook(inv, transactions)
    const buffer = await wb.xlsx.writeBuffer()
    zip.file(uniqueName(vendorInvoiceFilename(inv)), buffer)
  }
  for (const inv of companyInvoices) {
    const wb = buildCompanyInvoiceWorkbook(inv)
    const buffer = await wb.xlsx.writeBuffer()
    zip.file(uniqueName(companyInvoiceFilename(inv)), buffer)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const label = zipLabel ? `_${sanitize(zipLabel)}` : ''
  downloadBlob(`Invoices${label}_${periodStart}_${periodEnd}.zip`, blob)
}

/**
 * One-row-per-vendor summary across ALL provided invoices:
 *   Vendor | Date Range | Pending | Completed | Total
 *
 * "Pending" = sum of `inv.totalAmount` for invoices whose status is not 'locked'.
 * "Completed" = sum for invoices whose status === 'locked'.
 * "Date Range" = earliest periodStart → latest periodEnd across that vendor's invoices.
 */
export const downloadVendorSummaryExcel = async (
  vendorInvoices: VendorInvoice[],
  filenameLabel?: string,
): Promise<void> => {
  type Agg = {
    vendorId: string
    vendorName: string
    earliestStart: string
    latestEnd: string
    pending: number
    completed: number
  }
  const byVendor = new Map<string, Agg>()
  for (const inv of vendorInvoices) {
    const key = inv.vendorId
    const existing = byVendor.get(key)
    const isCompleted = inv.status === 'locked'
    if (existing) {
      if (inv.periodStart < existing.earliestStart) existing.earliestStart = inv.periodStart
      if (inv.periodEnd > existing.latestEnd) existing.latestEnd = inv.periodEnd
      if (isCompleted) existing.completed += inv.totalAmount
      else existing.pending += inv.totalAmount
      // Prefer a non-empty company name if discovered later
      if (!existing.vendorName || existing.vendorName === inv.vendorId) {
        existing.vendorName = vendorDisplayName(inv)
      }
    } else {
      byVendor.set(key, {
        vendorId: key,
        vendorName: vendorDisplayName(inv),
        earliestStart: inv.periodStart,
        latestEnd: inv.periodEnd,
        pending: isCompleted ? 0 : inv.totalAmount,
        completed: isCompleted ? inv.totalAmount : 0,
      })
    }
  }

  const rows = Array.from(byVendor.values()).sort((a, b) =>
    a.vendorName.localeCompare(b.vendorName),
  )

  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()
  const ws = wb.addWorksheet('Vendor Summary')

  ws.addRow(['A Square GoKarting — Vendor Invoice Summary'])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([`Generated: ${new Date().toISOString()}`])
  ws.addRow([])

  const header = ws.addRow([
    'Vendor Name',
    'Invoice Date Range',
    'Pending Invoice',
    'Completed Invoice',
    'Total',
  ])
  styleHeaderRow(header)

  let totPending = 0
  let totCompleted = 0
  for (const r of rows) {
    const range =
      r.earliestStart === r.latestEnd ? r.earliestStart : `${r.earliestStart} → ${r.latestEnd}`
    ws.addRow([r.vendorName, range, r.pending, r.completed, r.pending + r.completed])
    totPending += r.pending
    totCompleted += r.completed
  }

  const totals = ws.addRow(['Totals', '', totPending, totCompleted, totPending + totCompleted])
  totals.font = { bold: true }
  totals.fill = FOOTER_FILL

  ws.columns = [{ width: 32 }, { width: 26 }, { width: 18 }, { width: 18 }, { width: 18 }]
  for (const col of [3, 4, 5]) ws.getColumn(col).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 4 }]

  const blob = await workbookToBlob(wb)
  const label = filenameLabel ? `_${sanitize(filenameLabel)}` : ''
  downloadBlob(`VendorInvoiceSummary${label}.xlsx`, blob)
}

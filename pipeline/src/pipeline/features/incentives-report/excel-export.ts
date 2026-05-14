import ExcelJS from 'exceljs'
import { downloadBlob } from './download'
import { monthlyReportFilename } from './filename'
import type { MonthlyReportPayload } from './types'

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
const NO_PLAN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEE2E2' },
}
const RUPEE_FORMAT = '"₹"#,##0'

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.font = HEADER_FONT
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'left' }
}

const addSummarySheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Summary')
  ws.addRow([`A Square GoKarting — Incentives — ${payload.monthLabel}`])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([`Branch: ${payload.branchLabel}`])
  ws.addRow([`Generated: ${payload.generatedAt} by ${payload.generatedByName}`])
  ws.addRow([])

  const headerRow = ws.addRow(['Branch', 'Cashier Incentive', 'Telecaller Incentive', 'Total'])
  styleHeaderRow(headerRow)

  let totalCashier = 0
  let totalTelecaller = 0
  for (const r of payload.branchSummary) {
    ws.addRow([r.branchName, r.cashierIncentive, r.telecallerIncentive, r.total])
    totalCashier += r.cashierIncentive
    totalTelecaller += r.telecallerIncentive
  }

  const telecallerGrand = payload.telecallers.reduce((s, t) => s + t.incentiveEarned, 0)
  if (telecallerGrand > 0) {
    ws.addRow(['(Telecallers — all branches)', 0, telecallerGrand, telecallerGrand])
    totalTelecaller += telecallerGrand
  }

  const grand = ws.addRow([
    'Grand Total',
    totalCashier,
    totalTelecaller,
    totalCashier + totalTelecaller,
  ])
  grand.font = { bold: true }
  grand.fill = FOOTER_FILL

  ws.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 18 }]
  ws.getColumn(2).numFmt = RUPEE_FORMAT
  ws.getColumn(3).numFmt = RUPEE_FORMAT
  ws.getColumn(4).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 5 }]
}

const addCashierSheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Cashiers')
  const headerRow = ws.addRow([
    'Branch',
    'Cashier Name',
    'Cashier ID',
    'Qualifying Txns',
    'Total Item Amount',
    'Non-Performing',
    'Go-Kart Laps',
    'Both',
    'Total Incentive',
  ])
  styleHeaderRow(headerRow)

  let txns = 0
  let item = 0
  let np = 0
  let gk = 0
  let bo = 0
  let tot = 0
  for (const r of payload.cashiers) {
    ws.addRow([
      r.branchName,
      r.cashierName,
      r.cashierId,
      r.qualifyingTxns,
      r.totalItemAmount,
      r.byNonPerforming,
      r.byGokartLaps,
      r.byBoth,
      r.totalIncentive,
    ])
    txns += r.qualifyingTxns
    item += r.totalItemAmount
    np += r.byNonPerforming
    gk += r.byGokartLaps
    bo += r.byBoth
    tot += r.totalIncentive
  }

  const totalsRow = ws.addRow(['', 'Totals', '', txns, item, np, gk, bo, tot])
  totalsRow.font = { bold: true }
  totalsRow.fill = FOOTER_FILL

  ws.columns = [
    { width: 14 },
    { width: 24 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 18 },
  ]
  for (const col of [5, 6, 7, 8, 9]) ws.getColumn(col).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

const addTelecallerSheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Telecallers')
  const headerRow = ws.addRow([
    'Telecaller Name',
    'Plan Status',
    'Bookings',
    'Booked Amount',
    'Target',
    'Achievement %',
    'Incentive %',
    'Incentive Earned',
  ])
  styleHeaderRow(headerRow)

  let bookings = 0
  let booked = 0
  let earned = 0
  for (const r of payload.telecallers) {
    const row = ws.addRow([
      r.telecallerName,
      r.hasPlan ? 'Active' : 'No Plan',
      r.bookingCount,
      r.bookedAmount,
      r.targetAmount,
      r.achievementPercent,
      r.incentivePercentUsed,
      r.incentiveEarned,
    ])
    if (!r.hasPlan) row.getCell(2).fill = NO_PLAN_FILL
    bookings += r.bookingCount
    booked += r.bookedAmount
    earned += r.incentiveEarned
  }

  const totalsRow = ws.addRow(['Totals', '', bookings, booked, '', '', '', earned])
  totalsRow.font = { bold: true }
  totalsRow.fill = FOOTER_FILL

  ws.columns = [
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
  ]
  ws.getColumn(4).numFmt = RUPEE_FORMAT
  ws.getColumn(5).numFmt = RUPEE_FORMAT
  ws.getColumn(8).numFmt = RUPEE_FORMAT
  ws.getColumn(6).numFmt = '0.0"%"'
  ws.getColumn(7).numFmt = '0.0"%"'
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export const exportMonthlyExcel = async (payload: MonthlyReportPayload): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()
  addSummarySheet(wb, payload)
  addCashierSheet(wb, payload)
  addTelecallerSheet(wb, payload)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(monthlyReportFilename(payload.branchLabel, payload.monthKey, 'xlsx'), blob)
}

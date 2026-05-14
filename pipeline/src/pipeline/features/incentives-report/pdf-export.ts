import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { downloadBlob } from './download'
import { monthlyReportFilename } from './filename'
import type { MonthlyReportPayload } from './types'

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)

const HEADER_FILL: [number, number, number] = [0, 102, 255]
const FOOTER_FILL: [number, number, number] = [243, 244, 246]

export const exportMonthlyPdf = (payload: MonthlyReportPayload): void => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('A Square GoKarting — Incentives Report', 40, 50)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${payload.monthLabel} · ${payload.branchLabel}`, 40, 70)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Generated: ${payload.generatedAt} · by ${payload.generatedByName}`, 40, 86)
  doc.setTextColor(0)

  const cashierBody = payload.cashiers.map((r) => [
    r.branchName,
    r.cashierName,
    r.cashierId,
    String(r.qualifyingTxns),
    inr(r.totalItemAmount),
    inr(r.byNonPerforming),
    inr(r.byGokartLaps),
    inr(r.byBoth),
    inr(r.totalIncentive),
  ])

  const cashierFoot =
    payload.cashiers.length > 0
      ? [
          [
            '',
            'Totals',
            '',
            String(payload.cashiers.reduce((s, r) => s + r.qualifyingTxns, 0)),
            inr(payload.cashiers.reduce((s, r) => s + r.totalItemAmount, 0)),
            inr(payload.cashiers.reduce((s, r) => s + r.byNonPerforming, 0)),
            inr(payload.cashiers.reduce((s, r) => s + r.byGokartLaps, 0)),
            inr(payload.cashiers.reduce((s, r) => s + r.byBoth, 0)),
            inr(payload.cashiers.reduce((s, r) => s + r.totalIncentive, 0)),
          ],
        ]
      : undefined

  autoTable(doc, {
    startY: 100,
    head: [['Branch', 'Cashier', 'ID', 'Txns', 'Item Amt', 'Non-Perf', 'Go-Kart', 'Both', 'Total']],
    body: cashierBody,
    foot: cashierFoot,
    theme: 'striped',
    headStyles: { fillColor: HEADER_FILL, textColor: 255 },
    footStyles: { fillColor: FOOTER_FILL, textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    margin: { left: 30, right: 30 },
  })

  doc.addPage()
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Telecaller Incentives', 40, 50)

  const telecallerBody = payload.telecallers.map((r) => [
    r.telecallerName,
    r.hasPlan ? 'Active' : 'No Plan',
    String(r.bookingCount),
    inr(r.bookedAmount),
    inr(r.targetAmount),
    `${r.achievementPercent.toFixed(1)}%`,
    `${r.incentivePercentUsed.toFixed(1)}%`,
    inr(r.incentiveEarned),
  ])

  const telecallerFoot =
    payload.telecallers.length > 0
      ? [
          [
            'Totals',
            '',
            String(payload.telecallers.reduce((s, r) => s + r.bookingCount, 0)),
            inr(payload.telecallers.reduce((s, r) => s + r.bookedAmount, 0)),
            '',
            '',
            '',
            inr(payload.telecallers.reduce((s, r) => s + r.incentiveEarned, 0)),
          ],
        ]
      : undefined

  autoTable(doc, {
    startY: 70,
    head: [['Telecaller', 'Plan', 'Bookings', 'Booked Amt', 'Target', 'Achv %', 'Inc %', 'Earned']],
    body: telecallerBody,
    foot: telecallerFoot,
    theme: 'striped',
    headStyles: { fillColor: HEADER_FILL, textColor: 255 },
    footStyles: { fillColor: FOOTER_FILL, textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    margin: { left: 30, right: 30 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1 && data.cell.text[0] === 'No Plan') {
        data.cell.styles.fillColor = [254, 226, 226]
      }
    },
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`${payload.branchLabel} · ${payload.monthLabel}`, 30, pageHeight - 20)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 90, pageHeight - 20)
  }

  const blob = doc.output('blob')
  downloadBlob(monthlyReportFilename(payload.branchLabel, payload.monthKey, 'pdf'), blob)
}

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateIST } from '../../lib/date-format'

export interface TaxBillConfig {
  invoiceNumber: string
  invoiceDate: string
  periodStart: string
  periodEnd: string
  billingFrom: {
    company: string
    name: string
    address: string
    gstin: string
    phone: string
    email: string
  }
  billedTo: {
    company: string
    name: string
    address: string
    gstin: string
  }
  locationLabel: string
  transactionCount: number
  totalBase: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  grandTotal: number
  amountInWords: string
  gameBreakdown?: { gameName: string; sessions: number; amount: number }[]
}

// ─── Indian number-to-words ────────────────────────────────────────────────────

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return TENS[t] + (o ? ' ' + ONES[o] : '')
}

function threeDigitWords(n: number): string {
  if (n === 0) return ''
  if (n < 100) return twoDigitWords(n)
  const h = Math.floor(n / 100)
  const rest = n % 100
  return ONES[h] + ' Hundred' + (rest ? ' and ' + twoDigitWords(rest) : '')
}

export function amountToWords(amount: number): string {
  if (amount === 0) return 'Zero Rupees Only'

  const rupees = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - rupees) * 100)

  let words = ''
  if (rupees >= 10000000) {
    words += threeDigitWords(Math.floor(rupees / 10000000)) + ' Crore, '
  }
  const afterCrore = rupees % 10000000
  if (afterCrore >= 100000) {
    words += twoDigitWords(Math.floor(afterCrore / 100000)) + ' Lakh, '
  }
  const afterLakh = afterCrore % 100000
  if (afterLakh >= 1000) {
    words += twoDigitWords(Math.floor(afterLakh / 1000)) + ' Thousand, '
  }
  const afterThousand = afterLakh % 1000
  if (afterThousand > 0) {
    words += threeDigitWords(afterThousand)
  }

  words = words.replace(/,\s*$/, '').trim()
  if (!words) words = 'Zero'

  let result = words + ' Rupees'
  if (paise > 0) {
    result += ' & ' + twoDigitWords(paise) + ' Paise'
  } else {
    result += ' Only'
  }

  return result.toUpperCase()
}

// ─── PDF generation ────────────────────────────────────────────────────────────

const PAGE_WIDTH = 210
const MARGIN = 15
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const fmtINR = (n: number): string =>
  Math.round(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function generateTaxBillPdf(config: TaxBillConfig): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = MARGIN

  // ── Header ──
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('Tax Invoice', MARGIN, y + 7)
  y += 10
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Original for recipient', MARGIN, y + 3)
  y += 5

  doc.setDrawColor(0)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y)
  y += 6

  // ── Invoice meta ──
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Invoice #${config.invoiceNumber}`, MARGIN, y + 4)
  doc.setFont('helvetica', 'normal')
  doc.text(`Invoice Date: ${fmtDateIST(config.invoiceDate)}`, MARGIN, y + 10)

  const periodLabel = `${fmtDateIST(config.periodStart)} - ${fmtDateIST(config.periodEnd)}`
  doc.setFontSize(9)
  doc.text('Payments for period from', MARGIN + CONTENT_WIDTH, y + 4, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.text(periodLabel, MARGIN + CONTENT_WIDTH, y + 10, { align: 'right' })
  y += 16

  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y)
  y += 6

  // ── Billing From / Billed To boxes ──
  const colWidth = CONTENT_WIDTH / 2 - 3
  const leftX = MARGIN
  const rightX = MARGIN + colWidth + 6

  const drawBillingBox = (title: string, x: number, startY: number, lines: string[]): number => {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.text(title, x, startY)
    doc.setLineWidth(0.2)
    doc.line(x, startY + 1, x + 40, startY + 1)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    let lineY = startY + 6
    for (const line of lines) {
      if (!line) continue
      const split = doc.splitTextToSize(line, colWidth) as string[]
      for (const segment of split) {
        doc.text(segment, x, lineY)
        lineY += 4.5
      }
    }
    return lineY
  }

  const fromLines = [
    config.billingFrom.company,
    config.billingFrom.name !== config.billingFrom.company ? config.billingFrom.name : '',
    config.billingFrom.address,
    config.billingFrom.gstin ? `GSTIN: ${config.billingFrom.gstin}` : '',
    config.billingFrom.phone ? `Phone: ${config.billingFrom.phone}` : '',
    config.billingFrom.email ? `Email: ${config.billingFrom.email}` : '',
  ].filter(Boolean)

  const toLines = [
    config.billedTo.company,
    config.billedTo.name !== config.billedTo.company ? config.billedTo.name : '',
    config.billedTo.address,
    config.billedTo.gstin ? `GSTIN: ${config.billedTo.gstin}` : '',
  ].filter(Boolean)

  const fromEndY = drawBillingBox('BILLING FROM', leftX, y, fromLines)
  const toEndY = drawBillingBox('BILLED TO', rightX, y, toLines)
  y = Math.max(fromEndY, toEndY) + 6

  // ── Location ──
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Location: ${config.locationLabel}`, MARGIN, y)
  y += 8

  // ── Summary table ──
  let description = `Vendor revenue share for period ${fmtDateIST(config.periodStart)} – ${fmtDateIST(config.periodEnd)} (${config.transactionCount} transactions)`

  if (config.gameBreakdown && config.gameBreakdown.length > 0) {
    const breakdownLines = config.gameBreakdown.map(
      (g) =>
        `${g.gameName}  –  ${g.sessions} session${g.sessions === 1 ? '' : 's'}  –  INR ${Math.round(g.amount).toLocaleString('en-IN')}`,
    )
    description += '\n\n' + breakdownLines.join('\n')
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [['S.NO.', 'Description', 'Amount (Rs)']],
    body: [[1, description, fmtINR(config.totalBase)]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
    },
    bodyStyles: { lineWidth: 0.2, lineColor: [200, 200, 200] },
    columnStyles: {
      0: { cellWidth: 15, halign: 'center' },
      2: { cellWidth: 35, halign: 'right' },
    },
    theme: 'grid',
  })

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  // ── Totals ──
  const totalsX = MARGIN + CONTENT_WIDTH - 80
  const amountX = MARGIN + CONTENT_WIDTH

  const drawTotalLine = (label: string, amount: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(9)
    doc.text(label, totalsX, y)
    doc.text(amount, amountX, y, { align: 'right' })
    y += 5.5
  }

  drawTotalLine('Subtotal', fmtINR(config.totalBase))
  if (config.igstAmount > 0) {
    drawTotalLine('IGST (18%)', fmtINR(config.igstAmount))
  } else {
    drawTotalLine('IGST (0%)', '0.00')
  }
  drawTotalLine('CGST (9%)', fmtINR(config.cgstAmount))
  drawTotalLine('SGST (9%)', fmtINR(config.sgstAmount))

  doc.setLineWidth(0.3)
  doc.line(totalsX, y, amountX, y)
  y += 4

  drawTotalLine('Grand Total', fmtINR(config.grandTotal), true)
  y += 4

  // ── Amount in words ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('AMOUNT IN WORDS', totalsX, y)
  y += 1
  doc.setLineWidth(0.2)
  doc.line(totalsX, y, totalsX + 55, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const wordsLines = doc.splitTextToSize(config.amountInWords, 70) as string[]
  for (const wl of wordsLines) {
    doc.text(wl, totalsX, y)
    y += 4.5
  }
  y += 6

  // ── Declaration ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Declaration', MARGIN, y)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y + 1, MARGIN + 30, y + 1)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('We declare that all particulars are true & correct.', MARGIN, y)
  y += 12

  // ── Signature ──
  const sigX = MARGIN + CONTENT_WIDTH - 60
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`For ${config.billingFrom.company}`, sigX, y)
  y += 16
  doc.setFont('helvetica', 'bold')
  doc.text('Authorized Signatory', sigX, y)

  return doc
}

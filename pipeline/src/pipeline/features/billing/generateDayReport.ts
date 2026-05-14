/**
 * Printable Day Report — generates an HTML report and prints via hidden iframe.
 * Layout: Sales Summary + Third-Party & Sublease Summary + Thirdparty Shares.
 * Optimised for both A4 and POS thermal printers (58mm / 80mm).
 */
import type { DayReportData } from './checkout-day-report'
import { logger } from '../../../lib/logger'
import { getFirestoreSessionUser } from '../../api/firestore-session'

const fmtCurrency = (v: number): string => Math.round(v).toLocaleString('en-IN')
const fmtDecimal = (v: number): string => v.toFixed(2)

const formatReportDate = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr || 'Unknown Date'
  const day = d.getDate()
  const suffix =
    day === 1 || day === 21 || day === 31
      ? 'st'
      : day === 2 || day === 22
        ? 'nd'
        : day === 3 || day === 23
          ? 'rd'
          : 'th'
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()} - ${days[d.getDay()]}`
}

const buildDayReportHtml = (data: DayReportData, cashierName?: string, isOwner = false): string => {
  const vendorRows = (data.vendorShares ?? [])
    .map(
      (row) => `
      <tr>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc;">${row.vendorName}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc;">${row.vendorType}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc; text-align:right;">${fmtCurrency(row.sales)}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc; text-align:right;">${fmtDecimal(row.tax)}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc; text-align:right;">${fmtDecimal(row.net)}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc; text-align:right;">${fmtDecimal(row.tpShare)}</td>
        <td style="padding:4px 6px; border-bottom:0.5px solid #ccc; text-align:right;">${fmtDecimal(row.asgShare)}</td>
      </tr>
    `,
    )
    .join('')

  const t = data.vendorTotals ?? { sales: 0, tax: 0, net: 0, tpShare: 0, asgShare: 0 }
  const rawSummary = data.salesSummary ?? {
    cash: 0,
    upi: 0,
    card: 0,
    razorpay: 0,
    discount: 0,
    protocolCount: 0,
    grandTotal: 0,
  }
  const vs = data.vendorSummary ?? {
    baseAmount: 0,
    gstAmount: 0,
    thirdPartyShare: 0,
    companyShare: 0,
  }

  // Non-owner (cashier) prints show the amounts the cashier entered at settlement,
  // not the system-computed actuals. Owner prints keep the actuals + excess row.
  const stl = data.settlement
  const useEntered = !isOwner && !!stl
  const s =
    useEntered && stl
      ? {
          ...rawSummary,
          cash: stl.cashEntered,
          card: stl.cardEntered,
          upi: stl.upiEntered,
          grandTotal: stl.cashEntered + stl.cardEntered + stl.upiEntered + rawSummary.razorpay,
        }
      : rawSummary

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Day Report - ${data.locationName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #fff;
      color: #000;
      padding: 12px;
      max-width: 800px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 { text-align: center; font-size: 16px; font-weight: 800; margin-bottom: 2px; letter-spacing: 1px; }
    h2 {
      text-align: center; font-size: 12px; font-weight: 700; margin: 12px 0 4px;
      text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid #000; padding-bottom: 2px;
    }
    .subtitle { text-align: center; color: #333; font-size: 10px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th {
      background: #eee; color: #000; padding: 4px 6px; text-align: left;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.3px; border-bottom: 1.5px solid #000;
    }
    th.right { text-align: right; }
    td { font-size: 11px; color: #000; padding: 4px 6px; border-bottom: 0.5px solid #ccc; }
    .summary-table td { padding: 3px 6px; font-size: 11px; }
    .summary-table td:last-child { text-align: right; font-weight: 600; }
    .summary-table .grand-total td {
      font-weight: 800; font-size: 12px;
      border-top: 1.5px solid #000; border-bottom: 1.5px solid #000;
      padding: 5px 6px;
    }
    .vendor-total td {
      font-weight: 700; padding: 5px 6px; font-size: 11px;
      border-top: 1.5px solid #000;
    }
    .separator { border-top: 0.5px solid #999; }
    @media print {
      body { padding: 4px; }
      @page { margin: 5mm; }
    }
  </style>
</head>
<body>
  <h1>Day Report of ${data.locationName} Gokarting</h1>
  <h2 style="border-bottom:none; margin-bottom:0; font-weight:700;">Sales &amp; Expenditure Overview</h2>
  <p class="subtitle">Report Period: ${formatReportDate(data.date)}</p>
  ${cashierName ? `<p class="subtitle" style="font-weight:600;">Cashier: ${cashierName}</p>` : ''}

  <!-- Sales Summary -->
  <h2>Sales Summary</h2>
  <table class="summary-table">
    <tbody>
      <tr><td>Cash</td><td>${fmtCurrency(s.cash)}</td></tr>
      <tr><td>UPI</td><td>${fmtCurrency(s.upi)}</td></tr>
      <tr><td>Card</td><td>${fmtCurrency(s.card)}</td></tr>
      <tr><td>Razorpay</td><td>${fmtCurrency(s.razorpay)}</td></tr>
      <tr class="separator"><td>Discount</td><td>${fmtCurrency(s.discount)}</td></tr>
      <tr><td>Protocol Count</td><td>${s.protocolCount}</td></tr>
      <tr class="grand-total"><td>Grand Total</td><td>${fmtCurrency(s.grandTotal)}</td></tr>
      ${(() => {
        if (!isOwner || !stl) return ''
        const totalEntered = stl.cashEntered + stl.cardEntered + stl.upiEntered
        const totalActual = stl.cashActual + stl.cardActual + stl.upiActual
        const diff = totalEntered - totalActual
        if (diff === 0) return ''
        const label = diff > 0 ? 'Excess Amount' : 'Shortage Amount'
        const color = diff > 0 ? '#16a34a' : '#dc2626'
        const display = diff > 0 ? `+${fmtCurrency(diff)}` : `-${fmtCurrency(Math.abs(diff))}`
        return `<tr><td style="font-weight:700;">${label}</td><td style="font-weight:700; color:${color};">${display}</td></tr>`
      })()}
    </tbody>
  </table>

  ${
    vs.baseAmount > 0
      ? `
  <!-- Third-Party & Sublease Summary -->
  <h2>Third-Party &amp; Sublease Summary</h2>
  <table class="summary-table">
    <tbody>
      <tr><td>Base Amount</td><td>${fmtDecimal(vs.baseAmount)}</td></tr>
      <tr><td>GST Amount</td><td>${fmtDecimal(vs.gstAmount)}</td></tr>
      <tr><td>Third-Party Share</td><td>${fmtDecimal(vs.thirdPartyShare)}</td></tr>
      <tr><td>Company Share</td><td>${fmtDecimal(vs.companyShare)}</td></tr>
    </tbody>
  </table>
  `
      : ''
  }

  ${
    (data.vendorShares ?? []).length > 0
      ? `
  <!-- Third-Party & Sublease Details -->
  <h2>Third-Party &amp; Sublease Details</h2>
  <table>
    <thead>
      <tr>
        <th>DETAILS</th>
        <th>TYPE</th>
        <th class="right">SALES</th>
        <th class="right">TAX(18%)</th>
        <th class="right">NET</th>
        <th class="right">TP SHARE</th>
        <th class="right">CO. SHARE</th>
      </tr>
    </thead>
    <tbody>
      ${vendorRows}
      <tr class="vendor-total">
        <td>Total</td>
        <td></td>
        <td style="text-align:right;">${fmtCurrency(t.sales)}</td>
        <td style="text-align:right;">${fmtDecimal(t.tax)}</td>
        <td style="text-align:right;">${fmtDecimal(t.net)}</td>
        <td style="text-align:right;">${fmtDecimal(t.tpShare)}</td>
        <td style="text-align:right;">${fmtDecimal(t.asgShare)}</td>
      </tr>
    </tbody>
  </table>
  `
      : ''
  }

  <p style="text-align:center; color:#333; font-size:10px; margin-top:16px;">
    ${data.transactionCount} transactions &bull; Generated at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
  </p>
</body>
</html>`
}

/**
 * Resolve whether the current session should see Owner-only rows
 * (Excess/Shortage totals) from the server-side session record rather
 * than trusting a caller-supplied boolean. Falls back to `false` on any
 * lookup failure so non-Owners never accidentally see privileged numbers.
 */
const resolveIsOwnerFromToken = async (token: string | undefined): Promise<boolean> => {
  if (!token) return false
  try {
    const user = await getFirestoreSessionUser(token)
    return user.role === 'Owner'
  } catch {
    return false
  }
}

/**
 * Generate and print the Day Report via a hidden iframe.
 *
 * The `token` param replaces a previous `isOwner` boolean that the caller
 * could trivially flip to `true` from devtools to reveal Owner-only
 * Excess/Shortage amounts in a cashier's printed report. We now resolve
 * the role from the session record keyed by the token, so spoofing
 * requires forging a token — not just flipping a client-side flag.
 */
export const printDayReport = async (
  data: DayReportData,
  cashierName: string | undefined,
  token: string | undefined,
): Promise<void> => {
  const isOwner = await resolveIsOwnerFromToken(token)

  let html: string
  try {
    html = buildDayReportHtml(data, cashierName, isOwner)
  } catch (err) {
    logger.error('day_report.html_generation_failed', err)
    throw new Error('Failed to generate report content.')
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'
  iframe.style.left = '-10000px'
  iframe.style.width = '800px'
  iframe.style.height = '1200px'
  iframe.style.border = 'none'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) {
    logger.warn('day_report.iframe_unavailable_fallback')
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    document.body.removeChild(iframe)
    return
  }

  try {
    iframeDoc.open()
    iframeDoc.write(html)
    iframeDoc.close()
  } catch (err) {
    logger.error('day_report.iframe_write_failed', err)
    document.body.removeChild(iframe)
    throw new Error('Failed to render report for printing.')
  }

  // Use setTimeout directly instead of onload — avoids race condition
  // where document.write/close completes before onload handler is attached
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch (err) {
      logger.error('day_report.print_dialog_failed', err)
    }
    setTimeout(() => {
      try {
        document.body.removeChild(iframe)
      } catch {
        /* already removed */
      }
    }, 1000)
  }, 300)
}

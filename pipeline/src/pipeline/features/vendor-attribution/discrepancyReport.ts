/**
 * Generates the customer-facing HTML "Vendor Revenue Discrepancy Notice"
 * from a `VendorDiscrepancyRecord`. Mirrors the static template at
 * reports/vendor-discrepancy-notice-2026-04-14.html, with all vendor- and
 * incident-specific values parameterised.
 *
 * The output is a fully self-contained HTML string (inlined CSS) — safe to
 * email, drop into Firebase Storage, or render at /r/disc-:ref.
 */

import type { VendorDiscrepancyRecord } from '../../api/types'

/** Minimal HTML escape — covers the values we interpolate (text + attributes). */
const esc = (raw: string): string =>
  raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const fmtINR = (n: number): string => `INR ${Math.round(n).toLocaleString('en-IN')}`

const fmtDate = (iso: string): string => {
  // Keep this independent of date-format.ts so the generator can run in a
  // CF / Node context without DOM Intl quirks.
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
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
  return `${dd} ${months[d.getMonth()]} ${d.getFullYear()}`
}

const renderRows = (record: VendorDiscrepancyRecord): string => {
  return record.affectedBookings
    .map((booking) => {
      const items = booking.items
      if (items.length === 0) {
        return `
        <tr>
          <td><strong>${esc(booking.bookingId)}</strong></td>
          <td>${esc(fmtDate(booking.transactionDate))}</td>
          <td>${esc(record.gameLabel)}</td>
          <td class="amount amount-lost">—</td>
        </tr>`
      }
      return items
        .map((it, idx) => {
          const idCell =
            idx === 0
              ? `<td rowspan="${items.length}"><strong>${esc(booking.bookingId)}</strong></td>`
              : ''
          const dateCell =
            idx === 0
              ? `<td rowspan="${items.length}">${esc(fmtDate(booking.transactionDate))}</td>`
              : ''
          return `
        <tr>
          ${idCell}
          ${dateCell}
          <td>
            ${esc(record.gameLabel)}<br />
            <span style="color: var(--muted); font-size: 0.8rem">${esc(it.itemName)}</span>
          </td>
          <td class="amount amount-lost">${esc(fmtINR(it.amount))}</td>
        </tr>`
        })
        .join('')
    })
    .join('')
}

export const generateVendorDiscrepancyHtml = (record: VendorDiscrepancyRecord): string => {
  const referenceLabel = esc(record.reference)
  const issuedDate = fmtDate(record.detectedAt)
  const vendorName = esc(record.vendorName || '—')
  const vendorPhone = esc(record.vendorPhone || record.vendorId || '—')
  const branch = esc(record.branchDisplayName || record.branchId || '—')
  const game = esc(record.gameLabel || '—')
  const bookingCount = record.affectedBookings.length
  const totalGross = fmtINR(record.grossAmount)

  const dates = Array.from(
    new Set(
      record.affectedBookings.map((b) => fmtDate(b.transactionDate)).filter((d) => d !== '—'),
    ),
  )
  const dateLine = dates.length === 0 ? issuedDate : dates.join(', ')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vendor Revenue Discrepancy Notice — A Square GoKarting</title>
    <style>
      :root { --primary:#0066ff; --accent:#ff6b00; --bg:#0b0f1a; --surface:#141928; --border:#1e2640; --text:#e8ecf4; --muted:#6b7a99; --success:#22c55e; --warning:#f59e0b; --critical:#ef4444; }
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:2rem; }
      .container { max-width:800px; margin:0 auto; }
      .header { text-align:center; padding:2.5rem 2rem; background:linear-gradient(135deg,var(--surface) 0%,#1a2238 100%); border:1px solid var(--border); border-radius:1.5rem; margin-bottom:2rem; }
      .header .logo { font-size:1.5rem; font-weight:800; letter-spacing:-0.5px; background:linear-gradient(135deg,var(--primary),var(--accent)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:0.25rem; }
      .header .subtitle { font-size:0.75rem; text-transform:uppercase; letter-spacing:3px; color:var(--muted); margin-bottom:1.5rem; }
      .header h1 { font-size:1.75rem; font-weight:700; margin-bottom:0.5rem; }
      .header .ref { font-size:0.8rem; color:var(--muted); }
      .section { background:var(--surface); border:1px solid var(--border); border-radius:1.25rem; padding:1.75rem; margin-bottom:1.5rem; }
      .section h2 { font-size:1.1rem; font-weight:700; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem; }
      .section p { color:var(--muted); font-size:0.9rem; margin-bottom:0.75rem; }
      .section p strong { color:var(--text); }
      .badge { display:inline-flex; align-items:center; gap:0.35rem; padding:0.25rem 0.75rem; border-radius:999px; font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:1px; }
      .badge-warning { background:rgba(245,158,11,0.12); color:var(--warning); border:1px solid rgba(245,158,11,0.25); }
      table { width:100%; border-collapse:separate; border-spacing:0; font-size:0.85rem; margin-top:1rem; }
      th { text-align:left; font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:var(--muted); padding:0.75rem 1rem; border-bottom:1px solid var(--border); }
      td { padding:0.75rem 1rem; border-bottom:1px solid rgba(30,38,64,0.5); color:var(--text); }
      tr:last-child td { border-bottom:none; }
      .amount { font-weight:700; font-variant-numeric:tabular-nums; }
      .amount-lost { color:var(--critical); }
      .info-card { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin:1rem 0; }
      .info-item { background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:0.75rem; padding:1rem; }
      .info-item .label { font-size:0.65rem; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); margin-bottom:0.25rem; }
      .info-item .value { font-size:1.1rem; font-weight:700; }
      .action-box { background:linear-gradient(135deg,rgba(0,102,255,0.08),rgba(255,107,0,0.08)); border:1px solid rgba(0,102,255,0.2); border-radius:1rem; padding:1.5rem; margin-top:1rem; }
      .action-box h3 { font-size:0.95rem; font-weight:700; margin-bottom:0.75rem; }
      .action-box ul { list-style:none; padding:0; }
      .action-box li { font-size:0.85rem; color:var(--muted); padding:0.4rem 0; padding-left:1.5rem; position:relative; }
      .action-box li::before { content:'\\2713'; position:absolute; left:0; color:var(--success); font-weight:700; }
      .footer { text-align:center; padding:2rem; color:var(--muted); font-size:0.8rem; }
      .footer strong { color:var(--text); }
      hr { border:none; border-top:1px solid var(--border); margin:1.5rem 0; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="logo">A Square GoKarting</div>
        <div class="subtitle">Partner Operations</div>
        <h1>Revenue Discrepancy Notice</h1>
        <div class="ref">
          Reference: ${referenceLabel} &nbsp;|&nbsp; Date Issued: ${esc(issuedDate)}
        </div>
      </div>

      <div class="section">
        <h2>Addressed To</h2>
        <div class="info-card">
          <div class="info-item">
            <div class="label">Vendor / Partner</div>
            <div class="value">${vendorName}</div>
          </div>
          <div class="info-item">
            <div class="label">Vendor ID</div>
            <div class="value">${vendorPhone}</div>
          </div>
          <div class="info-item">
            <div class="label">Branch</div>
            <div class="value">${branch}</div>
          </div>
          <div class="info-item">
            <div class="label">Game</div>
            <div class="value">${game}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>What Happened</h2>
        <p>Dear <strong>${vendorName}</strong>,</p>
        <p>
          We are writing to inform you about a <strong>technical issue</strong> in our billing
          system that caused <strong>${bookingCount} booking${bookingCount === 1 ? '' : 's'}</strong>
          at the <strong>${branch}</strong> branch on <strong>${esc(dateLine)}</strong> to not
          appear in your Partner Game Revenue dashboard.
        </p>
        <p>
          The bookings were processed and payment was collected from the customers successfully —
          but the system did not link these bookings to your vendor account, so the revenue was
          not visible in your Game Revenue reports.
        </p>
        <p>
          <strong>We sincerely apologise for this error.</strong> We take partner revenue
          accuracy seriously, and we want to make sure you have complete visibility on every
          transaction tied to your games.
        </p>
      </div>

      <div class="section">
        <h2>Affected Transactions &nbsp;<span class="badge badge-warning">${bookingCount} Booking${bookingCount === 1 ? '' : 's'}</span></h2>
        <p>The following bookings were paid by customers but did not reflect in your Game Revenue reports:</p>
        <table>
          <thead>
            <tr>
              <th>Booking ID</th>
              <th>Date</th>
              <th>Game / Variant</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>${renderRows(record)}</tbody>
        </table>

        <div class="info-card" style="margin-top: 1.25rem">
          <div class="info-item">
            <div class="label">Total Missing Revenue (Gross)</div>
            <div class="value amount-lost">${esc(totalGross)}</div>
          </div>
          <div class="info-item">
            <div class="label">Status</div>
            <div class="value">
              <span class="badge badge-warning">${
                record.status === 'resolved'
                  ? 'Adjustment Issued'
                  : record.status === 'notified'
                    ? 'Notice Sent'
                    : 'Pending Adjustment'
              }</span>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Resolution &amp; Next Steps</h2>
        <p>
          We have identified the root cause and deployed a fix to prevent this from happening
          on future bookings. For the affected transactions listed above:
        </p>
        <div class="action-box">
          <h3>What We Are Doing</h3>
          <ul>
            <li>The missing revenue will be <strong>credited to your vendor ledger</strong> and rolled into your next weekly payout.</li>
            <li>The affected booking records will be corrected so they reflect proper vendor attribution.</li>
            <li>The software bug has been fixed; a system-wide guard rail now runs on every non-POS booking channel.</li>
          </ul>
        </div>
        <hr />
        <div class="action-box" style="background: linear-gradient(135deg, rgba(255, 107, 0, 0.08), rgba(255, 107, 0, 0.04)); border-color: rgba(255, 107, 0, 0.2);">
          <h3>What You Need To Do</h3>
          <ul>
            <li>Reach out to the Admin team at your branch (<strong>${branch}</strong>) to confirm the adjustment for <strong>${esc(totalGross)}</strong>.</li>
            <li>Once the credit is issued, you will see it in your Vendor Ledger and on the next weekly invoice.</li>
            <li>If you have any questions, please contact the Admin or Owner directly.</li>
          </ul>
        </div>
      </div>

      <div class="section" style="text-align: center; padding: 2rem">
        <p style="font-size: 1rem; color: var(--text); margin-bottom: 0.75rem">
          We sincerely apologise for the inconvenience and value your partnership.
        </p>
        <p style="font-size: 0.85rem">Thank you for your continued partnership with A Square GoKarting.</p>
      </div>

      <div class="footer">
        <p><strong>A Square GoKarting — Partner Operations</strong></p>
        <p>Reference: ${referenceLabel} &nbsp;|&nbsp; Generated: ${esc(issuedDate)}</p>
      </div>
    </div>
  </body>
</html>`
}

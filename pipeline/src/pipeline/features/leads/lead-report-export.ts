/**
 * Lead Performance Report — CSV + PDF export.
 *
 * CSV: builds comma-separated string, triggers download as .csv file.
 * PDF: builds styled HTML, opens in hidden iframe, triggers print dialog.
 * Follows the existing pattern from generateDayReport.ts.
 */

import type { LeadPerformanceMetrics } from '../../api/types'
import { LEAD_STATUS_LABELS } from './lead-constants'
import { logger } from '../../../lib/logger'

// ─── CSV Export ─────────────────────────────────────────────────────────────

export function exportLeadPerformanceCSV(
  metrics: LeadPerformanceMetrics,
  dateRange: { from: string; to: string },
): void {
  const rows: string[] = []

  rows.push(`Lead Performance Report: ${dateRange.from} to ${dateRange.to}`)
  rows.push('')

  // Summary
  rows.push('Summary')
  rows.push(`Total Leads,${metrics.totalLeads}`)
  rows.push(`Total Conversions,${metrics.totalConversions}`)
  rows.push(`Conversion %,${metrics.conversionPercent}%`)
  rows.push(`Pending Follow-ups,${metrics.pendingFollowUps}`)
  rows.push('')

  // Stage breakdown
  rows.push('Stage Breakdown')
  rows.push('Stage,Count')
  for (const [status, count] of Object.entries(metrics.byStatus)) {
    rows.push(`${LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status},${count}`)
  }
  rows.push('')

  // Per-telecaller
  rows.push('Per-Telecaller Performance')
  rows.push('Telecaller,Assigned,Contacted,Follow-ups Pending,Conversions,Conv %,Revenue')
  for (const t of metrics.perTelecaller) {
    rows.push(
      `${t.telecallerName},${t.leadsAssigned},${t.leadsContacted},${t.followUpsPending},${t.conversions},${t.conversionPercent}%,${t.revenue}`,
    )
  }

  const csv = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lead-performance-${dateRange.from}-to-${dateRange.to}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── PDF Print ──────────────────────────────────────────────────────────────

function buildPerformanceReportHtml(
  metrics: LeadPerformanceMetrics,
  dateRange: { from: string; to: string },
): string {
  const statusRows = Object.entries(metrics.byStatus)
    .map(
      ([status, count]) =>
        `<tr><td>${LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status}</td><td style="text-align:right">${count}</td></tr>`,
    )
    .join('')

  const telecallerRows = metrics.perTelecaller
    .map(
      (t, i) =>
        `<tr${i < 3 ? ' style="font-weight:600"' : ''}>
          <td>${i + 1}</td>
          <td>${t.telecallerName}</td>
          <td style="text-align:right">${t.leadsAssigned}</td>
          <td style="text-align:right">${t.leadsContacted}</td>
          <td style="text-align:right">${t.followUpsPending}</td>
          <td style="text-align:right">${t.conversions}</td>
          <td style="text-align:right">${t.conversionPercent}%</td>
          <td style="text-align:right">₹${t.revenue.toLocaleString('en-IN')}</td>
        </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Lead Performance Report</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 4px 0; }
  h2 { font-size: 14px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 16px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
  .kpi-value { font-size: 20px; font-weight: 700; }
  .kpi-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f5f5f5; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #ddd; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) { background: #fafafa; }
  .print-only { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
</style>
</head>
<body class="print-only">
  <h1>A² GoKarting — Lead Performance Report</h1>
  <p class="subtitle">${dateRange.from} to ${dateRange.to}</p>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-value">${metrics.totalLeads}</div><div class="kpi-label">Total Leads</div></div>
    <div class="kpi"><div class="kpi-value">${metrics.totalConversions}</div><div class="kpi-label">Conversions</div></div>
    <div class="kpi"><div class="kpi-value">${metrics.conversionPercent}%</div><div class="kpi-label">Conversion Rate</div></div>
    <div class="kpi"><div class="kpi-value">${metrics.pendingFollowUps}</div><div class="kpi-label">Pending Follow-ups</div></div>
  </div>

  <h2>Stage Breakdown</h2>
  <table>
    <thead><tr><th>Stage</th><th style="text-align:right">Count</th></tr></thead>
    <tbody>${statusRows}</tbody>
  </table>

  <h2>Per-Telecaller Leaderboard</h2>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Telecaller</th><th style="text-align:right">Assigned</th>
        <th style="text-align:right">Contacted</th><th style="text-align:right">Follow-ups</th>
        <th style="text-align:right">Conversions</th><th style="text-align:right">Conv %</th>
        <th style="text-align:right">Revenue</th>
      </tr>
    </thead>
    <tbody>${telecallerRows}</tbody>
  </table>

  <p style="margin-top:20px;font-size:10px;color:#999">Generated on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
</body>
</html>`
}

export function printLeadPerformanceReport(
  metrics: LeadPerformanceMetrics,
  dateRange: { from: string; to: string },
): void {
  let html: string
  try {
    html = buildPerformanceReportHtml(metrics, dateRange)
  } catch (err) {
    logger.error('lead_performance_report.html_generation_failed', err)
    throw new Error('Failed to generate report content.')
  }

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'
  iframe.style.left = '-10000px'
  iframe.style.width = '0'
  iframe.style.height = '0'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    return
  }

  iframeDoc.open()
  iframeDoc.write(html)
  iframeDoc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => document.body.removeChild(iframe), 5000)
  }, 300)
}

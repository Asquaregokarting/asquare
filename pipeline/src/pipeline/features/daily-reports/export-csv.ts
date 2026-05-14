/**
 * Daily Reports — CSV export.
 *
 * Owner/Admin only — gating happens at the action layer (the export button is
 * hidden for non-privileged roles), but this helper itself is pure formatting.
 */

import type { AuditShift } from './types'

const CSV_HEADERS = [
  'date',
  'branch',
  'cashier_user_id',
  'cashier_name',
  'shift_start',
  'shift_end',
  'duration',
  'txn_count',
  'cash_entered',
  'cash_actual',
  'cash_diff',
  'card_entered',
  'card_actual',
  'card_diff',
  'upi_entered',
  'upi_actual',
  'upi_diff',
  'total_entered',
  'total_actual',
  'total_diff',
  'status',
  'flagged',
  'flagged_by',
  'reviewed_by',
  'reviewed_at',
] as const

const escape = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const toneLabel = (audit: AuditShift): string => {
  if (audit.tone === 'pending') return 'In Progress'
  if (audit.review.reviewedAt) return 'Reviewed'
  if (audit.review.flagged) return 'Flagged'
  if (audit.tone === 'settled') return 'Settled'
  return audit.tone === 'excess' ? 'Excess' : 'Shortage'
}

export const auditShiftsToCsv = (audits: AuditShift[]): string => {
  const rows = audits.map((audit) => {
    const shift = audit.shift
    const settlement = shift.settlement
    return [
      shift.shiftDate,
      audit.branchDisplayName,
      shift.userId,
      audit.cashierDisplayName,
      shift.startTime,
      shift.endTime ?? '',
      shift.totalActiveHours ? shift.totalActiveHours.toFixed(2) : '',
      settlement?.totalTransactions ?? '',
      audit.cash.entered,
      audit.cash.actual,
      audit.cash.diff,
      audit.card.entered,
      audit.card.actual,
      audit.card.diff,
      audit.upi.entered,
      audit.upi.actual,
      audit.upi.diff,
      audit.totalEntered,
      audit.totalActual,
      audit.totalDiff,
      toneLabel(audit),
      audit.review.flagged ? 'yes' : 'no',
      audit.review.flaggedByName ?? '',
      audit.review.reviewedByName ?? '',
      audit.review.reviewedAt ?? '',
    ]
      .map(escape)
      .join(',')
  })
  return [CSV_HEADERS.join(','), ...rows].join('\n')
}

export const downloadCsv = (filename: string, csv: string): void => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

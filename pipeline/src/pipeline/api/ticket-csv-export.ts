import type { Ticket } from './types'

export const TICKET_CSV_COLUMNS = [
  'id',
  'title',
  'status',
  'priority',
  'categoryId',
  'branchDisplayName',
  'raisedByName',
  'raisedByKind',
  'assigneeName',
  'assigneeRole',
  'createdAt',
  'resolvedAt',
  'resolveDueAt',
  'rootCauseTag',
  'tags',
] as const

type CsvColumn = (typeof TICKET_CSV_COLUMNS)[number]

/**
 * RFC-4180-style escaping. Wraps a value in double quotes when it contains
 * a quote, comma, or newline; double-quotes inside are doubled.
 */
export function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * Convert tickets into a CSV string. Header row is always emitted, even when
 * the ticket list is empty. Tags are joined with `|` to avoid the column
 * delimiter; null/undefined values become empty strings.
 */
export function ticketsToCsv(tickets: ReadonlyArray<Ticket>): string {
  const header = TICKET_CSV_COLUMNS.join(',')
  if (tickets.length === 0) return header
  const lines = [header]
  for (const t of tickets) {
    const row = TICKET_CSV_COLUMNS.map((col) => {
      const raw = pickValue(t, col)
      return escapeCsv(raw)
    }).join(',')
    lines.push(row)
  }
  return lines.join('\n')
}

function pickValue(ticket: Ticket, col: CsvColumn): string {
  if (col === 'tags') return ticket.tags.join('|')
  const v = ticket[col as Exclude<CsvColumn, 'tags'>]
  if (v === null || v === undefined) return ''
  return String(v)
}

/**
 * Browser-only helper. Triggers a CSV download by creating an `<a download>`.
 * No-op on non-window environments (SSR / unit tests without jsdom).
 */
export function triggerCsvDownload(filename: string, csv: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

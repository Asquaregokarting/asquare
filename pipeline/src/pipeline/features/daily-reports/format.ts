/**
 * Daily Reports — formatting primitives.
 *
 * Tabular figures, Indian locale, signed currency for discrepancy. The auditor
 * scans columns vertically; every helper here returns a string that lines up
 * to the digit when rendered in a tabular-numerals font.
 */

const INR = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
  useGrouping: true,
})

const INR_DECIMAL = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
})

/** ₹1,84,250 — no sign, integer rupees. */
export const fmtRupees = (value: number): string => `₹${INR.format(Math.round(value))}`

/** ₹1,84,250.00 — for CSV export rows where decimal precision matters. */
export const fmtRupeesDecimal = (value: number): string => `₹${INR_DECIMAL.format(value)}`

/**
 * Discrepancy formatting — sign-prefixed, with a leading triangle so the
 * status is readable without color (color-blind safe).
 *
 *   +450  → "▲ +₹450"   (excess, green)
 *   -2840 → "▼ −₹2,840" (shortage, red — uses U+2212 minus, not hyphen)
 *      0  → "₹0"        (settled, neutral — let tabular alignment do the work)
 */
export const fmtDiscrepancy = (
  diff: number,
): { text: string; tone: 'excess' | 'shortage' | 'settled' } => {
  const rounded = Math.round(diff)
  if (rounded === 0) return { text: '₹0', tone: 'settled' }
  if (rounded > 0) return { text: `▲ +₹${INR.format(rounded)}`, tone: 'excess' }
  return { text: `▼ −₹${INR.format(Math.abs(rounded))}`, tone: 'shortage' }
}

/** A short ISO-derived date label for ledger rows: "Mon, 5 May". */
export const fmtShortDate = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** Long form for headers: "Tuesday, 5 May 2026". */
export const fmtLongDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Shift duration as "7h 42m" from start/end ISO strings. */
export const fmtDuration = (startIso: string, endIso?: string): string => {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  if (!isFinite(start) || !isFinite(end) || end <= start) return '—'
  const mins = Math.round((end - start) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Just the time, IST: "9:14 PM". */
export const fmtTime = (iso?: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Relative time for comments: "2h ago", "yesterday", "3 May". */
export const fmtRelative = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

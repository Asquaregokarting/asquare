const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

export const monthLabelFromKey = (monthKey: string): string => {
  const [yearStr, monthStr] = monthKey.split('-')
  const m = Number(monthStr)
  if (!yearStr || !m || m < 1 || m > 12) return monthKey
  return `${MONTHS[m - 1]} ${yearStr}`
}

const sanitizeForFilename = (text: string): string =>
  text.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '')

export const monthlyReportFilename = (
  branchLabel: string,
  monthKey: string,
  ext: 'xlsx' | 'pdf',
): string => {
  const branchPart = sanitizeForFilename(branchLabel) || 'Branch'
  const monthPart = sanitizeForFilename(monthLabelFromKey(monthKey).replace(' ', '-'))
  return `A-Square-Incentives-${branchPart}-${monthPart}.${ext}`
}

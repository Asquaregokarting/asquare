import type { CreateLeadPayload } from './leads-firestore'
import type { LeadSource } from './types'
import { normalizePhone } from '../features/leads/lead-utils'
import { BRANCH_MAP } from '../features/leads/lead-constants'
import { getAllLocations } from '../../lib/locations'

const getExcelJS = () => import('exceljs').then((m) => m.default ?? m)

// ─── Column Aliases ──────────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  customerName: ['name', 'customer name', 'customer', 'full name', 'contact name', 'lead name'],
  customerPhone: [
    'phone',
    'mobile',
    'phone number',
    'contact number',
    'mobile number',
    'cell',
    'tel',
  ],
  customerEmail: ['email', 'email address', 'e-mail', 'mail'],
  branchId: ['branch', 'branch id', 'location', 'location id', 'city'],
  source: ['source', 'lead source', 'channel', 'origin'],
  notes: ['notes', 'remarks', 'comments', 'description'],
  assignedTo: ['assigned to', 'telecaller', 'assignee', 'agent'],
}

const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[_-]/g, ' ')

/**
 * Auto-detect column mapping from Excel headers.
 * Returns a map of leadField -> excelColumnHeader.
 */
export const detectColumnMapping = (headers: string[]): Record<string, string> => {
  const mapping: Record<string, string> = {}
  for (const header of headers) {
    const norm = normalizeHeader(header)
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(norm) && !mapping[field]) {
        mapping[field] = header
        break
      }
    }
  }
  return mapping
}

/** Resolve branch name to ID. */
const resolveBranchId = (value: string): string => {
  const lower = value.trim().toLowerCase()
  for (const [id, name] of Object.entries(BRANCH_MAP)) {
    if (name.toLowerCase() === lower || id === lower) return id
  }
  // Partial match
  for (const [id, name] of Object.entries(BRANCH_MAP)) {
    if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) return id
  }
  return getAllLocations()[0]?.branchId ?? '0'
}

export interface ImportRow {
  rowNumber: number
  data: Record<string, string>
  lead?: CreateLeadPayload
  error?: string
}

/**
 * Parse an Excel file and return rows with validation.
 */
export const parseExcelFile = async (
  file: File,
  columnMapping: Record<string, string>,
): Promise<{ headers: string[]; rows: ImportRow[] }> => {
  const buffer = await file.arrayBuffer()
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('No worksheet found in the file.')

  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell((cell) => {
    headers.push(String(cell.value ?? '').trim())
  })

  const rows: ImportRow[] = []

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const data: Record<string, string> = {}
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) data[header] = String(cell.value ?? '').trim()
    })

    // Skip completely empty rows
    if (Object.values(data).every((v) => !v)) continue

    const getValue = (field: string): string => {
      const col = columnMapping[field]
      return col ? (data[col] ?? '').trim() : ''
    }

    const name = getValue('customerName')
    const phone = normalizePhone(getValue('customerPhone'))
    const email = getValue('customerEmail') || undefined
    const branchRaw = getValue('branchId')
    const branchId = branchRaw ? resolveBranchId(branchRaw) : undefined
    if (!branchId) {
      rows.push({
        rowNumber: r,
        data,
        error: 'Missing branchId — every lead must specify a branch',
      })
      continue
    }
    const notes = getValue('notes') || undefined

    if (!name) {
      rows.push({ rowNumber: r, data, error: 'Missing customer name' })
      continue
    }
    if (!phone || phone.length !== 10) {
      rows.push({ rowNumber: r, data, error: 'Invalid phone number' })
      continue
    }

    rows.push({
      rowNumber: r,
      data,
      lead: {
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        source: 'import' as LeadSource,
        branchId,
        branchName: BRANCH_MAP[branchId] ?? branchId,
        notes,
      },
    })
  }

  return { headers, rows }
}

/**
 * Read just the headers from an Excel file (for column mapping UI).
 */
export const readExcelHeaders = async (file: File): Promise<string[]> => {
  const buffer = await file.arrayBuffer()
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const headers: string[] = []
  sheet.getRow(1).eachCell((cell) => {
    headers.push(String(cell.value ?? '').trim())
  })
  return headers
}

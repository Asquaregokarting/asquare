import type ExcelJS from 'exceljs'
import type { BranchLocationKey } from './types'
import { getAllLocations, resolveLocation } from '../../lib/locations'

const getExcelJS = () => import('exceljs').then((m) => m.default ?? m)

// ─── Branch resolution (backed by centralized registry) ──────────
const resolveBranchId = (value: string): string | null => {
  const loc = resolveLocation(value.trim())
  if (loc) return loc.branchId
  // Fuzzy match: check if input partially matches any known name/slug
  const lower = value.trim().toLowerCase()
  for (const l of getAllLocations()) {
    if (
      lower.includes(l.slug) ||
      l.slug.includes(lower) ||
      lower.includes(l.displayName.toLowerCase()) ||
      l.displayName.toLowerCase().includes(lower)
    ) {
      return l.branchId
    }
  }
  return null
}

// ─── Column Aliases ────────────────────────────────────────────────
const VENDOR_COLUMN_ALIASES: Record<string, string[]> = {
  vendorName: ['vendor name', 'name', 'vendor', 'full name'],
  companyName: ['company name', 'company', 'firm', 'firm name'],
  mobileNumber: ['mobile number', 'mobile', 'phone', 'phone number', 'contact number'],
  email: ['email', 'email address', 'e-mail', 'mail'],
  gstNumber: ['gst number', 'gst', 'gst no', 'gstin'],
  address: ['address', 'location', 'addr'],
  bankAccountNumber: ['bank account number', 'bank account', 'account number', 'account no'],
  bankName: ['bank name', 'bank'],
  ifscCode: ['ifsc code', 'ifsc', 'ifsc no'],
  bankBranch: ['bank branch', 'branch name', 'bank branch name'],
  branch: ['branch', 'city', 'branch id'],
  vendorType: ['vendor type', 'type'],
  revenueShare: ['revenue share (%)', 'revenue share', 'share %', 'share', 'revenue %'],
}

const GAME_COLUMN_ALIASES: Record<string, string[]> = {
  vendorName: ['vendor name', 'vendor', 'name'],
  branch: ['branch', 'city', 'location'],
  gameName: ['game name', 'game', 'activity'],
  gameStatus: ['game status', 'status'],
  subGameName: ['sub game name', 'sub game', 'subgame', 'mode', 'type'],
  variantLabel: ['variant label', 'variant', 'option', 'package'],
  price: ['price', 'cost', 'amount', 'rate'],
  durationMinutes: ['duration (minutes)', 'duration', 'minutes', 'time'],
  laps: ['laps', 'lap count', 'rounds'],
  active: ['active', 'enabled', 'available'],
}

const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[_-]/g, ' ')

const detectMapping = (
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, string> => {
  const mapping: Record<string, string> = {}
  for (const header of headers) {
    const norm = normalizeHeader(header)
    for (const [field, fieldAliases] of Object.entries(aliases)) {
      if (fieldAliases.includes(norm) && !mapping[field]) {
        mapping[field] = header
        break
      }
    }
  }
  return mapping
}

export const detectVendorColumnMapping = (headers: string[]): Record<string, string> =>
  detectMapping(headers, VENDOR_COLUMN_ALIASES)

export const detectGameColumnMapping = (headers: string[]): Record<string, string> =>
  detectMapping(headers, GAME_COLUMN_ALIASES)

// ─── Types ─────────────────────────────────────────────────────────
export interface VendorImportRow {
  rowNumber: number
  data: Record<string, string>
  vendor?: ParsedVendor
  error?: string
}

export interface ParsedVendor {
  vendorName: string
  companyName: string
  mobileNumber: string
  email: string
  gstNumber: string
  address: string
  bankAccountNumber: string
  bankName: string
  ifscCode: string
  bankBranch: string
  branchId: string
  branchName: string
  vendorType: 'ThirdParty' | 'SubLease'
  revenueShare: number
}

export interface GameImportRow {
  rowNumber: number
  data: Record<string, string>
  game?: ParsedGame
  error?: string
}

export interface ParsedGame {
  vendorName: string
  branch: BranchLocationKey
  branchName: string
  gameName: string
  gameStatus: 'Active' | 'Inactive'
  subGameName: string
  variantLabel: string
  price: number
  durationMinutes?: number
  laps?: number
  active: boolean
}

// ─── Validation Patterns ────────────────────────────────────────────
const MOBILE_PATTERN = /^[6-9]\d{9}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/

const normalizeMobile = (value: string): string => {
  const digits = value.replace(/\D+/g, '')
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
}

// ─── Sheet Reading ──────────────────────────────────────────────────
const readSheetHeaders = (sheet: ExcelJS.Worksheet): string[] => {
  const headers: string[] = []
  sheet.getRow(1).eachCell((cell) => {
    headers.push(String(cell.value ?? '').trim())
  })
  return headers
}

export interface ExcelSheetInfo {
  vendorHeaders: string[]
  gameHeaders: string[]
  vendorSheetFound: boolean
  gameSheetFound: boolean
}

export const readExcelSheets = async (file: File): Promise<ExcelSheetInfo> => {
  const buffer = await file.arrayBuffer()
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  await workbook.xlsx.load(buffer)

  const vendorSheet = workbook.getWorksheet('Vendors') ?? workbook.worksheets[0]
  const gameSheet = workbook.getWorksheet('Games') ?? workbook.worksheets[1]

  return {
    vendorHeaders: vendorSheet ? readSheetHeaders(vendorSheet) : [],
    gameHeaders: gameSheet ? readSheetHeaders(gameSheet) : [],
    vendorSheetFound: Boolean(workbook.getWorksheet('Vendors')),
    gameSheetFound: Boolean(workbook.getWorksheet('Games')),
  }
}

// ─── Vendor Parsing ─────────────────────────────────────────────────
export const parseVendorSheet = async (
  file: File,
  mapping: Record<string, string>,
): Promise<{ headers: string[]; rows: VendorImportRow[] }> => {
  const buffer = await file.arrayBuffer()
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.getWorksheet('Vendors') ?? workbook.worksheets[0]
  if (!sheet) throw new Error('No Vendors sheet found.')

  const headers = readSheetHeaders(sheet)
  const rows: VendorImportRow[] = []
  const seenMobiles = new Set<string>()
  const seenEmails = new Set<string>()

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const data: Record<string, string> = {}
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) data[header] = String(cell.value ?? '').trim()
    })

    if (Object.values(data).every((v) => !v)) continue

    const get = (field: string): string => {
      const col = mapping[field]
      return col ? (data[col] ?? '').trim() : ''
    }

    const vendorName = get('vendorName')
    if (!vendorName) {
      rows.push({ rowNumber: r, data, error: 'Missing vendor name' })
      continue
    }

    const companyName = get('companyName')
    if (!companyName) {
      rows.push({ rowNumber: r, data, error: 'Missing company name' })
      continue
    }

    const mobile = normalizeMobile(get('mobileNumber'))
    if (!MOBILE_PATTERN.test(mobile)) {
      rows.push({ rowNumber: r, data, error: 'Invalid mobile number (must be 10-digit Indian)' })
      continue
    }
    if (seenMobiles.has(mobile)) {
      rows.push({ rowNumber: r, data, error: `Duplicate mobile number: ${mobile}` })
      continue
    }
    seenMobiles.add(mobile)

    const email = get('email').toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      rows.push({ rowNumber: r, data, error: 'Invalid email address' })
      continue
    }
    if (seenEmails.has(email)) {
      rows.push({ rowNumber: r, data, error: `Duplicate email: ${email}` })
      continue
    }
    seenEmails.add(email)

    const gstNumber = get('gstNumber').toUpperCase()
    if (!gstNumber) {
      rows.push({ rowNumber: r, data, error: 'Missing GST number' })
      continue
    }

    const address = get('address')
    if (!address) {
      rows.push({ rowNumber: r, data, error: 'Missing address' })
      continue
    }

    const bankAccount = get('bankAccountNumber').replace(/\s+/g, '')
    if (!BANK_ACCOUNT_PATTERN.test(bankAccount)) {
      rows.push({ rowNumber: r, data, error: 'Invalid bank account (9-18 digits)' })
      continue
    }

    const bankName = get('bankName')
    if (!bankName) {
      rows.push({ rowNumber: r, data, error: 'Missing bank name' })
      continue
    }

    const ifsc = get('ifscCode').toUpperCase()
    if (!IFSC_PATTERN.test(ifsc)) {
      rows.push({ rowNumber: r, data, error: 'Invalid IFSC code' })
      continue
    }

    const bankBranch = get('bankBranch')
    if (!bankBranch) {
      rows.push({ rowNumber: r, data, error: 'Missing bank branch' })
      continue
    }

    const branchRaw = get('branch')
    const branchId = resolveBranchId(branchRaw || '')
    if (!branchId) {
      rows.push({
        rowNumber: r,
        data,
        error: `Invalid branch: "${branchRaw}". Valid: ${getAllLocations()
          .map((l) => l.shortName)
          .join(', ')}`,
      })
      continue
    }

    const vendorTypeRaw = get('vendorType').trim()
    const vendorType: 'ThirdParty' | 'SubLease' =
      vendorTypeRaw === 'SubLease' ? 'SubLease' : 'ThirdParty'

    const shareRaw = get('revenueShare')
    const revenueShare = shareRaw ? Number(shareRaw) : 0
    if (!Number.isFinite(revenueShare) || revenueShare < 0 || revenueShare > 100) {
      rows.push({ rowNumber: r, data, error: 'Revenue share must be 0-100' })
      continue
    }

    rows.push({
      rowNumber: r,
      data,
      vendor: {
        vendorName,
        companyName,
        mobileNumber: mobile,
        email,
        gstNumber,
        address,
        bankAccountNumber: bankAccount,
        bankName,
        ifscCode: ifsc,
        bankBranch,
        branchId,
        branchName: resolveLocation(branchId)?.displayName ?? branchId,
        vendorType,
        revenueShare,
      },
    })
  }

  return { headers, rows }
}

// ─── Game Parsing ───────────────────────────────────────────────────
export const parseGameSheet = async (
  file: File,
  mapping: Record<string, string>,
  vendorNames: Set<string>,
): Promise<{ headers: string[]; rows: GameImportRow[] }> => {
  const buffer = await file.arrayBuffer()
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.getWorksheet('Games') ?? workbook.worksheets[1]
  if (!sheet) throw new Error('No Games sheet found.')

  const headers = readSheetHeaders(sheet)
  const rows: GameImportRow[] = []
  const seenVariants = new Set<string>()

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const data: Record<string, string> = {}
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (header) data[header] = String(cell.value ?? '').trim()
    })

    if (Object.values(data).every((v) => !v)) continue

    const get = (field: string): string => {
      const col = mapping[field]
      return col ? (data[col] ?? '').trim() : ''
    }

    const vendorName = get('vendorName')
    if (!vendorName) {
      rows.push({ rowNumber: r, data, error: 'Missing vendor name' })
      continue
    }
    if (!vendorNames.has(vendorName.toLowerCase())) {
      rows.push({ rowNumber: r, data, error: `Vendor "${vendorName}" not found in Vendors sheet` })
      continue
    }

    const branchRaw = get('branch')
    const branchId = resolveBranchId(branchRaw || '')
    if (!branchId) {
      rows.push({ rowNumber: r, data, error: `Invalid branch: "${branchRaw}"` })
      continue
    }

    const gameName = get('gameName')
    if (!gameName) {
      rows.push({ rowNumber: r, data, error: 'Missing game name' })
      continue
    }

    const statusRaw = get('gameStatus').toLowerCase()
    const gameStatus: 'Active' | 'Inactive' = statusRaw === 'inactive' ? 'Inactive' : 'Active'

    const subGameName = get('subGameName')
    if (!subGameName) {
      rows.push({ rowNumber: r, data, error: 'Missing sub game name' })
      continue
    }

    const variantLabel = get('variantLabel')
    if (!variantLabel) {
      rows.push({ rowNumber: r, data, error: 'Missing variant label' })
      continue
    }

    const priceRaw = get('price')
    const price = Number(priceRaw)
    if (!Number.isFinite(price) || price < 0) {
      rows.push({ rowNumber: r, data, error: 'Invalid price (must be a number >= 0)' })
      continue
    }

    const durationRaw = get('durationMinutes')
    const durationMinutes = durationRaw ? Number(durationRaw) : undefined
    if (
      durationMinutes !== undefined &&
      (!Number.isFinite(durationMinutes) || durationMinutes < 0)
    ) {
      rows.push({ rowNumber: r, data, error: 'Invalid duration' })
      continue
    }

    const lapsRaw = get('laps')
    const laps = lapsRaw ? Number(lapsRaw) : undefined
    if (laps !== undefined && (!Number.isFinite(laps) || laps < 0)) {
      rows.push({ rowNumber: r, data, error: 'Invalid laps' })
      continue
    }

    const activeRaw = get('active').toLowerCase()
    const active =
      activeRaw !== 'no' && activeRaw !== 'false' && activeRaw !== '0' && activeRaw !== 'inactive'

    const variantKey = `${branchId}::${gameName.toLowerCase()}::${subGameName.toLowerCase()}::${variantLabel.toLowerCase()}`
    if (seenVariants.has(variantKey)) {
      rows.push({
        rowNumber: r,
        data,
        error: `Duplicate variant: ${gameName} / ${subGameName} / ${variantLabel} at ${resolveLocation(branchId)?.displayName}`,
      })
      continue
    }
    seenVariants.add(variantKey)

    rows.push({
      rowNumber: r,
      data,
      game: {
        vendorName,
        branch: branchId as BranchLocationKey,
        branchName: resolveLocation(branchId)?.displayName ?? branchId,
        gameName,
        gameStatus,
        subGameName,
        variantLabel,
        price,
        durationMinutes,
        laps,
        active,
      },
    })
  }

  return { headers, rows }
}

// ─── Template Generation ────────────────────────────────────────────
export const generateVendorGameTemplate = async (): Promise<Blob> => {
  const ExcelMod = await getExcelJS()
  const workbook = new ExcelMod.Workbook()
  workbook.creator = 'A Square GoKarting'

  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066FF' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    },
  }

  // ── Sheet 1: Vendors ──
  const vendorSheet = workbook.addWorksheet('Vendors')
  vendorSheet.columns = [
    { header: 'Vendor Name', key: 'vendorName', width: 22 },
    { header: 'Company Name', key: 'companyName', width: 22 },
    { header: 'Mobile Number', key: 'mobileNumber', width: 16 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'GST Number', key: 'gstNumber', width: 20 },
    { header: 'Address', key: 'address', width: 35 },
    { header: 'Bank Account Number', key: 'bankAccountNumber', width: 22 },
    { header: 'Bank Name', key: 'bankName', width: 22 },
    { header: 'IFSC Code', key: 'ifscCode', width: 16 },
    { header: 'Bank Branch', key: 'bankBranch', width: 20 },
    { header: 'Branch', key: 'branch', width: 16 },
    { header: 'Vendor Type', key: 'vendorType', width: 16 },
    { header: 'Revenue Share (%)', key: 'revenueShare', width: 18 },
  ]

  vendorSheet.getRow(1).eachCell((cell) => {
    cell.style = headerStyle
  })
  vendorSheet.getRow(1).height = 24

  const sampleLocs = getAllLocations()
  const sampleBranch1 = sampleLocs[0]?.shortName ?? 'Vizag'
  const sampleBranch2 = sampleLocs[1]?.shortName ?? 'Kakinada'

  vendorSheet.addRow({
    vendorName: 'Ravi Kumar',
    companyName: 'RK Games Pvt Ltd',
    mobileNumber: '9876543210',
    email: 'ravi@rkgames.com',
    gstNumber: '37AABCU9603R1ZM',
    address: '12-34 Main Road, Sample City',
    bankAccountNumber: '1234567890123',
    bankName: 'State Bank of India',
    ifscCode: 'SBIN0001234',
    bankBranch: `${sampleBranch1} Main Branch`,
    branch: sampleBranch1,
    vendorType: 'ThirdParty',
    revenueShare: 30,
  })

  vendorSheet.addRow({
    vendorName: 'Suresh Reddy',
    companyName: 'SR Amusements',
    mobileNumber: '8765432109',
    email: 'suresh@sramusements.in',
    gstNumber: '37AABCS1234R1ZP',
    address: '56 Gandhi Nagar, Sample City',
    bankAccountNumber: '9876543210987',
    bankName: 'HDFC Bank',
    ifscCode: 'HDFC0002345',
    bankBranch: `${sampleBranch2} Branch`,
    branch: sampleBranch2,
    vendorType: 'SubLease',
    revenueShare: 25,
  })

  // Style sample rows
  ;[2, 3].forEach((rowNum) => {
    vendorSheet.getRow(rowNum).eachCell((cell) => {
      cell.style = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } },
        font: { italic: true, color: { argb: 'FF888888' } },
      }
    })
  })

  // ── Sheet 2: Games ──
  const gameSheet = workbook.addWorksheet('Games')
  gameSheet.columns = [
    { header: 'Vendor Name', key: 'vendorName', width: 22 },
    { header: 'Branch', key: 'branch', width: 16 },
    { header: 'Game Name', key: 'gameName', width: 22 },
    { header: 'Game Status', key: 'gameStatus', width: 14 },
    { header: 'Sub Game Name', key: 'subGameName', width: 22 },
    { header: 'Variant Label', key: 'variantLabel', width: 22 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'Duration (minutes)', key: 'durationMinutes', width: 20 },
    { header: 'Laps', key: 'laps', width: 8 },
    { header: 'Active', key: 'active', width: 10 },
  ]

  gameSheet.getRow(1).eachCell((cell) => {
    cell.style = headerStyle
  })
  gameSheet.getRow(1).height = 24

  const sampleGames = [
    {
      vendorName: 'Ravi Kumar',
      branch: sampleBranch1,
      gameName: 'Bumper Cars',
      gameStatus: 'Active',
      subGameName: 'Standard',
      variantLabel: '5 Minutes',
      price: 200,
      durationMinutes: 5,
      laps: '',
      active: 'Yes',
    },
    {
      vendorName: 'Ravi Kumar',
      branch: sampleBranch1,
      gameName: 'Bumper Cars',
      gameStatus: 'Active',
      subGameName: 'Standard',
      variantLabel: '10 Minutes',
      price: 350,
      durationMinutes: 10,
      laps: '',
      active: 'Yes',
    },
    {
      vendorName: 'Ravi Kumar',
      branch: sampleBranch1,
      gameName: 'Go Kart',
      gameStatus: 'Active',
      subGameName: 'Pro Track',
      variantLabel: '3 Laps',
      price: 300,
      durationMinutes: '',
      laps: 3,
      active: 'Yes',
    },
    {
      vendorName: 'Suresh Reddy',
      branch: sampleBranch2,
      gameName: 'Trampoline',
      gameStatus: 'Active',
      subGameName: 'Open Jump',
      variantLabel: '15 Minutes',
      price: 250,
      durationMinutes: 15,
      laps: '',
      active: 'Yes',
    },
    {
      vendorName: 'Suresh Reddy',
      branch: sampleBranch2,
      gameName: 'Trampoline',
      gameStatus: 'Active',
      subGameName: 'Open Jump',
      variantLabel: '30 Minutes',
      price: 400,
      durationMinutes: 30,
      laps: '',
      active: 'Yes',
    },
  ]

  sampleGames.forEach((g) => gameSheet.addRow(g))

  // Style sample rows
  for (let rowNum = 2; rowNum <= sampleGames.length + 1; rowNum++) {
    gameSheet.getRow(rowNum).eachCell((cell) => {
      cell.style = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4FF' } },
        font: { italic: true, color: { argb: 'FF888888' } },
      }
    })
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

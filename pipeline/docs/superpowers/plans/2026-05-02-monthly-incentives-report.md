# Monthly Incentives Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly incentives report covering both cashiers and telecallers, exportable as Excel or PDF, with a dedicated page at `/incentives/monthly` and a quick-export popover on the existing Cashier Breakdown view.

**Architecture:** New feature folder `src/pipeline/features/incentives-report/` with pure aggregator + Excel/PDF formatters. View component reuses `ModulePageLayout` and `DataTable`. Cashier monthly rollup is computed by querying `cashierIncentives` records via existing `listCashierIncentives` extended with a `toDate` filter. Telecaller data comes from existing `telecallerPerformanceApi.listPerformance({ monthKey })`.

**Tech Stack:** React 18 + TypeScript, `exceljs@4.4`, `jspdf@4.1` + `jspdf-autotable@5.0`, Vitest, Tailwind 3.

---

## File Map

**New:**

| Path                                                                 | Purpose                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/pipeline/features/incentives-report/types.ts`                   | `CashierMonthlyRow`, `TelecallerMonthlyRow`, `MonthlyReportPayload` |
| `src/pipeline/features/incentives-report/monthly-aggregator.ts`      | Pure aggregation/mapping functions                                  |
| `src/pipeline/features/incentives-report/monthly-aggregator.test.ts` | Unit tests for aggregator                                           |
| `src/pipeline/features/incentives-report/filename.ts`                | Human-readable filename builder                                     |
| `src/pipeline/features/incentives-report/download.ts`                | `downloadBlob(filename, blob)` helper                               |
| `src/pipeline/features/incentives-report/excel-export.ts`            | `exportMonthlyExcel(payload)`                                       |
| `src/pipeline/features/incentives-report/pdf-export.ts`              | `exportMonthlyPdf(payload)`                                         |
| `src/pipeline/pages/modules/incentives/MonthlyReportView.tsx`        | New page view                                                       |
| `src/pipeline/pages/modules/incentives/MonthlyExportPopover.tsx`     | Quick-export popover on Cashier Breakdown                           |

**Modified:**

| Path                                              | Change                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/pipeline/api/incentives-firestore.ts`        | Add `toDate?: string` to `IncentiveFilters`, apply in `listCashierIncentives`    |
| `src/pipeline/pages/modules/IncentivesModule.tsx` | Add `'monthly'` to `IncentivesView`, wire subnav, render new view, embed popover |
| `src/pipeline/app/router.tsx`                     | Register `/incentives/monthly` route                                             |

---

## Task 1: Add `toDate` filter to cashier incentive query

**Files:**

- Modify: `src/pipeline/api/incentives-firestore.ts` (`IncentiveFilters` interface and `listCashierIncentives`)

- [ ] **Step 1: Read current `IncentiveFilters` and filter logic**

Open `src/pipeline/api/incentives-firestore.ts`, locate the `IncentiveFilters` interface (around line 120-130) and the `listCashierIncentives` function (around line 130-150).

- [ ] **Step 2: Add `toDate` to interface**

Find:

```ts
export interface IncentiveFilters {
  cashierId?: string
  locationId?: string
  weekKey?: string
  status?: 'active' | 'reversed' | 'all'
  fromDate?: string
}
```

Replace with:

```ts
export interface IncentiveFilters {
  cashierId?: string
  locationId?: string
  weekKey?: string
  status?: 'active' | 'reversed' | 'all'
  fromDate?: string
  toDate?: string
}
```

- [ ] **Step 3: Apply `toDate` filter in `listCashierIncentives`**

Find:

```ts
if (filters.fromDate) {
  results = results.filter((r) => r.transactionDate >= filters.fromDate!)
}
```

Add immediately after:

```ts
if (filters.toDate) {
  results = results.filter((r) => r.transactionDate <= filters.toDate!)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/api/incentives-firestore.ts
git commit -m "feat(incentives): add toDate filter to listCashierIncentives"
```

---

## Task 2: Define payload types

**Files:**

- Create: `src/pipeline/features/incentives-report/types.ts`

- [ ] **Step 1: Write the file**

```ts
export interface CashierMonthlyRow {
  branchId: string
  branchName: string
  cashierId: string
  cashierName: string
  qualifyingTxns: number
  totalItemAmount: number
  byNonPerforming: number
  byGokartLaps: number
  byBoth: number
  totalIncentive: number
}

export interface TelecallerMonthlyRow {
  telecallerId: string
  telecallerName: string
  hasPlan: boolean
  bookingCount: number
  bookedAmount: number
  targetAmount: number
  achievementPercent: number
  incentivePercentUsed: number
  incentiveEarned: number
}

export interface BranchSummaryRow {
  branchId: string
  branchName: string
  cashierIncentive: number
  telecallerIncentive: number
  total: number
}

export interface MonthlyReportPayload {
  monthKey: string // 'YYYY-MM'
  monthLabel: string // 'May 2026'
  branchLabel: string // 'Vizag' or 'All Branches'
  generatedAt: string // ISO timestamp
  generatedByName: string
  cashiers: CashierMonthlyRow[]
  telecallers: TelecallerMonthlyRow[]
  branchSummary: BranchSummaryRow[] // empty if single branch
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/features/incentives-report/types.ts
git commit -m "feat(incentives): add monthly report payload types"
```

---

## Task 3: Aggregator — failing tests

**Files:**

- Create: `src/pipeline/features/incentives-report/monthly-aggregator.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateCashierMonth, mapTelecallerMonth, buildBranchSummary } from './monthly-aggregator'
import type { CashierIncentiveRecord, TelecallerMonthlyPerformanceRecord } from '../../api/types'

const branchNames: Record<string, string> = {
  '0': 'Vizag',
  '1': 'Kakinada',
}

const baseCashierRec = (overrides: Partial<CashierIncentiveRecord>): CashierIncentiveRecord =>
  ({
    id: 'r1',
    bookingId: 'b1',
    invoiceNumber: 'INV-1',
    locationId: '0',
    cashierId: 'C1',
    cashierName: 'Alice',
    itemIndex: 0,
    itemName: 'Bowling',
    gameId: 'g1',
    subGameId: 'sg1',
    variantId: 'v1',
    itemAmount: 1000,
    incentivePercent: 2,
    incentiveAmount: 20,
    reason: 'non_performing',
    laps: null,
    weeklyRevenue: null,
    threshold: null,
    weekKey: '2026-W18',
    isComboItem: false,
    comboName: null,
    status: 'active',
    reversedAt: null,
    reversedReason: null,
    createdAt: '2026-05-01T10:00:00Z',
    transactionDate: '2026-05-01',
    ...overrides,
  }) as CashierIncentiveRecord

describe('aggregateCashierMonth', () => {
  it('returns empty rows when records list is empty', () => {
    const rows = aggregateCashierMonth([], branchNames)
    expect(rows).toEqual([])
  })

  it('aggregates incentive by cashier across multiple records', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', incentiveAmount: 20, reason: 'non_performing' }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', incentiveAmount: 30, reason: 'gokart_laps' }),
      baseCashierRec({
        id: 'r3',
        cashierId: 'C2',
        cashierName: 'Bob',
        incentiveAmount: 15,
        reason: 'both',
      }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows).toHaveLength(2)
    const alice = rows.find((r) => r.cashierId === 'C1')!
    expect(alice.qualifyingTxns).toBe(2)
    expect(alice.byNonPerforming).toBe(20)
    expect(alice.byGokartLaps).toBe(30)
    expect(alice.byBoth).toBe(0)
    expect(alice.totalIncentive).toBe(50)
    const bob = rows.find((r) => r.cashierId === 'C2')!
    expect(bob.byBoth).toBe(15)
    expect(bob.totalIncentive).toBe(15)
  })

  it('keeps separate rows for the same cashier across different branches', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', locationId: '0', incentiveAmount: 20 }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', locationId: '1', incentiveAmount: 30 }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.branchName).sort()).toEqual(['Kakinada', 'Vizag'])
  })

  it('falls back to locationId when branch name is missing', () => {
    const records = [baseCashierRec({ locationId: '99' })]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows[0].branchName).toBe('99')
  })

  it('sums totalItemAmount correctly', () => {
    const records = [
      baseCashierRec({ id: 'r1', cashierId: 'C1', itemAmount: 1000 }),
      baseCashierRec({ id: 'r2', cashierId: 'C1', itemAmount: 2500 }),
    ]
    const rows = aggregateCashierMonth(records, branchNames)
    expect(rows[0].totalItemAmount).toBe(3500)
  })
})

describe('mapTelecallerMonth', () => {
  const baseTcRec = (
    overrides: Partial<TelecallerMonthlyPerformanceRecord>,
  ): TelecallerMonthlyPerformanceRecord => ({
    telecallerId: 'T1',
    telecallerName: 'Carol',
    monthKey: '2026-05',
    hasPlan: true,
    bookingCount: 10,
    bookedAmount: 100000,
    targetAmount: 80000,
    achievementPercent: 125,
    incentivePercentUsed: 2,
    estimatedIncentiveTotal: 2000,
    ...overrides,
  })

  it('returns empty rows for empty input', () => {
    expect(mapTelecallerMonth([])).toEqual([])
  })

  it('maps performance records to row shape', () => {
    const recs = [baseTcRec({})]
    const rows = mapTelecallerMonth(recs)
    expect(rows[0]).toEqual({
      telecallerId: 'T1',
      telecallerName: 'Carol',
      hasPlan: true,
      bookingCount: 10,
      bookedAmount: 100000,
      targetAmount: 80000,
      achievementPercent: 125,
      incentivePercentUsed: 2,
      incentiveEarned: 2000,
    })
  })

  it('preserves hasPlan=false', () => {
    const rows = mapTelecallerMonth([baseTcRec({ hasPlan: false, telecallerId: 'T2' })])
    expect(rows[0].hasPlan).toBe(false)
  })
})

describe('buildBranchSummary', () => {
  it('returns empty array when both inputs empty', () => {
    expect(buildBranchSummary([], [], branchNames)).toEqual([])
  })

  it('aggregates per branch with grand-total exclusion (telecaller has no branch)', () => {
    const cashierRows = [
      {
        branchId: '0',
        branchName: 'Vizag',
        cashierId: 'C1',
        cashierName: 'Alice',
        qualifyingTxns: 1,
        totalItemAmount: 1000,
        byNonPerforming: 20,
        byGokartLaps: 0,
        byBoth: 0,
        totalIncentive: 20,
      },
      {
        branchId: '1',
        branchName: 'Kakinada',
        cashierId: 'C2',
        cashierName: 'Bob',
        qualifyingTxns: 1,
        totalItemAmount: 2000,
        byNonPerforming: 0,
        byGokartLaps: 40,
        byBoth: 0,
        totalIncentive: 40,
      },
    ]
    const summary = buildBranchSummary(cashierRows, [], branchNames)
    expect(summary).toHaveLength(2)
    const vizag = summary.find((s) => s.branchId === '0')!
    expect(vizag.cashierIncentive).toBe(20)
    expect(vizag.telecallerIncentive).toBe(0)
    expect(vizag.total).toBe(20)
  })
})
```

- [ ] **Step 2: Run the tests — confirm they fail with module-not-found**

```bash
npx vitest run src/pipeline/features/incentives-report/monthly-aggregator.test.ts
```

Expected: failure — module `./monthly-aggregator` does not exist.

- [ ] **Step 3: Commit (failing test)**

```bash
git add src/pipeline/features/incentives-report/monthly-aggregator.test.ts
git commit -m "test(incentives): failing tests for monthly aggregator"
```

---

## Task 4: Aggregator — implementation

**Files:**

- Create: `src/pipeline/features/incentives-report/monthly-aggregator.ts`

- [ ] **Step 1: Implement**

```ts
import type { CashierIncentiveRecord, TelecallerMonthlyPerformanceRecord } from '../../api/types'
import type { BranchSummaryRow, CashierMonthlyRow, TelecallerMonthlyRow } from './types'

const cashierKey = (locationId: string, cashierId: string) => `${locationId}::${cashierId}`

export const aggregateCashierMonth = (
  records: CashierIncentiveRecord[],
  branchNameById: Record<string, string>,
): CashierMonthlyRow[] => {
  const map = new Map<string, CashierMonthlyRow>()

  for (const rec of records) {
    if (rec.status !== 'active') continue
    const key = cashierKey(rec.locationId, rec.cashierId)
    let row = map.get(key)
    if (!row) {
      row = {
        branchId: rec.locationId,
        branchName: branchNameById[rec.locationId] ?? rec.locationId,
        cashierId: rec.cashierId,
        cashierName: rec.cashierName,
        qualifyingTxns: 0,
        totalItemAmount: 0,
        byNonPerforming: 0,
        byGokartLaps: 0,
        byBoth: 0,
        totalIncentive: 0,
      }
      map.set(key, row)
    }
    row.qualifyingTxns += 1
    row.totalItemAmount += rec.itemAmount
    row.totalIncentive += rec.incentiveAmount
    if (rec.reason === 'non_performing') row.byNonPerforming += rec.incentiveAmount
    else if (rec.reason === 'gokart_laps') row.byGokartLaps += rec.incentiveAmount
    else if (rec.reason === 'both') row.byBoth += rec.incentiveAmount
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.branchName !== b.branchName) return a.branchName.localeCompare(b.branchName)
    return a.cashierName.localeCompare(b.cashierName)
  })
}

export const mapTelecallerMonth = (
  records: TelecallerMonthlyPerformanceRecord[],
): TelecallerMonthlyRow[] =>
  records
    .map((r) => ({
      telecallerId: r.telecallerId,
      telecallerName: r.telecallerName,
      hasPlan: r.hasPlan,
      bookingCount: r.bookingCount,
      bookedAmount: r.bookedAmount,
      targetAmount: r.targetAmount,
      achievementPercent: r.achievementPercent,
      incentivePercentUsed: r.incentivePercentUsed,
      incentiveEarned: r.estimatedIncentiveTotal,
    }))
    .sort((a, b) => a.telecallerName.localeCompare(b.telecallerName))

export const buildBranchSummary = (
  cashierRows: CashierMonthlyRow[],
  _telecallerRows: TelecallerMonthlyRow[],
  branchNameById: Record<string, string>,
): BranchSummaryRow[] => {
  if (cashierRows.length === 0) return []
  const byBranch = new Map<string, BranchSummaryRow>()
  for (const r of cashierRows) {
    let entry = byBranch.get(r.branchId)
    if (!entry) {
      entry = {
        branchId: r.branchId,
        branchName: branchNameById[r.branchId] ?? r.branchName,
        cashierIncentive: 0,
        telecallerIncentive: 0,
        total: 0,
      }
      byBranch.set(r.branchId, entry)
    }
    entry.cashierIncentive += r.totalIncentive
    entry.total += r.totalIncentive
  }
  return Array.from(byBranch.values()).sort((a, b) => a.branchName.localeCompare(b.branchName))
}
```

- [ ] **Step 2: Run tests — expect all pass**

```bash
npx vitest run src/pipeline/features/incentives-report/monthly-aggregator.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/features/incentives-report/monthly-aggregator.ts
git commit -m "feat(incentives): aggregator for monthly cashier and telecaller rows"
```

---

## Task 5: Filename builder

**Files:**

- Create: `src/pipeline/features/incentives-report/filename.ts`

- [ ] **Step 1: Implement**

```ts
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
  text.replace(/\s+/g, '-').replace(/[^A-Za-z0-9_\-]/g, '')

export const monthlyReportFilename = (
  branchLabel: string,
  monthKey: string,
  ext: 'xlsx' | 'pdf',
): string => {
  const branchPart = sanitizeForFilename(branchLabel) || 'Branch'
  const monthPart = sanitizeForFilename(monthLabelFromKey(monthKey).replace(' ', '-'))
  return `A-Square-Incentives-${branchPart}-${monthPart}.${ext}`
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/features/incentives-report/filename.ts
git commit -m "feat(incentives): filename + month-label helpers for monthly report"
```

---

## Task 6: Download helper

**Files:**

- Create: `src/pipeline/features/incentives-report/download.ts`

- [ ] **Step 1: Implement**

```ts
export const downloadBlob = (filename: string, blob: Blob): void => {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline/features/incentives-report/download.ts
git commit -m "feat(incentives): downloadBlob helper for binary exports"
```

---

## Task 7: Excel export

**Files:**

- Create: `src/pipeline/features/incentives-report/excel-export.ts`

- [ ] **Step 1: Implement**

```ts
import ExcelJS from 'exceljs'
import { downloadBlob } from './download'
import { monthlyReportFilename } from './filename'
import type { MonthlyReportPayload } from './types'

const HEADER_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FF0066FF' },
}
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }
const FOOTER_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFF3F4F6' },
}
const NO_PLAN_FILL = {
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb: 'FFFEE2E2' },
}
const RUPEE_FORMAT = '"₹"#,##0'

const styleHeader = (row: ExcelJS.Row) => {
  row.font = HEADER_FONT
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'left' }
}

const addSummarySheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Summary')
  ws.addRow([`A Square GoKarting — Incentives — ${payload.monthLabel}`])
  ws.getRow(1).font = { bold: true, size: 14 }
  ws.addRow([`Branch: ${payload.branchLabel}`])
  ws.addRow([`Generated: ${payload.generatedAt} by ${payload.generatedByName}`])
  ws.addRow([])

  const headerRow = ws.addRow(['Branch', 'Cashier Incentive', 'Telecaller Incentive', 'Total'])
  styleHeader(headerRow)

  let totalCashier = 0
  let totalTelecaller = 0
  for (const r of payload.branchSummary) {
    ws.addRow([r.branchName, r.cashierIncentive, r.telecallerIncentive, r.total])
    totalCashier += r.cashierIncentive
    totalTelecaller += r.telecallerIncentive
  }
  // Telecaller line is not branch-scoped — append as its own row
  const telecallerGrand = payload.telecallers.reduce((s, t) => s + t.incentiveEarned, 0)
  if (telecallerGrand > 0) {
    ws.addRow(['(Telecallers — all branches)', 0, telecallerGrand, telecallerGrand])
    totalTelecaller += telecallerGrand
  }
  const grand = ws.addRow([
    'Grand Total',
    totalCashier,
    totalTelecaller,
    totalCashier + totalTelecaller,
  ])
  grand.font = { bold: true }
  grand.fill = FOOTER_FILL

  ws.columns = [{ width: 32 }, { width: 22 }, { width: 22 }, { width: 18 }]
  ws.getColumn(2).numFmt = RUPEE_FORMAT
  ws.getColumn(3).numFmt = RUPEE_FORMAT
  ws.getColumn(4).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 5 }]
}

const addCashierSheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Cashiers')
  const headerRow = ws.addRow([
    'Branch',
    'Cashier Name',
    'Cashier ID',
    'Qualifying Txns',
    'Total Item Amount',
    'Non-Performing',
    'Go-Kart Laps',
    'Both',
    'Total Incentive',
  ])
  styleHeader(headerRow)

  let txns = 0
  let item = 0
  let np = 0
  let gk = 0
  let bo = 0
  let tot = 0
  for (const r of payload.cashiers) {
    ws.addRow([
      r.branchName,
      r.cashierName,
      r.cashierId,
      r.qualifyingTxns,
      r.totalItemAmount,
      r.byNonPerforming,
      r.byGokartLaps,
      r.byBoth,
      r.totalIncentive,
    ])
    txns += r.qualifyingTxns
    item += r.totalItemAmount
    np += r.byNonPerforming
    gk += r.byGokartLaps
    bo += r.byBoth
    tot += r.totalIncentive
  }
  const totalsRow = ws.addRow(['', 'Totals', '', txns, item, np, gk, bo, tot])
  totalsRow.font = { bold: true }
  totalsRow.fill = FOOTER_FILL

  ws.columns = [
    { width: 14 },
    { width: 24 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
    { width: 18 },
  ]
  for (const col of [5, 6, 7, 8, 9]) ws.getColumn(col).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

const addTelecallerSheet = (wb: ExcelJS.Workbook, payload: MonthlyReportPayload) => {
  const ws = wb.addWorksheet('Telecallers')
  const headerRow = ws.addRow([
    'Telecaller Name',
    'Plan Status',
    'Bookings',
    'Booked Amount',
    'Target',
    'Achievement %',
    'Incentive %',
    'Incentive Earned',
  ])
  styleHeader(headerRow)

  let bookings = 0
  let booked = 0
  let earned = 0
  for (const r of payload.telecallers) {
    const row = ws.addRow([
      r.telecallerName,
      r.hasPlan ? 'Active' : 'No Plan',
      r.bookingCount,
      r.bookedAmount,
      r.targetAmount,
      r.achievementPercent,
      r.incentivePercentUsed,
      r.incentiveEarned,
    ])
    if (!r.hasPlan) row.getCell(2).fill = NO_PLAN_FILL
    bookings += r.bookingCount
    booked += r.bookedAmount
    earned += r.incentiveEarned
  }
  const totalsRow = ws.addRow(['Totals', '', bookings, booked, '', '', '', earned])
  totalsRow.font = { bold: true }
  totalsRow.fill = FOOTER_FILL

  ws.columns = [
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
  ]
  ws.getColumn(4).numFmt = RUPEE_FORMAT
  ws.getColumn(5).numFmt = RUPEE_FORMAT
  ws.getColumn(8).numFmt = RUPEE_FORMAT
  ws.getColumn(6).numFmt = '0.0"%"'
  ws.getColumn(7).numFmt = '0.0"%"'
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export const exportMonthlyExcel = async (payload: MonthlyReportPayload): Promise<void> => {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()
  addSummarySheet(wb, payload)
  addCashierSheet(wb, payload)
  addTelecallerSheet(wb, payload)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(monthlyReportFilename(payload.branchLabel, payload.monthKey, 'xlsx'), blob)
}
```

- [ ] **Step 2: Type-check the file**

```bash
npx tsc --noEmit
```

Expected: no errors involving the new file.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/features/incentives-report/excel-export.ts
git commit -m "feat(incentives): Excel export for monthly report (3 sheets)"
```

---

## Task 8: PDF export

**Files:**

- Create: `src/pipeline/features/incentives-report/pdf-export.ts`

- [ ] **Step 1: Implement**

```ts
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { downloadBlob } from './download'
import { monthlyReportFilename } from './filename'
import type { MonthlyReportPayload } from './types'

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)

const HEADER_FILL: [number, number, number] = [0, 102, 255]

export const exportMonthlyPdf = (payload: MonthlyReportPayload): void => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('A Square GoKarting — Incentives Report', 40, 50)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`${payload.monthLabel} · ${payload.branchLabel}`, 40, 70)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Generated: ${payload.generatedAt} · by ${payload.generatedByName}`, 40, 86)
  doc.setTextColor(0)

  // Cashier table
  autoTable(doc, {
    startY: 100,
    head: [['Branch', 'Cashier', 'ID', 'Txns', 'Item Amt', 'Non-Perf', 'Go-Kart', 'Both', 'Total']],
    body: payload.cashiers.map((r) => [
      r.branchName,
      r.cashierName,
      r.cashierId,
      r.qualifyingTxns,
      inr(r.totalItemAmount),
      inr(r.byNonPerforming),
      inr(r.byGokartLaps),
      inr(r.byBoth),
      inr(r.totalIncentive),
    ]),
    foot:
      payload.cashiers.length > 0
        ? [
            [
              '',
              'Totals',
              '',
              payload.cashiers.reduce((s, r) => s + r.qualifyingTxns, 0),
              inr(payload.cashiers.reduce((s, r) => s + r.totalItemAmount, 0)),
              inr(payload.cashiers.reduce((s, r) => s + r.byNonPerforming, 0)),
              inr(payload.cashiers.reduce((s, r) => s + r.byGokartLaps, 0)),
              inr(payload.cashiers.reduce((s, r) => s + r.byBoth, 0)),
              inr(payload.cashiers.reduce((s, r) => s + r.totalIncentive, 0)),
            ],
          ]
        : undefined,
    theme: 'striped',
    headStyles: { fillColor: HEADER_FILL, textColor: 255 },
    footStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    margin: { left: 30, right: 30 },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(
        `${payload.branchLabel} · ${payload.monthLabel}`,
        30,
        doc.internal.pageSize.getHeight() - 20,
      )
    },
  })

  // Telecaller table on a fresh page
  doc.addPage()
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0)
  doc.text('Telecaller Incentives', 40, 50)
  autoTable(doc, {
    startY: 70,
    head: [['Telecaller', 'Plan', 'Bookings', 'Booked Amt', 'Target', 'Achv %', 'Inc %', 'Earned']],
    body: payload.telecallers.map((r) => [
      r.telecallerName,
      r.hasPlan ? 'Active' : 'No Plan',
      r.bookingCount,
      inr(r.bookedAmount),
      inr(r.targetAmount),
      `${r.achievementPercent.toFixed(1)}%`,
      `${r.incentivePercentUsed.toFixed(1)}%`,
      inr(r.incentiveEarned),
    ]),
    foot:
      payload.telecallers.length > 0
        ? [
            [
              'Totals',
              '',
              payload.telecallers.reduce((s, r) => s + r.bookingCount, 0),
              inr(payload.telecallers.reduce((s, r) => s + r.bookedAmount, 0)),
              '',
              '',
              '',
              inr(payload.telecallers.reduce((s, r) => s + r.incentiveEarned, 0)),
            ],
          ]
        : undefined,
    theme: 'striped',
    headStyles: { fillColor: HEADER_FILL, textColor: 255 },
    footStyles: { fillColor: [243, 244, 246], textColor: 0, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    margin: { left: 30, right: 30 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 1 && data.cell.text[0] === 'No Plan') {
        data.cell.styles.fillColor = [254, 226, 226]
      }
    },
  })

  // Page numbering footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 90, doc.internal.pageSize.getHeight() - 20)
  }

  const blob = doc.output('blob')
  downloadBlob(monthlyReportFilename(payload.branchLabel, payload.monthKey, 'pdf'), blob)
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/features/incentives-report/pdf-export.ts
git commit -m "feat(incentives): PDF export for monthly report"
```

---

## Task 9: MonthlyReportView page component

**Files:**

- Create: `src/pipeline/pages/modules/incentives/MonthlyReportView.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TrendingUp, Trophy, Users, Building2, Download } from 'lucide-react'
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { logger } from '../../../../lib/logger'
import { listCashierIncentives } from '../../../api/incentives-firestore'
import { telecallerPerformanceApi } from '../../../api/telecaller-performance'
import {
  aggregateCashierMonth,
  buildBranchSummary,
  mapTelecallerMonth,
} from '../../../features/incentives-report/monthly-aggregator'
import { exportMonthlyExcel } from '../../../features/incentives-report/excel-export'
import { exportMonthlyPdf } from '../../../features/incentives-report/pdf-export'
import { monthLabelFromKey } from '../../../features/incentives-report/filename'
import type {
  CashierMonthlyRow,
  MonthlyReportPayload,
  TelecallerMonthlyRow,
} from '../../../features/incentives-report/types'

const currency = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const currentMonthKey = (): string => {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const ist = new Date(utcMs + 5.5 * 60 * 60_000)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}`
}

const monthBounds = (monthKey: string): { fromDate: string; toDate: string } => {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  }
}

const KpiCard = ({
  label,
  value,
  icon,
  tone,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone: 'success' | 'info' | 'muted'
}) => {
  const toneClass = {
    success: 'text-green-600 dark:text-green-400',
    info: 'text-blue-600 dark:text-blue-400',
    muted: 'text-muted',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-panel p-4 shadow-sm">
      <div className={`rounded-lg bg-surface/60 p-2.5 ${toneClass}`}>{icon}</div>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="text-lg font-bold text-text">{value}</p>
      </div>
    </div>
  )
}

export const MonthlyReportView = () => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey())
  const [branchId, setBranchId] = useState<string>('')
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [tab, setTab] = useState<'cashiers' | 'telecallers'>('cashiers')
  const [cashiers, setCashiers] = useState<CashierMonthlyRow[]>([])
  const [telecallers, setTelecallers] = useState<TelecallerMonthlyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const branchNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of enabledLocations) m[l.branchId] = l.displayName
    return m
  }, [enabledLocations])

  const branchLabel = useMemo(() => {
    if (!branchId) return 'All Branches'
    return branchNameById[branchId] ?? branchId
  }, [branchId, branchNameById])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { fromDate, toDate } = monthBounds(monthKey)
      const [records, perfResult] = await Promise.all([
        listCashierIncentives({
          fromDate,
          toDate,
          locationId: branchId || undefined,
          status: 'active',
        }),
        telecallerPerformanceApi.listPerformance({ monthKey }),
      ])
      setCashiers(aggregateCashierMonth(records, branchNameById))
      setTelecallers(mapTelecallerMonth(perfResult.performance))
    } catch (err) {
      logger.error('incentives.monthly.load_failed', err)
      setCashiers([])
      setTelecallers([])
    } finally {
      setLoading(false)
    }
  }, [monthKey, branchId, branchNameById])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const cashier = cashiers.reduce((s, r) => s + r.totalIncentive, 0)
    const telecaller = telecallers.reduce((s, r) => s + r.incentiveEarned, 0)
    const employees =
      cashiers.filter((c) => c.totalIncentive > 0).length +
      telecallers.filter((t) => t.incentiveEarned > 0).length
    const branches = new Set(cashiers.map((c) => c.branchId)).size
    return { cashier, telecaller, employees, branches }
  }, [cashiers, telecallers])

  const handleExport = useCallback(async () => {
    if (cashiers.length === 0 && telecallers.length === 0) return
    setExporting(true)
    try {
      const payload: MonthlyReportPayload = {
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        branchLabel,
        generatedAt: new Date().toISOString(),
        generatedByName: session?.user.name ?? session?.user.id ?? 'Unknown',
        cashiers,
        telecallers,
        branchSummary: buildBranchSummary(cashiers, telecallers, branchNameById),
      }
      if (format === 'xlsx') await exportMonthlyExcel(payload)
      else exportMonthlyPdf(payload)
    } catch (err) {
      logger.error('incentives.monthly.export_failed', err)
    } finally {
      setExporting(false)
    }
  }, [cashiers, telecallers, monthKey, branchLabel, branchNameById, format, session])

  const cashierColumns: DataTableColumn<CashierMonthlyRow>[] = [
    { key: 'branch', header: 'Branch', render: (r) => r.branchName },
    { key: 'name', header: 'Cashier', render: (r) => r.cashierName },
    { key: 'txns', header: 'Txns', render: (r) => r.qualifyingTxns },
    { key: 'np', header: 'Non-Performing', render: (r) => currency(r.byNonPerforming) },
    { key: 'gk', header: 'Go-Kart Laps', render: (r) => currency(r.byGokartLaps) },
    { key: 'both', header: 'Both', render: (r) => currency(r.byBoth) },
    {
      key: 'total',
      header: 'Total',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.totalIncentive)}
        </span>
      ),
    },
  ]

  const telecallerColumns: DataTableColumn<TelecallerMonthlyRow>[] = [
    { key: 'name', header: 'Telecaller', render: (r) => r.telecallerName },
    {
      key: 'plan',
      header: 'Plan',
      render: (r) =>
        r.hasPlan ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">No Plan</span>
        ),
    },
    { key: 'bookings', header: 'Bookings', render: (r) => r.bookingCount },
    { key: 'booked', header: 'Booked', render: (r) => currency(r.bookedAmount) },
    { key: 'target', header: 'Target', render: (r) => currency(r.targetAmount) },
    {
      key: 'achv',
      header: 'Achievement',
      render: (r) => `${r.achievementPercent.toFixed(1)}%`,
    },
    { key: 'pct', header: 'Inc %', render: (r) => `${r.incentivePercentUsed.toFixed(1)}%` },
    {
      key: 'earned',
      header: 'Earned',
      render: (r) => (
        <span className="font-semibold text-green-600 dark:text-green-400">
          {currency(r.incentiveEarned)}
        </span>
      ),
    },
  ]

  const isEmpty = cashiers.length === 0 && telecallers.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value || currentMonthKey())}
        />
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          <option value="">All Branches</option>
          {enabledLocations.map((l) => (
            <option key={l.branchId} value={l.branchId}>
              {l.displayName}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-border/60 bg-panel px-3 py-2 text-sm"
          value={format}
          onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')}
        >
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF (.pdf)</option>
        </select>
        <button
          className="ui-btn ui-btn-info inline-flex items-center gap-2 px-4 text-sm"
          disabled={exporting || loading || isEmpty}
          onClick={handleExport}
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting...' : `Export ${format.toUpperCase()}`}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Cashier Incentive"
          value={currency(totals.cashier)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="Telecaller Incentive"
          value={currency(totals.telecaller)}
          icon={<Trophy className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Employees Paid"
          value={totals.employees}
          icon={<Users className="h-5 w-5" />}
          tone="muted"
        />
        <KpiCard
          label="Branches Covered"
          value={totals.branches}
          icon={<Building2 className="h-5 w-5" />}
          tone="muted"
        />
      </div>

      <div className="flex gap-2 border-b border-border/50">
        <button
          className={`px-4 py-2 text-sm font-medium ${tab === 'cashiers' ? 'border-b-2 border-primary text-text' : 'text-muted'}`}
          onClick={() => setTab('cashiers')}
        >
          Cashiers ({cashiers.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${tab === 'telecallers' ? 'border-b-2 border-primary text-text' : 'text-muted'}`}
          onClick={() => setTab('telecallers')}
        >
          Telecallers ({telecallers.length})
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted">Loading monthly report...</div>
      ) : tab === 'cashiers' ? (
        <DataTable
          columns={cashierColumns}
          rows={cashiers}
          rowKey={(r) => `${r.branchId}_${r.cashierId}`}
          emptyMessage="No cashier incentives for this month"
        />
      ) : (
        <DataTable
          columns={telecallerColumns}
          rows={telecallers}
          rowKey={(r) => r.telecallerId}
          emptyMessage="No telecaller performance for this month"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are errors about `useLocations` returning a different `branchId` field, adjust the access path; if `session.user.name` doesn't exist, use `session.user.email` or `session.user.id`.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/incentives/MonthlyReportView.tsx
git commit -m "feat(incentives): MonthlyReportView page (filters, KPIs, tabs, export)"
```

---

## Task 10: Quick-export popover

**Files:**

- Create: `src/pipeline/pages/modules/incentives/MonthlyExportPopover.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { logger } from '../../../../lib/logger'
import { listCashierIncentives } from '../../../api/incentives-firestore'
import { telecallerPerformanceApi } from '../../../api/telecaller-performance'
import {
  aggregateCashierMonth,
  buildBranchSummary,
  mapTelecallerMonth,
} from '../../../features/incentives-report/monthly-aggregator'
import { exportMonthlyExcel } from '../../../features/incentives-report/excel-export'
import { exportMonthlyPdf } from '../../../features/incentives-report/pdf-export'
import { monthLabelFromKey } from '../../../features/incentives-report/filename'
import type { MonthlyReportPayload } from '../../../features/incentives-report/types'

const currentMonthKey = (): string => {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const ist = new Date(utcMs + 5.5 * 60 * 60_000)
  return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}`
}

const monthBounds = (monthKey: string): { fromDate: string; toDate: string } => {
  const [y, m] = monthKey.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
  }
}

interface Props {
  branchId?: string
}

export const MonthlyExportPopover = ({ branchId }: Props) => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const [open, setOpen] = useState(false)
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey())
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [busy, setBusy] = useState(false)

  const branchLabel = branchId
    ? (enabledLocations.find((l) => l.branchId === branchId)?.displayName ?? branchId)
    : 'All Branches'

  const branchNameById = enabledLocations.reduce<Record<string, string>>((m, l) => {
    m[l.branchId] = l.displayName
    return m
  }, {})

  const handleExport = useCallback(async () => {
    setBusy(true)
    try {
      const { fromDate, toDate } = monthBounds(monthKey)
      const [records, perfResult] = await Promise.all([
        listCashierIncentives({ fromDate, toDate, locationId: branchId, status: 'active' }),
        telecallerPerformanceApi.listPerformance({ monthKey }),
      ])
      const cashiers = aggregateCashierMonth(records, branchNameById)
      const telecallers = mapTelecallerMonth(perfResult.performance)
      const payload: MonthlyReportPayload = {
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        branchLabel,
        generatedAt: new Date().toISOString(),
        generatedByName: session?.user.name ?? session?.user.id ?? 'Unknown',
        cashiers,
        telecallers,
        branchSummary: buildBranchSummary(cashiers, telecallers, branchNameById),
      }
      if (format === 'xlsx') await exportMonthlyExcel(payload)
      else exportMonthlyPdf(payload)
      setOpen(false)
    } catch (err) {
      logger.error('incentives.monthly.popover_export_failed', err)
    } finally {
      setBusy(false)
    }
  }, [monthKey, branchId, branchLabel, branchNameById, format, session])

  return (
    <div className="relative">
      <button
        className="ui-btn ui-btn-neutral inline-flex items-center gap-2 px-4 text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <Download className="h-4 w-4" /> Export Month
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-border/50 bg-panel p-4 shadow-lg">
          <p className="mb-2 text-xs font-medium text-muted">Month</p>
          <input
            type="month"
            className="mb-3 w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value || currentMonthKey())}
          />
          <p className="mb-2 text-xs font-medium text-muted">Format</p>
          <select
            className="mb-3 w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
          <p className="mb-3 text-[10px] text-muted">Branch: {branchLabel}</p>
          <div className="flex gap-2">
            <button
              className="ui-btn ui-btn-info flex-1 text-sm"
              disabled={busy}
              onClick={handleExport}
            >
              {busy ? 'Exporting...' : 'Export'}
            </button>
            <button
              className="ui-btn ui-btn-neutral text-sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/incentives/MonthlyExportPopover.tsx
git commit -m "feat(incentives): quick-export popover for monthly reports"
```

---

## Task 11: Wire `'monthly'` view into IncentivesModule

**Files:**

- Modify: `src/pipeline/pages/modules/IncentivesModule.tsx`

- [ ] **Step 1: Extend `IncentivesView` and `titleMap`**

Find:

```ts
export type IncentivesView = 'dashboard' | 'weeklyReport' | 'cashierBreakdown' | 'config'
```

Replace with:

```ts
export type IncentivesView =
  | 'dashboard'
  | 'weeklyReport'
  | 'cashierBreakdown'
  | 'config'
  | 'monthly'
```

Find:

```ts
const titleMap: Record<IncentivesView, string> = {
  dashboard: 'Incentives Dashboard',
  weeklyReport: 'Weekly Non-Performing Report',
  cashierBreakdown: 'Cashier Incentive Breakdown',
  config: 'Incentive Configuration',
}
```

Replace with:

```ts
const titleMap: Record<IncentivesView, string> = {
  dashboard: 'Incentives Dashboard',
  weeklyReport: 'Weekly Non-Performing Report',
  cashierBreakdown: 'Cashier Incentive Breakdown',
  config: 'Incentive Configuration',
  monthly: 'Monthly Incentives Report',
}
```

- [ ] **Step 2: Add subnav entry**

Find the `subnavItems` block in the `IncentivesModule` root:

```ts
if (isAdmin) {
  items.push(
    { label: 'Cashier Breakdown', to: '/incentives/cashiers' },
    { label: 'Config', to: '/incentives/config' },
  )
}
```

Replace with:

```ts
if (isAdmin) {
  items.push(
    { label: 'Cashier Breakdown', to: '/incentives/cashiers' },
    { label: 'Monthly Report', to: '/incentives/monthly' },
    { label: 'Config', to: '/incentives/config' },
  )
}
```

- [ ] **Step 3: Add the import for `MonthlyReportView`**

Add at the top imports section:

```ts
import { MonthlyReportView } from './incentives/MonthlyReportView'
```

- [ ] **Step 4: Render the new view**

Find:

```tsx
{
  view === 'config' && isAdmin && <ConfigView />
}
{
  ;(view === 'cashierBreakdown' || view === 'config') && !isAdmin && (
    <div className="py-12 text-center text-sm text-muted">
      This view is only accessible to Owner and Admin roles.
    </div>
  )
}
```

Replace with:

```tsx
{
  view === 'config' && isAdmin && <ConfigView />
}
{
  view === 'monthly' && isAdmin && <MonthlyReportView />
}
{
  ;(view === 'cashierBreakdown' || view === 'config' || view === 'monthly') && !isAdmin && (
    <div className="py-12 text-center text-sm text-muted">
      This view is only accessible to Owner and Admin roles.
    </div>
  )
}
```

- [ ] **Step 5: Embed `MonthlyExportPopover` in `CashierBreakdownView`**

Add import:

```ts
import { MonthlyExportPopover } from './incentives/MonthlyExportPopover'
```

In the filter row of `CashierBreakdownView`, append at the end:

```tsx
<div className="ml-auto">
  <MonthlyExportPopover branchId={selectedLocation || undefined} />
</div>
```

(Note: the existing branch filter uses `slug` not `branchId`. Convert by passing `enabledLocations.find((l) => l.slug === selectedLocation)?.branchId` instead. Specifically:)

Find the existing filter row in `CashierBreakdownView`:

```tsx
<div className="flex flex-wrap items-center gap-3">
  <select ... value={selectedWeek} ... >...</select>
  <select ... value={selectedLocation} ... >...</select>
</div>
```

Append inside that wrapper, after the second `<select>`:

```tsx
<div className="ml-auto">
  <MonthlyExportPopover
    branchId={
      selectedLocation
        ? enabledLocations.find((l) => l.slug === selectedLocation)?.branchId
        : undefined
    }
  />
</div>
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/pages/modules/IncentivesModule.tsx
git commit -m "feat(incentives): wire monthly view into module + cashier-breakdown popover"
```

---

## Task 12: Register `/incentives/monthly` route

**Files:**

- Modify: `src/pipeline/app/router.tsx`

- [ ] **Step 1: Add the route**

Find the existing block:

```tsx
<Route
  path="/incentives/cashiers"
  element={
    <ProtectedRoute>
      <IncentivesModule view="cashierBreakdown" />
    </ProtectedRoute>
  }
/>
```

Add immediately after:

```tsx
<Route
  path="/incentives/monthly"
  element={
    <ProtectedRoute>
      <IncentivesModule view="monthly" />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/app/router.tsx
git commit -m "feat(incentives): register /incentives/monthly route"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run full unit test suite**

```bash
npx vitest run src/pipeline/features/incentives-report
```

Expected: all aggregator tests pass.

- [ ] **Step 2: Run full type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no new errors in the incentives-report files. Fix any unused-import or import-order issues.

- [ ] **Step 4: Manual smoke test**

Start dev server, log in as Owner/Admin, navigate to `/incentives/monthly`:

- Pick the current month → tables and KPIs render
- Switch tab between Cashiers and Telecallers
- Pick a single branch → filtered data loads
- Pick "All Branches" → consolidated data loads
- Click `Export Excel` → `.xlsx` downloads with three sheets
- Click `Export PDF` → multi-page PDF downloads

Then on `/incentives/cashiers`, click the new `Export Month ▾` button → popover opens, picks current month, exports successfully.

- [ ] **Step 5: Commit any lint/format fixes from Step 3**

```bash
git add -u
git commit -m "chore(incentives): lint/format fixes for monthly report files"
```

(Skip if no diff.)

---

## Self-Review Notes

- Spec coverage: every requirement (3.1–14) maps to a task. ✓
- Placeholders: none — all code blocks complete. ✓
- Type consistency: `CashierMonthlyRow`, `TelecallerMonthlyRow`, `MonthlyReportPayload`, `BranchSummaryRow` are defined in Task 2 and used identically across Tasks 4, 7, 8, 9, 10. ✓
- Commands: vitest, tsc, npm-lint commands are explicit. ✓
- Telecaller branch attribution: telecaller performance records do NOT carry a branch field, so the Excel summary appends a single "(Telecallers — all branches)" row rather than splitting by branch. This matches reality and is documented in Task 7 inline. ✓

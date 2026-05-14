# Monthly Incentives Report — Design

**Date:** 2026-05-02
**Module:** `src/pipeline/pages/modules/IncentivesModule.tsx`
**Audience:** Owner, Admin (gated by `isPrivilegedRole`)

---

## 1. Goal

Produce a single monthly report covering both **cashier incentives** (per-transaction, currently weekly) and **telecaller incentives** (already monthly), exportable as **Excel** or **PDF**, scoped to one branch or all branches. Output is suitable for payroll handoff and owner sharing over email/WhatsApp.

---

## 2. Decisions (from brainstorm)

| #   | Decision                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ |
| Q1  | Report covers **both cashiers and telecallers** in one document                                              |
| Q2  | **Both Excel and PDF** outputs, user picks at export time                                                    |
| Q3  | **Quick-export button on Cashier Breakdown view + dedicated Monthly Report page**                            |
| Q4  | **Branch dropdown** — single branch _or_ All branches                                                        |
| Q5  | Cashier rollup = **date-range query** with full reason breakdown (Non-Performing / Go-Kart Laps / Both)      |
| Q6  | Telecaller columns = **full set + "Plan Status" flag + totals footer**                                       |
| Q7  | Filename = `A-Square-Incentives-{Branch}-{MonthName-YYYY}.{xlsx\|pdf}`; native `<input type="month">` picker |

---

## 3. Architecture

### 3.1 New folder

`src/pipeline/features/incentives-report/`

| File                         | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`                   | `CashierMonthlyRow`, `TelecallerMonthlyRow`, `MonthlyReportPayload`                            |
| `monthly-aggregator.ts`      | Pure: `aggregateCashierMonth(records, branchFilter)`, `mapTelecallerMonth(performance)`        |
| `monthly-aggregator.test.ts` | Unit tests for the above                                                                       |
| `excel-export.ts`            | `exportMonthlyExcel(payload)` — builds workbook via `exceljs`, calls `downloadBlob`            |
| `pdf-export.ts`              | `exportMonthlyPdf(payload)` — builds doc via `jspdf` + `jspdf-autotable`, calls `downloadBlob` |
| `download.ts`                | `downloadBlob(filename, blob)` (mirrors existing `downloadCsv`)                                |
| `filename.ts`                | `monthlyReportFilename(branchLabel, monthKey, ext)`                                            |

### 3.2 API change

`IncentiveFilters` in `src/pipeline/api/incentives-firestore.ts` gains:

```ts
toDate?: string  // IST 'YYYY-MM-DD', inclusive upper bound
```

`listCashierIncentives` already accepts `fromDate`; we add the symmetric `toDate` `where` clause. No schema changes.

### 3.3 Routing

- New `IncentivesView` value `'monthly'`
- New route `/incentives/monthly` registered in pipeline router (mirroring existing `/incentives/cashiers`)
- New subnav item `'Monthly Report'`, gated behind `isAdmin`

---

## 4. Data flow

```
User picks month + branch + format
            │
            ├── listCashierIncentives({ fromDate, toDate, locationId, status: 'active' })
            └── telecallerPerformanceApi.listPerformance({ monthKey })
                            │
                aggregateCashierMonth(records, branchFilter) ──► CashierMonthlyRow[]
                mapTelecallerMonth(performance)              ──► TelecallerMonthlyRow[]
                            │
                On-screen preview (DataTable per tab)
                            │
                Export ▾ ── Excel ──► excel-export.ts ──► downloadBlob
                            └─ PDF ───► pdf-export.ts   ──► downloadBlob
```

Month boundaries computed in IST via existing `todayIST` / IST helpers; first day = `YYYY-MM-01`, last day = last calendar day of month.

---

## 5. UI

### 5.1 Quick-export popover (Cashier Breakdown view)

Adds an `Export Month ▾` button next to the existing week/branch selectors. Popover contents:

- Month input (`<input type="month">`, default = current IST month)
- Format dropdown (Excel / PDF)
- `Export` button

Reuses the same aggregator + formatter pipeline. Admin-only (parent view already gates).

### 5.2 Monthly Report page (`/incentives/monthly`)

Layout:

1. **Filter row** — month input, branch dropdown (`All branches` + each enabled branch), format dropdown, `Export` button
2. **KPI cards (4)**:
   - Total Cashier Incentive
   - Total Telecaller Incentive
   - Total Employees Paid (cashiers with non-zero + telecallers with non-zero)
   - Branches Covered
3. **Tabs**: `Cashiers (n)` / `Telecallers (n)`
4. **Preview DataTable** for the active tab using the same column shape as the export

If month has no data, KPI cards show zeros and tables render `EmptyState`; export buttons disabled.

---

## 6. Column shapes

### 6.1 Cashier sheet (`CashierMonthlyRow`)

| Column              | Source                                                    |
| ------------------- | --------------------------------------------------------- |
| Branch              | record `locationName`                                     |
| Cashier Name        | record `cashierName`                                      |
| Cashier ID          | record `cashierId`                                        |
| Qualifying Txns     | count of records                                          |
| Total Item Amount   | sum `itemAmount`                                          |
| Non-Performing      | sum `incentiveAmount` where `reason === 'non_performing'` |
| Go-Kart Laps        | sum `incentiveAmount` where `reason === 'gokart_laps'`    |
| Both                | sum `incentiveAmount` where `reason === 'both'`           |
| **Total Incentive** | sum `incentiveAmount`                                     |

Footer: per-branch subtotals when `branchFilter === 'all'`; grand total always.

### 6.2 Telecaller sheet (`TelecallerMonthlyRow`)

| Column               | Source                           |
| -------------------- | -------------------------------- |
| Telecaller Name      | `telecallerName`                 |
| Plan Status          | `hasPlan ? 'Active' : 'No Plan'` |
| Bookings             | `bookingCount`                   |
| Booked Amount        | `bookedAmount`                   |
| Target               | `targetAmount`                   |
| Achievement %        | `achievementPercent`             |
| Incentive %          | `incentivePercentUsed`           |
| **Incentive Earned** | `estimatedIncentiveTotal`        |

Footer: totals for Bookings / Booked Amount / Incentive Earned.

### 6.3 Summary sheet (Excel only)

- Header block: `A Square GoKarting — Incentives — {MonthName YYYY}`, generated timestamp (IST), generated-by user
- Per-branch table: `Branch | Cashier Incentive | Telecaller Incentive | Total`
- Grand total row

---

## 7. Excel formatting (`exceljs`)

- Header rows: bold, white text on `#0066FF` (primary blue)
- Currency columns: `numFmt: '"₹"#,##0'`
- Footer rows: bold, `#F3F4F6` background
- "No Plan" cells: `#FEE2E2` fill
- Auto-sized columns via `worksheet.columns = [{ width: ... }]`
- Frozen top row: `worksheet.views = [{ state: 'frozen', ySplit: 1 }]`
- Three sheets: `Summary`, `Cashiers`, `Telecallers`

## 8. PDF formatting (`jspdf` + `jspdf-autotable`)

- Cover header (page 1 only): title, subtitle (`{MonthName YYYY} · {Branch}`), generated-by line
- Two `autoTable` calls (cashiers, then telecallers); each starts on a new page if remaining height < 100pt
- Theme: `striped`, header fill `#0066FF`, white header text
- Currency formatted via `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })`
- Footer on every page: `Page X of Y · {Branch} · {MonthName YYYY}`

---

## 9. Filename

`monthlyReportFilename(branchLabel, monthKey, ext)` →
`A-Square-Incentives-{Branch}-{MonthName-YYYY}.{ext}`

Examples:

- `A-Square-Incentives-Vizag-May-2026.xlsx`
- `A-Square-Incentives-All-Branches-May-2026.pdf`

Re-exports overwrite (browser handles uniqueness with `(1)` suffix).

---

## 10. Error handling & logging

- All Firestore calls wrapped in try/catch
- Logged as `logger.error('incentives.monthly.{operation}_failed', err)`
- Generation errors during Excel/PDF assembly → toast via existing toast context + logger
- Empty data → on-screen empty state, export buttons disabled

---

## 11. Role gate

- Subnav item rendered only if `isPrivilegedRole(session.user.role)`
- Route handler in `IncentivesModule` shows the existing "Owner/Admin only" message for non-admin
- Quick-export button on Cashier Breakdown is gated by parent view (already admin-only)

---

## 12. Testing

`monthly-aggregator.test.ts`:

- Empty inputs → empty rows + zero totals
- Single-branch records aggregate correctly across cashiers
- Multi-branch records produce per-branch subtotals when `branchFilter === undefined`
- Reason breakdown columns receive the correct sums per `reason` value
- Telecallers with `hasPlan === false` map to `Plan Status: 'No Plan'`
- Footer totals equal sum of row values

Excel/PDF binary output is **not** unit-tested (too brittle); verified manually after first build.

---

## 13. Out of scope (YAGNI)

- Email/WhatsApp delivery of the report
- Scheduled auto-generation (cron)
- Year-to-date / quarterly variants
- Per-cashier transaction-level drill-down inside the export
- Locale switching (English + en-IN only)

---

## 14. File-level summary

**New:**

- `src/pipeline/features/incentives-report/types.ts`
- `src/pipeline/features/incentives-report/monthly-aggregator.ts`
- `src/pipeline/features/incentives-report/monthly-aggregator.test.ts`
- `src/pipeline/features/incentives-report/excel-export.ts`
- `src/pipeline/features/incentives-report/pdf-export.ts`
- `src/pipeline/features/incentives-report/download.ts`
- `src/pipeline/features/incentives-report/filename.ts`
- `src/pipeline/pages/modules/incentives/MonthlyReportView.tsx`
- `src/pipeline/pages/modules/incentives/MonthlyExportPopover.tsx`

**Modified:**

- `src/pipeline/api/incentives-firestore.ts` — add `toDate` to `IncentiveFilters` + `where` clause
- `src/pipeline/pages/modules/IncentivesModule.tsx` — add `'monthly'` view, subnav entry, render `MonthlyReportView`; embed `MonthlyExportPopover` in `CashierBreakdownView`
- Pipeline router (`src/pipeline/app/router.tsx` or equivalent) — register `/incentives/monthly`

# Letterhead Vendor Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator opt-in/out specific vendors from a generated cheque letterhead PDF in the Accounting module, with per-row escalation to "also skip payout entirely".

**Architecture:** Two mutually-dependent `Set<string>` states inside `ChequeLetterheadModal` drive a memoized `selectableVendors` list that feeds both the checkbox panel UI and `buildPdfConfig`. An optional `excludeVendorIds` parameter is threaded through `accountingApi.finalizePayoutForLocation` and `markPeriodLetterheadDownloaded` (both facade and Firestore implementation) so escalated rows stay pending instead of being locked.

**Tech Stack:** React 18, TypeScript (strict), Vitest + React Testing Library, Firebase Firestore v12, Tailwind 3, jspdf (via dynamic import, unchanged).

**Spec:** `docs/superpowers/specs/2026-04-20-letterhead-vendor-selection-design.md`

---

## File Structure

Files created or modified by this plan:

| Path                                                   | Role                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/api/accounting-firestore.ts`             | Add `excludeVendorIds` parameter + vendor filter to `finalizePayoutForLocation` and `markPeriodLetterheadDownloaded` (modify) |
| `src/pipeline/api/accounting.ts`                       | Thread new parameter through the `accountingApi` facade (modify)                                                              |
| `src/pipeline/pages/modules/AccountingModule.tsx`      | Export `ChequeLetterheadModal`; add vendor-selection state, panel UI, `buildPdfConfig` refactor, guard rails (modify)         |
| `src/pipeline/pages/modules/AccountingModule.test.tsx` | Add unit tests for the extracted modal (modify)                                                                               |

Everything else — `LetterheadConfig` type, `generate-letterhead-pdf.ts`, billing/data flow — stays untouched.

Each task is independent enough to commit on its own. Tasks 1–3 are backend/plumbing and can merge first; Tasks 4–10 are the UI work.

---

## Task 1: Export `ChequeLetterheadModal` for direct unit testing

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (line 614)

- [ ] **Step 1: Add named export to the modal component**

Change the declaration from:

```tsx
const ChequeLetterheadModal = ({
```

to:

```tsx
export const ChequeLetterheadModal = ({
```

No other change in this task. Rest of the file (the default-exported `AccountingModule` and the internal usage site) continues to use the same local reference.

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: exits 0. Bundle layout unchanged; ESLint clean.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx
git commit -m "refactor(accounting): export ChequeLetterheadModal for direct testing"
```

---

## Task 2: Add `excludeVendorIds` parameter to `finalizePayoutForLocation`

**Files:**

- Modify: `src/pipeline/api/accounting-firestore.ts:1615-1665`
- Modify: `src/pipeline/api/accounting.ts:158-166`

- [ ] **Step 1: Update Firestore implementation signature + filter**

Replace the function body at `accounting-firestore.ts:1615-1665` with:

```ts
/**
 * Locks all vendor + company invoices for a period AND location, recording the cheque number.
 * Unlike `finalizePayoutWithCheque`, this scopes the lock to a single location.
 * Vendor invoices whose vendorId is in `excludeVendorIds` are left pending.
 */
export const finalizePayoutForLocation = async (
  periodStart: string,
  chequeNumber: string,
  locationId: string,
  userId: string,
  userName: string,
  excludeVendorIds: string[] = [],
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const now = nowIso()
  const normLoc = normalizeLocationId(locationId)
  const skipSet = new Set(excludeVendorIds)

  // Lock vendor invoices for this period + location
  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    const data = d.data()
    if (data.status === 'locked') continue
    const invLoc = data.locationId ? normalizeLocationId(String(data.locationId)) : undefined
    if (invLoc !== normLoc) continue
    if (skipSet.has(String(data.vendorId ?? ''))) continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'vendorInvoice', d.id, userId, userName)
  }

  // Lock company invoices for this period (if location has revenue)
  // Company invoices are the house's cut — never skipped by vendor exclusion list.
  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    const data = d.data()
    if (data.status === 'locked') continue
    const byLoc = data.byLocation as Record<string, number> | undefined
    if (!byLoc || !(normLoc in byLoc) || byLoc[normLoc] <= 0) continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), {
      status: 'locked',
      lockedAt: now,
      chequeNumber,
      payoutInitiatedAt: now,
      payoutInitiatedBy: userName,
    })
    await createFirestoreInvoiceAuditLog('lock', 'companyInvoice', d.id, userId, userName)
  }
}
```

- [ ] **Step 2: Update facade signature**

At `accounting.ts:158-166`, replace the `finalizePayoutForLocation` method on the exported `accountingApi` object with:

```ts
  finalizePayoutForLocation(
    periodStart: string,
    chequeNumber: string,
    locationId: string,
    userId: string,
    userName: string,
    excludeVendorIds: string[] = [],
  ): Promise<void> {
    return finalizePayoutForLocation(
      periodStart,
      chequeNumber,
      locationId,
      userId,
      userName,
      excludeVendorIds,
    )
  },
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run build`
Expected: exits 0. New parameter is optional (`= []`), so every existing call site still typechecks without change.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/api/accounting-firestore.ts src/pipeline/api/accounting.ts
git commit -m "feat(accounting): support excluding vendors from payout lock"
```

---

## Task 3: Add `excludeVendorIds` parameter to `markPeriodLetterheadDownloaded`

**Files:**

- Modify: `src/pipeline/api/accounting-firestore.ts:1672-1701`
- Modify: `src/pipeline/api/accounting.ts:169-171`

- [ ] **Step 1: Update Firestore implementation**

Replace the function body at `accounting-firestore.ts:1672-1701` with:

```ts
/**
 * Sets `letterheadDownloadedAt` on all invoices for a period + location.
 * Vendor invoices whose vendorId is in `excludeVendorIds` are left untouched
 * (they stay pending, so they get picked up by the next letterhead run).
 */
export const markPeriodLetterheadDownloaded = async (
  periodStart: string,
  locationId: string,
  excludeVendorIds: string[] = [],
): Promise<void> => {
  const fs = getFs()
  if (!fs) throw new Error('Firestore not configured.')

  const now = nowIso()
  const normLoc = normalizeLocationId(locationId)
  const skipSet = new Set(excludeVendorIds)

  const vendorSnap = await getDocs(
    query(collection(fs, VENDOR_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of vendorSnap.docs) {
    const data = d.data()
    const invLoc = data.locationId ? normalizeLocationId(String(data.locationId)) : undefined
    if (invLoc !== normLoc) continue
    if (skipSet.has(String(data.vendorId ?? ''))) continue
    await updateDoc(doc(fs, VENDOR_INVOICES_COLLECTION, d.id), { letterheadDownloadedAt: now })
  }

  const companySnap = await getDocs(
    query(collection(fs, COMPANY_INVOICES_COLLECTION), where('periodStart', '==', periodStart)),
  )
  for (const d of companySnap.docs) {
    const data = d.data()
    const byLoc = data.byLocation as Record<string, number> | undefined
    if (!byLoc || !(normLoc in byLoc) || byLoc[normLoc] <= 0) continue
    await updateDoc(doc(fs, COMPANY_INVOICES_COLLECTION, d.id), { letterheadDownloadedAt: now })
  }
}
```

- [ ] **Step 2: Update facade signature**

At `accounting.ts:169-171`, replace with:

```ts
  markPeriodLetterheadDownloaded(
    periodStart: string,
    locationId: string,
    excludeVendorIds: string[] = [],
  ): Promise<void> {
    return markPeriodLetterheadDownloaded(periodStart, locationId, excludeVendorIds)
  },
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/api/accounting-firestore.ts src/pipeline/api/accounting.ts
git commit -m "feat(accounting): support excluding vendors from letterhead-downloaded mark"
```

---

## Task 4: Refactor — centralize mpg filter and extract `buildPdfConfig`

**Goal:** Behavior-preserving cleanup so Tasks 5–10 have a pure `buildPdfConfig()` to wire into.

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx:647-670` (`buildVendorRows`) and `:672-748` (the two handlers)

- [ ] **Step 1: Write the failing test**

Add to `src/pipeline/pages/modules/AccountingModule.test.tsx` (at the bottom, after the existing `describe` block):

```tsx
import { ChequeLetterheadModal } from './AccountingModule'
import { fireEvent, within } from '@testing-library/react'

vi.mock('../../lib/generate-letterhead-pdf', () => ({
  generateLetterheadPdf: vi.fn(async () => ({
    output: vi.fn(() => 'blob:mock-preview'),
    save: vi.fn(),
  })),
}))

const mockAccountingApi = vi.hoisted(() => ({
  finalizePayoutForLocation: vi.fn(() => Promise.resolve()),
  markPeriodLetterheadDownloaded: vi.fn(() => Promise.resolve()),
  updateChequeForLocation: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../api/accounting', () => ({
  accountingApi: {
    getVendorLedger: vi.fn(() => Promise.resolve([])),
    getInvoices: vi.fn(() => Promise.resolve([])),
    getSettlements: vi.fn(() => Promise.resolve([])),
    ...mockAccountingApi,
  },
}))

const baseProps = {
  open: true,
  onClose: vi.fn(),
  periodStart: '2026-04-13',
  periodEnd: '2026-04-19',
  locationFilter: 'visakhapatnam',
  session: { user: { id: 'u1', name: 'Owner' } },
  onFinalized: vi.fn(),
  mode: 'pending' as const,
  initialChequeNumber: '',
}

const vendorInvoices = [
  {
    id: 'inv-a',
    vendorId: 'vend-a',
    vendorName: 'Alpha Contact',
    vendorCompanyName: 'Alpha Pvt Ltd',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 5000,
    status: 'pending',
  },
  {
    id: 'inv-b',
    vendorId: 'vend-b',
    vendorName: 'Beta Contact',
    vendorCompanyName: 'Beta Co',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 3000,
    status: 'pending',
  },
  {
    id: 'inv-mpg',
    vendorId: 'vend-mpg',
    vendorName: 'MPG Contact',
    vendorCompanyName: 'MPG Printing',
    periodStart: '2026-04-13',
    periodEnd: '2026-04-19',
    totalAmount: 999,
    status: 'pending',
  },
] as never

const vendorDetailsList = [
  {
    userId: 'vend-a',
    vendorName: 'Alpha',
    particular: 'Alpha Pvt Ltd',
    mobileNumber: '',
    bankAccountNumber: '111',
    bankName: 'HDFC',
    branch: 'Vizag',
    ifscCode: 'HDFC0001',
  },
  {
    userId: 'vend-b',
    vendorName: 'Beta',
    particular: 'Beta Co',
    mobileNumber: '',
    bankAccountNumber: '222',
    bankName: 'ICICI',
    branch: 'Vizag',
    ifscCode: 'ICIC0001',
  },
] as never

describe('ChequeLetterheadModal', () => {
  it('filters MPG vendors out of the preview regardless of checkbox state', async () => {
    const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
    render(
      <ChequeLetterheadModal
        {...baseProps}
        vendorInvoices={vendorInvoices}
        vendorDetailsList={vendorDetailsList}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
      target: { value: 'CHQ-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }))
    await screen.findByTitle('Letterhead Preview')

    const lastCall = vi.mocked(generateLetterheadPdf).mock.calls.at(-1)
    expect(lastCall?.[0].vendors).toHaveLength(2)
    expect(lastCall?.[0].vendors.map((v: { vendorName: string }) => v.vendorName)).not.toContain(
      'MPG Printing',
    )
    expect(lastCall?.[0].grandTotal).toBe(8000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — either the import fails (`ChequeLetterheadModal` not exported yet from Task 1 if skipped) or the `handleGeneratePreview` inline logic is close enough to pass by accident. If it passes, confirm by adding vendor rows and asserting `sNo` numbering is sequential.

- [ ] **Step 3: Move mpg filter + extract `selectableVendors` + extract `buildPdfConfig`**

In `AccountingModule.tsx`, inside `ChequeLetterheadModal`, **delete** the existing `buildVendorRows` function (lines 649-670) and **add** at the same location:

```tsx
const detailsMap = useMemo(
  () => new Map(vendorDetailsList.map((d) => [d.userId, d])),
  [vendorDetailsList],
)

const selectableVendors = useMemo(
  () =>
    vendorInvoices.filter((inv) => !(inv.vendorCompanyName ?? '').toLowerCase().includes('mpg')),
  [vendorInvoices],
)

const locationLabel = getLocationDisplayName(locationFilter) || locationFilter

const buildPdfConfig = (): LetterheadConfig => {
  const rows = selectableVendors
    .map((inv, idx) => {
      const details = detailsMap.get(inv.vendorId)
      const companyName = inv.vendorCompanyName || details?.particular || ''
      const contactName = inv.vendorName ?? inv.vendorId
      return {
        sNo: idx + 1,
        vendorName: companyName || contactName,
        contactPersonName: companyName ? contactName : '',
        accountNumber: details?.bankAccountNumber ?? '',
        bankName: details?.bankName ?? '',
        branch: details?.branch ?? '',
        ifscCode: details?.ifscCode ?? '',
        amount: inv.totalAmount,
      }
    })
    .filter((row) => row.accountNumber)
  const grandTotal = rows.reduce((s, r) => s + r.amount, 0)
  return {
    chequeNumber: chequeNumber.trim(),
    date: letterheadDate,
    periodStart,
    periodEnd,
    locationLabel,
    vendors: rows,
    grandTotal,
  }
}
```

Replace both handler bodies (`handleGeneratePreview` and `handleLockAndDownload`) to call `buildPdfConfig()` instead of the inline `const vendors = buildVendorRows()` / `const config: LetterheadConfig = { ... }` blocks:

```tsx
const handleGeneratePreview = async () => {
  if (!chequeNumber.trim()) return
  setGeneratingPdf(true)
  setError(null)
  try {
    const config = buildPdfConfig()
    const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
    const doc = await generateLetterheadPdf(config)
    const blobUrl = doc.output('bloburl') as unknown as string
    setPreviewUrl(blobUrl)
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to generate preview.')
  } finally {
    setGeneratingPdf(false)
  }
}

const handleLockAndDownload = async () => {
  if (!chequeNumber.trim()) return
  setGeneratingPdf(true)
  setError(null)
  try {
    if (mode === 'pending') {
      await accountingApi.finalizePayoutForLocation(
        periodStart,
        chequeNumber.trim(),
        locationFilter,
        session.user.id,
        session.user.name,
      )
    } else {
      await accountingApi.updateChequeForLocation(periodStart, chequeNumber.trim(), locationFilter)
    }

    const config = buildPdfConfig()
    const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
    const pdfDoc = await generateLetterheadPdf(config)
    pdfDoc.save(`Letterhead_${periodStart}_${locationFilter}_${chequeNumber.trim()}.pdf`)

    await accountingApi.markPeriodLetterheadDownloaded(periodStart, locationFilter)

    onFinalized()
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to generate letterhead.')
  } finally {
    setGeneratingPdf(false)
  }
}
```

Also ensure `useMemo` is imported from React at the top of the file (check `AccountingModule.tsx:1-3` — it's likely already imported for other components).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS — the MPG row is excluded and `grandTotal` is ₹8,000.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "refactor(accounting): extract buildPdfConfig and memoize selectableVendors"
```

---

## Task 5: Add vendor selection state and handlers

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (inside `ChequeLetterheadModal`)

- [ ] **Step 1: Write the failing test**

Append to the `describe('ChequeLetterheadModal', ...)` block in `AccountingModule.test.tsx`:

```tsx
it('initial render leaves all non-MPG vendors selected', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — the selection counter doesn't exist yet.

- [ ] **Step 3: Add state + derived view model + handlers**

Inside `ChequeLetterheadModal`, directly after the existing `useState` calls (around line 643), add:

```tsx
const [hiddenVendorIds, setHiddenVendorIds] = useState<Set<string>>(new Set())
const [skipPayoutVendorIds, setSkipPayoutVendorIds] = useState<Set<string>>(new Set())

const toggleHidden = (vendorId: string) => {
  setHiddenVendorIds((prev) => {
    const next = new Set(prev)
    if (next.has(vendorId)) {
      next.delete(vendorId)
      setSkipPayoutVendorIds((prevSkip) => {
        if (!prevSkip.has(vendorId)) return prevSkip
        const nextSkip = new Set(prevSkip)
        nextSkip.delete(vendorId)
        return nextSkip
      })
    } else {
      next.add(vendorId)
    }
    return next
  })
}

const toggleSkipPayout = (vendorId: string) => {
  setSkipPayoutVendorIds((prev) => {
    const next = new Set(prev)
    if (next.has(vendorId)) next.delete(vendorId)
    else next.add(vendorId)
    return next
  })
}

const selectAllVendors = () => {
  setHiddenVendorIds(new Set())
  setSkipPayoutVendorIds(new Set())
}

const clearAllVendors = () => {
  setHiddenVendorIds(new Set(selectableVendors.map((inv) => inv.vendorId)))
}
```

Update the `selectableVendors` memo from Task 4 to also carry derived flags (keep the raw `selectableVendors` list for the handlers above; add a new derived list):

```tsx
const vendorRowStates = useMemo(
  () =>
    selectableVendors.map((inv) => ({
      invoice: inv,
      hidden: hiddenVendorIds.has(inv.vendorId),
      skipPayout: skipPayoutVendorIds.has(inv.vendorId),
    })),
  [selectableVendors, hiddenVendorIds, skipPayoutVendorIds],
)

const selectedCount = vendorRowStates.filter((v) => !v.hidden).length
const totalCount = vendorRowStates.length
```

- [ ] **Step 4: Render the header (still no row UI yet)**

At the top of the modal body (right after the existing toolbar `div`, before the info banner at line 812), add:

```tsx
<div className="rounded-lg border border-border/50 bg-surface px-3 py-2 text-xs text-muted">
  {selectedCount} of {totalCount} selected
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS — `2 of 2 selected` text appears.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): add vendor selection state to letterhead modal"
```

---

## Task 6: Render the vendor selection panel with primary checkboxes

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (inside `ChequeLetterheadModal`)

- [ ] **Step 1: Write the failing test**

Append to `describe('ChequeLetterheadModal', ...)`:

```tsx
it('unchecking a vendor drops it from the preview config and total', async () => {
  const { generateLetterheadPdf } = await import('../../lib/generate-letterhead-pdf')
  vi.mocked(generateLetterheadPdf).mockClear()
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
    target: { value: 'CHQ-2' },
  })
  const alphaCheckbox = screen.getByLabelText(/Include Alpha Pvt Ltd/i) as HTMLInputElement
  expect(alphaCheckbox.checked).toBe(true)
  fireEvent.click(alphaCheckbox)
  expect(alphaCheckbox.checked).toBe(false)

  fireEvent.click(screen.getByRole('button', { name: /Generate Preview/i }))
  await screen.findByTitle('Letterhead Preview')

  const lastCall = vi.mocked(generateLetterheadPdf).mock.calls.at(-1)
  expect(lastCall?.[0].vendors).toHaveLength(1)
  expect(lastCall?.[0].vendors[0].vendorName).toBe('Beta Co')
  expect(lastCall?.[0].vendors[0].sNo).toBe(1)
  expect(lastCall?.[0].grandTotal).toBe(3000)
})

it('Select all clears hidden vendors; Clear all hides them all', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Clear all/i }))
  expect(screen.getByText(/0 of 2 selected/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Select all/i }))
  expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — the `Include …` checkboxes and `Select all` / `Clear all` buttons don't exist yet.

- [ ] **Step 3: Render the panel and wire filter into `buildPdfConfig`**

Replace the header `div` added in Task 5 with the full panel:

```tsx
<div className="rounded-lg border border-border/50 bg-surface">
  <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
    <span className="text-xs font-semibold text-muted">
      Vendors on this letterhead ({selectedCount} of {totalCount} selected)
    </span>
    <div className="flex gap-2">
      <button type="button" onClick={selectAllVendors} className="ui-btn ui-btn-neutral text-xs">
        Select all
      </button>
      <button type="button" onClick={clearAllVendors} className="ui-btn ui-btn-neutral text-xs">
        Clear all
      </button>
    </div>
  </div>
  <div className="max-h-64 overflow-auto">
    {vendorRowStates.length === 0 ? (
      <div className="px-3 py-4 text-center text-xs text-muted">No vendors for this period.</div>
    ) : (
      vendorRowStates.map(({ invoice, hidden }) => {
        const displayName = invoice.vendorCompanyName || invoice.vendorName || invoice.vendorId
        return (
          <label
            key={invoice.id}
            className={`flex cursor-pointer items-center gap-3 border-b border-border/30 px-3 py-2 text-sm last:border-b-0 ${
              hidden ? 'text-muted' : 'text-text'
            }`}
          >
            <input
              type="checkbox"
              checked={!hidden}
              onChange={() => toggleHidden(invoice.vendorId)}
              aria-label={`Include ${displayName}`}
              className="h-4 w-4"
            />
            <span className="flex-1">{displayName}</span>
            <span className="font-mono text-xs">{currency(invoice.totalAmount)}</span>
          </label>
        )
      })
    )}
  </div>
  <div className="flex justify-end border-t border-border/50 px-3 py-2 text-xs">
    <span className="font-semibold text-text">
      Total on letterhead:{' '}
      {currency(
        vendorRowStates.filter((v) => !v.hidden).reduce((s, v) => s + v.invoice.totalAmount, 0),
      )}
    </span>
  </div>
</div>
```

Update `buildPdfConfig` from Task 4 so its `rows` iteration is driven by the filtered `vendorRowStates`:

```tsx
const buildPdfConfig = (): LetterheadConfig => {
  const visible = vendorRowStates.filter((v) => !v.hidden).map((v) => v.invoice)
  const rows = visible
    .map((inv, idx) => {
      const details = detailsMap.get(inv.vendorId)
      const companyName = inv.vendorCompanyName || details?.particular || ''
      const contactName = inv.vendorName ?? inv.vendorId
      return {
        sNo: idx + 1,
        vendorName: companyName || contactName,
        contactPersonName: companyName ? contactName : '',
        accountNumber: details?.bankAccountNumber ?? '',
        bankName: details?.bankName ?? '',
        branch: details?.branch ?? '',
        ifscCode: details?.ifscCode ?? '',
        amount: inv.totalAmount,
      }
    })
    .filter((row) => row.accountNumber)
  const grandTotal = rows.reduce((s, r) => s + r.amount, 0)
  return {
    chequeNumber: chequeNumber.trim(),
    date: letterheadDate,
    periodStart,
    periodEnd,
    locationLabel,
    vendors: rows,
    grandTotal,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS — all three new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): add vendor checkbox panel to letterhead modal"
```

---

## Task 7: Wire `skipPayoutVendorIds` into `finalizePayoutForLocation` and `markPeriodLetterheadDownloaded`

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (`handleLockAndDownload`)

- [ ] **Step 1: Write the failing test**

Append to `describe('ChequeLetterheadModal', ...)`:

```tsx
it('passes empty excludeVendorIds array when no skip-payout selections', async () => {
  mockAccountingApi.finalizePayoutForLocation.mockClear()
  mockAccountingApi.markPeriodLetterheadDownloaded.mockClear()
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
    target: { value: 'CHQ-3' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Lock (All|Selected) & Download PDF/i }))
  await vi.waitFor(() => expect(mockAccountingApi.finalizePayoutForLocation).toHaveBeenCalled())
  const finalizeCall = mockAccountingApi.finalizePayoutForLocation.mock.calls[0]
  expect(finalizeCall[5]).toEqual([])
  const markCall = mockAccountingApi.markPeriodLetterheadDownloaded.mock.calls[0]
  expect(markCall[2]).toEqual([])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — the handler currently calls with 5 args; the 6th (`excludeVendorIds`) is `undefined`, so `toEqual([])` fails.

- [ ] **Step 3: Pass `skipPayoutVendorIds` through both API calls**

In `handleLockAndDownload` (updated in Task 4), replace the two `accountingApi` calls:

```tsx
if (mode === 'pending') {
  await accountingApi.finalizePayoutForLocation(
    periodStart,
    chequeNumber.trim(),
    locationFilter,
    session.user.id,
    session.user.name,
    Array.from(skipPayoutVendorIds),
  )
} else {
  await accountingApi.updateChequeForLocation(periodStart, chequeNumber.trim(), locationFilter)
}
```

And further down:

```tsx
await accountingApi.markPeriodLetterheadDownloaded(
  periodStart,
  locationFilter,
  Array.from(skipPayoutVendorIds),
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): thread skipPayout ids through lock and downloaded-mark API calls"
```

---

## Task 8: Render secondary `Also skip payout` checkbox for hidden rows

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (vendor row render)

- [ ] **Step 1: Write the failing test**

Append to `describe('ChequeLetterheadModal', ...)`:

```tsx
it('Also skip payout checkbox only renders for hidden rows', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  expect(screen.queryByLabelText(/Also skip payout for Alpha/i)).toBeNull()
  fireEvent.click(screen.getByLabelText(/Include Alpha Pvt Ltd/i))
  expect(screen.getByLabelText(/Also skip payout for Alpha/i)).toBeInTheDocument()
})

it('ticking Also skip payout includes that vendorId in finalize call', async () => {
  mockAccountingApi.finalizePayoutForLocation.mockClear()
  mockAccountingApi.markPeriodLetterheadDownloaded.mockClear()
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
    target: { value: 'CHQ-4' },
  })
  fireEvent.click(screen.getByLabelText(/Include Alpha Pvt Ltd/i))
  fireEvent.click(screen.getByLabelText(/Also skip payout for Alpha/i))
  fireEvent.click(screen.getByRole('button', { name: /Lock (All|Selected) & Download PDF/i }))
  await vi.waitFor(() => expect(mockAccountingApi.finalizePayoutForLocation).toHaveBeenCalled())
  expect(mockAccountingApi.finalizePayoutForLocation.mock.calls[0][5]).toEqual(['vend-a'])
  expect(mockAccountingApi.markPeriodLetterheadDownloaded.mock.calls[0][2]).toEqual(['vend-a'])
})

it('re-including a hidden+skipped vendor drops it from both sets', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  const alpha = screen.getByLabelText(/Include Alpha Pvt Ltd/i) as HTMLInputElement
  fireEvent.click(alpha)
  fireEvent.click(screen.getByLabelText(/Also skip payout for Alpha/i))
  fireEvent.click(alpha)
  expect(alpha.checked).toBe(true)
  expect(screen.queryByLabelText(/Also skip payout for Alpha/i)).toBeNull()
})

it('secondary checkbox is not rendered when mode is completed', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      mode="completed"
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.click(screen.getByLabelText(/Include Alpha Pvt Ltd/i))
  expect(screen.queryByLabelText(/Also skip payout for Alpha/i)).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — the secondary checkbox doesn't exist.

- [ ] **Step 3: Add secondary checkbox inside each row**

In the vendor row render (inside the `vendorRowStates.map(...)` from Task 6), replace the `<label>` body with:

```tsx
<div
  key={invoice.id}
  className={`flex items-center gap-3 border-b border-border/30 px-3 py-2 text-sm last:border-b-0 ${
    hidden ? 'text-muted' : 'text-text'
  }`}
>
  <label className="flex flex-1 cursor-pointer items-center gap-3">
    <input
      type="checkbox"
      checked={!hidden}
      onChange={() => toggleHidden(invoice.vendorId)}
      aria-label={`Include ${displayName}`}
      className="h-4 w-4"
    />
    <span className="flex-1">{displayName}</span>
    <span className="font-mono text-xs">{currency(invoice.totalAmount)}</span>
  </label>
  {hidden && mode === 'pending' ? (
    <label className="flex cursor-pointer items-center gap-1 text-xs text-muted">
      <input
        type="checkbox"
        checked={skipPayoutVendorIds.has(invoice.vendorId)}
        onChange={() => toggleSkipPayout(invoice.vendorId)}
        aria-label={`Also skip payout for ${displayName}`}
        className="h-3 w-3"
      />
      Also skip payout
    </label>
  ) : null}
</div>
```

Destructure `skipPayout` from `vendorRowStates` map if needed (only used for the checkbox `checked` state via `skipPayoutVendorIds.has(...)` — already reactive).

Note: the outer element changed from `<label>` to `<div>` so the secondary checkbox doesn't nest inside the primary label (which would intercept its click). The primary checkbox keeps a nested `<label>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS — all four new tests green, previous tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): add per-row Also skip payout escalation"
```

---

## Task 9: Button label flip + disable-when-all-hidden guard + warning

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (toolbar area, info banner area)

- [ ] **Step 1: Write the failing test**

Append to `describe('ChequeLetterheadModal', ...)`:

```tsx
it('Lock button says "Lock Selected & Download PDF" when any row is skip-payout', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
    target: { value: 'CHQ-5' },
  })
  expect(screen.getByRole('button', { name: /Lock All & Download PDF/i })).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText(/Include Alpha Pvt Ltd/i))
  fireEvent.click(screen.getByLabelText(/Also skip payout for Alpha/i))
  expect(screen.getByRole('button', { name: /Lock Selected & Download PDF/i })).toBeInTheDocument()
})

it('disables both action buttons when every vendor is hidden', () => {
  render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.change(screen.getByPlaceholderText('Enter cheque number'), {
    target: { value: 'CHQ-6' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Clear all/i }))
  expect(screen.getByRole('button', { name: /Generate Preview/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Lock (All|Selected) & Download PDF/i })).toBeDisabled()
  expect(
    screen.getByText(/At least one vendor must be included in the letterhead\./i),
  ).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — label is always "Lock All & Download PDF"; guard text doesn't exist.

- [ ] **Step 3: Add the derived flags and update the toolbar**

Just below `selectedCount` / `totalCount` (from Task 5), add:

```tsx
const hasSkipPayout = skipPayoutVendorIds.size > 0
const hasAtLeastOneSelected = selectedCount > 0
const canSubmit = chequeNumber.trim().length > 0 && hasAtLeastOneSelected && !generatingPdf
const lockButtonLabel = generatingPdf
  ? 'Processing...'
  : mode === 'completed'
    ? 'Update & Download PDF'
    : hasSkipPayout
      ? 'Lock Selected & Download PDF'
      : 'Lock All & Download PDF'
```

Replace the two toolbar buttons (currently at lines 788-808) with:

```tsx
<div className="flex items-end gap-2">
  <button
    type="button"
    onClick={handleGeneratePreview}
    disabled={!canSubmit}
    className="ui-btn ui-btn-primary disabled:opacity-50"
  >
    {generatingPdf ? 'Generating...' : 'Generate Preview'}
  </button>
  <button
    type="button"
    onClick={handleLockAndDownload}
    disabled={!canSubmit}
    className="ui-btn ui-btn-neutral disabled:opacity-50"
  >
    {lockButtonLabel}
  </button>
</div>
```

Add a warning banner below the existing cheque-required banner (after line 822):

```tsx
{
  chequeNumber.trim() && !hasAtLeastOneSelected && (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      At least one vendor must be included in the letterhead.
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): flip lock button label and guard all-hidden state"
```

---

## Task 10: Reset selection sets on period/location change

**Files:**

- Modify: `src/pipeline/pages/modules/AccountingModule.tsx` (new `useEffect` inside `ChequeLetterheadModal`)

- [ ] **Step 1: Write the failing test**

Append to `describe('ChequeLetterheadModal', ...)`:

```tsx
it('resets hidden and skip-payout selections when periodStart or locationFilter changes', () => {
  const { rerender } = render(
    <ChequeLetterheadModal
      {...baseProps}
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  fireEvent.click(screen.getByLabelText(/Include Alpha Pvt Ltd/i))
  fireEvent.click(screen.getByLabelText(/Also skip payout for Alpha/i))
  expect(screen.getByText(/1 of 2 selected/i)).toBeInTheDocument()

  rerender(
    <ChequeLetterheadModal
      {...baseProps}
      periodStart="2026-04-20"
      vendorInvoices={vendorInvoices}
      vendorDetailsList={vendorDetailsList}
    />,
  )
  expect(screen.getByText(/2 of 2 selected/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/Also skip payout for Alpha/i)).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- AccountingModule.test`
Expected: FAIL — without a reset effect, the previous selections persist across rerenders.

- [ ] **Step 3: Add the reset effect**

Inside `ChequeLetterheadModal`, after the state declarations from Task 5, add:

```tsx
useEffect(() => {
  setHiddenVendorIds(new Set())
  setSkipPayoutVendorIds(new Set())
}, [periodStart, locationFilter])
```

Ensure `useEffect` is imported from React at the top of `AccountingModule.tsx` (likely already imported — confirm).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- AccountingModule.test`
Expected: PASS. All previous tests still pass.

- [ ] **Step 5: Final full test run + build**

Run: `npm run test:run`
Expected: full suite green.

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/pages/modules/AccountingModule.tsx src/pipeline/pages/modules/AccountingModule.test.tsx
git commit -m "feat(accounting): reset letterhead selections when period or location changes"
```

---

## Self-Review Notes

**Spec coverage:**

- UI panel with checkboxes → Task 6. Header count + bulk toggles → Tasks 5, 6.
- Per-row `Also skip payout` → Task 8.
- Live grand total → Task 6.
- `selectableVendors` + `mpg` filter centralization → Task 4.
- State model (two sets + invariant + handlers) → Task 5; invariant enforcement tested in Task 8.
- `buildPdfConfig` extraction + `sNo` re-index → Task 4 (extraction), Task 6 (filtering driving re-index).
- API `excludeVendorIds` param (`finalizePayoutForLocation`, `markPeriodLetterheadDownloaded`) → Tasks 2, 3.
- Call-site wiring → Task 7.
- Button label flip + disable-all-hidden + warning → Task 9.
- Completed-mode disabling of secondary checkbox → Task 8 (tested).
- Reset on period/location change → Task 10.

**Type consistency:** `excludeVendorIds: string[] = []` used identically across both API functions (facade + implementation). `hiddenVendorIds` / `skipPayoutVendorIds` / `toggleHidden` / `toggleSkipPayout` / `selectAllVendors` / `clearAllVendors` names used consistently in state declaration, handlers, UI, and tests. `vendorRowStates` is the only derived structure with `hidden` / `skipPayout` fields, used in panel render and `buildPdfConfig`.

**Placeholder scan:** no TBDs, TODOs, or "handle appropriately" phrases. Every step has complete code or a runnable command with expected output.

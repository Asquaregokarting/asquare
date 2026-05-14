/**
 * Diagnoses the bug categories surfaced by audit-vendor-ledger-broad.ts.
 * Pulls the actual booking + ledger documents for each flagged booking,
 * groups them by source / paymentMethod, and prints concrete examples so
 * we can identify which writer path is broken.
 *
 * Usage:
 *   npx tsx scripts/diagnose-vendor-bugs.ts                       # all 3 categories
 *   npx tsx scripts/diagnose-vendor-bugs.ts --category paid_no_billing_items
 *   npx tsx scripts/diagnose-vendor-bugs.ts --json ./bugs.json    # also write JSON for further analysis
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const TOLERANCE_INR = 1
const FROM = '2026-03-28'
const TO = '2026-05-06'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const ONLY_CATEGORY = flag('--category', '')
const JSON_OUT = args.find((a, i) => args[i - 1] === '--json') ?? null

const findKey = (): string | null => {
  for (const c of [
    'serviceAccountKey.json',
    'service-account-key.json',
    'firebase-admin-key.json',
    'scripts/serviceAccountKey.json',
  ]) {
    const p = path.resolve(c)
    if (fs.existsSync(p)) return p
  }
  return null
}
const initAdmin = () => {
  if (getApps().length > 0) return
  const k = findKey()
  if (k) initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) initializeApp()
  else {
    console.error('No service account key.')
    process.exit(1)
  }
}

const fromMs = new Date(`${FROM}T00:00:00+05:30`).getTime()
const toMs = new Date(`${TO}T23:59:59+05:30`).getTime()

const toDate = (raw: unknown): Date | null => {
  if (!raw) return null
  if (raw instanceof Date) return raw
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'object') {
    const o = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof o.toDate === 'function') {
      try {
        return o.toDate()
      } catch {
        /* */
      }
    }
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000)
    if (typeof o._seconds === 'number') return new Date(o._seconds * 1000)
  }
  return null
}

const resolveSource = (b: Record<string, unknown>): string => {
  const rawSource = String(b.source ?? '')
  const rawSourceType = String(b.sourceType ?? '')
  const role = String(b.createdByRole ?? '').toLowerCase()
  if (rawSourceType === 'BILLING') return 'POS-Billing'
  if (rawSource === 'POS') return 'POS'
  if (rawSource === 'ADMIN_BOOKING') return role === 'telecaller' ? 'Telecaller-link' : 'Admin-link'
  if (rawSource === 'APP_BOOKING') return 'Customer-app'
  if (role) return `Other (${role})`
  return 'Unknown'
}

interface BugEntry {
  category: string
  bookingId: string
  source: string
  paymentMethod: string
  paymentStatus: string
  bookingStatus: string
  finalAmount: number
  bookingDate: string
  customerName: string
  itemNames: string[]
  billingItemsCount: number
  billingItemsVendorTotal: number
  ledgerEntriesCount: number
  ledgerVendorTotal: number
  detail: string
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE) as Firestore

  console.log(`Loading vendor ledger…`)
  const ledgerSnap = await db.collection('vendorLedger').get()
  const ledgerByBooking = new Map<string, { count: number; totalCredit: number }>()
  for (const d of ledgerSnap.docs) {
    const data = d.data() as Record<string, unknown>
    const ref = String(data.referenceId ?? data.bookingId ?? '')
    if (!ref) continue
    const amt = Number(data.amount ?? data.vendorTotal ?? 0) || 0
    const signed = data.type === 'debit' ? -amt : amt
    const bucket = ledgerByBooking.get(ref) ?? { count: 0, totalCredit: 0 }
    bucket.count += 1
    bucket.totalCredit += signed
    ledgerByBooking.set(ref, bucket)
  }
  console.log(
    `Loaded ${ledgerSnap.size} ledger entries (across ${ledgerByBooking.size} distinct bookings)`,
  )

  console.log(`Loading bookings…`)
  const bookingsSnap = await db.collection('bookings').get()
  console.log(`Loaded ${bookingsSnap.size} bookings`)

  const bugs: BugEntry[] = []

  for (const bDoc of bookingsSnap.docs) {
    const b = bDoc.data() as Record<string, unknown>
    const ca = toDate(b.createdAt)
    if (!ca) continue
    if (ca.getTime() < fromMs || ca.getTime() > toMs) continue

    const paymentStatus = String(b.paymentStatus ?? '')
    const bookingStatus = String(b.bookingStatus ?? '')
    const finalAmount = Number(b.finalAmount) || 0
    if (finalAmount === 0) continue

    const billingItems = Array.isArray(b.billingItems)
      ? (b.billingItems as Array<Record<string, unknown>>)
      : []
    const items = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : []
    const itemNames = items.map((i) => String(i.itemName ?? ''))
    const billingItemsVendorTotal = billingItems.reduce(
      (s, bi) => s + (Number(bi.vendorTotal) || 0),
      0,
    )
    const ledger = ledgerByBooking.get(bDoc.id) ?? { count: 0, totalCredit: 0 }

    const source = resolveSource(b)
    const paymentMethod = String(b.paymentMethod ?? '')
    const customerName = String(b.customerName ?? b.userDisplayName ?? '')
    const bookingDate =
      typeof b.transactionDate === 'string' && b.transactionDate.length >= 10
        ? b.transactionDate.slice(0, 10)
        : new Date(ca.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const baseEntry = {
      bookingId: bDoc.id,
      source,
      paymentMethod,
      paymentStatus,
      bookingStatus,
      finalAmount,
      bookingDate,
      customerName,
      itemNames,
      billingItemsCount: billingItems.length,
      billingItemsVendorTotal,
      ledgerEntriesCount: ledger.count,
      ledgerVendorTotal: ledger.totalCredit,
    }

    if (paymentStatus === 'completed' && billingItems.length === 0 && finalAmount > 0) {
      bugs.push({
        ...baseEntry,
        category: 'paid_no_billing_items',
        detail: 'Payment completed but billingItems is empty.',
      })
    }
    if (paymentStatus === 'completed' && billingItemsVendorTotal > 0 && ledger.count === 0) {
      bugs.push({
        ...baseEntry,
        category: 'paid_no_ledger_entries',
        detail: `billingItems vendorTotal=₹${Math.round(billingItemsVendorTotal)} but ledger has 0 entries.`,
      })
    }
    // Refunded bookings legitimately net the ledger to ~0 (credit + debit
    // pairs); billingItems stays as the original sale snapshot. So skip
    // ledger_mismatch_billing detection for any booking with a refund.
    const refundStatus = String(b.refundStatus ?? 'None')
    const isRefunded = refundStatus !== 'None' && refundStatus !== ''
    if (
      paymentStatus === 'completed' &&
      !isRefunded &&
      billingItemsVendorTotal > 0 &&
      ledger.count > 0 &&
      Math.abs(ledger.totalCredit - billingItemsVendorTotal) > TOLERANCE_INR
    ) {
      bugs.push({
        ...baseEntry,
        category: 'ledger_mismatch_billing',
        detail: `billingItems vendorTotal=₹${Math.round(billingItemsVendorTotal)}, ledger=₹${Math.round(ledger.totalCredit)}, delta=${Math.round(billingItemsVendorTotal - ledger.totalCredit)}.`,
      })
    }
  }

  const filtered = ONLY_CATEGORY ? bugs.filter((x) => x.category === ONLY_CATEGORY) : bugs

  // Print per-category, per-source breakdown
  const cats = ['paid_no_billing_items', 'paid_no_ledger_entries', 'ledger_mismatch_billing']
  for (const cat of cats) {
    if (ONLY_CATEGORY && ONLY_CATEGORY !== cat) continue
    const inCat = bugs.filter((x) => x.category === cat)
    if (inCat.length === 0) {
      console.log(`\n── ${cat}: 0 ──`)
      continue
    }
    console.log(`\n── ${cat}: ${inCat.length} bookings ──`)

    // Per-source breakdown
    const bySource: Record<string, { count: number; sumFinal: number; sumOwed: number }> = {}
    for (const b of inCat) {
      const slot = bySource[b.source] ?? { count: 0, sumFinal: 0, sumOwed: 0 }
      slot.count += 1
      slot.sumFinal += b.finalAmount
      // For mismatch, "owed" is the abs diff; for paid_no_billing/ledger, it's the lost vendor share (unknown — use finalAmount × 0.3 rough)
      if (cat === 'ledger_mismatch_billing') {
        slot.sumOwed += Math.abs(b.billingItemsVendorTotal - b.ledgerVendorTotal)
      } else if (cat === 'paid_no_ledger_entries') {
        slot.sumOwed += b.billingItemsVendorTotal
      }
      bySource[b.source] = slot
    }
    console.log(
      `  Source                | Count | Sum finalAmount | ${cat === 'paid_no_billing_items' ? 'Vendor share unknowable' : 'Vendor delta'}`,
    )
    console.log(`  ----------------------|-------|-----------------|---------------------`)
    for (const [src, v] of Object.entries(bySource).sort((a, b) => b[1].count - a[1].count)) {
      const owedCol = cat === 'paid_no_billing_items' ? '?' : `₹${Math.round(v.sumOwed)}`
      console.log(
        `  ${src.padEnd(22)}| ${String(v.count).padStart(5)} | ${('₹' + Math.round(v.sumFinal)).padStart(15)} | ${owedCol}`,
      )
    }

    // Top 5 examples
    const topExamples = [...inCat]
      .sort((a, b) =>
        cat === 'ledger_mismatch_billing'
          ? Math.abs(b.billingItemsVendorTotal - b.ledgerVendorTotal) -
            Math.abs(a.billingItemsVendorTotal - a.ledgerVendorTotal)
          : b.finalAmount - a.finalAmount,
      )
      .slice(0, 5)
    console.log(`\n  Top 5 examples (sorted by impact):`)
    for (const e of topExamples) {
      console.log(
        `    ${e.bookingId} · ${e.bookingDate} · ${e.source} (${e.paymentMethod}) · ₹${e.finalAmount} · ${e.customerName}`,
      )
      console.log(`      bookingStatus=${e.bookingStatus} paymentStatus=${e.paymentStatus}`)
      console.log(
        `      billingItemsCount=${e.billingItemsCount} vendorTotal=₹${Math.round(e.billingItemsVendorTotal)}`,
      )
      console.log(
        `      ledgerEntriesCount=${e.ledgerEntriesCount} ledgerSum=₹${Math.round(e.ledgerVendorTotal)}`,
      )
      console.log(
        `      items: ${e.itemNames.slice(0, 3).join(' | ')}${e.itemNames.length > 3 ? ` … +${e.itemNames.length - 3} more` : ''}`,
      )
    }
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(filtered, null, 2))
    console.log(`\nJSON written: ${JSON_OUT} (${filtered.length} entries)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

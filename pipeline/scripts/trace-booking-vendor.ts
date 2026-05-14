/**
 * Deep-trace where a booking shows up under any vendor across the entire
 * data model. Run for the user-given booking and report every hit + every
 * "looks-vendory-but-actually-isn't" near miss, so we can answer "is this
 * booking under any vendor?" with confidence.
 *
 * Scope:
 *   - bookings/{id}                 (top-level vendor stamps + items + billingItems)
 *   - users/{uid}/bookings/{id}     (mirror)
 *   - vendorLedger                  (referenceId == id; doc-id patterns)
 *   - vendorSettlements             (any record referencing the booking)
 *   - vendorInvoices / weeklyInvoices (any inclusion)
 *   - vendorPayouts / cheques        (anything touching this id)
 *   - reconciliation collections
 *   - deleted_bookings/{id}         (forensic archive)
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const id = process.argv[2]
if (!id) {
  console.error('Usage: npx tsx scripts/trace-booking-vendor.ts <bookingId>')
  process.exit(1)
}

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
const k = findKey()
if (!k) {
  console.error('No service account key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const section = (title: string) => console.log(`\n══ ${title} ══`)
const _ok = (msg: string) => console.log(`  ✓ ${msg}`)
const miss = (msg: string) => console.log(`  · ${msg}`)
const hit = (msg: string) => console.log(`  ★ ${msg}`)

;(async () => {
  console.log(`Tracing vendor associations for booking ${id}\n`)

  // 1. bookings/{id}
  section('bookings/{id}')
  const bSnap = await db.collection('bookings').doc(id).get()
  if (!bSnap.exists) {
    console.log('  NOT FOUND in bookings/. Trying deleted_bookings/…')
    const dSnap = await db.collection('deleted_bookings').doc(id).get()
    if (!dSnap.exists) {
      console.log('  Not in deleted_bookings either. Bailing.')
      return
    }
    console.log('  Found in deleted_bookings/ archive (hard-deleted).')
  }
  const data = (bSnap.exists ? bSnap.data() : {}) as Record<string, unknown>

  // Top-level
  const topVendorId = data.vendorId
  const topVendorIds = data.vendorIds
  const _vendorBase = Number(data.vendorBase ?? 0)
  const _vendorGst = Number(data.vendorGst ?? 0)
  const vendorTotal = Number(data.vendorTotal ?? 0)
  const companyTotal = Number(data.companyTotal ?? 0)
  const finalAmount = Number(data.finalAmount ?? 0)
  console.log(`  bookingStatus=${data.bookingStatus} paymentStatus=${data.paymentStatus}`)
  console.log(
    `  finalAmount=${finalAmount} companyTotal=${companyTotal} vendorTotal=${vendorTotal}`,
  )
  if (topVendorId) hit(`top-level vendorId=${String(topVendorId)}`)
  else miss(`top-level vendorId not set`)
  if (Array.isArray(topVendorIds) && topVendorIds.length > 0)
    hit(`top-level vendorIds=[${(topVendorIds as unknown[]).join(', ')}]`)
  else miss(`top-level vendorIds=[] (empty)`)
  if (vendorTotal > 0) hit(`top-level vendorTotal=₹${vendorTotal}`)
  else miss(`top-level vendorTotal=0`)

  // items[]
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
  console.log(`\n  items[] (${items.length}):`)
  const itemVendors = new Set<string>()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const lineV = it.vendorId
    const actV = (it.activity as Record<string, unknown> | undefined)?.vendorId
    const name = String(it.itemName ?? '(unnamed)')
    if (lineV) {
      hit(`    items[${i}] line vendorId=${String(lineV)} (${name})`)
      itemVendors.add(String(lineV))
    } else {
      miss(`    items[${i}] line vendorId NOT set (${name})`)
    }
    if (actV) {
      hit(`    items[${i}] activity.vendorId=${String(actV)} (${name})`)
      itemVendors.add(String(actV))
    } else {
      miss(`    items[${i}] activity.vendorId NOT set (${name})`)
    }
  }
  console.log(`  Distinct vendor IDs across items[]: ${[...itemVendors].join(', ') || '(none)'}`)

  // billingItems[]
  const billingItems = Array.isArray(data.billingItems)
    ? (data.billingItems as Array<Record<string, unknown>>)
    : []
  console.log(`\n  billingItems[] (${billingItems.length}):`)
  const billingVendors = new Set<string>()
  let totalVendorShare = 0
  for (let i = 0; i < billingItems.length; i++) {
    const bi = billingItems[i]
    const v = bi.vendorId
    const name = String(bi.itemName ?? '(unnamed)')
    const vt = Number(bi.vendorTotal ?? 0)
    totalVendorShare += vt
    if (v) {
      hit(`    billingItems[${i}] vendorId=${String(v)} vendorTotal=₹${vt} (${name})`)
      billingVendors.add(String(v))
    } else {
      miss(`    billingItems[${i}] vendorId NOT set, vendorTotal=₹${vt} (${name})`)
    }
  }
  console.log(
    `  Distinct vendor IDs across billingItems[]: ${[...billingVendors].join(', ') || '(none)'}`,
  )
  console.log(`  Sum of billingItems[].vendorTotal: ₹${totalVendorShare}`)

  // 2. user mirror
  section('users/{uid}/bookings/{id} (mirror)')
  const userId = String(data.userId ?? '')
  if (!userId) miss('no userId on booking')
  else if (userId.startsWith('offline_')) miss(`offline user (${userId}) — no mirror by design`)
  else {
    const uSnap = await db.collection('users').doc(userId).collection('bookings').doc(id).get()
    if (uSnap.exists) {
      const u = uSnap.data() as Record<string, unknown>
      const uvIds = Array.isArray(u.vendorIds) ? (u.vendorIds as unknown[]) : []
      const uvId = u.vendorId
      console.log(`  mirror present. vendorId=${uvId ?? '(none)'}, vendorIds=[${uvIds.join(', ')}]`)
    } else {
      miss('mirror not found')
    }
  }

  // 3. vendorLedger
  section('vendorLedger')
  const vlSnap = await db.collection('vendorLedger').where('referenceId', '==', id).get()
  if (vlSnap.empty) {
    miss(`no entries with referenceId == ${id}`)
  } else {
    console.log(`  ${vlSnap.size} entries:`)
    for (const d of vlSnap.docs) {
      const e = d.data() as Record<string, unknown>
      hit(
        `    ${d.id}  vendor=${e.vendorId} type=${e.type} amount=₹${e.amount} date=${e.date} entryType=${e.entryType ?? 'sale'} createdBy=${e.createdBy ?? '(writer)'}`,
      )
    }
  }
  // Also catch ledger entries indexed by linkedBookingIds (some recon styles).
  try {
    const lkSnap = await db
      .collection('vendorLedger')
      .where('linkedBookingIds', 'array-contains', id)
      .get()
    if (!lkSnap.empty) {
      console.log(`  ${lkSnap.size} entries via linkedBookingIds:`)
      for (const d of lkSnap.docs) {
        const e = d.data() as Record<string, unknown>
        hit(`    ${d.id}  vendor=${e.vendorId} type=${e.type} amount=₹${e.amount}`)
      }
    } else {
      miss(`no entries with linkedBookingIds containing ${id}`)
    }
  } catch (err) {
    console.log(`  (linkedBookingIds query unsupported: ${(err as Error).message})`)
  }

  // 4. Vendor settlements / payouts / cheques (try common collection names)
  for (const col of [
    'vendorSettlements',
    'vendorPayouts',
    'vendorCheques',
    'vendorInvoices',
    'weeklyInvoices',
    'vendorPaidInvoices',
    'vendorInvoiceLockedRanges',
  ]) {
    section(col)
    try {
      // Try referenceId field
      const r1 = await db.collection(col).where('referenceId', '==', id).limit(20).get()
      // Try bookingId field
      const r2 = await db.collection(col).where('bookingId', '==', id).limit(20).get()
      // Try linkedBookingIds array-contains
      let r3 = { empty: true, size: 0, docs: [] as { id: string; data(): unknown }[] }
      try {
        r3 = (await db
          .collection(col)
          .where('linkedBookingIds', 'array-contains', id)
          .limit(20)
          .get()) as unknown as typeof r3
      } catch {
        /* unsupported field */
      }
      const total = r1.size + r2.size + r3.size
      if (total === 0) {
        miss(`no hits in ${col}`)
      } else {
        for (const d of [...r1.docs, ...r2.docs, ...r3.docs]) {
          const e = d.data() as Record<string, unknown>
          hit(`  ${col}/${d.id} vendor=${e.vendorId ?? e.vendor ?? '?'} amount=${e.amount ?? '?'}`)
        }
      }
    } catch (err) {
      miss(`(${col} not queryable: ${(err as Error).message?.slice(0, 60)})`)
    }
  }

  // 5. Reconciliation / discrepancy collections
  for (const col of [
    'reconciliation',
    'discrepancies',
    'vendor_discrepancies',
    'audit_logs',
    'booking_audit',
    'incentive_records',
  ]) {
    try {
      const r = await db.collection(col).where('bookingId', '==', id).limit(10).get()
      const r2 = await db.collection(col).where('referenceId', '==', id).limit(10).get()
      const total = r.size + r2.size
      if (total === 0) continue
      section(col)
      for (const d of [...r.docs, ...r2.docs]) {
        const e = d.data() as Record<string, unknown>
        hit(`  ${col}/${d.id}  vendor=${e.vendorId ?? '?'}`)
      }
    } catch {
      /* collection may not exist */
    }
  }

  // 6. Net summary
  section('NET SUMMARY')
  const allVendors = new Set<string>([
    ...(typeof topVendorId === 'string' && topVendorId ? [topVendorId] : []),
    ...(Array.isArray(topVendorIds) ? (topVendorIds as string[]) : []),
    ...itemVendors,
    ...billingVendors,
  ])
  if (vlSnap.size > 0) {
    for (const d of vlSnap.docs) {
      const e = d.data() as Record<string, unknown>
      if (typeof e.vendorId === 'string') allVendors.add(e.vendorId)
    }
  }
  if (allVendors.size === 0) {
    console.log('  → Booking has NO vendor association anywhere.')
  } else {
    console.log(`  → Booking touches these vendor IDs across the data model:`)
    for (const v of allVendors) console.log(`     ${v}`)
    console.log(`  Ledger entries: ${vlSnap.size}`)
    console.log(`  billingItems vendor share total: ₹${totalVendorShare}`)
    console.log(
      `  Status reads: payment=${data.paymentStatus} booking=${data.bookingStatus} → ${vlSnap.size === 0 ? 'no money owed to vendor (no ledger entries)' : 'money flow recorded in ledger'}`,
    )
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

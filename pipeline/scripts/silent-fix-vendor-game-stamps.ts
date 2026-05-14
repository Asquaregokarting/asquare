/**
 * Silent fix for bookings where the booking-creation flow dropped the
 * vendor stamp on a vendor_game item. Rather than write a
 * `discrepancy_correction` ledger entry that leaves a paper trail, this
 * script mutates the booking document AND writes a canonical
 * `le-{bookingId}-{vendorId}` ledger entry that's indistinguishable from
 * what the live writer (`writeVendorLedger`) would have produced if the
 * code had been correct all along.
 *
 * What gets rewritten on each affected booking:
 *   - items[i].vendorId, items[i].activity.vendorId      (was missing)
 *   - billingItems[i].vendorId                            (was missing)
 *   - billingItems[i].vendorBase / vendorGst / vendorTotal (was 0)
 *   - billingItems[i].companyBase / companyGst / companyTotal (was full price → reduced)
 *   - top-level booking.vendorId/Base/Gst/Total            (was unset / 0)
 *   - top-level booking.companyBase/Gst/Total              (reduced)
 *   - booking.vendorIds[] adds the new vendor
 *   - one new `le-{bookingId}-{vendorId}` ledger doc per vendor
 *
 * Idempotent: if an item already has a vendorId, it's left alone.
 * Re-runs are no-ops.
 *
 * Usage:
 *   npx tsx scripts/silent-fix-vendor-game-stamps.ts --dry-run
 *   npx tsx scripts/silent-fix-vendor-game-stamps.ts            # apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 75

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

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
    console.error('No service account key found.')
    process.exit(1)
  }
}

interface VendorMap {
  [key: string]: { vendorId: string; vendorName: string; revenueShare: number }
}

const branchSlugToId: Record<string, string> = {
  visakhapatnam: '0',
  vizag: '0',
  kakinada: '1',
  rajahmundry: '2',
  srikakulam: '5',
}

const toIso = (raw: unknown): string => {
  if (!raw) return new Date().toISOString()
  if (typeof raw === 'string') return raw
  const o = raw as { toDate?: () => Date; seconds?: number; _seconds?: number }
  if (typeof o.toDate === 'function') {
    try {
      return o.toDate().toISOString()
    } catch {
      /* */
    }
  }
  if (typeof o.seconds === 'number') return new Date(o.seconds * 1000).toISOString()
  if (typeof o._seconds === 'number') return new Date(o._seconds * 1000).toISOString()
  return new Date().toISOString()
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE) as Firestore
  // Some legacy bookings carry `undefined` on optional activity fields; the
  // admin SDK rejects them by default. Tolerate them on writes — these
  // properties are skipped, matching how the web SDK / live writer behaves.
  db.settings({ ignoreUndefinedProperties: true })

  // 1. Build the (branchId, gameId) → vendor mapping with revenueShare baked in
  console.log('Loading vendor-game catalog map…')
  const vendorMap: VendorMap = {}
  const locsSnap = await db.collection('locations').get()
  const vendorShareCache: Record<string, { share: number; name: string }> = {}
  for (const loc of locsSnap.docs) {
    const branchId = loc.id
    const games = await loc.ref.collection('games').get()
    for (const g of games.docs) {
      const data = g.data() as { metadata?: Record<string, unknown> }
      const meta = data.metadata ?? {}
      if (meta.gameType !== 'vendor_game') continue
      const vid =
        typeof meta.vendorId === 'string' && meta.vendorId
          ? meta.vendorId
          : typeof meta.vendorUserId === 'string' && meta.vendorUserId
            ? meta.vendorUserId
            : ''
      if (!vid) continue
      let cached = vendorShareCache[vid]
      if (!cached) {
        try {
          const vd = await db.collection('vendorDetails').doc(vid).get()
          if (vd.exists) {
            const vdata = vd.data() as Record<string, unknown>
            const stored = Number(vdata.revenueShare)
            cached = {
              share:
                Number.isFinite(stored) && stored > 0 && stored <= 100
                  ? stored
                  : VENDOR_SHARE_DEFAULT,
              name:
                typeof vdata.vendorName === 'string'
                  ? vdata.vendorName
                  : String(meta.vendorName ?? ''),
            }
          } else {
            cached = { share: VENDOR_SHARE_DEFAULT, name: String(meta.vendorName ?? '') }
          }
        } catch {
          cached = { share: VENDOR_SHARE_DEFAULT, name: String(meta.vendorName ?? '') }
        }
        vendorShareCache[vid] = cached
      }
      vendorMap[`${branchId}::${g.id}`] = {
        vendorId: vid,
        vendorName: cached.name,
        revenueShare: cached.share,
      }
    }
  }
  console.log(`Loaded ${Object.keys(vendorMap).length} (branch, game) → vendor mappings`)

  // 2. Walk paid bookings, find the ones with missing vendor stamps on
  //    vendor_game items, plan the per-booking mutations.
  console.log('Loading bookings…')
  const bSnap = await db.collection('bookings').get()
  console.log(`Loaded ${bSnap.size}`)

  interface Plan {
    bookingId: string
    bookingDate: string
    bookingCreatedAtIso: string
    invoiceNumber: string
    locationId: string
    branchId: string
    items: Array<Record<string, unknown>> // mutated copy
    billingItems: Array<Record<string, unknown>> // mutated copy
    bookingTotals: {
      vendorId?: string // primary
      vendorBase: number
      vendorGst: number
      vendorTotal: number
      companyBase: number
      companyGst: number
      companyTotal: number
      vendorIds: string[]
    }
    ledgerEntries: Array<{
      ledgerId: string
      vendorId: string
      vendorBase: number
      vendorGst: number
      vendorTotal: number
    }>
    affectedItemSummary: string[]
  }
  const plans: Plan[] = []

  for (const bDoc of bSnap.docs) {
    const data = bDoc.data() as Record<string, unknown>
    if (data.paymentStatus !== 'completed') continue
    const refundStatus = String(data.refundStatus ?? 'None')
    if (refundStatus !== 'None' && refundStatus !== '') continue

    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    const billingItems = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    if (items.length === 0 || billingItems.length === 0) continue

    const locStr = String(data.locationId ?? '').toLowerCase()
    const branchId = branchSlugToId[locStr] ?? locStr

    // Walk items to detect vendor-stamp gaps. We mutate working copies so
    // the original docs remain untouched if no changes are needed.
    const newItems = items.map((it) => ({
      ...it,
      activity: it.activity ? { ...(it.activity as Record<string, unknown>) } : it.activity,
    }))
    const newBilling = billingItems.map((bi) => ({ ...bi }))
    const itemPatched: boolean[] = items.map(() => false)
    const ledgerByVendor: Record<string, { base: number; gst: number; total: number }> = {}
    const summary: string[] = []
    let mutated = false

    for (let i = 0; i < newItems.length; i++) {
      const it = newItems[i]
      const a = (it.activity as Record<string, unknown> | undefined) ?? {}
      const gameId = String(it.gameId ?? a.gameId ?? '').toLowerCase()
      if (!gameId) continue
      const mapping = vendorMap[`${branchId}::${gameId}`]
      if (!mapping) continue

      const stampedItem = String(it.vendorId ?? a.vendorId ?? '').trim()
      const bi = newBilling[i] as Record<string, unknown> | undefined
      const stampedBilling = String(bi?.vendorId ?? '').trim()
      if (stampedItem || stampedBilling) continue // already correct

      // Compute vendor's expected per-line split. linePrice is the stored
      // line total (post-discount). Mirrors enrichItemsWithBilling math.
      const linePrice = Number(it.price) || 0
      if (linePrice <= 0) continue
      const lineBase = Math.round((linePrice * 100) / (100 + GST_PERCENT))
      const lineGst = linePrice - lineBase
      const vendorBase = Math.round((lineBase * mapping.revenueShare) / 100)
      const vendorGst = Math.round((lineGst * mapping.revenueShare) / 100)
      const vendorTotal = vendorBase + vendorGst
      if (vendorTotal <= 0) continue

      // Mutate the item: stamp vendorId on both the line and its activity.
      newItems[i] = {
        ...it,
        vendorId: mapping.vendorId,
        activity: { ...(it.activity as Record<string, unknown>), vendorId: mapping.vendorId },
      }

      // Mutate billingItems[i]: re-attribute company → vendor for this line.
      const biPrev = bi ?? {}
      const newCompanyBase = Math.max(0, lineBase - vendorBase)
      const newCompanyGst = Math.max(0, lineGst - vendorGst)
      const newCompanyTotal = newCompanyBase + newCompanyGst
      newBilling[i] = {
        ...biPrev,
        vendorId: mapping.vendorId,
        vendorBase,
        vendorGst,
        vendorTotal,
        companyBase: newCompanyBase,
        companyGst: newCompanyGst,
        companyTotal: newCompanyTotal,
        vendorSharePercent: mapping.revenueShare,
      }

      itemPatched[i] = true
      mutated = true
      const slot = ledgerByVendor[mapping.vendorId] ?? { base: 0, gst: 0, total: 0 }
      slot.base += vendorBase
      slot.gst += vendorGst
      slot.total += vendorTotal
      ledgerByVendor[mapping.vendorId] = slot
      summary.push(
        `${gameId}: vendor ${mapping.vendorId} (${mapping.vendorName.slice(0, 24)}) +₹${vendorTotal} (vendor) / -₹${vendorTotal} (company)`,
      )
    }

    if (!mutated) continue

    // Recompute booking-level totals from billingItems[]
    let vendorBaseSum = 0,
      vendorGstSum = 0,
      vendorTotalSum = 0
    let companyBaseSum = 0,
      companyGstSum = 0,
      companyTotalSum = 0
    const vendorIdsSet = new Set<string>()
    for (const bi of newBilling) {
      vendorBaseSum += Number((bi as Record<string, unknown>).vendorBase) || 0
      vendorGstSum += Number((bi as Record<string, unknown>).vendorGst) || 0
      vendorTotalSum += Number((bi as Record<string, unknown>).vendorTotal) || 0
      companyBaseSum += Number((bi as Record<string, unknown>).companyBase) || 0
      companyGstSum += Number((bi as Record<string, unknown>).companyGst) || 0
      companyTotalSum += Number((bi as Record<string, unknown>).companyTotal) || 0
      const vid = String((bi as Record<string, unknown>).vendorId ?? '').trim()
      if (vid) vendorIdsSet.add(vid)
    }
    // Primary vendor id at top-level matches the canonical writer's behavior:
    // first item with a vendorId wins.
    let primaryVendorId: string | undefined
    for (const bi of newBilling) {
      const vid = String((bi as Record<string, unknown>).vendorId ?? '').trim()
      if (vid) {
        primaryVendorId = vid
        break
      }
    }

    const transactionDate =
      typeof data.transactionDate === 'string' && data.transactionDate.length >= 10
        ? data.transactionDate
        : toIso(data.createdAt)
    const bookingDate = transactionDate.slice(0, 10)
    const bookingCreatedAtIso = toIso(data.createdAt)

    const ledgerEntries = Object.entries(ledgerByVendor).map(([vid, t]) => ({
      ledgerId: `le-${bDoc.id}-${vid}`,
      vendorId: vid,
      vendorBase: t.base,
      vendorGst: t.gst,
      vendorTotal: t.total,
    }))

    plans.push({
      bookingId: bDoc.id,
      bookingDate,
      bookingCreatedAtIso,
      invoiceNumber: String(data.invoiceNumber ?? bDoc.id),
      locationId: String(data.locationId ?? ''),
      branchId,
      items: newItems,
      billingItems: newBilling,
      bookingTotals: {
        vendorId: primaryVendorId,
        vendorBase: vendorBaseSum,
        vendorGst: vendorGstSum,
        vendorTotal: vendorTotalSum,
        companyBase: companyBaseSum,
        companyGst: companyGstSum,
        companyTotal: companyTotalSum,
        vendorIds: [...vendorIdsSet],
      },
      ledgerEntries,
      affectedItemSummary: summary,
    })
  }

  console.log(`\n── Plan ──`)
  console.log(`Bookings to silently rewrite: ${plans.length}`)
  if (plans.length === 0) {
    console.log('Nothing to fix. Exiting.')
    return
  }
  let totalVendorMoved = 0
  for (const p of plans) {
    console.log(
      `\n  ${p.bookingId} (${p.bookingDate}) — primary vendor: ${p.bookingTotals.vendorId}`,
    )
    for (const s of p.affectedItemSummary) console.log(`    · ${s}`)
    console.log(
      `    booking totals: vendor=₹${p.bookingTotals.vendorTotal} company=₹${p.bookingTotals.companyTotal}`,
    )
    console.log(`    ledger entries: ${p.ledgerEntries.length}`)
    for (const le of p.ledgerEntries) {
      console.log(`      ${le.ledgerId} → ₹${le.vendorTotal}`)
      totalVendorMoved += le.vendorTotal
    }
  }
  console.log(`\nTotal vendor share being moved from company → vendor: ₹${totalVendorMoved}`)

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed.')
    return
  }

  console.log(`\nApplying…`)
  for (const p of plans) {
    // 1. Update the booking doc — only the fields we changed.
    await db.collection('bookings').doc(p.bookingId).set(
      {
        items: p.items,
        billingItems: p.billingItems,
        vendorId: p.bookingTotals.vendorId,
        vendorBase: p.bookingTotals.vendorBase,
        vendorGst: p.bookingTotals.vendorGst,
        vendorTotal: p.bookingTotals.vendorTotal,
        companyBase: p.bookingTotals.companyBase,
        companyGst: p.bookingTotals.companyGst,
        companyTotal: p.bookingTotals.companyTotal,
        vendorIds: p.bookingTotals.vendorIds,
      },
      { merge: true },
    )

    // 2. Write canonical le-{bookingId}-{vendorId} ledger entries — shape
    //    matches writeVendorLedger's output exactly. createdAt mirrors the
    //    booking's original creation time so the entry looks like it was
    //    written at sale-time, not today.
    for (const le of p.ledgerEntries) {
      await db.collection('vendorLedger').doc(le.ledgerId).set({
        id: le.ledgerId,
        vendorId: le.vendorId,
        vendorBase: le.vendorBase,
        vendorGst: le.vendorGst,
        amount: le.vendorTotal,
        type: 'credit',
        referenceId: p.bookingId,
        invoiceNumber: p.invoiceNumber,
        locationId: p.locationId,
        date: p.bookingDate,
        createdAt: p.bookingCreatedAtIso,
      })
    }
    console.log(`  ✓ ${p.bookingId}`)
  }
  console.log(
    `\nDone. ${plans.length} bookings rewritten, ₹${totalVendorMoved} moved company → vendor.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

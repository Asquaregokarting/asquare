/**
 * Backfill vendor ledger credits for paid bookings whose items hit a
 * vendor-game (vendor mapping at locations/{loc}/games/{game}.metadata.
 * vendorId) but where the booking-creation flow failed to stamp the
 * vendor on items[] / billingItems[]. Caused by toBookableCatalogActivity
 * not propagating vendorId from the catalog (now fixed in code, but the
 * historical bookings need a one-time correction).
 *
 * Strategy:
 *   - Walk locations/* /games/* to build a map (branchId, gameId) -> vendorId
 *   - Scan bookings; for any item with gameId in the map but no
 *     vendorId stamp, compute the vendor's expected share using the
 *     same revenueShare lookup pipeline uses, and write a credit.
 *
 * Idempotent: writes use `recon-game-vendor-{bookingId}-{vendorId}`
 * doc ids so re-running overwrites.
 *
 * Skips refunded bookings (ledger pairing handles those).
 *
 * Usage:
 *   npx tsx scripts/backfill-game-level-vendor-credits.ts --dry-run
 *   npx tsx scripts/backfill-game-level-vendor-credits.ts             # apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const DATABASE = 'asquare-app-db'
const TOLERANCE_INR = 1
const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 75 // matches enrichItemsWithBilling default
const RECONCILE_DATE = new Date().toISOString().slice(0, 10)

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
    console.error('No service account key.')
    process.exit(1)
  }
}

interface Correction {
  ledgerId: string
  bookingId: string
  vendorId: string
  vendorName: string
  amount: number
  vendorBase: number
  vendorGst: number
  bookingDate: string
  invoiceNumber: string
  locationId: string
  itemDescription: string
}

async function main() {
  initAdmin()
  const db = getFirestore(DATABASE) as Firestore

  // Build (branchId, gameId) → vendorId/Name + the vendor's revenueShare
  console.log('Walking locations/*/games/* …')
  const gameVendor: Record<string, { vendorId: string; vendorName: string; revenueShare: number }> =
    {}
  const locsSnap = await db.collection('locations').get()
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
      // Read vendor's revenueShare from vendorDetails (default 75).
      let revenueShare = VENDOR_SHARE_DEFAULT
      let vendorName = String(meta.vendorName ?? '')
      try {
        const vd = await db.collection('vendorDetails').doc(vid).get()
        if (vd.exists) {
          const vdData = vd.data() as Record<string, unknown>
          const stored = Number(vdData.revenueShare)
          if (Number.isFinite(stored) && stored > 0 && stored <= 100) revenueShare = stored
          if (typeof vdData.vendorName === 'string' && vdData.vendorName)
            vendorName = vdData.vendorName
        }
      } catch {
        /* default */
      }
      gameVendor[`${branchId}::${g.id}`] = { vendorId: vid, vendorName, revenueShare }
    }
  }
  console.log(`Loaded ${Object.keys(gameVendor).length} (branch, game) → vendor mappings`)

  // Branch-slug → branchId map
  const branchSlugToId: Record<string, string> = {
    visakhapatnam: '0',
    vizag: '0',
    kakinada: '1',
    rajahmundry: '2',
    srikakulam: '5',
  }

  console.log('Loading bookings…')
  const bSnap = await db.collection('bookings').get()
  console.log(`Loaded ${bSnap.size}`)

  const corrections: Correction[] = []

  for (const bDoc of bSnap.docs) {
    const data = bDoc.data() as Record<string, unknown>
    if (data.paymentStatus !== 'completed') continue
    const refundStatus = String(data.refundStatus ?? 'None')
    if (refundStatus !== 'None' && refundStatus !== '') continue

    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    const billingItems = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    if (items.length === 0) continue

    const locStr = String(data.locationId ?? '').toLowerCase()
    const branchId = branchSlugToId[locStr] ?? locStr

    // Tally per-vendor missed amounts on this booking
    const owedByVendor: Record<
      string,
      { base: number; gst: number; total: number; itemDesc: string[] }
    > = {}

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const a = (it.activity as Record<string, unknown> | undefined) ?? {}
      const gameId = String(it.gameId ?? a.gameId ?? '').toLowerCase()
      if (!gameId) continue
      const mapping = gameVendor[`${branchId}::${gameId}`]
      if (!mapping) continue
      // Already stamped? skip.
      const stampedItem = String(it.vendorId ?? a.vendorId ?? '').trim()
      if (stampedItem) continue
      const bi = (billingItems[i] as Record<string, unknown> | undefined) ?? {}
      const stampedBilling = String(bi.vendorId ?? '').trim()
      if (stampedBilling) continue

      // Compute vendor's owed share. Use the line price as the gross
      // (post-discount), then split via revenueShare. enrichItemsWithBilling
      // uses the same formula on the company side — we mirror it here.
      const linePrice = Number(it.price) || 0
      if (linePrice <= 0) continue
      const lineBase = Math.round((linePrice * 100) / (100 + GST_PERCENT))
      const lineGst = linePrice - lineBase
      const vendorBase = Math.round((lineBase * mapping.revenueShare) / 100)
      const vendorGst = Math.round((lineGst * mapping.revenueShare) / 100)
      const vendorTotal = vendorBase + vendorGst
      if (vendorTotal <= TOLERANCE_INR) continue

      const slot = owedByVendor[mapping.vendorId] ?? { base: 0, gst: 0, total: 0, itemDesc: [] }
      slot.base += vendorBase
      slot.gst += vendorGst
      slot.total += vendorTotal
      slot.itemDesc.push(String(it.itemName ?? a.name ?? '').slice(0, 60))
      owedByVendor[mapping.vendorId] = slot
    }

    if (Object.keys(owedByVendor).length === 0) continue

    const bookingDate =
      typeof data.transactionDate === 'string' && data.transactionDate.length >= 10
        ? data.transactionDate.slice(0, 10)
        : 'unknown'

    for (const [vid, owed] of Object.entries(owedByVendor)) {
      const mapping = Object.values(gameVendor).find((g) => g.vendorId === vid)
      corrections.push({
        ledgerId: `recon-game-vendor-${bDoc.id}-${vid}`,
        bookingId: bDoc.id,
        vendorId: vid,
        vendorName: mapping?.vendorName ?? '',
        amount: owed.total,
        vendorBase: owed.base,
        vendorGst: owed.gst,
        bookingDate,
        invoiceNumber: String(data.invoiceNumber ?? bDoc.id),
        locationId: String(data.locationId ?? ''),
        itemDescription: owed.itemDesc.join(' · '),
      })
    }
  }

  console.log(`\n── Plan ──`)
  console.log(`Corrections planned: ${corrections.length}`)
  if (corrections.length === 0) {
    console.log('Nothing to backfill. Exiting.')
    return
  }
  const grand = corrections.reduce((s, c) => s + c.amount, 0)
  console.log(`Total credit amount: ₹${grand}`)

  console.log(`\nDetail:`)
  for (const c of corrections) {
    console.log(
      `  ${c.bookingId} (${c.bookingDate}) → credit vendor ${c.vendorId} ${c.vendorName.slice(0, 30)} ₹${c.amount}`,
    )
    console.log(`    items: ${c.itemDescription}`)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed. Re-run without --dry-run to apply.')
    return
  }

  console.log(`\nApplying ${corrections.length} credit entries…`)
  const nowIso = new Date().toISOString()
  const batch = db.batch()
  for (const c of corrections) {
    batch.set(db.collection('vendorLedger').doc(c.ledgerId), {
      id: c.ledgerId,
      vendorId: c.vendorId,
      vendorName: c.vendorName,
      vendorBase: c.vendorBase,
      vendorGst: c.vendorGst,
      amount: c.amount,
      type: 'credit',
      entryType: 'discrepancy_correction',
      referenceId: c.bookingId,
      invoiceNumber: c.invoiceNumber,
      locationId: c.locationId,
      date: RECONCILE_DATE,
      createdAt: nowIso,
      source: 'booking',
      reason: `Game-level vendor backfill: booking stamped no vendorId on items[] but locations/{branch}/games/{game}.metadata.vendorId points to this vendor. items: ${c.itemDescription}`,
      linkedBookingIds: [c.bookingId],
      createdBy: 'system-backfill-game-level-vendor',
      createdByName: 'Game-level vendor backfill',
    })
  }
  await batch.commit()
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

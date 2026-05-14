/**
 * Find every (location, game) pair where the GAME doc carries
 * `metadata.vendorId` (vendor_game type), then count bookings that hit
 * those games but stamped no vendorId on items[] or billingItems[].
 * Surfaces vendor under-credit caused by the catalog-flatten path
 * missing game-level vendor stamps.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

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
  console.error('No key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db')

;(async () => {
  console.log('Walking locations/*/games/* …')
  const locsSnap = await db.collection('locations').get()
  const gameVendorMap: Record<
    string,
    { vendorId: string; vendorName: string; vendorBranchId: string }
  > = {}
  for (const loc of locsSnap.docs) {
    const branchId = loc.id
    const games = await loc.ref.collection('games').get()
    for (const g of games.docs) {
      const data = g.data() as { metadata?: Record<string, unknown> }
      const meta = data.metadata ?? {}
      if (meta.gameType === 'vendor_game' && typeof meta.vendorId === 'string' && meta.vendorId) {
        const key = `${branchId}::${g.id}`
        gameVendorMap[key] = {
          vendorId: String(meta.vendorId),
          vendorName: String(meta.vendorName ?? ''),
          vendorBranchId: String(meta.vendorBranchId ?? branchId),
        }
        console.log(`  ${branchId} / ${g.id} → vendor ${meta.vendorId} ${meta.vendorName ?? ''}`)
      }
    }
  }

  console.log(
    `\nFound ${Object.keys(gameVendorMap).length} (location, game) pairs with game-level vendor stamp.`,
  )

  // Now scan bookings: for each item, if the (locationId, gameId) maps to
  // a vendor but the item has NO vendorId on it AND vendorTotal=0 in
  // billingItems, the booking is under-credited.
  console.log('\nLoading bookings…')
  const bSnap = await db.collection('bookings').get()
  console.log(`Loaded ${bSnap.size} bookings`)

  const branchSlugToId: Record<string, string> = {
    visakhapatnam: '0',
    vizag: '0',
    kakinada: '1',
    rajahmundry: '2',
    srikakulam: '5',
  }
  const orphanByGame: Record<string, { count: number; sumPrice: number; sample: string[] }> = {}
  let scanned = 0
  let hits = 0
  for (const b of bSnap.docs) {
    scanned++
    const data = b.data() as Record<string, unknown>
    if (data.paymentStatus !== 'completed') continue
    const refundStatus = String(data.refundStatus ?? 'None')
    if (refundStatus !== 'None' && refundStatus !== '') continue
    const locStr = String(data.locationId ?? '')
    const branchId = branchSlugToId[locStr.toLowerCase()] ?? locStr
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []
    const billingItems = Array.isArray(data.billingItems)
      ? (data.billingItems as Array<Record<string, unknown>>)
      : []
    if (items.length === 0) continue

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const a = (it.activity as Record<string, unknown> | undefined) ?? {}
      const gameId = String(it.gameId ?? a.gameId ?? '').toLowerCase()
      if (!gameId) continue
      const key = `${branchId}::${gameId}`
      const vendorMapping = gameVendorMap[key]
      if (!vendorMapping) continue
      // Skip if vendor IS already stamped (booking is fine)
      const stampedOnItem = String(it.vendorId ?? a.vendorId ?? '').trim()
      if (stampedOnItem) continue
      const bi = (billingItems[i] as Record<string, unknown> | undefined) ?? {}
      const stampedOnBilling = String(bi.vendorId ?? '').trim()
      if (stampedOnBilling) continue
      // Orphan: should have a vendor, doesn't
      const linePrice = Number(it.price) || 0
      const slot = orphanByGame[key] ?? { count: 0, sumPrice: 0, sample: [] }
      slot.count += 1
      slot.sumPrice += linePrice
      if (slot.sample.length < 5) slot.sample.push(b.id)
      orphanByGame[key] = slot
      hits++
    }
  }

  console.log(`\n── Orphans (paid bookings with vendor_game items but no vendor stamp) ──`)
  console.log(`Scanned: ${scanned} bookings, found ${hits} affected line-items`)
  console.log(
    `\nGame                         | Vendor                               | Bookings | Sum line-price`,
  )
  console.log(
    `-----------------------------|--------------------------------------|----------|---------------`,
  )
  const sorted = Object.entries(orphanByGame).sort((a, b) => b[1].sumPrice - a[1].sumPrice)
  for (const [key, slot] of sorted) {
    const v = gameVendorMap[key]
    const label = `${key.replace('::', ' / ')}`.padEnd(28)
    const vname = `${v.vendorId} ${v.vendorName.slice(0, 30)}`.padEnd(36)
    console.log(
      `${label} | ${vname} | ${String(slot.count).padStart(8)} | ₹${String(slot.sumPrice).padStart(13)}`,
    )
  }
  const grand = sorted.reduce((s, [, v]) => s + v.sumPrice, 0)
  console.log(
    `-----------------------------|--------------------------------------|----------|---------------`,
  )
  console.log(
    `TOTAL                                                                |          | ₹${String(grand).padStart(13)}`,
  )
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

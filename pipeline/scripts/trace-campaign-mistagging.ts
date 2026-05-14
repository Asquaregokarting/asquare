/**
 * Reproduce the campaign-matching algorithm exactly, run it against the
 * 28-Mar → 03-Apr ledger window, and show which non-Summer-Vibes
 * bookings get false-positively tagged as Summer Vibes.
 *
 * Confirms or refutes the suspected token-bag-overlap bug in
 * `src/pipeline/features/event-campaigns/campaign-matching.ts`.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
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
  console.error('No service account key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const eventTokenise = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)

interface CampaignMatcher {
  campaignId: string
  campaignTitle: string
  packageId: string
  itemName: string
  gameTokens: string[]
}

;(async () => {
  // 1. Load campaigns and build matchers
  const campaignsSnap = await db.collection('eventCampaigns').get()
  const matchers: CampaignMatcher[] = []
  for (const d of campaignsSnap.docs) {
    const c = d.data() as Record<string, unknown>
    const title = String(c.title ?? d.id)
    const packages = Array.isArray(c.packages) ? (c.packages as Array<Record<string, unknown>>) : []
    for (const pkg of packages) {
      const pkgId = String(pkg.id ?? '')
      const items = Array.isArray(pkg.items) ? (pkg.items as Array<Record<string, unknown>>) : []
      for (const it of items) {
        const name = typeof it.name === 'string' ? it.name : ''
        const tokens = eventTokenise(name)
        if (tokens.length === 0) continue
        matchers.push({
          campaignId: d.id,
          campaignTitle: title,
          packageId: pkgId,
          itemName: name,
          gameTokens: tokens,
        })
      }
    }
  }
  console.log(
    `Loaded ${matchers.length} campaign-item matchers from ${campaignsSnap.size} campaigns.\n`,
  )
  console.log('All matchers (campaign, item name, tokens):')
  for (const m of matchers) {
    console.log(`  [${m.campaignTitle}] "${m.itemName}" → [${m.gameTokens.join(', ')}]`)
  }

  // 2. Load ledger entries in the suspect window
  const FROM = '2026-03-28'
  const TO = '2026-04-03T23:59:59.999Z'
  const lSnap = await db
    .collection('vendorLedger')
    .where('date', '>=', FROM)
    .where('date', '<=', TO)
    .get()
  console.log(`\nLoaded ${lSnap.size} ledger entries with date in [${FROM}, ${TO}].`)

  // 3. For each entry, look up the booking and run the matcher
  type Hit = {
    bookingId: string
    vendorId: string
    amount: number
    matchedCampaignId: string
    matchedCampaignTitle: string
    matchedItemName: string
    bookingItemNames: string[]
    bookingSource: string
    bookingTransactionDate: string
  }
  const hits: Hit[] = []
  const bookingCache = new Map<string, Record<string, unknown> | null>()
  for (const d of lSnap.docs) {
    const e = d.data() as Record<string, unknown>
    const refId = String(e.referenceId ?? '')
    if (!refId) continue
    let booking = bookingCache.get(refId)
    if (booking === undefined) {
      const bSnap = await db.collection('bookings').doc(refId).get()
      booking = bSnap.exists ? (bSnap.data() as Record<string, unknown>) : null
      bookingCache.set(refId, booking)
    }
    if (!booking) continue
    const items = Array.isArray(booking.items)
      ? (booking.items as Array<Record<string, unknown>>)
      : []
    if (items.length === 0) continue

    // Run the matcher
    let matched: CampaignMatcher | undefined
    outer: for (const it of items) {
      const itName = typeof it.itemName === 'string' ? it.itemName : ''
      const itTokens = new Set(eventTokenise(itName))
      if (itTokens.size === 0) continue
      for (const m of matchers) {
        let ok = true
        for (const t of m.gameTokens) {
          if (!itTokens.has(t)) {
            ok = false
            break
          }
        }
        if (ok) {
          matched = m
          break outer
        }
      }
    }
    if (!matched) continue

    hits.push({
      bookingId: refId,
      vendorId: String(e.vendorId ?? ''),
      amount: Number(e.amount ?? 0),
      matchedCampaignId: matched.campaignId,
      matchedCampaignTitle: matched.campaignTitle,
      matchedItemName: matched.itemName,
      bookingItemNames: items.map((it) => String(it.itemName ?? '')),
      bookingSource: String(booking.source ?? ''),
      bookingTransactionDate: String(booking.transactionDate ?? ''),
    })
  }

  console.log(`\n${hits.length} ledger entries got tagged to a campaign by the matcher.\n`)

  // 4. Identify false-positives: bookings created BEFORE the campaign's startDate
  const campaignStarts = new Map<string, string>()
  for (const d of campaignsSnap.docs) {
    const c = d.data() as Record<string, unknown>
    campaignStarts.set(d.id, String(c.startDate ?? ''))
  }

  const falsePositives = hits.filter((h) => {
    const start = campaignStarts.get(h.matchedCampaignId) ?? ''
    if (!start) return false
    const txnDay = h.bookingTransactionDate.slice(0, 10)
    return txnDay && txnDay < start
  })

  console.log(
    `${falsePositives.length} false-positives (booking dated BEFORE campaign startDate).\n`,
  )
  let total = 0
  for (const fp of falsePositives) {
    total += fp.amount
    console.log(
      `  ${fp.bookingId}  vendor=${fp.vendorId}  ₹${fp.amount}  txn=${fp.bookingTransactionDate.slice(0, 10)}  matched-as="${fp.matchedItemName}"  via item=${
        fp.bookingItemNames.find((n) => {
          const t = new Set(eventTokenise(n))
          const m = matchers.find((mm) => mm.itemName === fp.matchedItemName)
          return m?.gameTokens.every((tok) => t.has(tok))
        }) ?? '(?)'
      }`,
    )
  }
  console.log(`\nTotal money mis-attributed in this window: ₹${total}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

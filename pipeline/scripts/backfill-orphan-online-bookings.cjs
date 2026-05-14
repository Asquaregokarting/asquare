/**
 * Backfill billingItems / vendorIds / GST splits / vendor ledger for the
 * 40+ orphan paid customer-app online bookings produced before the
 * createDraftBooking → createUnifiedBooking fix.
 *
 * What's an orphan?
 *   billingType='online' AND paymentStatus='completed' AND !cancelled
 *   AND (no billingItems[] OR billingItems.length === 0)
 *
 * What we do per orphan:
 *   1. Canonicalize locationId to a known branch slug.
 *   2. Look up each item's vendor in locations/{slug}/games/{gameId}/
 *      subgames/{subGameId}/variants/{variantId} (with metadata.vendorId
 *      inheritance from game → subgame → variant).
 *   3. Compute per-item GST + vendor splits using the same maths as
 *      src/lib/unified-booking.ts (computeGst + computeRevenueSplit).
 *   4. Merge-write baseAmount, gstAmount, vendorId, vendorBase/Gst/Total,
 *      companyBase/Gst/Total, vendorIds[], billingItems[], invoiceNumber.
 *   5. Write vendor ledger credits for any vendor that earned > 0.
 *
 * Safe to run multiple times — every step is idempotent: invoiceNumber
 * is only written when missing, ledger doc IDs are deterministic
 * (`le-{bookingId}-{vendorId}`), and billingItems merge-writes
 * replace the empty array with the computed one.
 *
 * --dry-run flag prints what would be changed without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

const GST_PERCENT = 18
const VENDOR_SHARE_DEFAULT = 80

const computeGst = (totalAmount, gstPercent = GST_PERCENT) => {
  const baseAmount = Math.round((totalAmount * 100) / (100 + gstPercent))
  return { baseAmount, gstAmount: totalAmount - baseAmount }
}

const computeRevenueSplit = (baseAmount, gstAmount, sharePercent, vendorType) => {
  if (vendorType === 'SubLease') {
    const vendorBase = Math.round((baseAmount * sharePercent) / 100)
    const companyBase = baseAmount - vendorBase
    return {
      vendorBase,
      vendorGst: 0,
      vendorTotal: vendorBase,
      companyBase,
      companyGst: gstAmount,
      companyTotal: companyBase + gstAmount,
    }
  }
  const vendorBase = Math.round((baseAmount * sharePercent) / 100)
  const vendorGst = Math.round((gstAmount * sharePercent) / 100)
  const companyBase = baseAmount - vendorBase
  const companyGst = gstAmount - vendorGst
  return {
    vendorBase,
    vendorGst,
    vendorTotal: vendorBase + vendorGst,
    companyBase,
    companyGst,
    companyTotal: companyBase + companyGst,
  }
}

// Branch slug canonicalization (matches src/lib/locations.ts fallback).
const SLUG_ALIASES = {
  visakhapatnam: 'visakhapatnam',
  vizag: 'visakhapatnam',
  '0': 'visakhapatnam',
  kakinada: 'kakinada',
  '1': 'kakinada',
  rajahmundry: 'rajahmundry',
  '2': 'rajahmundry',
  srikakulam: 'srikakulam',
  '5': 'srikakulam',
}

const canonicalSlug = (raw) => {
  if (!raw) return ''
  const lc = String(raw).toLowerCase().trim()
  return SLUG_ALIASES[lc] || lc
}

// `locations/{id}` doc id is the numeric branchId for the original 3
// branches and the slug for Srikakulam. The customer-app booking carries
// the slug, so we map slug → doc-id form before reading the catalog tree.
// Mirror of src/lib/locations.ts.
const SLUG_TO_LOC_DOC_ID = {
  visakhapatnam: '0',
  kakinada: '1',
  rajahmundry: '2',
  srikakulam: 'srikakulam',
}

const stripUndefined = (obj) => {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

async function getVendorConfig(vendorId) {
  if (!vendorId) return null
  try {
    const snap = await db.collection('vendorDetails').doc(vendorId).get()
    if (!snap.exists) return { sharePercent: VENDOR_SHARE_DEFAULT, vendorType: 'ThirdParty' }
    const d = snap.data()
    const share = Math.max(0, Math.min(100, Number(d.revenueShare) || VENDOR_SHARE_DEFAULT))
    const vendorType = d.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty'
    return { sharePercent: share, vendorType }
  } catch {
    return { sharePercent: VENDOR_SHARE_DEFAULT, vendorType: 'ThirdParty' }
  }
}

async function resolveVendorForVariant(branchSlug, gameId, subGameId, variantId) {
  try {
    const locDocId = SLUG_TO_LOC_DOC_ID[branchSlug] || branchSlug
    const gameRef = db
      .collection('locations')
      .doc(locDocId)
      .collection('games')
      .doc(gameId)
    const gameSnap = await gameRef.get()
    const gameMeta = gameSnap.exists ? (gameSnap.data() || {}).metadata || {} : {}
    const gameVendorId = (typeof gameMeta.vendorId === 'string' && gameMeta.vendorId)
      || (typeof gameMeta.vendorUserId === 'string' && gameMeta.vendorUserId)
      || undefined

    const sgRef = gameRef.collection('subgames').doc(subGameId)
    const sgSnap = await sgRef.get()
    const sgMeta = sgSnap.exists ? (sgSnap.data() || {}).metadata || {} : {}

    const vRef = sgRef.collection('variants').doc(variantId)
    const vSnap = await vRef.get()
    const vMeta = vSnap.exists ? (vSnap.data() || {}).metadata || {} : {}

    const variantVendorId = (typeof vMeta.vendorId === 'string' && vMeta.vendorId)
      || (typeof sgMeta.vendorId === 'string' && sgMeta.vendorId)
      || gameVendorId
      || undefined
    return variantVendorId
  } catch (err) {
    console.error('resolveVendorForVariant failed', { branchSlug, gameId, subGameId, variantId, err: err.message })
    return undefined
  }
}

async function enrichOrphan(docSnap) {
  const id = docSnap.id
  const b = docSnap.data()

  const rawSlug = b.locationId || b.branchId || ''
  const branchSlug = canonicalSlug(rawSlug)
  if (!branchSlug) return { id, skipped: 'no_branch_slug' }

  const items = b.items || []
  if (items.length === 0) return { id, skipped: 'no_items' }

  // Resolve vendor per item from the catalog
  const itemsWithVendor = []
  for (const it of items) {
    const gameId = it.gameId
    const subGameId = it.subGameId
    const variantId = it.variantId
    if (!gameId || !subGameId || !variantId) {
      itemsWithVendor.push({ ...it, vendorId: undefined })
      continue
    }
    const vendorId = await resolveVendorForVariant(branchSlug, gameId, subGameId, variantId)
    itemsWithVendor.push({ ...it, vendorId })
  }

  // Load vendor configs for unique vendors
  const uniqueVendors = [...new Set(itemsWithVendor.map(it => it.vendorId).filter(Boolean))]
  const vendorConfigMap = new Map()
  for (const vid of uniqueVendors) {
    vendorConfigMap.set(vid, await getVendorConfig(vid))
  }

  // Per-item GST + vendor split (proportional distribution)
  const finalAmount = Math.max(0, Number(b.finalAmount) || 0)
  const { baseAmount, gstAmount } = computeGst(finalAmount, GST_PERCENT)

  const itemSubtotals = itemsWithVendor.map(it => Math.max(1, Math.floor(Number(it.quantity) || 1)) * Math.max(0, Number(it.price) / (Number(it.quantity) || 1)))
  // The customer-app stores price = quantity * unitPrice on items, so divide back out
  const unitPrices = itemsWithVendor.map(it => {
    const q = Math.max(1, Math.floor(Number(it.quantity) || 1))
    return q > 0 ? Math.max(0, Number(it.price) || 0) / q : 0
  })
  const totals = itemsWithVendor.map((_, i) => Math.max(0, Math.round(unitPrices[i] * (Number(itemsWithVendor[i].quantity) || 1))))
  const itemRawBases = totals.map(t => Math.round((t * 100) / (100 + GST_PERCENT)))
  if (itemRawBases.length > 0) {
    const baseSum = itemRawBases.reduce((s, a) => s + a, 0)
    itemRawBases[itemRawBases.length - 1] += baseAmount - baseSum
  }
  const itemRawGsts = totals.map((t, idx) => t - itemRawBases[idx])
  if (itemRawGsts.length > 0) {
    const gstSum = itemRawGsts.reduce((s, a) => s + a, 0)
    itemRawGsts[itemRawGsts.length - 1] += gstAmount - gstSum
  }

  const billingItems = itemsWithVendor.map((item, idx) => {
    const itemBase = itemRawBases[idx] ?? 0
    const itemGst = itemRawGsts[idx] ?? 0
    const baseFields = stripUndefined({
      itemName: item.activity?.name || item.itemName || 'Activity',
      quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
      unitPrice: unitPrices[idx],
      gameId: item.gameId,
      subGameId: item.subGameId,
      variantId: item.variantId,
      itemBaseAmount: itemBase,
      itemGstAmount: itemGst,
    })
    if (item.vendorId) {
      const cfg = vendorConfigMap.get(item.vendorId) || { sharePercent: VENDOR_SHARE_DEFAULT, vendorType: 'ThirdParty' }
      const split = computeRevenueSplit(itemBase, itemGst, cfg.sharePercent, cfg.vendorType)
      return {
        ...baseFields,
        vendorId: item.vendorId,
        vendorSharePercent: cfg.sharePercent,
        ...split,
      }
    }
    return {
      ...baseFields,
      vendorBase: 0,
      vendorGst: 0,
      vendorTotal: 0,
      companyBase: itemBase,
      companyGst: itemGst,
      companyTotal: itemBase + itemGst,
    }
  })

  const txnVendorBase = billingItems.reduce((s, i) => s + (i.vendorBase || 0), 0)
  const txnVendorGst = billingItems.reduce((s, i) => s + (i.vendorGst || 0), 0)
  const txnVendorTotal = txnVendorBase + txnVendorGst
  const txnCompanyBase = billingItems.reduce((s, i) => s + (i.companyBase || 0), 0)
  const txnCompanyGst = billingItems.reduce((s, i) => s + (i.companyGst || 0), 0)
  const txnCompanyTotal = txnCompanyBase + txnCompanyGst
  const primaryVendorId = billingItems.find(i => i.vendorId)?.vendorId
  const vendorIds = [...new Set(billingItems.map(i => i.vendorId).filter(Boolean))]

  const billingFields = stripUndefined({
    invoiceNumber: b.invoiceNumber || id,
    baseAmount,
    gstAmount,
    gstPercent: GST_PERCENT,
    vendorId: primaryVendorId,
    vendorBase: txnVendorTotal > 0 ? txnVendorBase : undefined,
    vendorGst: txnVendorTotal > 0 ? txnVendorGst : undefined,
    vendorTotal: txnVendorTotal > 0 ? txnVendorTotal : undefined,
    companyBase: txnCompanyBase,
    companyGst: txnCompanyGst,
    companyTotal: txnCompanyTotal,
    vendorIds,
    billingItems,
    billingSyncedAt: new Date(),
    billingBackfilledAt: new Date(),
    billingBackfilledReason: 'orphan-paid-online-pre-unified-fix',
    // Normalize locationId to canonical slug too (some had 'vizag' / '0')
    locationId: branchSlug,
  })

  if (DRY_RUN) {
    return {
      id,
      preview: {
        branchSlug,
        finalAmount,
        baseAmount,
        gstAmount,
        vendorIds,
        billingItems: billingItems.map(bi => ({
          name: bi.itemName,
          q: bi.quantity,
          vendor: bi.vendorId,
          vendorTotal: bi.vendorTotal,
        })),
      },
    }
  }

  await db.collection('bookings').doc(id).set(billingFields, { merge: true })

  // Vendor ledger credits — deterministic id `le-{bookingId}-{vendorId}`
  if (txnVendorTotal > 0) {
    const ledgerByVendor = new Map()
    for (const i of billingItems) {
      if (!i.vendorId || !(i.vendorTotal || 0)) continue
      const acc = ledgerByVendor.get(i.vendorId) || { vendorBase: 0, vendorGst: 0, vendorTotal: 0 }
      acc.vendorBase += i.vendorBase || 0
      acc.vendorGst += i.vendorGst || 0
      acc.vendorTotal += i.vendorTotal || 0
      ledgerByVendor.set(i.vendorId, acc)
    }
    const txnDate = b.scheduleDate || new Date().toISOString().slice(0, 10)
    for (const [vid, totals] of ledgerByVendor.entries()) {
      if (totals.vendorTotal <= 0) continue
      const ledgerId = `le-${id}-${vid}`
      await db.collection('vendorLedger').doc(ledgerId).set(stripUndefined({
        id: ledgerId,
        vendorId: vid,
        vendorBase: totals.vendorBase,
        vendorGst: totals.vendorGst,
        amount: totals.vendorTotal,
        type: 'credit',
        referenceId: id,
        invoiceNumber: b.invoiceNumber || id,
        locationId: branchSlug,
        date: txnDate,
        createdAt: new Date().toISOString(),
        backfilledAt: new Date().toISOString(),
        backfillReason: 'orphan-paid-online-pre-unified-fix',
      }), { merge: true })
    }
  }

  return {
    id,
    branchSlug,
    finalAmount,
    vendorIds,
    txnVendorTotal,
  }
}

;(async () => {
  const snap = await db.collection('bookings').where('billingType', '==', 'online').limit(5000).get()
  const orphans = []
  for (const d of snap.docs) {
    const b = d.data()
    const hasBI = Array.isArray(b.billingItems) && b.billingItems.length > 0
    if (!hasBI && !b.cancelled && b.paymentStatus === 'completed') orphans.push(d)
  }
  console.log(`Found ${orphans.length} orphan paid online bookings${DRY_RUN ? ' (dry-run)' : ''}`)

  let processed = 0
  let withVendor = 0
  let totalVendorCredits = 0
  for (const d of orphans) {
    try {
      const r = await enrichOrphan(d)
      processed++
      if (r.skipped) {
        console.log(`SKIP ${r.id}: ${r.skipped}`)
        continue
      }
      if (DRY_RUN) {
        console.log(`DRY ${r.id}: ${JSON.stringify(r.preview)}`)
      } else {
        console.log(`OK ${r.id}: branch=${r.branchSlug} vendors=${r.vendorIds.join(',') || '-'} vendorCredit=${r.txnVendorTotal}`)
        if (r.vendorIds.length > 0) withVendor++
        totalVendorCredits += r.txnVendorTotal || 0
      }
    } catch (err) {
      console.error(`FAIL ${d.id}:`, err.message)
    }
  }
  console.log('---')
  console.log(`Processed: ${processed}/${orphans.length}`)
  if (!DRY_RUN) {
    console.log(`With vendor credits: ${withVendor}`)
    console.log(`Total vendor credits written: ₹${totalVendorCredits}`)
  }
  process.exit(0)
})().catch(err => { console.error(err); process.exit(1) })

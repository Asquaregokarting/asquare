/**
 * Normalize locationId and paymentMethod values across bookings.
 *
 * Why:
 *   - locationId is currently stored as 7 different values for 4 branches:
 *       "0"/"visakhapatnam"/"vizag"  → all map to "visakhapatnam"
 *       "1"/"kakinada"                → "kakinada"
 *       "2"/"rajahmundry"             → "rajahmundry"
 *       "5"/"srikakulam"              → "srikakulam"
 *     A query `where('locationId','==','visakhapatnam')` misses the 919
 *     bookings stored with locationId='0'.
 *
 *   - paymentMethod is stored as 18 variants — half are case-only
 *     duplicates ("UPI"/"upi", "Card"/"card", "Cash"/"cash", "Razorpay"/
 *     "razorpay"). Reports group-by paymentMethod under-count by half.
 *
 * Fix: rewrite every booking with the canonical value for both fields.
 * Idempotent — re-running is a no-op once normalized.
 *
 * --dry-run prints intended changes without writing.
 */
const admin = require('firebase-admin')
admin.initializeApp({ credential: admin.credential.cert(require('../serviceAccountKey.json')) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const DRY_RUN = process.argv.includes('--dry-run')

// ── Canonical mapping ──────────────────────────────────────────────────
const LOCATION_CANONICAL = {
  '0': 'visakhapatnam',
  visakhapatnam: 'visakhapatnam',
  vizag: 'visakhapatnam',
  '1': 'kakinada',
  kakinada: 'kakinada',
  '2': 'rajahmundry',
  rajahmundry: 'rajahmundry',
  '5': 'srikakulam',
  srikakulam: 'srikakulam',
}

const PAYMENT_METHOD_CANONICAL = {
  // Single-method
  upi: 'UPI',
  UPI: 'UPI',
  cash: 'Cash',
  Cash: 'Cash',
  card: 'Card',
  Card: 'Card',
  razorpay: 'Razorpay',
  Razorpay: 'Razorpay',
  link: 'Link',
  Link: 'Link',
  wallet: 'Wallet',
  Wallet: 'Wallet',
  netbanking: 'NetBanking',
  NetBanking: 'NetBanking',
  online: 'Online',
  Online: 'Online',
  free: 'Free',
  Free: 'Free',
  Protocol: 'Protocol',
  protocol: 'Protocol',
  Split: 'Split',
  split: 'Split',
  // Split-payment combos collapse to "Split" (matches the dominant 139
  // bookings already using that label; preserves per-bucket aggregation
  // without lying about the customer-facing flow that was used).
  'wallet+upi': 'Split',
  'wallet+card': 'Split',
  'wallet+netbanking': 'Split',
}

const normalizeLocation = (raw) => {
  if (typeof raw !== 'string' || !raw) return raw
  const lc = raw.toLowerCase().trim()
  return LOCATION_CANONICAL[raw] || LOCATION_CANONICAL[lc] || raw
}

const normalizePaymentMethod = (raw) => {
  if (typeof raw !== 'string' || !raw) return raw
  return PAYMENT_METHOD_CANONICAL[raw] || PAYMENT_METHOD_CANONICAL[raw.toLowerCase()] || raw
}

;(async () => {
  let cursor = null
  let scanned = 0
  const fixes = []
  while (true) {
    let q = db.collection('bookings').orderBy(admin.firestore.FieldPath.documentId()).limit(500)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      scanned++
      const b = d.data()
      const updates = {}
      const before = {}
      const loc = b.locationId
      const newLoc = normalizeLocation(loc)
      if (newLoc !== loc && typeof loc === 'string') {
        updates.locationId = newLoc
        before.locationId = loc
      }
      const pm = b.paymentMethod
      const newPm = normalizePaymentMethod(pm)
      if (newPm !== pm && typeof pm === 'string') {
        updates.paymentMethod = newPm
        before.paymentMethod = pm
      }
      if (Object.keys(updates).length > 0) fixes.push({ id: d.id, updates, before })
    }
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < 500) break
  }
  console.log(`${DRY_RUN ? 'DRY ' : ''}Scanned ${scanned} bookings`)
  console.log(`  docs needing normalization: ${fixes.length}`)
  const byChange = {}
  for (const f of fixes) {
    for (const [k, v] of Object.entries(f.updates)) {
      const key = `${k}: ${JSON.stringify(f.before[k])} → ${JSON.stringify(v)}`
      byChange[key] = (byChange[key] || 0) + 1
    }
  }
  console.log('  changes by mapping:')
  Object.entries(byChange)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, c]) => console.log('    ' + k + ' × ' + c))

  if (!DRY_RUN) {
    let written = 0
    for (const f of fixes) {
      await db.collection('bookings').doc(f.id).update({
        ...f.updates,
        canonicalizedAt: admin.firestore.Timestamp.now(),
        canonicalizedFrom: f.before,
      })
      written++
    }
    console.log(`Wrote: ${written}`)
  }
  process.exit(0)
})().catch((err) => { console.error(err); process.exit(1) })

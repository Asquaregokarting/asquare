/**
 * Reverse orphan "Cashback for booking #X" credits on wallets where the
 * underlying booking ended up cancelled or payment failed.
 *
 * Detector (scripts/detect-wallet-refund-abuse.cjs) already identifies these
 * cases. This script consumes a hard-coded reversal list (below) and:
 *
 *   1. Resolves each phone → customer uid (staff docs skipped).
 *   2. Per user, runs a Firestore transaction that:
 *        - re-verifies the booking is cancelled/failed,
 *        - re-verifies the wallet has ≥ reversal amount,
 *        - deducts the amount + writes a debit audit entry,
 *        - keeps the root `walletBalance` mirror in sync.
 *   3. Aborts the user's transaction (skips, does not crash) if any
 *      precondition fails, so partial wallets / drained balances are a
 *      safe no-op.
 *
 * Usage:
 *   node scripts/reverse-orphan-cashback.cjs                # dry-run
 *   node scripts/reverse-orphan-cashback.cjs --confirm       # apply
 */
const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const args = process.argv.slice(2)
const CONFIRM = args.includes('--confirm')
const DRY_RUN = !CONFIRM

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.')
  process.exit(1)
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
})
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const normalizePhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

// Reversal targets — from detect-wallet-refund-abuse.cjs run on 2026-04-20.
// Only users whose wallet still has the credit (i.e. wallet ≥ amount). Users
// whose wallet is already ₹0 are written off — nothing to reverse.
const TARGETS = [
  { phone: '9182205393', amount: 1000, orderNumber: 'ASG260201205558101' },
  { phone: '9133333636', amount: 1000, orderNumber: 'ASG260201155513101' },
  { phone: '9346046218', amount: 1000, orderNumber: 'ASG260211165208109' },
  // Tumbry has ₹3051 — only ₹1000 is orphan cashback, rest is legitimate.
  { phone: '9876543210', amount: 1000, orderNumber: 'ASG260124185358103' },
]

const tag = DRY_RUN ? '[DRY]' : '[RUN]'

async function resolveUserId(phone) {
  const normalized = normalizePhone(phone)
  // phoneToUid first
  const indexSnap = await db.doc(`phoneToUid/${normalized}`).get()
  if (indexSnap.exists) {
    const mapped = indexSnap.data().uid
    if (typeof mapped === 'string' && mapped.length > 0) {
      const u = await db.doc(`users/${mapped}`).get()
      if (u.exists && !u.data().role) return mapped
    }
  }
  // Field-scan fallback
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]
  for (const v of variants) {
    const q = await db.collection('users').where('phone', '==', v).get()
    for (const candidate of q.docs) {
      const d = candidate.data()
      if (d.role) continue
      return candidate.id
    }
  }
  return null
}

;(async () => {
  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — reverse orphan cashback credits\n` +
      `  targets: ${TARGETS.length}\n` +
      `  total:   ₹${TARGETS.reduce((s, t) => s + t.amount, 0)}\n`,
  )

  let successCount = 0
  let skipCount = 0
  let errorCount = 0

  for (const target of TARGETS) {
    console.log(`\n${tag} ── ${target.phone} (₹${target.amount} for #${target.orderNumber}) ──`)

    const userId = await resolveUserId(target.phone)
    if (!userId) {
      console.log(`${tag}   SKIP: no customer uid`)
      skipCount++
      continue
    }
    console.log(`${tag}   userId = ${userId}`)

    // Verify booking is actually cancelled/failed before deducting
    const bookingSnap = await db.doc(`bookings/${target.orderNumber}`).get()
    if (!bookingSnap.exists) {
      console.log(`${tag}   SKIP: booking ${target.orderNumber} not found`)
      skipCount++
      continue
    }
    const booking = bookingSnap.data()
    const bookingOk =
      booking.bookingStatus === 'cancelled' || booking.paymentStatus === 'failed'
    if (!bookingOk) {
      console.log(
        `${tag}   SKIP: booking not cancelled/failed (status=${booking.bookingStatus}/${booking.paymentStatus})`,
      )
      skipCount++
      continue
    }
    console.log(
      `${tag}   booking verified: bookingStatus=${booking.bookingStatus}, paymentStatus=${booking.paymentStatus}`,
    )

    // Verify wallet balance
    const walletRef = db.doc(`users/${userId}/wallet/data`)
    const userRef = db.doc(`users/${userId}`)
    const walletSnap = await walletRef.get()
    const currentBalance = Number(walletSnap.exists ? walletSnap.data().balance || 0 : 0)
    console.log(`${tag}   current balance: ₹${currentBalance}`)
    if (currentBalance < target.amount) {
      console.log(`${tag}   SKIP: wallet balance ₹${currentBalance} < reversal ₹${target.amount}`)
      skipCount++
      continue
    }

    console.log(`${tag}   plan: deduct ₹${target.amount} (${currentBalance} → ${currentBalance - target.amount})`)

    if (DRY_RUN) continue

    try {
      await db.runTransaction(async (tx) => {
        const freshWallet = await tx.get(walletRef)
        const freshBalance = Number(
          freshWallet.exists ? freshWallet.data().balance || 0 : 0,
        )
        if (freshBalance < target.amount) {
          throw new Error(`Balance dropped mid-flight: ₹${freshBalance}`)
        }
        const newBalance = freshBalance - target.amount
        tx.set(
          walletRef,
          { balance: newBalance, lastUpdated: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        )
        tx.set(userRef, { walletBalance: newBalance }, { merge: true })
        const auditId = `cashback-reversal-${Date.now()}`
        const auditRef = db.doc(`users/${userId}/wallet_transactions/${auditId}`)
        tx.set(auditRef, {
          type: 'debit',
          amount: -target.amount,
          description: `Reversal: orphan cashback credited on cancelled booking #${target.orderNumber}`,
          source: 'reverse-orphan-cashback-script',
          relatedBooking: target.orderNumber,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
      const post = await walletRef.get()
      console.log(`${tag}   ✓ reversed. new balance: ₹${Number(post.data()?.balance || 0)}`)
      successCount++
    } catch (err) {
      console.error(`${tag}   ✗ FAILED: ${err.message}`)
      errorCount++
    }
  }

  console.log(
    `\n${tag} Summary: ${successCount} reversed, ${skipCount} skipped, ${errorCount} errored\n`,
  )
  if (DRY_RUN) {
    console.log('(dry-run — re-run with --confirm to apply)\n')
  }
  process.exit(errorCount > 0 ? 2 : 0)
})().catch((err) => {
  console.error('\nreverse-orphan-cashback failed:', err && err.stack ? err.stack : err)
  process.exit(1)
})

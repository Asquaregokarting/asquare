/**
 * Wallet Auto-Refund Abuse Detector
 *
 * Scans every user's `wallet_transactions` subcollection and flags accounts
 * where auto-refund credits don't reconcile 1:1 with the preceding "Booking
 * Payment" debit. The bug in Checkout.tsx (pre-fix) allowed multi-tab races
 * to fire the auto-refund handler without a matching deduction — see
 * docs/9281088892 incident.
 *
 * Usage:
 *   node scripts/detect-wallet-refund-abuse.cjs                # full scan
 *   node scripts/detect-wallet-refund-abuse.cjs <phone>        # one user
 *   node scripts/detect-wallet-refund-abuse.cjs --json         # machine-readable
 *
 * Output per abuser:
 *   userId, phone, debitTotal, refundTotal, refundExcess, affectedOrders[]
 */
const admin = require('firebase-admin')
const key = require('../serviceAccountKey.json')

admin.initializeApp({ credential: admin.credential.cert(key) })
const db = admin.firestore()
db.settings({ databaseId: 'asquare-app-db' })

const args = process.argv.slice(2)
const jsonOut = args.includes('--json')
const phoneArg = args.find((a) => !a.startsWith('--'))

const DEBIT_RE = /Booking Payment #([A-Za-z0-9_-]+)/i
const REFUND_RE = /(?:Refund for failed booking|Auto-refund: booking) #([A-Za-z0-9_-]+)/i
const CASHBACK_RE = /Cashback for booking #([A-Za-z0-9_-]+)/i

async function getUsers() {
  if (phoneArg) {
    const variants = [phoneArg, `+91${phoneArg}`, `91${phoneArg}`]
    const found = []
    // Try phoneToUid index first (canonical)
    try {
      const idxSnap = await db.doc(`phoneToUid/${phoneArg}`).get()
      if (idxSnap.exists) {
        const uid = idxSnap.data().uid
        if (uid) {
          const u = await db.doc(`users/${uid}`).get()
          if (u.exists) found.push({ id: u.id, data: u.data() })
        }
      }
    } catch {}
    // Fallback: field scan on phone variants
    for (const v of variants) {
      const snap = await db.collection('users').where('phone', '==', v).get()
      snap.forEach((d) => {
        if (!found.some((f) => f.id === d.id)) found.push({ id: d.id, data: d.data() })
      })
    }
    return found
  }
  // Full scan
  const snap = await db.collection('users').get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

async function analyseUser(user) {
  const txSnap = await db
    .collection(`users/${user.id}/wallet_transactions`)
    .orderBy('timestamp', 'asc')
    .get()
  if (txSnap.empty) return null

  // Per-orderNumber ledger
  const ledger = new Map() // orderNumber -> { debits:[], refunds:[], cashback:[] }
  const orphanRefunds = [] // refund with no matching debit at all

  for (const doc of txSnap.docs) {
    const d = doc.data()
    const desc = String(d.description || '')
    const amt = Number(d.amount || 0)
    const debitMatch = DEBIT_RE.exec(desc)
    const refundMatch = REFUND_RE.exec(desc)
    const cashbackMatch = CASHBACK_RE.exec(desc)

    if (d.type === 'debit' && debitMatch) {
      const order = debitMatch[1]
      const entry = ledger.get(order) || { debits: [], refunds: [], cashback: [] }
      entry.debits.push({ txId: doc.id, amount: Math.abs(amt), ts: d.timestamp })
      ledger.set(order, entry)
    } else if (d.type === 'credit' && refundMatch) {
      const order = refundMatch[1]
      const entry = ledger.get(order) || { debits: [], refunds: [], cashback: [] }
      entry.refunds.push({ txId: doc.id, amount: amt, ts: d.timestamp })
      ledger.set(order, entry)
    } else if (d.type === 'credit' && cashbackMatch) {
      const order = cashbackMatch[1]
      const entry = ledger.get(order) || { debits: [], refunds: [], cashback: [] }
      entry.cashback.push({ txId: doc.id, amount: amt, ts: d.timestamp })
      ledger.set(order, entry)
    }
  }

  const affectedOrders = []
  let refundExcess = 0
  let orphanCashback = 0

  for (const [order, entry] of ledger) {
    const debitSum = entry.debits.reduce((s, x) => s + x.amount, 0)
    const refundSum = entry.refunds.reduce((s, x) => s + x.amount, 0)

    // Abuse pattern 1: refunds exceed debits (no matching deduction OR double refund)
    if (refundSum > debitSum + 0.5) {
      affectedOrders.push({
        orderNumber: order,
        debitCount: entry.debits.length,
        refundCount: entry.refunds.length,
        debitSum,
        refundSum,
        excess: refundSum - debitSum,
        pattern: entry.debits.length === 0 ? 'orphan-refund' : 'double-refund',
      })
      refundExcess += refundSum - debitSum
    }

    // Abuse pattern 2: cashback credited but booking was ultimately cancelled.
    // Detect by checking the booking doc. Skip if there was a debit for this
    // order (normal wallet payment) — this is noisy but catches the main case.
    if (entry.cashback.length > 0) {
      try {
        const bSnap = await db.doc(`bookings/${order}`).get()
        if (bSnap.exists) {
          const b = bSnap.data()
          if (b.bookingStatus === 'cancelled' || b.paymentStatus === 'failed') {
            const cashbackSum = entry.cashback.reduce((s, x) => s + x.amount, 0)
            orphanCashback += cashbackSum
            affectedOrders.push({
              orderNumber: order,
              pattern: 'cashback-on-cancelled',
              cashbackSum,
              bookingStatus: b.bookingStatus,
              paymentStatus: b.paymentStatus,
            })
          }
        }
      } catch {}
    }
  }

  if (affectedOrders.length === 0) return null

  return {
    userId: user.id,
    phone: user.data.phone || user.data.phoneNumber || user.data.mobile || null,
    name: user.data.displayName || user.data.name || null,
    walletBalance: user.data.walletBalance || 0,
    refundExcess,
    orphanCashback,
    totalLoss: refundExcess + orphanCashback,
    affectedOrders,
  }
}

;(async () => {
  const users = await getUsers()
  if (!jsonOut) {
    console.error(`Scanning ${users.length} user(s)...`)
  }

  const abusers = []
  let scanned = 0
  for (const u of users) {
    scanned += 1
    if (!jsonOut && scanned % 250 === 0) {
      console.error(`  ...${scanned}/${users.length}`)
    }
    const result = await analyseUser(u)
    if (result) abusers.push(result)
  }

  abusers.sort((a, b) => b.totalLoss - a.totalLoss)

  if (jsonOut) {
    console.log(JSON.stringify({ scanned: users.length, abusers }, null, 2))
    return
  }

  console.log(`\n=== Wallet Refund Abuse Report ===`)
  console.log(`Users scanned: ${users.length}`)
  console.log(`Abusers found: ${abusers.length}`)
  console.log(
    `Total estimated loss: ₹${abusers.reduce((s, a) => s + a.totalLoss, 0).toFixed(2)}\n`,
  )

  for (const a of abusers) {
    console.log(
      `• ${a.phone || '(no phone)'} — ${a.name || ''} [${a.userId}]  refundExcess=₹${a.refundExcess.toFixed(2)}  cashbackOnCancelled=₹${a.orphanCashback.toFixed(2)}  currentWallet=₹${a.walletBalance}`,
    )
    for (const o of a.affectedOrders.slice(0, 10)) {
      if (o.pattern === 'cashback-on-cancelled') {
        console.log(
          `    cashback-on-cancelled  #${o.orderNumber}  ₹${o.cashbackSum}  (${o.bookingStatus}/${o.paymentStatus})`,
        )
      } else {
        console.log(
          `    ${o.pattern.padEnd(14)}  #${o.orderNumber}  debits=${o.debitCount}(₹${o.debitSum})  refunds=${o.refundCount}(₹${o.refundSum})  excess=₹${o.excess}`,
        )
      }
    }
    if (a.affectedOrders.length > 10) {
      console.log(`    ... ${a.affectedOrders.length - 10} more`)
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

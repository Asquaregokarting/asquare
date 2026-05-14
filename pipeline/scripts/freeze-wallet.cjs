/**
 * Freeze a customer's wallet.
 *
 * Use when a wallet has been identified as abused (e.g. via
 * detect-wallet-refund-abuse.cjs). This script:
 *
 *   1. Resolves the customer's uid via phoneToUid index (staff docs skipped).
 *   2. Atomically zeroes the wallet balance and the root `walletBalance` mirror.
 *   3. Sets `walletFrozen: true` and `walletFrozenReason` on the user doc.
 *   4. Writes an audit debit entry to `wallet_transactions` noting the freeze.
 *
 * `walletService` checks `walletFrozen` before every deduct/addBalance — once
 * this flag is set the wallet cannot be used or credited from the client.
 *
 * Usage:
 *   node scripts/freeze-wallet.cjs <phone>                          # dry-run
 *   node scripts/freeze-wallet.cjs <phone> --confirm                # apply
 *   node scripts/freeze-wallet.cjs <phone> --confirm --reason "..." # custom reason
 *   node scripts/freeze-wallet.cjs <phone> --unfreeze --confirm     # undo
 */
const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const args = process.argv.slice(2)
const CONFIRM = args.includes('--confirm')
const UNFREEZE = args.includes('--unfreeze')
const DRY_RUN = !CONFIRM
const reasonIdx = args.indexOf('--reason')
const REASON = reasonIdx >= 0 ? args[reasonIdx + 1] : 'Wallet frozen — suspected auto-refund abuse'
const phoneArg = args.find((a) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}/.test(a))

if (!phoneArg) {
  console.error('Usage: node scripts/freeze-wallet.cjs <phone> [--confirm] [--unfreeze] [--reason "text"]')
  process.exit(1)
}

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

const tag = DRY_RUN ? '[DRY]' : '[RUN]'
const op = UNFREEZE ? 'UNFREEZE' : 'FREEZE'

;(async () => {
  const normalized = normalizePhone(phoneArg)
  console.log(
    `\n${DRY_RUN ? 'DRY-RUN' : 'REAL RUN'} — ${op} wallet\n` +
      `  phone:  ${phoneArg} (normalized: ${normalized})\n` +
      `  reason: ${REASON}\n`,
  )

  // ── Resolve candidate uids ───────────────────────────────────────────────
  // Collect ALL candidate uids instead of taking the first hit. phoneToUid can
  // be stale (pointing to a ghost uid with no user doc), and the same phone
  // may have been recorded under multiple variants over time. We freeze every
  // non-staff doc that has either a user doc OR a wallet doc.
  const candidateUids = new Set()
  const indexSnap = await db.doc(`phoneToUid/${normalized}`).get()
  if (indexSnap.exists) {
    const mapped = indexSnap.data().uid
    if (typeof mapped === 'string' && mapped.length > 0) candidateUids.add(mapped)
  }
  const variants = [normalized, `+91${normalized}`, `91${normalized}`]
  for (const v of variants) {
    const q = await db.collection('users').where('phone', '==', v).get()
    q.forEach((d) => {
      const data = d.data()
      if (!data.role) candidateUids.add(d.id) // never touch staff wallets
    })
  }

  if (candidateUids.size === 0) {
    console.error(`ABORT: no customer uid found for phone ${phoneArg}`)
    process.exit(1)
  }

  // Filter to uids that actually have a user doc OR a wallet doc
  const targets = []
  for (const uid of candidateUids) {
    const userSnap = await db.doc(`users/${uid}`).get()
    const walletSnap = await db.doc(`users/${uid}/wallet/data`).get()
    const userData = userSnap.exists ? userSnap.data() : null
    if (userData && userData.role) continue // staff guard (defense-in-depth)
    if (!userSnap.exists && !walletSnap.exists) {
      console.log(`${tag} skip ${uid} — neither user doc nor wallet doc exists (stale index)`)
      continue
    }
    targets.push({ uid, userSnap, walletSnap })
  }

  if (targets.length === 0) {
    console.error(`ABORT: all candidate uids were empty/stale. Nothing to freeze.`)
    process.exit(1)
  }

  if (targets.length > 1) {
    console.log(`${tag} WARNING: ${targets.length} uids found for ${phoneArg}. Freezing all.`)
  }

  // Continue the single-target flow below. For multi-target, we iterate the
  // same logic per uid.
  let anyWrote = false
  for (const target of targets) {
    const { uid: userId, userSnap, walletSnap } = target
    console.log(`\n${tag} ── target: users/${userId} ──`)
    const userRef = db.doc(`users/${userId}`)
    const walletRef = db.doc(`users/${userId}/wallet/data`)
    const u = userSnap.exists ? userSnap.data() : {}
    const w = walletSnap.exists ? walletSnap.data() : {}
    const currentBalance = Number(w.balance || 0)
    const currentRootBalance = Number(u.walletBalance || 0)
    const currentlyFrozen = Boolean(u.walletFrozen)

    console.log(`${tag}   userDoc.exists:   ${userSnap.exists}`)
    console.log(`${tag}   walletDoc.exists: ${walletSnap.exists}`)
    console.log(`${tag}   name:             ${u.displayName || u.name || '(none)'}`)
    console.log(`${tag}   wallet.balance:   ₹${currentBalance}`)
    console.log(`${tag}   root walletBal:   ₹${currentRootBalance}`)
    console.log(`${tag}   walletFrozen:     ${currentlyFrozen}`)
    if (u.walletFrozenReason) console.log(`${tag}   walletFrozenReason: ${u.walletFrozenReason}`)
    if (u.walletFrozenAt) console.log(`${tag}   walletFrozenAt:     ${u.walletFrozenAt}`)

    // Per-target guards — skip rather than abort so other targets still run.
    if (u.role) {
      console.log(`${tag}   SKIP: staff doc (role=${u.role})`)
      continue
    }
    if (UNFREEZE && !currentlyFrozen) {
      console.log(`${tag}   SKIP: not currently frozen`)
      continue
    }
    if (!UNFREEZE && currentlyFrozen) {
      console.log(`${tag}   (already frozen — will re-stamp reason)`)
    }

    // Plan summary
    if (UNFREEZE) {
      console.log(`${tag}   plan: clear walletFrozen flag (balance NOT restored)`)
    } else {
      console.log(
        `${tag}   plan: zero balance (₹${currentBalance} → ₹0), set walletFrozen=true, audit log`,
      )
    }

    if (DRY_RUN) continue

    // ── Execute ──────────────────────────────────────────────────────────
    const nowIso = new Date().toISOString()
    await db.runTransaction(async (tx) => {
      if (UNFREEZE) {
        tx.set(
          userRef,
          {
            walletFrozen: admin.firestore.FieldValue.delete(),
            walletFrozenReason: admin.firestore.FieldValue.delete(),
            walletFrozenAt: admin.firestore.FieldValue.delete(),
            walletUnfrozenAt: nowIso,
            walletUnfrozenReason: REASON,
          },
          { merge: true },
        )
        return
      }

      // Zero wallet subcollection (create if missing so the flag on the
      // root doc has a matching balance record).
      tx.set(
        walletRef,
        { balance: 0, lastUpdated: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      )
      // Write/update root user doc with freeze flag. Using set-merge so this
      // works whether the user doc exists or not (ghost uid case).
      tx.set(
        userRef,
        {
          walletBalance: 0,
          walletFrozen: true,
          walletFrozenReason: REASON,
          walletFrozenAt: nowIso,
        },
        { merge: true },
      )

      // Audit — only write a debit entry if there was actually a balance.
      if (currentBalance > 0) {
        const auditId = `freeze-${Date.now()}`
        const auditRef = db.doc(`users/${userId}/wallet_transactions/${auditId}`)
        tx.set(auditRef, {
          type: 'debit',
          amount: -currentBalance,
          description: `Wallet frozen — ${REASON}`,
          source: 'freeze-wallet-script',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
    })
    anyWrote = true

    // Verify
    const [postUser, postWallet] = await Promise.all([userRef.get(), walletRef.get()])
    console.log(`${tag}   post: balance=₹${Number(postWallet.data()?.balance || 0)}  rootWalletBal=₹${Number(postUser.data()?.walletBalance || 0)}  frozen=${Boolean(postUser.data()?.walletFrozen)}`)
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes performed. Re-run with --confirm to apply.)\n')
  } else {
    console.log(
      `\n✓ ${op} complete for ${phoneArg}. ${anyWrote ? 'Wrote changes.' : 'No changes needed.'}\n`,
    )
  }
})().catch((err) => {
  console.error('\nfreeze-wallet failed:', err && err.stack ? err.stack : err)
  process.exit(1)
})

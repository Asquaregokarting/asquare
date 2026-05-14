/**
 * Find every booking ever made for a customer phone and surface
 * suspected duplicates: ones written within the same second by the
 * same writer.
 *
 * Pulls booking metadata that distinguishes legitimate repeats
 * (cashier intentionally rang the customer up twice) from a single
 * click that fanned out into N writes (bug).
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const phone = process.argv[2]
if (!phone) {
  console.error('Usage: npx tsx scripts/trace-duplicate-bookings.ts <phone10digit>')
  process.exit(1)
}

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const normalize = (p: string): string =>
  String(p ?? '')
    .replace(/\D/g, '')
    .replace(/^91/, '')
    .slice(-10)

;(async () => {
  const target = normalize(phone)
  console.log(`Searching for bookings with normalized phone "${target}"...\n`)

  // Query both customerPhone variants stored across the codebase.
  const candidatePhones = [target, `91${target}`, `+91${target}`, ` ${target} `]
  const seen = new Map<string, FirebaseFirestore.DocumentData>()
  for (const candidate of candidatePhones) {
    const snap = await db
      .collection('bookings')
      .where('customerPhone', '==', candidate.trim())
      .get()
    for (const doc of snap.docs) {
      seen.set(doc.id, { id: doc.id, ...doc.data() })
    }
  }

  console.log(`Total bookings: ${seen.size}\n`)
  if (seen.size === 0) return

  const rows = [...seen.values()].sort((a, b) =>
    String(a.transactionDate ?? a.createdAt ?? '').localeCompare(
      String(b.transactionDate ?? b.createdAt ?? ''),
    ),
  )

  console.log(
    [
      'id'.padEnd(28),
      'transactionDate'.padEnd(28),
      'createdAt'.padEnd(28),
      'source'.padEnd(18),
      'cashier'.padEnd(20),
      'amount',
    ].join('  '),
  )
  console.log('-'.repeat(150))
  for (const r of rows) {
    const created =
      r.createdAt && typeof r.createdAt === 'object' && 'toDate' in r.createdAt
        ? (r.createdAt.toDate() as Date).toISOString()
        : typeof r.createdAt === 'string'
          ? r.createdAt
          : ''
    console.log(
      [
        String(r.id).padEnd(28),
        String(r.transactionDate ?? '')
          .slice(0, 24)
          .padEnd(28),
        String(created).slice(0, 24).padEnd(28),
        String(r.source ?? '')
          .slice(0, 16)
          .padEnd(18),
        String(r.cashierName ?? r.cashierId ?? '')
          .slice(0, 18)
          .padEnd(20),
        `₹${r.finalAmount ?? r.totalAmount ?? '?'}`,
      ].join('  '),
    )
  }

  // Group by same-second + same source/cashier + same finalAmount.
  console.log('\nDuplicate clusters (same second + writer + amount):')
  const clusters = new Map<string, typeof rows>()
  for (const r of rows) {
    const txn = String(r.transactionDate ?? '').slice(0, 19) // YYYY-MM-DDTHH:MM:SS
    const key = `${txn}__${r.source ?? '?'}__${r.cashierId ?? '?'}__${r.finalAmount ?? '?'}`
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key)!.push(r)
  }
  for (const [key, list] of clusters) {
    if (list.length < 2) continue
    console.log(`\n  cluster (n=${list.length}): ${key}`)
    for (const r of list) {
      console.log(`    - ${r.id}  items=${(r.items as unknown[] | undefined)?.length ?? 0}`)
    }
  }

  // Also check for print logs.
  console.log('\nPrint log entries for these bookings:')
  for (const r of rows) {
    const printSnap = await db.collection('printLogs').where('bookingId', '==', r.id).get()
    if (!printSnap.empty) {
      console.log(`  ${r.id} → ${printSnap.size} print log(s):`)
      for (const p of printSnap.docs) {
        const pd = p.data() as Record<string, unknown>
        console.log(
          `      ${p.id}  at=${String(pd.printedAt ?? pd.createdAt ?? '?')}  by=${pd.printedBy ?? '?'}`,
        )
      }
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

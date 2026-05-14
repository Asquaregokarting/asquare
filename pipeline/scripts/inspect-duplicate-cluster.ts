/**
 * Deep-inspect the 5-duplicate cluster for 9502617044 / 2026-05-07.
 * Surface every field that can tell us:
 *   - Was the customer charged 5x or 1x?
 *   - What was in the cart (1 item or 5 items)?
 *   - Which cashier wrote them?
 *   - What did the payment side persist?
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const ids = [
  'ASG260507155215493FW8B',
  'ASG260507155215494GUOP',
  'ASG260507155215495WC70',
  'ASG2605071552154962CI0',
  'ASG2605071552154974MTW',
]

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '(null)'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object' && 'toDate' in (v as object))
    return (v as { toDate(): Date }).toDate().toISOString()
  if (Array.isArray(v)) return `[${v.length} items]`
  return JSON.stringify(v).slice(0, 80)
}

;(async () => {
  for (const id of ids) {
    const snap = await db.collection('bookings').doc(id).get()
    if (!snap.exists) {
      console.log(`${id}  NOT FOUND`)
      continue
    }
    const d = snap.data()!
    console.log(`\n══ ${id} ══`)
    const fields = [
      'orderNumber',
      'paymentMethod',
      'paymentStatus',
      'finalAmount',
      'totalAmount',
      'razorpayOrderId',
      'razorpayPaymentId',
      'cashierId',
      'cashierName',
      'createdBy',
      'submittedFromIp',
      'idempotencyKey',
      'requestId',
      'clientId',
      'sessionId',
      'branchId',
      'locationId',
      'source',
      'transactionDate',
      'createdAt',
      'updatedAt',
    ]
    for (const f of fields) {
      console.log(`  ${f.padEnd(20)} ${fmt(d[f])}`)
    }
    const items = (d.items as Array<Record<string, unknown>>) ?? []
    console.log(`  items[${items.length}]:`)
    for (const it of items) {
      console.log(
        `    - ${String(it.itemName ?? '?').padEnd(28)}  qty=${it.quantity ?? '?'}  unitPrice=${
          it.unitPrice ?? it.price ?? '?'
        }  vendorId=${it.vendorId ?? '-'}  gameId=${it.gameId ?? '-'}/${it.subGameId ?? '-'}/${
          it.variantId ?? '-'
        }`,
      )
    }
  }

  // Payment side: any Razorpay order shared between them?
  console.log('\n══ Razorpay-order overlap ══')
  const orders = new Map<string, string[]>()
  for (const id of ids) {
    const snap = await db.collection('bookings').doc(id).get()
    const d = snap.data() as Record<string, unknown>
    const ro = String(d.razorpayOrderId ?? '')
    const arr = orders.get(ro) ?? []
    arr.push(id)
    orders.set(ro, arr)
  }
  for (const [order, list] of orders) {
    console.log(`  razorpayOrderId="${order}" → ${list.length} booking(s): ${list.join(', ')}`)
  }

  // Print logs (doc id pattern guesses).
  console.log('\n══ Print logs ══')
  const printPaths = ['printLogs', 'pos_print_logs', 'tokenPrintLogs', 'posReceipts']
  for (const collection of printPaths) {
    try {
      for (const id of ids) {
        const snap = await db.collection(collection).where('bookingId', '==', id).get()
        if (!snap.empty) {
          console.log(`  ${collection}/ → ${id}: ${snap.size} entries`)
          for (const p of snap.docs) {
            const pd = p.data() as Record<string, unknown>
            console.log(`      ${p.id}  ${fmt(pd.createdAt)}  by=${pd.printedBy ?? '?'}`)
          }
        }
      }
    } catch (err) {
      console.log(`  (${collection} not queryable: ${(err as Error).message})`)
    }
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

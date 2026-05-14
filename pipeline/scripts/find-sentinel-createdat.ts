/**
 * Forensic scan: find every bookings/{id} doc whose `createdAt` is the
 * literal Web SDK `serverTimestamp()` sentinel serialized to plain data
 * (`{_methodName: 'serverTimestamp'}`) instead of a real Timestamp.
 * This is the "createdAt: 1970-01-01" surface symptom.
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
  console.error('No service account key.')
  process.exit(1)
}
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(k, 'utf-8'))) })
const db = getFirestore('asquare-app-db')

;(async () => {
  console.log('Scanning bookings for sentinel-shape createdAt…')
  const snap = await db.collection('bookings').limit(20000).get()
  console.log(`Total bookings scanned: ${snap.size}`)

  const corrupt: Array<{
    id: string
    createdBy?: string
    transactionDate?: string
    paymentMethod?: string
    source?: string
    sourceType?: string
  }> = []

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>
    const c = data.createdAt
    // Sentinel-shape detection: plain object with `_methodName` and no
    // toDate(), no _seconds. Real Firestore Timestamps have both.
    if (
      c &&
      typeof c === 'object' &&
      !Array.isArray(c) &&
      typeof (c as { toDate?: unknown }).toDate !== 'function' &&
      !('_seconds' in c) &&
      '_methodName' in c
    ) {
      corrupt.push({
        id: d.id,
        createdBy: String(data.createdBy ?? ''),
        transactionDate: String(data.transactionDate ?? ''),
        paymentMethod: String(data.paymentMethod ?? ''),
        source: String(data.source ?? ''),
        sourceType: String(data.sourceType ?? ''),
      })
    }
  }

  console.log(`\nCorrupt bookings: ${corrupt.length}`)
  if (corrupt.length === 0) return
  for (const c of corrupt) {
    console.log(
      `  ${c.id}  src=${c.source}/${c.sourceType}  pay=${c.paymentMethod}  createdBy=${c.createdBy}  txn=${c.transactionDate}`,
    )
  }

  // Group by source / paymentMethod / createdBy to spot a pattern
  const bySource = new Map<string, number>()
  const byMethod = new Map<string, number>()
  const byCreator = new Map<string, number>()
  for (const c of corrupt) {
    const sk = `${c.source}/${c.sourceType}`
    bySource.set(sk, (bySource.get(sk) ?? 0) + 1)
    byMethod.set(c.paymentMethod ?? '', (byMethod.get(c.paymentMethod ?? '') ?? 0) + 1)
    byCreator.set(c.createdBy ?? '', (byCreator.get(c.createdBy ?? '') ?? 0) + 1)
  }
  console.log('\nBy source:')
  for (const [k, v] of bySource) console.log(`  ${k}: ${v}`)
  console.log('\nBy paymentMethod:')
  for (const [k, v] of byMethod) console.log(`  ${k}: ${v}`)
  console.log('\nBy createdBy:')
  for (const [k, v] of byCreator) console.log(`  ${k}: ${v}`)

  // Group by transaction date (first 10 chars)
  const byDate = new Map<string, number>()
  for (const c of corrupt) {
    const day = (c.transactionDate ?? '').slice(0, 10)
    byDate.set(day, (byDate.get(day) ?? 0) + 1)
  }
  console.log('\nBy transaction date:')
  for (const [k, v] of [...byDate.entries()].sort()) console.log(`  ${k}: ${v}`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * Diagnose the customer-app vs admin-module verified-flag mismatch
 * for phone 9985590477. Reads:
 *   - phoneToUid/{phone} → canonical uid
 *   - users/* where phone fields match this number → list every doc
 *   - users/{canonicalUid} → the doc the auth context should resolve to
 *
 * Output should reveal whether admin and the customer-app are looking
 * at different user documents for the same phone.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import * as path from 'path'
import * as fs from 'fs'

const PHONE = '9985590477'

const keyPath = path.resolve('serviceAccountKey.json')
if (getApps().length === 0)
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) })
const db = getFirestore('asquare-app-db') as Firestore

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '(none)'
  if (typeof v === 'object' && 'toDate' in (v as object)) {
    try {
      return (v as { toDate(): Date }).toDate().toISOString()
    } catch {
      return '(invalid)'
    }
  }
  return JSON.stringify(v)
}

;(async () => {
  console.log(`Phone: ${PHONE}\n`)

  // 1. phoneToUid lookup — the canonical mapping.
  const variants = [PHONE, `91${PHONE}`, `+91${PHONE}`]
  console.log('═'.repeat(60))
  console.log('phoneToUid/* lookups (every variant)')
  console.log('═'.repeat(60))
  for (const v of variants) {
    const snap = await db.collection('phoneToUid').doc(v).get()
    if (snap.exists) {
      const d = snap.data()!
      console.log(
        `  ${v}  →  uid=${d.uid}  source=${d.source ?? '?'}  createdAt=${fmt(d.createdAt)}`,
      )
    } else {
      console.log(`  ${v}  →  (not found)`)
    }
  }

  // 2. Direct scan: every users/* whose phone field matches the number.
  console.log()
  console.log('═'.repeat(60))
  console.log('users/* docs whose phone field matches the number')
  console.log('═'.repeat(60))
  const phoneFields = ['phone', 'phoneNumber', 'mobile', 'userPhone']
  const seenUids = new Set<string>()
  for (const field of phoneFields) {
    for (const v of variants) {
      const snap = await db.collection('users').where(field, '==', v).get()
      for (const d of snap.docs) {
        if (seenUids.has(d.id)) continue
        seenUids.add(d.id)
        const data = d.data()
        console.log(
          `  ${d.id}  via ${field}=${v}  isVerified=${fmt(data.isVerified)}  displayName=${data.displayName ?? data.name ?? '?'}  createdAt=${fmt(data.createdAt)}  lastLoginAt=${fmt(data.lastLoginAt)}`,
        )
      }
    }
  }
  if (seenUids.size === 0) {
    console.log('  (no users/* docs found by phone field — admin lookup must use a different path)')
  }
  console.log(`\nTotal distinct uids: ${seenUids.size}`)

  // 3. Authoritative phoneToUid → users/{uid} read (matches what AuthContext does).
  console.log()
  console.log('═'.repeat(60))
  console.log('users/{phoneToUid.uid}.isVerified — what AuthContext sees')
  console.log('═'.repeat(60))
  for (const v of variants) {
    const ptu = await db.collection('phoneToUid').doc(v).get()
    if (!ptu.exists) continue
    const uid = String((ptu.data() ?? {}).uid ?? '')
    if (!uid) continue
    const u = await db.collection('users').doc(uid).get()
    if (!u.exists) {
      console.log(`  ${v}  →  uid=${uid}  USER DOC MISSING`)
      continue
    }
    const data = u.data()!
    console.log(
      `  ${v}  →  uid=${uid}  isVerified=${fmt(data.isVerified)}  displayName=${data.displayName ?? data.name ?? '?'}`,
    )
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

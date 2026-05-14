import { initializeApp } from 'firebase/app'
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from 'firebase/auth'
import { getFirestore, initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { Capacitor } from '@capacitor/core'
import { logger } from './logger'

const firebaseEnv = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  VITE_FIREBASE_MEASUREMENT_ID: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const requiredFirebaseEnvKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const

const missingFirebaseEnvKeys = requiredFirebaseEnvKeys.filter((key) => !firebaseEnv[key]?.trim())

if (missingFirebaseEnvKeys.length > 0) {
  const message = `Missing required Firebase environment variable(s): ${missingFirebaseEnvKeys.join(', ')}`
  logger.error('firebase.missing_env', undefined, { message })
  throw new Error(message)
}

const firebaseConfig = {
  apiKey: firebaseEnv.VITE_FIREBASE_API_KEY,
  authDomain: firebaseEnv.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: firebaseEnv.VITE_FIREBASE_PROJECT_ID,
  storageBucket: firebaseEnv.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: firebaseEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: firebaseEnv.VITE_FIREBASE_APP_ID,
  measurementId: firebaseEnv.VITE_FIREBASE_MEASUREMENT_ID || '',
}

const app = initializeApp(firebaseConfig)
export { app as firebaseApp }
export const auth = getAuth(app)

// Use IndexedDB persistence for mobile (more reliable when app is killed)
// Fall back to browserLocalPersistence for web
if (typeof window !== 'undefined') {
  const isNative = Capacitor.isNativePlatform()
  const persistence = isNative ? indexedDBLocalPersistence : browserLocalPersistence

  setPersistence(auth, persistence).catch((err) => {
    logger.error('firebase.auth_persistence_failed', err)
    // Try fallback persistence if IndexedDB fails
    if (isNative) {
      setPersistence(auth, browserLocalPersistence).catch((fallbackErr) => {
        logger.error('firebase.auth_persistence_fallback_failed', fallbackErr)
      })
    }
  })
}

// Stop-gap for `INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9 / b815)`.
// Forcing long-polling bypasses the WebSocket watch-stream aggregator that
// trips the assertion under heavy listener churn + StrictMode + multi-tab.
// Trade-off: a few hundred ms more per query. Revisit once we unify the dual
// Firestore init paths and audit onSnapshot cleanups.
//
// initializeFirestore must be the FIRST call against this app+database. If
// another path beat us (e.g. pipeline's lazy init ran first in pipeline mode)
// the call throws — fall back to plain getFirestore which returns whichever
// instance already exists.
let dbInstance
try {
  dbInstance = initializeFirestore(app, { experimentalForceLongPolling: true }, 'asquare-app-db')
} catch (err) {
  logger.warn('firebase.long_polling_init_skipped', {
    reason: err instanceof Error ? err.message : String(err),
  })
  dbInstance = getFirestore(app, 'asquare-app-db')
}
export const db = dbInstance
export const storage = getStorage(app)

// Dev-only debug helper. Exposes the firestore instance + a handful of
// inspection helpers on `window.__asquare` so console one-liners work
// without bare-specifier imports (Vite dev doesn't resolve `firebase/*`
// at runtime in the browser console).
//
// Usage in DevTools console:
//   await window.__asquare.inspect('BOOKING_ID', 'VENDOR_ID')
//
// Stripped from production builds via the import.meta.env.DEV gate so
// no debug surface ships to customers.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  void (async () => {
    const fs = await import('firebase/firestore')
    type LedgerDoc = {
      id: string
      type?: string
      amount?: number
      date?: string
      source?: string
      note?: string
    }
    const w = window as unknown as Record<string, unknown>
    w.__asquare = {
      db,
      firestore: fs,
      /**
       * Backfill `transactionDate` on a single booking from its
       * `createdAt`. Only writes when transactionDate is missing —
       * never overwrites an existing value. Used to unstick
       * bookings created by paths that didn't set the field, which
       * makes them invisible to invoice regen.
       */
      /**
       * Delete a single vendorLedger doc by ID. Refuses to delete
       * canonical `le-{bid}-{vid}` rows from the trigger / Re-attribute
       * unless `force: true` is passed — those are the source of truth
       * for the booking's credit and are normally what we want to keep.
       * Safe by default; surfaces what would be deleted before doing it.
       */
      async deleteLedger(docId: string, opts: { force?: boolean } = {}) {
        if (!docId) return { ok: false, reason: 'missing-docId' }
        const isCanonical = /^le-[^-]+-[^-]+$/.test(docId)
        if (isCanonical && !opts.force) {
          return {
            ok: false,
            reason:
              `${docId} is a canonical le-{bid}-{vid} row from the trigger / Re-attribute. ` +
              `Pass { force: true } to delete it. Usually you want to delete the duplicate ` +
              `lc-manual-{bid}-{vid} or lc-reconcile-{bid}-{vid}-{ts} row instead.`,
          }
        }
        const ref = fs.doc(db, 'vendorLedger', docId)
        const snap = await fs.getDoc(ref)
        if (!snap.exists()) return { ok: false, reason: 'not-found' }
        const data = snap.data() as LedgerDoc
        await fs.deleteDoc(ref)
        console.log(`Deleted ${docId} (${data.type} · ${data.amount} · ${data.source ?? '?'})`)
        return { ok: true, deleted: { docId, ...data } }
      },
      /**
       * Sweep a list of bookings: for each (booking, vendor) pair,
       * if every billingItem for that vendor is `refunded: true`
       * AND a `lc-manual-{bid}-{vid}` ledger row exists, delete the
       * row. Vendor truth is 0 for fully-refunded items so the manual
       * credit is the wrong fix.
       *
       * Reports per-booking summary and totals. Skips when the
       * vendor still has any non-refunded items (real money is
       * owed) — never deletes those.
       */
      async cleanRefundedManualFix(bookingIds: string[]) {
        const summary: Array<{
          bookingId: string
          deletes: Array<{ docId: string; amount: number; vendorId: string }>
          skipped: Array<{ vendorId: string; reason: string }>
        }> = []
        let totalDeleted = 0
        let totalAmount = 0
        for (const bid of bookingIds) {
          const bSnap = await fs.getDoc(fs.doc(db, 'bookings', bid))
          if (!bSnap.exists()) {
            summary.push({
              bookingId: bid,
              deletes: [],
              skipped: [{ vendorId: '*', reason: 'booking-not-found' }],
            })
            continue
          }
          const data = bSnap.data() as Record<string, unknown>
          const billing = Array.isArray(data.billingItems)
            ? (data.billingItems as Array<Record<string, unknown>>)
            : []
          const vendorIds = Array.isArray(data.vendorIds)
            ? (data.vendorIds as unknown[]).map(String)
            : []
          const perBooking = {
            bookingId: bid,
            deletes: [] as Array<{
              docId: string
              amount: number
              vendorId: string
            }>,
            skipped: [] as Array<{ vendorId: string; reason: string }>,
          }
          for (const vid of vendorIds) {
            const vendorItems = billing.filter((bi) => bi.vendorId === vid)
            if (vendorItems.length === 0) {
              perBooking.skipped.push({
                vendorId: vid,
                reason: 'no-billing-items-for-vendor',
              })
              continue
            }
            const allRefunded = vendorItems.every((bi) => bi.refunded === true)
            if (!allRefunded) {
              perBooking.skipped.push({
                vendorId: vid,
                reason: 'has-non-refunded-items (real money owed)',
              })
              continue
            }
            const docId = `lc-manual-${bid}-${vid}`
            const lcSnap = await fs.getDoc(fs.doc(db, 'vendorLedger', docId))
            if (!lcSnap.exists()) {
              perBooking.skipped.push({
                vendorId: vid,
                reason: 'no-lc-manual-row-to-delete',
              })
              continue
            }
            const lcData = lcSnap.data() as LedgerDoc
            const amt = Number(lcData.amount) || 0
            await fs.deleteDoc(fs.doc(db, 'vendorLedger', docId))
            perBooking.deletes.push({
              docId,
              amount: amt,
              vendorId: vid,
            })
            totalDeleted += 1
            totalAmount += amt
          }
          summary.push(perBooking)
        }
        console.log('=== cleanRefundedManualFix summary ===')
        console.log(JSON.stringify(summary, null, 2))
        console.log(
          `Deleted ${totalDeleted} row(s) totalling INR ${totalAmount.toLocaleString('en-IN')}.`,
        )
        return { totalDeleted, totalAmount, summary }
      },
      /**
       * Carry-forward correction for a locked period. Use when a
       * vendor was over- or under-paid on a settled invoice and you
       * can't regenerate the locked period.
       *
       * `amount` is signed:
       *   + N → vendor was overpaid by N (debit on next cheque)
       *   − N → vendor was underpaid by N (credit on next cheque)
       *
       * Lands in the current pending period so the next cheque
       * absorbs the correction. The locked invoice is untouched.
       *
       * Example:
       *   await window.__asquare.carryForward({
       *     bookingId: 'ASG260411162943347BX94',
       *     vendorId: '7777997226',
       *     amount: 73,            // overpaid 73 last week
       *     lockedPeriodStart: '2026-04-04',
       *     reason: 'Refunded items wrongly credited via manual_adjustment'
       *   })
       */
      async carryForward(input: {
        bookingId: string
        vendorId: string
        amount: number
        lockedPeriodStart: string
        reason: string
      }) {
        const session = JSON.parse(
          localStorage.getItem('asquare:pipeline-session') ??
            localStorage.getItem('pipeline:session') ??
            '{}',
        )
        const userId = session?.user?.id || session?.user?.uid || session?.user?.email || 'unknown'
        const userName = session?.user?.name || 'Unknown'
        const recon = await import('../pipeline/api/reconciliation-firestore')
        const result = await recon.applySettlementCorrection({
          ...input,
          resolvedBy: { id: userId, name: userName },
        })
        console.log(
          `[carryForward] wrote ${result.type} ${result.docId} (period ${result.appliedToPeriod})`,
        )
        return result
      },
      /**
       * Sweep + recover for the refunded-item overpayment pattern
       * across a batch of bookings. For each (booking, vendor) where:
       *   - every billingItem for that vendor is `refunded: true`, AND
       *   - a `lc-manual-{bid}-{vid}` ledger row exists,
       * the helper:
       *   1. Deletes the wrong manual_adjustment.
       *   2. Writes a carry-forward DEBIT of the same amount in the
       *      current pending period (recovers the overpayment from
       *      the next cheque).
       *
       * Both the locked period invoice and the cheque already paid
       * stay untouched — only future payouts are reduced.
       *
       * Usage:
       *   await window.__asquare.recoverOverpaidRefunds(
       *     ['ASG...', 'ASG...', ...],   // can be 1 or 600
       *     '2026-04-04',                // locked period the bookings were in
       *     { dryRun: false }            // preview-only when true
       *   )
       */
      async recoverOverpaidRefunds(
        bookingIds: string[],
        lockedPeriodStart: string,
        opts: { dryRun?: boolean } = {},
      ) {
        const dryRun = opts.dryRun === true
        const session = JSON.parse(
          localStorage.getItem('asquare:pipeline-session') ??
            localStorage.getItem('pipeline:session') ??
            '{}',
        )
        const userId = session?.user?.id || session?.user?.uid || session?.user?.email || 'unknown'
        const userName = session?.user?.name || 'Unknown'
        const resolvedBy = { id: userId, name: userName }
        const recon = await import('../pipeline/api/reconciliation-firestore')

        const planned: Array<{
          bookingId: string
          vendorId: string
          amount: number
        }> = []
        const skipped: Array<{ bookingId: string; reason: string }> = []

        for (const bid of bookingIds) {
          const bSnap = await fs.getDoc(fs.doc(db, 'bookings', bid))
          if (!bSnap.exists()) {
            skipped.push({ bookingId: bid, reason: 'booking-not-found' })
            continue
          }
          const data = bSnap.data() as Record<string, unknown>
          const billing = Array.isArray(data.billingItems)
            ? (data.billingItems as Array<Record<string, unknown>>)
            : []
          const vendorIds = Array.isArray(data.vendorIds)
            ? (data.vendorIds as unknown[]).map(String)
            : []
          for (const vid of vendorIds) {
            const items = billing.filter((bi) => bi.vendorId === vid)
            if (items.length === 0) continue
            const allRefunded = items.every((bi) => bi.refunded === true)
            if (!allRefunded) continue
            const docId = `lc-manual-${bid}-${vid}`
            const lcSnap = await fs.getDoc(fs.doc(db, 'vendorLedger', docId))
            if (!lcSnap.exists()) continue
            const amt = Number((lcSnap.data() as LedgerDoc).amount ?? 0)
            if (amt <= 0) continue
            planned.push({ bookingId: bid, vendorId: vid, amount: amt })
          }
        }

        const totalAmount = planned.reduce((s, p) => s + p.amount, 0)
        const perVendor: Record<string, number> = {}
        for (const p of planned) {
          perVendor[p.vendorId] = (perVendor[p.vendorId] ?? 0) + p.amount
        }

        console.log('=== recoverOverpaidRefunds plan ===')
        console.log(
          `${planned.length} (booking, vendor) pair(s) · INR ${totalAmount.toLocaleString('en-IN')} to recover · skipped ${skipped.length}`,
        )
        console.log('Per-vendor recovery:')
        for (const [vid, amt] of Object.entries(perVendor)) {
          console.log(`  ${vid.padEnd(14)}  INR ${amt.toLocaleString('en-IN').padStart(10)}`)
        }
        if (dryRun) {
          console.log('Dry run — no writes. Re-run with { dryRun: false } to apply.')
          return { dryRun: true, planned, perVendor, totalAmount, skipped }
        }

        let applied = 0
        const failed: Array<{
          bookingId: string
          vendorId: string
          error: string
        }> = []
        for (const row of planned) {
          try {
            await fs.deleteDoc(
              fs.doc(db, 'vendorLedger', `lc-manual-${row.bookingId}-${row.vendorId}`),
            )
            await recon.applySettlementCorrection({
              bookingId: row.bookingId,
              vendorId: row.vendorId,
              amount: row.amount,
              lockedPeriodStart,
              reason: `Refunded items wrongly credited via manual_adjustment in audit Reconcile-to-truth path; locked invoice for ${lockedPeriodStart} paid extra ${row.amount}`,
              resolvedBy,
            })
            applied += 1
          } catch (err) {
            failed.push({
              bookingId: row.bookingId,
              vendorId: row.vendorId,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }
        console.log(
          `Applied ${applied}/${planned.length}; failed ${failed.length}; recovered INR ${totalAmount.toLocaleString('en-IN')}`,
        )
        if (failed.length > 0) console.log('Failures:', failed)
        return { dryRun: false, planned, perVendor, totalAmount, applied, failed }
      },
      /**
       * Period-level drift sweep on a LOCKED period. For every
       * locked vendor invoice in the period, computes:
       *   paidAmount  = invoice.totalAmount
       *   truthAmount = Σ non-refunded billingItems[].vendorTotal
       *   drift       = paidAmount − truthAmount
       *
       * Returns a per-vendor breakdown. Pure read — no writes.
       * Pair with `applyLockedSweep` to apply as carry-forwards.
       *
       * Use case: discover all over/underpayments across an entire
       * locked week without manually inspecting each booking.
       *
       * Usage:
       *   await window.__asquare.sweepLocked('2026-04-04')
       */
      /**
       * Sweep EVERY locked period in the vendorInvoices collection
       * for drift. Returns a per-period, per-vendor breakdown plus
       * grand totals. Pure read — no writes.
       *
       * Use when you don't know which bookings are wrong and want
       * the system to find them all. Pair with `applyAllLockedSweeps`
       * to apply every period's carry-forward in one go.
       *
       * Usage:
       *   const all = await window.__asquare.sweepAllLocked()
       *   // Inspect, then:
       *   await window.__asquare.applyAllLockedSweeps(all, { dryRun: true })
       *   await window.__asquare.applyAllLockedSweeps(all, { dryRun: false })
       */
      async sweepAllLocked() {
        const recon = await import('../pipeline/api/reconciliation-firestore')
        // Find every locked period.
        const invSnap = await fs.getDocs(
          fs.query(fs.collection(db, 'vendorInvoices'), fs.where('status', '==', 'locked')),
        )
        const periodStarts = new Set<string>()
        invSnap.forEach((d) => {
          const data = d.data() as Record<string, unknown>
          const ps = String(data.periodStart ?? '').trim()
          if (ps) periodStarts.add(ps)
        })
        const sortedPeriods = [...periodStarts].sort()
        console.log(`Scanning ${sortedPeriods.length} locked period(s)…`)

        type PeriodResult = {
          periodStart: string
          rows: Awaited<ReturnType<typeof recon.detectLockedPeriodDrift>>
        }
        const allResults: PeriodResult[] = []
        let totalOverpaid = 0
        let totalUnderpaid = 0
        let totalVendors = 0
        let totalBookings = 0
        const bookingsTouched = new Set<string>()
        for (const ps of sortedPeriods) {
          const rows = await recon.detectLockedPeriodDrift(ps)
          if (rows.length === 0) continue
          allResults.push({ periodStart: ps, rows })
          totalVendors += rows.length
          for (const r of rows) {
            if (r.drift > 0) totalOverpaid += r.drift
            else totalUnderpaid += Math.abs(r.drift)
            for (const bid of r.bookingsTouched) bookingsTouched.add(bid)
            totalBookings += r.bookingsTouched.length
          }
        }

        console.log('=== Multi-period locked-drift sweep ===')
        console.log(
          `${allResults.length} period(s) with drift · ${totalVendors} (period, vendor) row(s)`,
        )
        console.log(
          `Bookings touched: ${bookingsTouched.size} unique · ${totalBookings} total references`,
        )
        console.log(
          `INR ${totalOverpaid.toLocaleString('en-IN')} overpaid · INR ${totalUnderpaid.toLocaleString('en-IN')} underpaid · NET INR ${(totalOverpaid - totalUnderpaid).toLocaleString('en-IN')} recoverable`,
        )
        for (const pr of allResults) {
          console.log(`\n--- ${pr.periodStart} ---`)
          console.table(
            pr.rows.map((r) => ({
              vendor: r.vendorId,
              paid: r.paidAmount,
              truth: r.truthAmount,
              drift: r.drift,
              bookings: r.bookingsTouched.length,
            })),
          )
        }
        return allResults
      },
      /**
       * Apply every period's carry-forward correction from a
       * `sweepAllLocked` result. One ledger row per (vendor, period).
       *
       * Defaults to dry-run for safety — pass `{ dryRun: false }` to
       * actually write. Locked invoices and prior cheques are never
       * touched; corrections land in the current pending period.
       */
      async applyAllLockedSweeps(
        allResults: Array<{
          periodStart: string
          rows: Awaited<
            ReturnType<
              (typeof import('../pipeline/api/reconciliation-firestore'))['detectLockedPeriodDrift']
            >
          >
        }>,
        opts: { dryRun?: boolean; pendingPeriodStart?: string } = {},
      ) {
        const dryRun = opts.dryRun !== false
        let totalRecovered = 0
        let totalToppedUp = 0
        for (const pr of allResults) {
          for (const r of pr.rows) {
            if (r.drift > 0) totalRecovered += r.drift
            else totalToppedUp += Math.abs(r.drift)
          }
        }
        const planCount = allResults.reduce((s, p) => s + p.rows.length, 0)
        console.log(
          `Plan: ${allResults.length} period(s), ${planCount} carry-forward correction(s)`,
        )
        console.log(`  Recover: INR ${totalRecovered.toLocaleString('en-IN')}`)
        console.log(`  Top up:  INR ${totalToppedUp.toLocaleString('en-IN')}`)
        if (dryRun) {
          console.log('Dry run (default) — no writes. Re-run with { dryRun: false } to apply.')
          return { dryRun: true }
        }

        // Compute current pending period start. Caller may override
        // (useful when the audit chart was framed against a specific
        // period start, e.g. running this against a Saturday cutover).
        // Default: today, snapped to the previous Saturday — same logic
        // as accounting-firestore.getPeriodStart.
        const computeCurrentPeriodStart = () => {
          const d = new Date()
          // Saturday = 6; for any other day, walk back to last Saturday.
          const day = d.getDay()
          const back = (day - 6 + 7) % 7
          d.setDate(d.getDate() - back)
          const yyyy = d.getFullYear()
          const mm = String(d.getMonth() + 1).padStart(2, '0')
          const dd = String(d.getDate()).padStart(2, '0')
          return `${yyyy}-${mm}-${dd}`
        }
        const periodStart = opts.pendingPeriodStart || computeCurrentPeriodStart()
        console.log(`Writing carry-forwards dated to ${periodStart}…`)

        const session = JSON.parse(
          localStorage.getItem('asquare:pipeline-session') ??
            localStorage.getItem('pipeline:session') ??
            '{}',
        )
        const userId = session?.user?.id || session?.user?.uid || session?.user?.email || 'unknown'
        const userName = session?.user?.name || 'Unknown'

        let totalApplied = 0
        const failed: Array<{
          periodStart: string
          vendorId: string
          error: string
        }> = []
        const dateIso = `${periodStart}T12:00:00.000Z`
        const nowIso = new Date().toISOString()

        // Direct SDK writes — bypass applySettlementCorrection
        // (which silently dropped writes in this session due to a
        // Firestore-instance mismatch). One ledger row per
        // (period, vendor) pair, written to the same `db` the
        // window helper uses for reads, so persistence is
        // guaranteed.
        for (const pr of allResults) {
          for (const row of pr.rows) {
            try {
              const ts = Date.now() + Math.floor(Math.random() * 1000)
              const isOver = row.drift > 0
              const type = isOver ? 'debit' : 'credit'
              const prefix = isOver ? 'ld-settlement' : 'lc-settlement'
              const docId = `${prefix}-${row.bookingsTouched[0] ?? `period-${pr.periodStart}`}-${row.vendorId}-${ts}`
              const amount = Math.abs(row.drift)
              await fs.setDoc(fs.doc(db, 'vendorLedger', docId), {
                id: docId,
                vendorId: row.vendorId,
                amount,
                vendorBase: amount,
                vendorGst: 0,
                type,
                source: 'settlement-correction',
                referenceId: row.bookingsTouched[0] ?? `period-${pr.periodStart}`,
                invoiceNumber: row.bookingsTouched[0] ?? `period-${pr.periodStart}`,
                locationId: '',
                date: dateIso,
                createdAt: nowIso,
                note:
                  `Period sweep — paid ${row.paidAmount}, truth ${row.truthAmount}, drift ${row.drift}. ` +
                  `Touches ${row.bookingsTouched.length} booking(s): ${row.bookingsTouched.slice(0, 5).join(', ')}` +
                  (row.bookingsTouched.length > 5
                    ? `, +${row.bookingsTouched.length - 5} more`
                    : ''),
                lockedPeriodStart: pr.periodStart,
                appliedToPeriod: periodStart,
                resolvedBy: userId,
                resolvedByName: userName,
              })
              totalApplied += 1
            } catch (err) {
              failed.push({
                periodStart: pr.periodStart,
                vendorId: row.vendorId,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
        }
        console.log(
          `Applied ${totalApplied}/${planCount} correction(s) across ${allResults.length} period(s)`,
        )
        if (failed.length > 0) console.log('Failures:', failed)
        return {
          dryRun: false,
          totalApplied,
          totalRecovered,
          totalToppedUp,
          failed,
        }
      },
      async sweepLocked(periodStart: string) {
        const recon = await import('../pipeline/api/reconciliation-firestore')
        const rows = await recon.detectLockedPeriodDrift(periodStart)
        let overpaid = 0
        let underpaid = 0
        for (const r of rows) {
          if (r.drift > 0) overpaid += r.drift
          else underpaid += Math.abs(r.drift)
        }
        console.log(`=== Locked period drift · ${periodStart} ===`)
        console.log(
          `${rows.length} vendor row(s) with drift > ₹2 · INR ${overpaid.toLocaleString('en-IN')} overpaid · INR ${underpaid.toLocaleString('en-IN')} underpaid`,
        )
        console.table(
          rows.map((r) => ({
            vendor: r.vendorId,
            paid: r.paidAmount,
            truth: r.truthAmount,
            drift: r.drift,
            bookings: r.bookingsTouched.length,
          })),
        )
        return rows
      },
      /**
       * Apply a sweep as carry-forward corrections. Pass the rows
       * returned by `sweepLocked`. Writes ONE ledger row per vendor,
       * dated to the current pending period — over/underpayments
       * absorb into the next cheque cycle.
       *
       * Locked invoice + already-cut cheques are NEVER touched.
       *
       * Usage:
       *   const rows = await window.__asquare.sweepLocked('2026-04-04')
       *   await window.__asquare.applyLockedSweep(rows, '2026-04-04')
       */
      async applyLockedSweep(
        rows: Awaited<
          ReturnType<
            (typeof import('../pipeline/api/reconciliation-firestore'))['detectLockedPeriodDrift']
          >
        >,
        lockedPeriodStart: string,
        opts: { dryRun?: boolean } = {},
      ) {
        if (rows.length === 0) {
          console.log('No drift rows to apply.')
          return { applied: 0, failed: [] }
        }
        const dryRun = opts.dryRun === true
        const totalOver = rows.filter((r) => r.drift > 0).reduce((s, r) => s + r.drift, 0)
        const totalUnder = rows
          .filter((r) => r.drift < 0)
          .reduce((s, r) => s + Math.abs(r.drift), 0)
        console.log(
          `Plan: ${rows.length} carry-forward correction(s) for locked period ${lockedPeriodStart}`,
        )
        console.log(`  Recover (overpayment debits): INR ${totalOver.toLocaleString('en-IN')}`)
        console.log(`  Top up (underpayment credits): INR ${totalUnder.toLocaleString('en-IN')}`)
        if (dryRun) {
          console.log('Dry run — no writes. Re-run with { dryRun: false } to apply.')
          return { dryRun: true, planned: rows }
        }
        const session = JSON.parse(
          localStorage.getItem('asquare:pipeline-session') ??
            localStorage.getItem('pipeline:session') ??
            '{}',
        )
        const resolvedBy = {
          id: session?.user?.id || session?.user?.uid || session?.user?.email || 'unknown',
          name: session?.user?.name || 'Unknown',
        }
        const recon = await import('../pipeline/api/reconciliation-firestore')
        const r = await recon.applyLockedPeriodCarryForward(rows, lockedPeriodStart, resolvedBy)
        console.log(
          `Applied ${r.applied}/${rows.length} · recovered INR ${r.totalRecovered.toLocaleString('en-IN')} · topped up INR ${r.totalToppedUp.toLocaleString('en-IN')}`,
        )
        if (r.failed.length > 0) console.log('Failures:', r.failed)
        return r
      },
      async backfillTxnDate(bookingId: string) {
        const ref = fs.doc(db, 'bookings', bookingId)
        const snap = await fs.getDoc(ref)
        if (!snap.exists()) {
          console.warn('Booking not found:', bookingId)
          return { ok: false, reason: 'booking-not-found' }
        }
        const data = snap.data() as Record<string, unknown>
        if (typeof data.transactionDate === 'string' && data.transactionDate) {
          return {
            ok: true,
            skipped: true,
            existing: data.transactionDate,
          }
        }
        const ca = data.createdAt as { seconds?: number } | string | undefined
        let iso: string | null = null
        if (typeof ca === 'string') iso = ca
        else if (ca && typeof ca === 'object' && typeof ca.seconds === 'number') {
          iso = new Date(ca.seconds * 1000).toISOString()
        }
        if (!iso) {
          console.warn('Cannot derive transactionDate for', bookingId)
          return { ok: false, reason: 'no-createdAt' }
        }
        await fs.updateDoc(ref, { transactionDate: iso })
        console.log(`Backfilled transactionDate=${iso} on booking ${bookingId}`)
        return { ok: true, transactionDate: iso }
      },
      async inspect(bookingId: string, vendorId: string) {
        const bSnap = await fs.getDoc(fs.doc(db, 'bookings', bookingId))
        const lcSnap = await fs.getDoc(
          fs.doc(db, 'vendorLedger', `lc-manual-${bookingId}-${vendorId}`),
        )
        const leSnap = await fs.getDoc(fs.doc(db, 'vendorLedger', `le-${bookingId}-${vendorId}`))
        const allLedger = await fs.getDocs(
          fs.query(
            fs.collection(db, 'vendorLedger'),
            fs.where('referenceId', '==', bookingId),
            fs.where('vendorId', '==', vendorId),
          ),
        )
        const bd = bSnap.exists() ? (bSnap.data() as Record<string, unknown>) : {}
        const billing = Array.isArray(bd.billingItems)
          ? (bd.billingItems as Array<Record<string, unknown>>).filter(
              (i) => i.vendorId === vendorId,
            )
          : []
        const itemsRaw = Array.isArray(bd.items) ? (bd.items as Array<Record<string, unknown>>) : []
        const billingRaw = Array.isArray(bd.billingItems)
          ? (bd.billingItems as Array<Record<string, unknown>>)
          : []
        const result = {
          bookingId,
          vendorId,
          booking: {
            exists: bSnap.exists(),
            paymentStatus: bd.paymentStatus,
            refundStatus: bd.refundStatus,
            cancelled: bd.cancelled,
            transactionDate: bd.transactionDate,
            transactionDateMissing: bd.transactionDate === undefined,
            createdAt: bd.createdAt,
            locationId: bd.locationId,
            vendorIds: bd.vendorIds,
            topLevelVendorId: bd.vendorId,
            itemsCount: itemsRaw.length,
            billingItemsCount: billingRaw.length,
            itemsRaw: itemsRaw.map((i) => ({
              itemName: i.itemName,
              vendorId: i.vendorId,
              quantity: i.quantity,
              unitPrice: i.unitPrice ?? i.price,
              vendorBase: i.vendorBase,
              vendorTotal: i.vendorTotal,
              refunded: i.refunded === true,
            })),
            billingItemsRaw: billingRaw.map((i) => ({
              itemName: i.itemName,
              vendorId: i.vendorId,
              quantity: i.quantity,
              unitPrice: i.unitPrice ?? i.price,
              vendorBase: i.vendorBase,
              vendorGst: i.vendorGst,
              vendorTotal: i.vendorTotal,
              refunded: i.refunded === true,
            })),
            matchingBillingItems: billing.map((bi) => ({
              itemName: bi.itemName,
              quantity: bi.quantity,
              unitPrice: bi.unitPrice,
              vendorBase: bi.vendorBase,
              vendorGst: bi.vendorGst,
              vendorTotal: bi.vendorTotal,
              refunded: bi.refunded === true,
            })),
          },
          ledgerByDocId: {
            lcManual: lcSnap.exists() ? (lcSnap.data() as LedgerDoc) : null,
            leDirect: leSnap.exists() ? (leSnap.data() as LedgerDoc) : null,
          },
          allLedgerEntriesForPair: allLedger.docs.map((d) => {
            const data = d.data() as Record<string, unknown>
            return {
              id: d.id,
              type: data.type,
              amount: data.amount,
              date: data.date,
              source: data.source,
              note: data.note,
            }
          }),
        }
        console.log('=== Asquare debug inspect ===')
        console.log(JSON.stringify(result, null, 2))
        return result
      },
    }
    console.info(
      '[asquare] debug helper ready: await window.__asquare.inspect("BOOKING_ID", "VENDOR_ID")',
    )
  })()
}

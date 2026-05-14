/**
 * Contract tests guarding the multi-vendor scope index (`vendorIds`).
 *
 * Why this exists
 * ──────────────────────────────────────────────────────────────────────────
 * The `vendorIds: string[]` field on every booking is what lets a vendor
 * query their own bookings via `array-contains`. If any of the canonical
 * write paths stops stamping it, vendors silently lose visibility on
 * bookings — exactly the bug this codebase has already shipped twice
 * (April 2026 vendor-ledger drift, then again on `feat/tickets-phase-1`
 * because the trigger never wrote the field).
 *
 * These tests don't run any Firestore code. They read the source files
 * and assert the call to `deriveVendorIds` is present in each writer.
 * Brittle on purpose — the whole point is to fail loudly the moment a
 * future refactor moves or removes the line.
 *
 * If a writer legitimately changes shape, update the assertion to point
 * at the new line — never delete the assertion.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..', '..', '..')
const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf-8')

describe('vendorIds write contract', () => {
  it('POS write path stamps vendorIds via deriveVendorIds', () => {
    const src = read('src/pipeline/api/billing-firestore.ts')
    expect(src).toMatch(/vendorIds:\s*deriveVendorIds\(itemsWithSplits\)/)
  })

  it('unified-booking (online/web/android/ios) stamps vendorIds via deriveVendorIds', () => {
    const src = read('src/lib/unified-booking.ts')
    expect(src).toMatch(/vendorIds:\s*deriveVendorIds\(billing\.billingItems\)/)
  })

  it('vendor-ledger-sync trigger stamps vendorIds when persisting enriched billing', () => {
    const src = read('functions/lib/vendor-ledger-sync.js')
    expect(src).toMatch(/vendorIds:\s*deriveVendorIds\(enriched\.billingItems\)/)
  })

  it('vendor-ledger-sync trigger reconciles vendorIds when billingItems already exist', () => {
    const src = read('functions/lib/vendor-ledger-sync.js')
    expect(src).toMatch(/vendorIds reconcile failed/)
  })

  it('ThirdParty read scope unions array-contains with legacy top-level vendorId', () => {
    const src = read('src/pipeline/api/billing-firestore.ts')
    expect(src).toMatch(/where\('vendorIds',\s*'array-contains',\s*scope\.vendorId\)/)
    expect(src).toMatch(/where\('vendorId',\s*'==',\s*scope\.vendorId\)/)
  })

  it('functions trigger keeps deriveVendorIds in sync with src/pipeline/api/firestore-utils.ts', () => {
    // The trigger is a separate module graph (CommonJS, deployed to Cloud
    // Functions) so it inlines its own copy of deriveVendorIds. The two
    // implementations must produce the same result for any input — assert
    // the same dedupe + trim semantics by string-matching the core lines.
    const triggerSrc = read('functions/lib/vendor-ledger-sync.js')
    const canonicalSrc = read('src/pipeline/api/firestore-utils.ts')

    for (const src of [triggerSrc, canonicalSrc]) {
      expect(src).toMatch(/typeof vid === ['"]string['"] && vid\.trim\(\)\.length > 0/)
      expect(src).toMatch(/Array\.from\(ids\)/)
    }
  })

  it('trigger reconciles event-package vendor IDs via EventCampaign config', () => {
    // Event-package items carry no `vendorId` on `items[]`. Vendor identity
    // lives only in the EventCampaign.packages[].items[] config. The trigger
    // must walk that config and merge the matching vendor IDs into
    // `vendorIds[]`, otherwise event-package vendors are invisible to the
    // ThirdParty bookings query.
    //
    // Function names were refactored 2026-04 — `loadVendorGameNamesById`
    // was replaced by `loadEventPackageMatchers` (carries more fields:
    // revenueShare, type, price, temporal-gate startDate/endDate). The
    // contract is the same; the test asserts the current names.
    const src = read('functions/lib/vendor-ledger-sync.js')
    expect(src).toMatch(/loadEventPackageMatchers/)
    expect(src).toMatch(/deriveEventVendorIds/)
    expect(src).toMatch(/eventCampaigns/)
    expect(src).toMatch(/findEventMatcherForItem/)
  })

  it('mapTransactionRecord ORs items[].refunded into the output items', () => {
    // The customer-app refund flow stamps `refunded:true` only on `items[]`.
    // The mapper prefers `billingItems`, so without an OR the refunded flag
    // is lost from settlements / vendor reports / the BookingDetailsModal.
    const src = read('src/pipeline/api/billing-firestore.ts')
    expect(src).toMatch(/refundedVariants/)
    expect(src).toMatch(/refundedFromItems/)
  })
})

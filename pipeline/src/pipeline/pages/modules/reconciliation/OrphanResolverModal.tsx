import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type CatalogOption,
  type EventPackageOption,
  type OrphanBooking,
  type ResolutionInput,
  type VendorOption,
  type VendorSuggestionIndex,
  lookupVendorSuggestions,
  readBookingLedger,
  resolveOrphanBooking,
} from '../../../api/reconciliation-firestore'

const currency = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

interface ItemDraft {
  itemName: string
  quantity: number
  unitPrice: number
  /**
   * 'company'    no vendor — revenue stays with the company.
   * 'thirdParty' vendor gets share% of base + share% of GST.
   * 'subLease'   vendor gets share% of base only; company keeps all GST.
   */
  type: 'company' | 'thirdParty' | 'subLease' | 'unresolved'
  catalogKey?: string // composite "branchId::gameId::subGameId::variantId"
  vendorId?: string
  sharePercentOverride?: number
  /** Where this row's auto-fill came from (UI badge only, not persisted). */
  _source?: 'billing-items' | 'name-match' | 'history' | 'combo' | 'manual'
}

interface Props {
  booking: OrphanBooking
  catalog: CatalogOption[]
  vendors: VendorOption[]
  packages: EventPackageOption[]
  /** Historical (branch+game+sub+variant)→vendor index. Used to surface
   *  click-to-fill suggestions when a vendor isn't picked. Optional so
   *  the modal still renders if the index isn't loaded yet. */
  vendorSuggestions?: VendorSuggestionIndex
  resolvedBy: { id: string; name: string }
  onClose: () => void
  onResolved: () => void
}

// Extract a combo prefix from an item name. Items inside a combo are
// stored as "<COMBO NAME> • <CHILD ACTIVITY NAME>".
const extractComboPrefix = (name: string): string | null => {
  const m = (name || '').match(/^(.+?)\s+•\s+.+$/)
  return m?.[1] ?? null
}

// Walk drafts in order and bucket consecutive same-prefix combo rows into
// groups. Plain items become their own bucket. Editing semantics aren't
// changed — each ItemRow is still editable; the bucket only adds a visual
// header above the group with the combo name and × N multiplier.
const groupConsecutiveCombos = <T extends { itemName: string }>(
  drafts: T[],
): Array<
  | { kind: 'plain'; idx: number; draft: T }
  | { kind: 'combo'; prefix: string; multiplier: number; entries: Array<{ idx: number; draft: T }> }
> => {
  const out: Array<
    | { kind: 'plain'; idx: number; draft: T }
    | {
        kind: 'combo'
        prefix: string
        multiplier: number
        entries: Array<{ idx: number; draft: T }>
      }
  > = []
  let i = 0
  while (i < drafts.length) {
    const prefix = extractComboPrefix(drafts[i].itemName)
    if (!prefix) {
      out.push({ kind: 'plain', idx: i, draft: drafts[i] })
      i++
      continue
    }
    const entries: Array<{ idx: number; draft: T }> = []
    while (i < drafts.length && extractComboPrefix(drafts[i].itemName) === prefix) {
      entries.push({ idx: i, draft: drafts[i] })
      i++
    }
    // Multiplier: if every unique child name appears the same number of
    // times K, the combo was bought K times. Otherwise multiplier=1.
    const nameCounts = new Map<string, number>()
    for (const e of entries) {
      const child = e.draft.itemName.replace(`${prefix} • `, '')
      nameCounts.set(child, (nameCounts.get(child) ?? 0) + 1)
    }
    const counts = [...nameCounts.values()]
    const multiplier = counts.every((c) => c === counts[0]) ? counts[0] || 1 : 1
    out.push({ kind: 'combo', prefix, multiplier, entries })
  }
  return out
}

const composeCatalogKey = (c: CatalogOption) =>
  `${c.branchId}::${c.gameId}::${c.subGameId}::${c.variantId}`

const splitKey = (k: string) => {
  const [branchId, gameId, subGameId, variantId] = k.split('::')
  return { branchId, gameId, subGameId, variantId }
}

export const OrphanResolverModal = ({
  booking,
  catalog,
  vendors,
  packages,
  vendorSuggestions,
  resolvedBy,
  onClose,
  onResolved,
}: Props) => {
  // Build initial drafts. Pre-fill catalog + vendor + attribution per
  // item from billingItems[] when present (canonical source), since that
  // turns most audit Re-attributes into a 0-click confirm.
  const [drafts, setDrafts] = useState<ItemDraft[]>(() => {
    const billing = booking.billingItems ?? []
    return booking.items.map((i): ItemDraft => {
      const base: ItemDraft = {
        itemName: i.itemName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        type: 'unresolved',
      }
      if (billing.length === 0) return base
      // Prefer match by variantId, fall back to itemName (case-insensitive).
      const norm = (s: string) => s.trim().toLowerCase()
      const match =
        (i.variantId && billing.find((b) => b.variantId && b.variantId === i.variantId)) ||
        billing.find((b) => norm(b.itemName) === norm(i.itemName))
      if (!match) return base
      const hasIds = !!(match.gameId && match.subGameId)
      if (!hasIds && !match.vendorId) return base
      const catalogKey = hasIds
        ? `${booking.branchId}::${match.gameId}::${match.subGameId}::${match.variantId ?? ''}`
        : undefined
      const vendor = match.vendorId ? vendors.find((v) => v.id === match.vendorId) : undefined
      const inferredType: ItemDraft['type'] = match.vendorId
        ? vendor?.vendorType === 'SubLease'
          ? 'subLease'
          : 'thirdParty'
        : 'company'
      return {
        ...base,
        catalogKey,
        vendorId: match.vendorId || undefined,
        type: inferredType,
        _source: 'billing-items',
      }
    })
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Current ledger state for this booking, refreshed on mount and after
  // Apply. Used by the Ledger Preview pane to show before/after diffs and
  // the post-apply verifier to confirm the writes landed correctly.
  const [currentLedger, setCurrentLedger] = useState<{
    netByVendor: Map<string, number>
    entries: Array<{ id: string; vendorId: string; type: string; source: string; amount: number }>
  } | null>(null)
  const [verifyResult, setVerifyResult] = useState<
    | null
    | { ok: true; message: string }
    | {
        ok: false
        diffs: Array<{ vendorId: string; expected: number; actual: number }>
      }
  >(null)
  const refreshLedger = useCallback(async () => {
    try {
      const r = await readBookingLedger(booking.id)
      setCurrentLedger(r)
    } catch {
      // Non-fatal; preview just hides the current side.
    }
  }, [booking.id])
  useEffect(() => {
    void refreshLedger()
  }, [refreshLedger])

  // Catalog narrowed to this booking's branch first, plus all-branches fallback.
  const catalogForBranch = useMemo(
    () => catalog.filter((c) => c.branchId === booking.branchId),
    [catalog, booking.branchId],
  )
  const catalogOther = useMemo(
    () => catalog.filter((c) => c.branchId !== booking.branchId),
    [catalog, booking.branchId],
  )

  // Event-package items as a third catalog group. Each (campaign, package,
  // item) becomes a synthetic CatalogOption so the admin can pick e.g.
  // "Summer Vibes • Combo 2 • Cricket 3 overs" directly from the catalog
  // dropdown — useful when fanning out a combo and wanting each generated
  // row to carry its event-package gameId/subGameId/variantId on the
  // booking. Branch is `pkg.locationKey`; we split by booking.branchId so
  // this-branch options surface first.
  const eventCatalogAll = useMemo<CatalogOption[]>(
    () =>
      packages.flatMap((p) =>
        p.items.map((it) => {
          const variantId = it.name
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .join('_')
          return {
            branchId: p.locationKey,
            gameId: p.campaignSlug,
            gameName: p.campaignName,
            subGameId: p.packageId,
            subGameName: p.packageName,
            variantId,
            variantLabel: it.name,
            vendorId: it.vendorId || undefined,
            composedLabel: `${p.campaignName} • ${p.packageName} • ${it.name}`,
          }
        }),
      ),
    [packages],
  )
  const eventCatalogForBranch = useMemo(
    () => eventCatalogAll.filter((c) => c.branchId === booking.branchId),
    [eventCatalogAll, booking.branchId],
  )
  const eventCatalogOther = useMemo(
    () => eventCatalogAll.filter((c) => c.branchId !== booking.branchId),
    [eventCatalogAll, booking.branchId],
  )
  const vendorMap = useMemo(() => {
    const m = new Map<string, VendorOption>()
    for (const v of vendors) m.set(v.id, v)
    return m
  }, [vendors])

  // Compute live preview totals + per-item breakdown.
  // ThirdParty: vendor gets share% of (base + gst).
  // SubLease:   vendor gets share% of base only (company keeps all GST).
  // Company:    100% to company.
  const preview = useMemo(() => {
    const itemRows = drafts.map((d) => {
      const qty = Math.max(1, Math.floor(d.quantity))
      const unit = Math.max(0, d.unitPrice)
      const total = qty * unit
      const base = Math.round((total * 100) / 118)
      const gst = total - base
      let sharePct = 0
      let vendorBase = 0
      let vendorGst = 0
      let vendorTotal = 0
      if ((d.type === 'thirdParty' || d.type === 'subLease') && d.vendorId) {
        sharePct =
          d.sharePercentOverride !== undefined
            ? d.sharePercentOverride
            : (vendorMap.get(d.vendorId)?.revenueShare ?? 80)
        vendorBase = Math.round((base * sharePct) / 100)
        vendorGst = d.type === 'subLease' ? 0 : Math.round((gst * sharePct) / 100)
        vendorTotal = vendorBase + vendorGst
      }
      const companyBase = base - vendorBase
      const companyGst = gst - vendorGst
      const companyTotal = companyBase + companyGst
      return {
        draft: d,
        qty,
        unit,
        total,
        base,
        gst,
        sharePct,
        vendorBase,
        vendorGst,
        vendorTotal,
        companyBase,
        companyGst,
        companyTotal,
      }
    })

    const subtotal = itemRows.reduce((s, r) => s + r.total, 0)
    const totalBase = itemRows.reduce((s, r) => s + r.base, 0)
    const totalGst = itemRows.reduce((s, r) => s + r.gst, 0)

    // Aggregate per vendor.
    const perVendor = new Map<
      string,
      {
        vendorBase: number
        vendorGst: number
        vendorTotal: number
        sharePct: number
        type: 'thirdParty' | 'subLease'
      }
    >()
    for (const r of itemRows) {
      if (
        (r.draft.type !== 'thirdParty' && r.draft.type !== 'subLease') ||
        !r.draft.vendorId ||
        r.vendorTotal <= 0
      )
        continue
      const acc = perVendor.get(r.draft.vendorId) ?? {
        vendorBase: 0,
        vendorGst: 0,
        vendorTotal: 0,
        sharePct: r.sharePct,
        type: r.draft.type,
      }
      acc.vendorBase += r.vendorBase
      acc.vendorGst += r.vendorGst
      acc.vendorTotal += r.vendorTotal
      perVendor.set(r.draft.vendorId, acc)
    }

    const totalVendorBase = [...perVendor.values()].reduce((s, v) => s + v.vendorBase, 0)
    const totalVendorGst = [...perVendor.values()].reduce((s, v) => s + v.vendorGst, 0)
    const totalVendorTotal = totalVendorBase + totalVendorGst
    const totalCompanyBase = totalBase - totalVendorBase
    const totalCompanyGst = totalGst - totalVendorGst
    const totalCompanyTotal = totalCompanyBase + totalCompanyGst

    return {
      itemRows,
      subtotal,
      totalBase,
      totalGst,
      perVendor,
      totalVendorBase,
      totalVendorGst,
      totalVendorTotal,
      totalCompanyBase,
      totalCompanyGst,
      totalCompanyTotal,
    }
  }, [drafts, vendorMap])

  const allResolved = drafts.every((d) => d.type !== 'unresolved')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateDraft = (idx: number, patch: Partial<ItemDraft>) => {
    // Any user-driven change to catalog/vendor/type/share invalidates the
    // auto-fill source badge — once admin touches a row, the badge would
    // lie about provenance. Caller can pass `_source` explicitly in the
    // patch to override (e.g., the auto-fill handler does this).
    const touchesAttribution =
      'catalogKey' in patch ||
      'vendorId' in patch ||
      'type' in patch ||
      'sharePercentOverride' in patch
    const next: Partial<ItemDraft> =
      touchesAttribution && !('_source' in patch) ? { ...patch, _source: 'manual' } : patch
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...next } : d)))
  }

  const removeDraft = (idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx))
  }

  // Pro-rate every row's unitPrice so the items subtotal exactly matches
  // the booking's finalAmount. Used after fan-out when the customer paid
  // less than the sum of campaign config prices (free seats / bundle
  // discounts) — this option makes vendors share the discount instead of
  // the company absorbing it entirely. Reverse: clicking again with
  // identical state is a no-op.
  const proRateToBookingTotal = () => {
    const currentSubtotal = drafts.reduce(
      (s, d) => s + Math.max(1, Math.floor(d.quantity)) * Math.max(0, d.unitPrice),
      0,
    )
    if (currentSubtotal <= 0 || booking.finalAmount <= 0) return
    if (currentSubtotal === booking.finalAmount) return
    const ratio = booking.finalAmount / currentSubtotal
    setDrafts((prev) =>
      prev.map((d) => ({
        ...d,
        unitPrice: Math.max(0, Math.round(d.unitPrice * ratio)),
      })),
    )
  }

  const addEmptyDraft = () => {
    setDrafts((prev) => [...prev, { itemName: '', quantity: 1, unitPrice: 0, type: 'unresolved' }])
  }

  // Fan-out replaces `parentIdx` with one row per item in the picked
  // package/combo. For event packages, the parent's quantity is treated as
  // "seats" — a 4-seat Combo 2 line expands into N items each at qty 4.
  // For POS combos, `adjustedPrice` already represents the per-item price
  // for ONE combo bundle, so each fanned-out row defaults to qty 1; the
  // admin sets quantity afterwards based on how many combos were sold.
  const fanOutFromPackage = (parentIdx: number, pkg: EventPackageOption, seats: number) => {
    const isCombo = pkg.kind === 'combo'
    const fannedQty = isCombo ? 1 : Math.max(1, Math.floor(seats))
    const expanded: ItemDraft[] = pkg.items.map((it) => {
      const inferredType: ItemDraft['type'] =
        it.type === 'company'
          ? 'company'
          : (() => {
              const v = it.vendorId ? vendors.find((vv) => vv.id === it.vendorId) : undefined
              return v?.vendorType === 'SubLease' ? 'subLease' : 'thirdParty'
            })()
      // Compose a catalogKey from the package item's IDs (combos carry
      // these; event-package items don't). Without this, fanned-out rows
      // get written with empty gameId/subGameId/variantId and the booking
      // re-appears in the orphan list after Apply.
      const composedCatalogKey =
        it.gameId && it.subGameId
          ? `${booking.branchId}::${it.gameId}::${it.subGameId}::${it.variantId ?? ''}`
          : undefined
      return {
        itemName: `${pkg.packageName} • ${it.name}`,
        quantity: fannedQty,
        unitPrice: it.configPrice || 0,
        type: inferredType,
        vendorId: it.vendorId || undefined,
        catalogKey: composedCatalogKey,
        // 100% override when revenueShare === false (matches the live
        // event-package-ledger.ts behaviour); otherwise leave undefined so
        // the vendor's stored share applies.
        sharePercentOverride: it.revenueShare === false ? 100 : undefined,
      }
    })
    setDrafts((prev) => {
      const before = prev.slice(0, parentIdx)
      const after = prev.slice(parentIdx + 1)
      return [...before, ...expanded, ...after]
    })
  }

  // True when every draft was pre-filled from billingItems and is fully
  // attributed (catalog OR company + vendor where required). Enables the
  // "Apply billingItems as-is" fast path at the top of the form.
  const allFromBillingComplete =
    drafts.length > 0 &&
    drafts.every(
      (d) =>
        d._source === 'billing-items' &&
        (d.type === 'company' ||
          ((d.type === 'thirdParty' || d.type === 'subLease') && !!d.vendorId && !!d.catalogKey)),
    )

  /**
   * Auto-fill drafts whose attribution is still 'unresolved' using:
   *   1. Exact normalized itemName match against catalog → set catalogKey.
   *   2. Vendor history at the same (branch, game, sub, variant): if
   *      EXACTLY ONE vendor matches, auto-fill it (single-match rule —
   *      never picks the most popular when ambiguous). Multiple matches
   *      stay as suggestion chips.
   * Returns the count of rows it filled. Each filled row gets a `_source`
   * badge so admin can verify before Apply.
   */
  const handleAutoFillFromHistory = () => {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
    let filled = 0
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.type !== 'unresolved') return d
        let catalogKey = d.catalogKey
        let source: ItemDraft['_source'] = d._source
        // 1. Catalog name match (exact normalized).
        if (!catalogKey && d.itemName) {
          const target = norm(d.itemName)
          const matches = catalog.filter(
            (c) => norm(c.composedLabel) === target || norm(c.variantLabel) === target,
          )
          // Prefer same branch when there's a tie.
          const sameBranch = matches.filter((c) => c.branchId === booking.branchId)
          const pick =
            sameBranch.length === 1 ? sameBranch[0] : matches.length === 1 ? matches[0] : null
          if (pick) {
            catalogKey = `${pick.branchId}::${pick.gameId}::${pick.subGameId}::${pick.variantId}`
            source = 'name-match'
          }
        }
        // 2. Vendor history — only when exactly ONE historical vendor.
        let vendorId = d.vendorId
        let inferredType: ItemDraft['type'] = d.type
        if (catalogKey && !vendorId && vendorSuggestions) {
          const [bId, gId, sId, vId] = catalogKey.split('::')
          const suggestions = lookupVendorSuggestions(vendorSuggestions, bId, gId, sId, vId, 5)
          if (suggestions.length === 1) {
            const v = vendors.find((vv) => vv.id === suggestions[0].vendorId)
            if (v) {
              vendorId = v.id
              inferredType = v.vendorType === 'SubLease' ? 'subLease' : 'thirdParty'
              source = 'history'
            }
          }
        }
        if (catalogKey !== d.catalogKey || vendorId !== d.vendorId) {
          filled++
          return {
            ...d,
            catalogKey,
            vendorId,
            type: inferredType,
            _source: source ?? d._source,
          }
        }
        return d
      }),
    )
    if (filled === 0) {
      window.alert(
        'Nothing to auto-fill: every unresolved row has either no catalog match or multiple ' +
          'possible vendors. Use the suggestion chips per row to pick.',
      )
    } else {
      // Brief toast-style message via alert. Could be replaced with inline
      // status if a toast component exists in the project.
      window.alert(
        `Auto-filled ${filled} row${filled === 1 ? '' : 's'} from name match / vendor history. ` +
          `Each row shows a "✓ from history" or "✓ from name match" badge — verify before Apply.`,
      )
    }
  }

  const handleApply = async () => {
    if (!allResolved) {
      setError('Resolve every item before applying.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const input: ResolutionInput = {
        bookingId: booking.id,
        branchId: booking.branchId,
        date: booking.date,
        resolvedBy,
        notes: notes.trim() || undefined,
        items: drafts.map((d) => {
          const cat = d.catalogKey ? splitKey(d.catalogKey) : undefined
          const resolvedType: 'company' | 'thirdParty' | 'subLease' =
            d.type === 'company' ? 'company' : d.type === 'subLease' ? 'subLease' : 'thirdParty'
          return {
            itemName: d.itemName,
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            gameId: cat?.gameId,
            subGameId: cat?.subGameId,
            variantId: cat?.variantId,
            type: resolvedType,
            vendorId: resolvedType === 'company' ? undefined : d.vendorId,
            sharePercentOverride: d.sharePercentOverride,
          }
        }),
      }
      await resolveOrphanBooking(input)
      // Verify ledger after Apply. Read the current ledger and compare
      // its per-vendor net against what the drafts implied. A diff > ₹2
      // means the trigger did not write what we expected (race / bug /
      // overwrite). We surface the diff so admin can inspect manually
      // before assuming the resolution is complete.
      try {
        const led = await readBookingLedger(booking.id)
        setCurrentLedger(led)
        const expectedNetByVendor = computeExpectedLedgerByVendor(drafts, vendors)
        // Compute "actual" excluding entries whose source is unrelated to
        // what Apply writes — refunds and prior manual adjustments leave
        // valid ledger rows that aren't part of the credit math the
        // resolver should match. Compare apples to apples.
        const EXCLUDED_SOURCES = new Set<string>(['refund'])
        const actualNetByVendor = new Map<string, number>()
        for (const e of led.entries) {
          if (EXCLUDED_SOURCES.has(e.source)) continue
          const cur = actualNetByVendor.get(e.vendorId) ?? 0
          const delta = e.type === 'credit' ? e.amount : e.type === 'debit' ? -e.amount : 0
          actualNetByVendor.set(e.vendorId, cur + delta)
        }
        const diffs: Array<{ vendorId: string; expected: number; actual: number }> = []
        const allVendors = new Set<string>([
          ...expectedNetByVendor.keys(),
          ...actualNetByVendor.keys(),
        ])
        for (const vid of allVendors) {
          const expected = expectedNetByVendor.get(vid) ?? 0
          const actual = actualNetByVendor.get(vid) ?? 0
          if (Math.abs(expected - actual) > 2) {
            diffs.push({ vendorId: vid, expected, actual })
          }
        }
        if (diffs.length === 0) {
          setVerifyResult({ ok: true, message: 'Ledger matches expected per-vendor net.' })
          // Auto-close on clean apply after a beat so admin sees the green tick.
          setTimeout(() => onResolved(), 800)
        } else {
          setVerifyResult({ ok: false, diffs })
          // Don't auto-close — let admin see the verification mismatches.
        }
      } catch {
        // Verify read failed (rare); fall back to the original close.
        onResolved()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply resolution.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Compute the per-vendor net the ledger SHOULD have after Apply, using
   * the same math the trigger uses (vendorBase = round(total*100/118),
   * vendorTotal = base*share + (gst*share if ThirdParty)).
   */
  const computeExpectedLedgerByVendor = (
    drafts: ItemDraft[],
    vendorList: VendorOption[],
  ): Map<string, number> => {
    const out = new Map<string, number>()
    for (const d of drafts) {
      if (d.type !== 'thirdParty' && d.type !== 'subLease') continue
      if (!d.vendorId) continue
      const total = Math.max(1, Math.floor(d.quantity)) * Math.max(0, d.unitPrice)
      const base = Math.round((total * 100) / 118)
      const gst = total - base
      const v = vendorList.find((vv) => vv.id === d.vendorId)
      const sharePct =
        d.sharePercentOverride !== undefined ? d.sharePercentOverride : (v?.revenueShare ?? 80)
      const vendorBase = Math.round((base * sharePct) / 100)
      const vendorGst = d.type === 'subLease' ? 0 : Math.round((gst * sharePct) / 100)
      const vendorTotal = vendorBase + vendorGst
      out.set(d.vendorId, (out.get(d.vendorId) ?? 0) + vendorTotal)
    }
    return out
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Resolve booking ${booking.id}`}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
          <div>
            <p className="font-mono text-sm font-semibold text-text">{booking.id}</p>
            <p className="text-xs text-muted">
              {booking.date} · {booking.customerName || 'Guest'} · {booking.customerPhone} ·{' '}
              {booking.branchId} · {currency(booking.finalAmount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
          >
            Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-[1fr_320px] overflow-hidden">
          <div className="overflow-y-auto px-6 py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Items ({drafts.length})
              </h3>
              <div className="flex gap-2">
                {preview.subtotal !== booking.finalAmount && booking.finalAmount > 0 ? (
                  <button
                    type="button"
                    onClick={proRateToBookingTotal}
                    className="ui-btn ui-btn-neutral min-h-7 px-2 py-1 text-xs"
                    title={`Multiply every row's unit price by (booking total / current subtotal) so vendors share the bundle discount / free-seat cost instead of the company absorbing it entirely. Multiplier: ${
                      preview.subtotal > 0
                        ? (booking.finalAmount / preview.subtotal).toFixed(3)
                        : '?'
                    }`}
                  >
                    Pro-rate to booking total
                  </button>
                ) : null}
                {drafts.some((d) => d.type === 'unresolved') ? (
                  <button
                    type="button"
                    onClick={handleAutoFillFromHistory}
                    className="ui-btn ui-btn-neutral min-h-7 px-2 py-1 text-xs"
                    title="For each unresolved row, attempt: (1) exact normalized name match against catalog, (2) vendor with exactly one historical match. Shows a badge per row so you can verify."
                  >
                    Auto-fill from history
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={addEmptyDraft}
                  className="ui-btn ui-btn-neutral min-h-7 px-2 py-1 text-xs"
                >
                  + Add item
                </button>
              </div>
            </div>

            {allFromBillingComplete ? (
              <div className="mb-3 rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <strong className="text-success">
                      All {drafts.length} rows pre-filled from billingItems.
                    </strong>{' '}
                    Every row already has the catalog mapping and vendor that the ledger trigger
                    uses as truth.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={saving}
                    className="ui-btn ui-btn-accent min-h-7 px-3 py-1 text-xs"
                  >
                    {saving ? 'Applying…' : 'Apply billingItems as-is'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Same write that the per-row Apply button performs — this just skips the
                  click-through.
                </p>
              </div>
            ) : null}

            <div className="space-y-3">
              {groupConsecutiveCombos(drafts).map((b) => {
                if (b.kind === 'plain') {
                  return (
                    <ItemRow
                      key={b.idx}
                      index={b.idx}
                      draft={b.draft}
                      catalogForBranch={catalogForBranch}
                      catalogOther={catalogOther}
                      eventCatalogForBranch={eventCatalogForBranch}
                      eventCatalogOther={eventCatalogOther}
                      vendors={vendors}
                      packages={packages}
                      vendorSuggestions={vendorSuggestions}
                      bookingBranchId={booking.branchId}
                      onChange={(patch) => updateDraft(b.idx, patch)}
                      onRemove={drafts.length > 1 ? () => removeDraft(b.idx) : undefined}
                      onFanOut={(pkg, seats) => fanOutFromPackage(b.idx, pkg, seats)}
                    />
                  )
                }
                const comboTotal = b.entries.reduce(
                  (s, e) =>
                    s + Math.max(1, Math.floor(e.draft.quantity)) * Math.max(0, e.draft.unitPrice),
                  0,
                )
                return (
                  <div
                    key={`combo-${b.entries[0].idx}`}
                    className="rounded-xl border border-info/40 bg-info/5 p-2"
                  >
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded-full border border-info/50 bg-info/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info">
                          Combo
                        </span>
                        <span className="font-semibold text-text">{b.prefix}</span>
                        <span className="rounded border border-border/60 bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
                          × {b.multiplier}
                        </span>
                        <span className="text-[11px] text-muted">
                          {b.entries.length} row{b.entries.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="font-mono text-sm font-semibold text-text">
                        {currency(comboTotal)}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {b.entries.map((e) => (
                        <ItemRow
                          key={e.idx}
                          index={e.idx}
                          draft={e.draft}
                          catalogForBranch={catalogForBranch}
                          catalogOther={catalogOther}
                          eventCatalogForBranch={eventCatalogForBranch}
                          eventCatalogOther={eventCatalogOther}
                          vendors={vendors}
                          packages={packages}
                          bookingBranchId={booking.branchId}
                          onChange={(patch) => updateDraft(e.idx, patch)}
                          onRemove={drafts.length > 1 ? () => removeDraft(e.idx) : undefined}
                          onFanOut={(pkg, seats) => fanOutFromPackage(e.idx, pkg, seats)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
                Resolution notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="ui-field w-full text-sm"
                placeholder="Why this attribution? Source of vendor info? Anything future-you should know."
              />
            </div>

            {error ? (
              <p className="mt-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
                {error}
              </p>
            ) : null}
          </div>

          <aside className="overflow-y-auto border-l border-border/60 bg-panel px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              Preview
            </h3>

            {booking.subTotal && booking.subTotal !== booking.finalAmount ? (
              <Row label="Order subtotal (pre-discount)" value={currency(booking.subTotal)} />
            ) : null}
            {booking.couponCode ? (
              <Row
                label={`Coupon (${booking.couponCode})`}
                value={`− ${currency(booking.couponAmount || booking.discountAmount || 0)}`}
              />
            ) : booking.discountAmount && booking.discountAmount > 0 ? (
              <Row label="Manual discount" value={`− ${currency(booking.discountAmount)}`} />
            ) : null}
            {booking.walletAmountUsed && booking.walletAmountUsed > 0 ? (
              <Row
                label="Wallet / store credit applied"
                value={`− ${currency(booking.walletAmountUsed)}`}
              />
            ) : null}
            <Row label="Booking total (customer paid)" value={currency(booking.finalAmount)} />
            <Row label="Items subtotal (service value)" value={currency(preview.subtotal)} />
            <Row label="GST extracted" value={currency(preview.totalGst)} />
            <Row label="Base (ex GST)" value={currency(preview.totalBase)} />
            {(() => {
              const totalDisc = (booking.discountAmount || 0) + (booking.walletAmountUsed || 0)
              if (totalDisc <= 0) return null
              return (
                <div className="mt-1 rounded border border-warning/40 bg-warning/5 px-2 py-1 text-[11px] text-warning">
                  <strong>Customer received {currency(totalDisc)} off.</strong> Per current policy
                  the <strong>company bears this cost</strong> — vendor split computes against the
                  full service value above.
                </div>
              )
            })()}
            {(() => {
              const promoCost = preview.subtotal - booking.finalAmount
              if (booking.finalAmount <= 0) return null
              if (promoCost === 0) return null
              if (promoCost > 0) {
                // Items add up to MORE than what the customer paid — typical
                // for combos with free seats AND/OR bundle discounts.
                const ratio = preview.subtotal > 0 ? booking.finalAmount / preview.subtotal : 0
                const ratioPct = (ratio * 100).toFixed(1)
                return (
                  <div className="mt-1 rounded border border-info/40 bg-info/5 px-2 py-1 text-[11px] text-info">
                    <strong>Service value &gt; customer paid by {currency(promoCost)}.</strong> This
                    is the combined cost of (a) the bundle discount the customer received and (b)
                    any free seats. Right now vendors are credited at{' '}
                    <strong>full service value</strong> ({currency(preview.subtotal)}) — the company
                    absorbs the gap.
                    <br />
                    <span className="text-muted">
                      To make vendors share the discount / promo cost instead, click{' '}
                      <strong>Pro-rate to booking total</strong> at the top of the items list. That
                      multiplies every row's unit price by {ratioPct}% so the items subtotal lines
                      up with what the customer paid.
                    </span>
                  </div>
                )
              }
              return (
                <p className="mt-1 text-[11px] text-warning">
                  Item subtotal is less than booking total. Adjust unit prices, or add a
                  Company-revenue row to absorb the difference.
                </p>
              )
            })()}

            <hr className="my-3 border-border/60" />

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Per-item breakdown
            </h4>
            {preview.itemRows.length === 0 ? (
              <p className="text-xs text-muted">No items yet.</p>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const rows = preview.itemRows.map((r, idx) => ({
                    ...r,
                    idx,
                    itemName: r.draft.itemName || '',
                  }))
                  return groupConsecutiveCombos(rows).map((b) => {
                    if (b.kind === 'plain') {
                      const r = b.draft
                      return (
                        <PreviewItemCard
                          key={b.idx}
                          row={r}
                          displayName={r.draft.itemName || ''}
                          showComboPrefix={null}
                        />
                      )
                    }
                    const comboTotal = b.entries.reduce((s, e) => s + e.draft.total, 0)
                    return (
                      <div
                        key={`pv-combo-${b.entries[0].idx}`}
                        className="rounded border border-info/40 bg-info/5 p-1.5"
                      >
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-1 px-1 text-[11px]">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="rounded-full border border-info/50 bg-info/10 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-info">
                              Combo
                            </span>
                            <span className="font-semibold text-text">{b.prefix}</span>
                            <span className="rounded border border-border/60 bg-surface px-1 py-0 font-mono text-[10px] text-muted">
                              × {b.multiplier}
                            </span>
                          </div>
                          <span className="font-mono text-text">{currency(comboTotal)}</span>
                        </div>
                        <div className="space-y-1.5">
                          {b.entries.map((e) => (
                            <PreviewItemCard
                              key={e.idx}
                              row={e.draft}
                              displayName={(e.draft.draft.itemName || '').replace(
                                `${b.prefix} • `,
                                '',
                              )}
                              showComboPrefix={null}
                              dense
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}

            <hr className="my-3 border-border/60" />

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Vendor credits
            </h4>
            {preview.perVendor.size === 0 ? (
              <p className="text-xs text-muted">No vendor credits (all company).</p>
            ) : (
              <div className="space-y-2">
                {[...preview.perVendor.entries()].map(([vid, agg]) => {
                  const v = vendorMap.get(vid)
                  return (
                    <div
                      key={vid}
                      className="rounded border border-success/30 bg-success/5 px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-text">{v?.name ?? vid}</span>
                        <span className="text-[10px] text-muted">
                          [{agg.type === 'subLease' ? 'SL' : 'TP'}] · {agg.sharePct}%
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-2 text-muted">
                        <span>Vendor ID</span>
                        <span className="text-right font-mono text-text">{vid}</span>
                        <span>Base</span>
                        <span className="text-right text-text">{currency(agg.vendorBase)}</span>
                        <span>GST</span>
                        <span className="text-right text-text">{currency(agg.vendorGst)}</span>
                        <span className="font-medium text-text">Total</span>
                        <span className="text-right font-semibold text-success">
                          {currency(agg.vendorTotal)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <hr className="my-3 border-border/60" />

            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Totals (service value basis)
            </h4>
            <Row label="Vendors total" value={currency(preview.totalVendorTotal)} />
            <Row
              label="  · Vendors base"
              value={<span className="text-muted">{currency(preview.totalVendorBase)}</span>}
            />
            <Row
              label="  · Vendors GST"
              value={<span className="text-muted">{currency(preview.totalVendorGst)}</span>}
            />
            <Row label="Company total" value={currency(preview.totalCompanyTotal)} />
            <Row
              label="  · Company base"
              value={<span className="text-muted">{currency(preview.totalCompanyBase)}</span>}
            />
            <Row
              label="  · Company GST"
              value={<span className="text-muted">{currency(preview.totalCompanyGst)}</span>}
            />
            <hr className="my-2 border-border/60" />
            <Row
              label={<span className="font-semibold text-text">Service-value total</span>}
              value={
                <span className="font-semibold">
                  {currency(preview.totalVendorTotal + preview.totalCompanyTotal)}
                </span>
              }
            />

            <hr className="my-3 border-border/60" />
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Ledger preview (current → after Apply)
            </h4>
            {(() => {
              const expected = computeExpectedLedgerByVendor(drafts, vendors)
              // Compute current per-vendor net excluding entries Apply
              // doesn't touch (refunds, prior manual adjustments). Same
              // exclusion as the post-apply verifier — keeps the diff
              // column comparing apples to apples.
              const EXCLUDED_SOURCES = new Set<string>(['refund'])
              const currentForCompare = new Map<string, number>()
              const refundDebitsByVendor = new Map<string, number>()
              for (const e of currentLedger?.entries ?? []) {
                const delta = e.type === 'credit' ? e.amount : e.type === 'debit' ? -e.amount : 0
                if (EXCLUDED_SOURCES.has(e.source)) {
                  if (e.type === 'debit') {
                    refundDebitsByVendor.set(
                      e.vendorId,
                      (refundDebitsByVendor.get(e.vendorId) ?? 0) + e.amount,
                    )
                  }
                  continue
                }
                currentForCompare.set(e.vendorId, (currentForCompare.get(e.vendorId) ?? 0) + delta)
              }
              const allVendors = new Set<string>([...currentForCompare.keys(), ...expected.keys()])
              if (allVendors.size === 0) {
                return (
                  <p className="text-[11px] text-muted">
                    No vendor credits to write. Ledger will not change.
                  </p>
                )
              }
              return (
                <div className="space-y-1">
                  {[...allVendors].map((vid) => {
                    const cur = currentForCompare.get(vid) ?? 0
                    const exp = expected.get(vid) ?? 0
                    const diff = exp - cur
                    const refundOff = refundDebitsByVendor.get(vid) ?? 0
                    const v = vendorMap.get(vid)
                    return (
                      <div
                        key={vid}
                        className={`rounded border px-2 py-1 text-[11px] ${
                          Math.abs(diff) <= 2
                            ? 'border-border/40 bg-surface'
                            : 'border-info/40 bg-info/5'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium text-text">{v?.name ?? vid}</span>
                          <span className="font-mono text-[10px] text-muted">{vid}</span>
                        </div>
                        <div className="mt-0.5 grid grid-cols-3 gap-2 font-mono">
                          <span className="text-muted">current: {currency(cur)}</span>
                          <span>after: {currency(exp)}</span>
                          <span
                            className={`text-right ${
                              diff > 0 ? 'text-success' : diff < 0 ? 'text-warning' : 'text-muted'
                            }`}
                          >
                            {diff > 0 ? '+' : ''}
                            {currency(diff)}
                          </span>
                        </div>
                        {refundOff > 0 ? (
                          <p className="mt-0.5 text-[10px] text-muted">
                            (excludes − {currency(refundOff)} refund debit already on ledger)
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                  <p className="mt-1 text-[10px] text-muted">
                    Apply will write canonical ledger rows. The trigger may also fire — both paths
                    are idempotent (same doc IDs).
                  </p>
                </div>
              )
            })()}

            {verifyResult ? (
              <div
                className={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
                  verifyResult.ok
                    ? 'border-success/40 bg-success/5 text-success'
                    : 'border-warning/40 bg-warning/5 text-warning'
                }`}
              >
                {verifyResult.ok ? (
                  <span>
                    <strong>✓ Verified.</strong> {verifyResult.message}
                  </span>
                ) : (
                  <>
                    <p className="font-semibold">⚠ Ledger doesn't match expected after Apply</p>
                    <ul className="ml-4 mt-1 list-disc">
                      {verifyResult.diffs.map((d) => {
                        const v = vendorMap.get(d.vendorId)
                        return (
                          <li key={d.vendorId}>
                            {v?.name ?? d.vendorId}: expected {currency(d.expected)}, ledger has{' '}
                            {currency(d.actual)} (diff {currency(d.actual - d.expected)})
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-1">
                      The trigger may have written extra rows or the ledger has older entries that
                      haven't been cleared. Inspect this booking and run the audit for affected
                      vendor(s).
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {/* Cash basis: what the company actually nets given the
                customer-paid total minus vendor credits we owe. For a
                booking with free seats, this can be lower than (or equal
                to) the company total above. */}
            <hr className="my-3 border-border/60" />
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Company P&amp;L (cash basis)
            </h4>
            <Row
              label="Customer paid"
              value={<span className="text-muted">{currency(booking.finalAmount)}</span>}
            />
            <Row
              label="− Vendor credits"
              value={<span className="text-muted">−{currency(preview.totalVendorTotal)}</span>}
            />
            <hr className="my-1 border-border/40" />
            <Row
              label={<span className="font-semibold text-text">Company net</span>}
              value={(() => {
                const net = booking.finalAmount - preview.totalVendorTotal
                return (
                  <span className={`font-semibold ${net < 0 ? 'text-critical' : 'text-success'}`}>
                    {currency(net)}
                  </span>
                )
              })()}
            />
            {booking.finalAmount - preview.totalVendorTotal < 0 ? (
              <p className="mt-1 text-[11px] text-critical">
                Company nets a loss on this booking — vendor credits exceed customer payment.
                Expected when the booking includes free seats; the loss is the cost of the promo.
              </p>
            ) : null}
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border/60 bg-panel px-6 py-3">
          <p className="text-xs text-muted">
            {allResolved ? (
              <span className="text-success">All items resolved. Ready to apply.</span>
            ) : (
              <span>
                {drafts.filter((d) => d.type === 'unresolved').length} of {drafts.length} items
                still unresolved.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-neutral min-h-9 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!allResolved || saving}
              className="ui-btn ui-btn-accent min-h-9 px-4 text-sm"
            >
              {saving ? 'Applying…' : 'Apply resolution'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

const Row = ({ label, value }: { label: ReactNode; value: ReactNode }) => (
  <div className="flex justify-between gap-3 py-1 text-sm">
    <span className="text-muted">{label}</span>
    <span className="font-medium text-text">{value}</span>
  </div>
)

interface ItemRowProps {
  index: number
  draft: ItemDraft
  catalogForBranch: CatalogOption[]
  catalogOther: CatalogOption[]
  eventCatalogForBranch: CatalogOption[]
  eventCatalogOther: CatalogOption[]
  vendors: VendorOption[]
  packages: EventPackageOption[]
  /** Booking branch — used to surface this-branch packages/combos first. */
  bookingBranchId: string
  /** Optional history-based vendor suggestion index. */
  vendorSuggestions?: VendorSuggestionIndex
  onChange: (patch: Partial<ItemDraft>) => void
  onRemove?: () => void
  onFanOut: (pkg: EventPackageOption, seats: number) => void
}

const ItemRow = ({
  index,
  draft,
  catalogForBranch,
  catalogOther,
  eventCatalogForBranch,
  eventCatalogOther,
  vendors,
  packages,
  bookingBranchId,
  vendorSuggestions,
  onChange,
  onRemove,
  onFanOut,
}: ItemRowProps) => {
  const [showFanOut, setShowFanOut] = useState(false)
  const [pickedPackageKey, setPickedPackageKey] = useState('')
  const composePkgKey = (p: EventPackageOption) => `${p.campaignId}::${p.packageId}`

  // Catalog filter: typing here narrows the catalog dropdown so the admin
  // can search by part of the item name (e.g. "smart" or "combo") without
  // scrolling through hundreds of variants. Pre-filled with the booking
  // item's own name so the relevant catalog rows surface first.
  const [catalogFilter, setCatalogFilter] = useState(draft.itemName || '')
  const filterCatalog = (list: CatalogOption[]) => {
    const q = catalogFilter.trim().toLowerCase()
    if (!q) return list
    const tokens = q.split(/\s+/).filter(Boolean)
    return list.filter((c) => {
      const hay = c.composedLabel.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }

  // Vendor filter: typing narrows the vendor dropdown by name + branch +
  // preferredActivity + ID. Useful when the vendor list grows past ~20.
  const [vendorFilter, setVendorFilter] = useState('')
  const filteredVendors = useMemo(() => {
    const q = vendorFilter.trim().toLowerCase()
    if (!q) return vendors
    const tokens = q.split(/\s+/).filter(Boolean)
    return vendors.filter((v) => {
      const hay = `${v.name} ${v.branch} ${v.preferredActivity} ${v.id}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [vendorFilter, vendors])
  const filteredForBranch = filterCatalog(catalogForBranch)
  const filteredOther = filterCatalog(catalogOther)
  const filteredEventForBranch = filterCatalog(eventCatalogForBranch)
  const filteredEventOther = filterCatalog(eventCatalogOther)
  const totalFilteredCount =
    filteredForBranch.length +
    filteredOther.length +
    filteredEventForBranch.length +
    filteredEventOther.length

  const handleFanOut = () => {
    const [campaignId, packageId] = pickedPackageKey.split('::')
    const pkg = packages.find((p) => p.campaignId === campaignId && p.packageId === packageId)
    if (!pkg) return
    onFanOut(pkg, draft.quantity)
    setShowFanOut(false)
    setPickedPackageKey('')
  }

  return (
    <div className="rounded-xl border border-border/60 bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="font-medium text-text">
          <span className="mr-2 text-xs text-muted">#{index + 1}</span>
          {draft.itemName || '(no name)'}
          {draft._source && draft._source !== 'manual' ? (
            <span
              className={`ml-2 rounded-full border px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider ${
                draft._source === 'billing-items'
                  ? 'border-success/40 bg-success/5 text-success'
                  : draft._source === 'history'
                    ? 'border-info/40 bg-info/5 text-info'
                    : 'border-warning/40 bg-warning/5 text-warning'
              }`}
              title={
                draft._source === 'billing-items'
                  ? 'Pre-filled from this booking’s billingItems[] (canonical source).'
                  : draft._source === 'history'
                    ? 'Vendor auto-filled because exactly one vendor was historically credited for this catalog item at this branch.'
                    : draft._source === 'name-match'
                      ? 'Catalog auto-set via exact normalized item name match.'
                      : 'Auto-filled from combo/event package.'
              }
            >
              ✓ {draft._source.replace('-', ' ')}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted">
            qty {draft.quantity} · {currency(draft.unitPrice)} ea
          </p>
          {packages.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowFanOut((s) => !s)}
              className="ui-btn ui-btn-neutral min-h-6 px-2 py-0.5 text-[11px]"
              title="Replace this row with one row per item in an event package"
            >
              Fan out from package
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="ui-btn ui-btn-neutral min-h-6 px-2 py-0.5 text-[11px] text-critical"
              aria-label={`Remove item ${index + 1}`}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {showFanOut ? (
        <div className="mb-3 rounded-lg border border-info/40 bg-info/5 p-2">
          <p className="mb-2 text-[11px] text-muted">
            Replaces this row with one row per item in the package or combo.
            <br />
            <strong>Event packages</strong>: each item is priced at the campaign-configured price ×
            this row's quantity ({draft.quantity}) — quantity is treated as seats.
            <br />
            <strong>POS combos</strong>: each item is priced at its bundle adjustedPrice ×{' '}
            <strong>1</strong> — adjust the quantity on each row afterwards based on how many combos
            were sold.
            <br />
            Vendor + share auto-fill from config. Pick below to preview.
          </p>
          <select
            value={pickedPackageKey}
            onChange={(e) => setPickedPackageKey(e.target.value)}
            className="ui-field min-h-8 w-full text-xs"
            aria-label="Pick a package or combo to fan out from"
          >
            <option value="">— pick an event package or combo —</option>
            {(() => {
              const same = (loc: string) =>
                loc.trim().toLowerCase() === bookingBranchId.trim().toLowerCase()
              const eventThis = packages.filter(
                (p) => p.kind === 'event-package' && same(p.locationKey),
              )
              const eventOther = packages.filter(
                (p) => p.kind === 'event-package' && !same(p.locationKey),
              )
              const comboThis = packages.filter((p) => p.kind === 'combo' && same(p.locationKey))
              const comboOther = packages.filter((p) => p.kind === 'combo' && !same(p.locationKey))
              // Truncate long Firestore doc IDs so the dropdown stays
              // readable while still exposing enough to disambiguate.
              const shortId = (id: string): string =>
                id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
              const renderEventOption = (p: EventPackageOption) => (
                <option
                  key={composePkgKey(p)}
                  value={composePkgKey(p)}
                  title={`Loaded from eventCampaigns/${p.truthDocId}/packages[${p.truthPackageId}]`}
                >
                  {p.campaignName} · {p.packageName} · {p.items.length} item
                  {p.items.length === 1 ? '' : 's'}
                  {p.locationKey ? ` · @${p.locationKey}` : ''} · eventCampaigns/
                  {shortId(p.truthDocId)}
                </option>
              )
              const renderComboOption = (p: EventPackageOption) => (
                <option
                  key={composePkgKey(p)}
                  value={composePkgKey(p)}
                  title={`Loaded from combos/${p.truthDocId}`}
                >
                  {p.packageName} · {p.items.length} item
                  {p.items.length === 1 ? '' : 's'}
                  {p.locationKey ? ` · @${p.locationKey}` : ''} · combos/{shortId(p.truthDocId)}
                </option>
              )
              return (
                <>
                  {eventThis.length > 0 ? (
                    <optgroup label={`Event packages — this branch (${bookingBranchId || '?'})`}>
                      {eventThis.map(renderEventOption)}
                    </optgroup>
                  ) : null}
                  {comboThis.length > 0 ? (
                    <optgroup label={`POS combos — this branch (${bookingBranchId || '?'})`}>
                      {comboThis.map(renderComboOption)}
                    </optgroup>
                  ) : null}
                  {eventOther.length > 0 ? (
                    <optgroup label="Event packages — other branches">
                      {eventOther.map(renderEventOption)}
                    </optgroup>
                  ) : null}
                  {comboOther.length > 0 ? (
                    <optgroup label="POS combos — other branches">
                      {comboOther.map(renderComboOption)}
                    </optgroup>
                  ) : null}
                </>
              )
            })()}
          </select>
          {pickedPackageKey ? (
            <PackagePreview pickedKey={pickedPackageKey} packages={packages} />
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowFanOut(false)
                setPickedPackageKey('')
              }}
              className="ui-btn ui-btn-neutral min-h-8 px-3 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleFanOut}
              disabled={!pickedPackageKey}
              className="ui-btn ui-btn-accent min-h-8 px-3 text-xs"
            >
              Fan out
            </button>
          </div>
        </div>
      ) : null}

      <label className="mb-2 block">
        <span className="text-[10px] uppercase tracking-wider text-muted">Item name</span>
        <input
          type="text"
          value={draft.itemName}
          onChange={(e) => onChange({ itemName: e.target.value })}
          className="ui-field min-h-8 w-full text-sm"
          placeholder="e.g. Paint Ball - 15 bullets"
          aria-label={`Name for item ${index + 1}`}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted">Quantity</span>
          <input
            type="number"
            min={1}
            value={draft.quantity}
            onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            className="ui-field min-h-8 w-full text-sm"
            aria-label={`Quantity for ${draft.itemName || 'item'}`}
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted">Unit price</span>
          <input
            type="number"
            min={0}
            value={draft.unitPrice}
            onChange={(e) => onChange({ unitPrice: Math.max(0, Number(e.target.value) || 0) })}
            className="ui-field min-h-8 w-full text-sm"
            aria-label={`Unit price for ${draft.itemName || 'item'}`}
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted">Attribution</span>
          <select
            value={draft.type}
            onChange={(e) => {
              const next = e.target.value as ItemDraft['type']
              const clearVendorId = next !== 'thirdParty' && next !== 'subLease'
              const clearCatalog = next === 'unresolved'
              onChange({
                type: next,
                ...(clearVendorId ? { vendorId: undefined, sharePercentOverride: undefined } : {}),
                ...(clearCatalog ? { catalogKey: undefined } : {}),
              })
            }}
            className="ui-field min-h-8 w-full text-sm"
            aria-label={`Attribution for ${draft.itemName || 'item'}`}
          >
            <option value="unresolved">— pick one —</option>
            <option value="thirdParty">Vendor (third party)</option>
            <option value="subLease">Vendor (sub lease)</option>
            <option value="company">Company revenue</option>
          </select>
        </label>
      </div>

      {draft.type !== 'unresolved' ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="block">
            <div className="mb-1 flex items-end justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                Catalog mapping (optional)
              </span>
              <span className="text-[10px] text-muted">
                {totalFilteredCount} match{totalFilteredCount === 1 ? '' : 'es'}
              </span>
            </div>
            <input
              type="text"
              value={catalogFilter}
              onChange={(e) => setCatalogFilter(e.target.value)}
              placeholder="Search the catalog (e.g. smart bounce, archery, vr)"
              className="ui-field min-h-7 mb-1 w-full text-xs"
              aria-label={`Filter catalog options for ${draft.itemName || 'item'}`}
            />
            <select
              value={draft.catalogKey ?? ''}
              onChange={(e) => onChange({ catalogKey: e.target.value || undefined })}
              className="ui-field min-h-8 w-full text-sm"
              aria-label={`Catalog mapping for ${draft.itemName || 'item'}`}
            >
              <option value="">— none —</option>
              {filteredForBranch.length > 0 ? (
                <optgroup label="Catalog · this branch">
                  {filteredForBranch.map((c) => (
                    <option key={`cat::${composeCatalogKey(c)}`} value={composeCatalogKey(c)}>
                      {c.composedLabel}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {filteredEventForBranch.length > 0 ? (
                <optgroup label="Event package items · this branch">
                  {filteredEventForBranch.map((c) => (
                    <option key={`evt::${composeCatalogKey(c)}`} value={composeCatalogKey(c)}>
                      {c.composedLabel}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {filteredOther.length > 0 ? (
                <optgroup label="Catalog · other branches">
                  {filteredOther.map((c) => (
                    <option key={`cat::${composeCatalogKey(c)}`} value={composeCatalogKey(c)}>
                      [{c.branchId}] {c.composedLabel}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {filteredEventOther.length > 0 ? (
                <optgroup label="Event package items · other branches">
                  {filteredEventOther.map((c) => (
                    <option key={`evt::${composeCatalogKey(c)}`} value={composeCatalogKey(c)}>
                      [{c.branchId}] {c.composedLabel}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {totalFilteredCount === 0 ? (
                <option value="" disabled>
                  No catalog or event-package rows match "{catalogFilter}". Clear the filter to see
                  all options.
                </option>
              ) : null}
            </select>
          </div>

          {draft.type === 'thirdParty' || draft.type === 'subLease' ? (
            <div className="block">
              <div className="mb-1 flex items-end justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  Vendor ({draft.type === 'subLease' ? 'sub-lease' : 'third-party'})
                </span>
                <span className="text-[10px] text-muted">
                  {filteredVendors.length} match{filteredVendors.length === 1 ? '' : 'es'}
                </span>
              </div>
              {(() => {
                if (!vendorSuggestions || draft.vendorId) return null
                if (!draft.catalogKey) return null
                const [bId, gId, sId, vId] = draft.catalogKey.split('::')
                const suggestions = lookupVendorSuggestions(
                  vendorSuggestions,
                  bId,
                  gId,
                  sId,
                  vId,
                  3,
                )
                if (suggestions.length === 0) return null
                return (
                  <div className="mb-1 rounded border border-info/30 bg-info/5 px-2 py-1 text-[11px]">
                    <span className="text-muted">Suggested from history:</span>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {suggestions.map((s) => {
                        const v = vendors.find((vv) => vv.id === s.vendorId)
                        if (!v) return null
                        const inferredType: ItemDraft['type'] =
                          v.vendorType === 'SubLease' ? 'subLease' : 'thirdParty'
                        return (
                          <button
                            key={s.vendorId}
                            type="button"
                            onClick={() =>
                              onChange({
                                vendorId: s.vendorId,
                                ...(inferredType !== draft.type ? { type: inferredType } : {}),
                              })
                            }
                            className="ui-btn ui-btn-neutral min-h-6 px-2 py-0 text-[11px]"
                            title={`${v.name} · ${v.vendorType} · ${v.revenueShare}% · matched ${s.count} past booking${s.count === 1 ? '' : 's'} for this catalog item at this branch`}
                          >
                            {v.name}
                            <span className="ml-1 text-muted">· {s.count}×</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
              <input
                type="text"
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                placeholder="Search by name, branch, activity, or phone"
                className="ui-field min-h-7 mb-1 w-full text-xs"
                aria-label={`Filter vendors for ${draft.itemName || 'item'}`}
              />
              <select
                value={draft.vendorId ?? ''}
                onChange={(e) => {
                  const next = e.target.value || undefined
                  // Auto-align attribution from the picked vendor:
                  //   - Pick a SubLease vendor   → type = 'subLease'
                  //   - Pick a ThirdParty vendor → type = 'thirdParty'
                  //   - Clear vendor             → type = 'company'
                  // The admin can still manually flip the attribution
                  // dropdown afterwards for one-off arrangements.
                  const v = next ? vendors.find((vv) => vv.id === next) : undefined
                  const inferredType: ItemDraft['type'] = !next
                    ? 'company'
                    : v?.vendorType === 'SubLease'
                      ? 'subLease'
                      : 'thirdParty'
                  onChange({
                    vendorId: next,
                    ...(inferredType !== draft.type ? { type: inferredType } : {}),
                    // When clearing vendor, also drop the share override —
                    // it's vendor-specific and stale for company rows.
                    ...(!next ? { sharePercentOverride: undefined } : {}),
                  })
                }}
                className="ui-field min-h-8 w-full text-sm"
                aria-label={`Vendor for ${draft.itemName || 'item'}`}
              >
                <option value="">— pick a vendor —</option>
                {filteredVendors.length === 0 ? (
                  <option value="" disabled>
                    No vendors match "{vendorFilter}". Clear the filter to see all vendors.
                  </option>
                ) : null}
                {filteredVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    [{v.vendorType === 'SubLease' ? 'SL' : 'TP'}] {v.name}
                    {v.branch ? ` · ${v.branch}` : ''}
                    {v.preferredActivity ? ` · ${v.preferredActivity}` : ''} · {v.id} ·{' '}
                    {v.revenueShare}%
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {(draft.type === 'thirdParty' || draft.type === 'subLease') && draft.vendorId ? (
        <label className="mt-2 block">
          <span className="text-[10px] uppercase tracking-wider text-muted">
            Override revenue share % (optional)
            {draft.type === 'subLease' ? ' — applied to base only; company keeps all GST' : ''}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={draft.sharePercentOverride ?? ''}
            onChange={(e) =>
              onChange({
                sharePercentOverride:
                  e.target.value === ''
                    ? undefined
                    : Math.min(100, Math.max(0, Number(e.target.value))),
              })
            }
            placeholder={`Default: ${vendors.find((v) => v.id === draft.vendorId)?.revenueShare ?? 80}%`}
            className="ui-field min-h-8 w-40 text-sm"
            aria-label={`Override revenue share for ${draft.itemName || 'item'}`}
          />
        </label>
      ) : null}
    </div>
  )
}

// Per-item preview card. Used inside the Preview pane both for plain
// items and for combo children (rendered nested under a combo header).
type PreviewRow = {
  draft: ItemDraft
  qty: number
  unit: number
  total: number
  base: number
  gst: number
  sharePct: number
  vendorBase: number
  vendorGst: number
  vendorTotal: number
  companyBase: number
  companyGst: number
  companyTotal: number
}

const PreviewItemCard = ({
  row: r,
  displayName,
  dense = false,
}: {
  row: PreviewRow
  displayName: string
  showComboPrefix: string | null
  dense?: boolean
}) => {
  const wrapper = dense
    ? 'rounded border border-border/40 bg-surface/60 px-2 py-1 text-[11px]'
    : 'rounded border border-border/40 bg-surface px-2 py-1.5 text-[11px]'
  return (
    <div className={wrapper}>
      <p className="font-medium text-text">
        {displayName || <span className="text-muted">(no name)</span>}
      </p>
      <p className="text-muted">
        {r.qty} × {currency(r.unit)} = {currency(r.total)}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-x-2">
        <span className="text-muted">Base</span>
        <span className="text-right">{currency(r.base)}</span>
        <span className="text-muted">GST</span>
        <span className="text-right">{currency(r.gst)}</span>
        {r.draft.type === 'thirdParty' || r.draft.type === 'subLease' ? (
          <>
            <span className="text-muted">
              {r.draft.type === 'subLease' ? 'Sub Lease' : 'Third Party'} share
            </span>
            <span className="text-right">{r.sharePct}%</span>
            <span className="text-muted">Vendor base</span>
            <span className="text-right text-success">{currency(r.vendorBase)}</span>
            <span className="text-muted">Vendor GST</span>
            <span className="text-right text-success">{currency(r.vendorGst)}</span>
            <span className="text-muted">Vendor total</span>
            <span className="text-right font-semibold text-success">{currency(r.vendorTotal)}</span>
            <span className="text-muted">Company base</span>
            <span className="text-right">{currency(r.companyBase)}</span>
            <span className="text-muted">Company GST</span>
            <span className="text-right">{currency(r.companyGst)}</span>
            <span className="text-muted">Company total</span>
            <span className="text-right font-semibold">{currency(r.companyTotal)}</span>
          </>
        ) : r.draft.type === 'company' ? (
          <>
            <span className="text-muted">Company keeps</span>
            <span className="text-right font-semibold">{currency(r.total)}</span>
          </>
        ) : (
          <span className="col-span-2 text-warning">Attribution not picked</span>
        )}
      </div>
    </div>
  )
}

const PackagePreview = ({
  pickedKey,
  packages,
}: {
  pickedKey: string
  packages: EventPackageOption[]
}) => {
  const [campaignId, packageId] = pickedKey.split('::')
  const pkg = packages.find((p) => p.campaignId === campaignId && p.packageId === packageId)
  if (!pkg) return null
  return (
    <div className="mt-2 rounded border border-info/30 bg-surface px-2 py-2 text-[11px]">
      <p className="font-semibold text-text">
        {pkg.campaignName} · {pkg.packageName}
        {pkg.locationKey ? ` (location ${pkg.locationKey})` : ''}
      </p>
      {/* Provenance banner — exact Firestore source for the data below. */}
      <p className="mt-1 rounded border border-border/60 bg-panel px-2 py-1 font-mono text-[10px] text-muted">
        ↳ {pkg.truthCollection}/{pkg.truthDocId}
        {pkg.truthPackageId ? `  ·  packages[${pkg.truthPackageId}]` : ''}
      </p>
      <table className="mt-1 w-full">
        <thead className="text-muted">
          <tr>
            <th className="text-left">Item</th>
            <th className="text-left">Type</th>
            <th className="text-left">Vendor</th>
            <th className="text-right">Config price</th>
            <th className="text-right">Share</th>
            <th className="text-left">IDs source</th>
          </tr>
        </thead>
        <tbody>
          {pkg.items.map((it, idx) => {
            const isCompany = it.type === 'company'
            const sourceTone =
              it.truthSource === 'combo-doc'
                ? 'border-success/40 bg-success/5 text-success'
                : it.truthSource === 'synthesized-slug'
                  ? 'border-warning/40 bg-warning/5 text-warning'
                  : 'border-border/60 bg-surface text-muted'
            const sourceLabel =
              it.truthSource === 'combo-doc'
                ? 'combo doc'
                : it.truthSource === 'synthesized-slug'
                  ? 'synth slug'
                  : 'none'
            const sourceTitle =
              it.truthSource === 'combo-doc'
                ? `Catalog IDs (gameId/subGameId/variantId) loaded directly from combos/${pkg.truthDocId}.items[].`
                : it.truthSource === 'synthesized-slug'
                  ? 'Catalog IDs synthesized as slugs from campaign + package + item names — eventCampaigns docs do not store catalog IDs on items[].'
                  : 'No catalog IDs available; admin must pick a catalog row manually after fan-out.'
            return (
              <tr key={idx} className="border-t border-border/40">
                <td className="py-0.5">{it.name}</td>
                <td className="py-0.5">{it.type}</td>
                <td className="py-0.5 font-mono">
                  {isCompany ? <span className="text-muted">n/a</span> : it.vendorId || '—'}
                </td>
                <td className="py-0.5 text-right">{currency(it.configPrice)}</td>
                <td className="py-0.5 text-right">
                  {isCompany ? (
                    <span className="text-muted">n/a</span>
                  ) : it.revenueShare === false ? (
                    '100% to vendor'
                  ) : (
                    'vendor default'
                  )}
                </td>
                <td className="py-0.5">
                  <span
                    className={`rounded border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider ${sourceTone}`}
                    title={sourceTitle}
                  >
                    {sourceLabel}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default OrphanResolverModal

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Keyboard, RefreshCw, RotateCw, X } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useLocations } from '../../hooks/useLocations'
import { logger } from '../../../lib/logger'
import { aggregateDayReport } from '../billing/checkout-day-report'
import { printDayReport } from '../billing/generateDayReport'
import { listAuditShiftsForDate, mergeAuditShifts, rollupByBranch } from './api'
import { auditShiftsToCsv, downloadCsv } from './export-csv'
import { fmtLongDate } from './format'
import type { AuditShift, BranchRollup, HubMode } from './types'
import { BranchChips } from './components/BranchChips'
import { DateStepper, shiftDateBy } from './components/DateStepper'
import { DiscrepancyStrip } from './components/DiscrepancyStrip'
import { ExportMenu } from './components/ExportMenu'
import { ShiftDrawer } from './components/ShiftDrawer'
import { ShiftLedger } from './components/ShiftLedger'
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet'
import { useDailyReportsHotkeys } from './use-hotkeys'
import { usersApi } from '../../api/users'
import './daily-reports.css'

interface DailyReportsHubProps {
  mode: HubMode
}

const todayIso = (): string => new Date().toISOString().slice(0, 10)

const PRIVILEGED_ROLES = new Set(['Owner', 'Admin', 'Developer'])

/**
 * Daily Reports Hub — the audit-grade view of cashier shift settlements
 * across all branches.
 *
 * Mode controls scope:
 *   • 'owner'   — `/reports/daily`, every branch, every cashier, full actions.
 *   • 'team'    — `/shifts/team`, every branch (gated by role), full actions.
 *   • 'my'      — `/shifts/my`, current user's shifts only, no moderation.
 *   • 'reports' — `/shifts/reports`, currently identical to 'team' but layout
 *                  reserves room for date-range mode in v2.
 */
export const DailyReportsHub = ({ mode }: DailyReportsHubProps) => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()

  const [date, setDate] = useState<string>(todayIso)
  const [audits, setAudits] = useState<AuditShift[]>([])
  const [namesByUserId, setNamesByUserId] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [printToast, setPrintToast] = useState<{ kind: 'error' | 'progress'; text: string } | null>(
    null,
  )
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set())
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const role = session?.user.role ?? 'Cashier'
  const canModerate = PRIVILEGED_ROLES.has(role) && mode !== 'my'

  const userIdScope = mode === 'my' ? session?.user.id : undefined
  const cashierOnly = mode === 'owner' || mode === 'team'

  // ── Load shifts for the selected date ───────────────────────────────────
  useEffect(() => {
    if (!session?.token) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    listAuditShiftsForDate(session.token, date, {
      userIdScope,
      cashierOnly,
    })
      .then((rows) => {
        if (cancelled) return
        setAudits(rows)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load shifts.'
        logger.error('daily_reports.load_failed', err, { date, mode })
        setLoadError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.token, date, userIdScope, cashierOnly, mode, refreshTick])

  // ── Hydrate cashier display names eagerly (one fetch per session, mounted
  //    in parallel with the shifts query so names are usually present on
  //    first paint of the ledger).
  useEffect(() => {
    if (!session?.token) return
    if (namesByUserId.size > 0) return
    let cancelled = false
    usersApi
      .list(session.token)
      .then(({ users }) => {
        if (cancelled) return
        const map = new Map<string, string>()
        for (const user of users) map.set(user.id, user.name)
        setNamesByUserId(map)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [session?.token, namesByUserId.size])

  // ── Display-merge: collapse duplicate same-day shifts per cashier+branch ──
  // The 2026-05-11 check-in/check-out bug left clusters of shift docs for the
  // same cashier on the same day. The underlying docs stay in Firestore (audit
  // trail preserved); the hub renders one merged row per group with the full
  // list exposed in the drawer for drill-down.
  const mergedAudits = useMemo(() => mergeAuditShifts(audits), [audits])

  // ── Derived: filtered audits and branch rollups ──────────────────────────
  const visibleAudits = useMemo(() => {
    if (selectedBranches.size === 0) return mergedAudits
    return mergedAudits.filter((a) => selectedBranches.has(a.branchSlug))
  }, [mergedAudits, selectedBranches])

  const rollups: BranchRollup[] = useMemo(() => rollupByBranch(mergedAudits), [mergedAudits])

  // ── Selected audit ────────────────────────────────────────────────────────
  // Selection id matches the merged row's primary sub-shift id (set by
  // mergeAuditShifts via the earliest-startTime shift). Look up in merged
  // first; fall back to the raw list so a deep-link to a sub-shift still
  // resolves to its merged parent.
  const selectedAudit = useMemo(() => {
    if (!selectedShiftId) return null
    const direct = mergedAudits.find((a) => a.shift.id === selectedShiftId)
    if (direct) return direct
    return (
      mergedAudits.find((a) => a.subShifts?.some((sub) => sub.shift.id === selectedShiftId)) ?? null
    )
  }, [mergedAudits, selectedShiftId])

  // ── Actions ───────────────────────────────────────────────────────────────
  const handlePrint = useCallback(
    async (audit: AuditShift) => {
      if (!session) return
      try {
        setPrintingId(audit.shift.id)
        setPrintToast({ kind: 'progress', text: 'Generating Day Report…' })
        const data = await aggregateDayReport(audit.shift.locationId, audit.shift.shiftDate)
        if (audit.shift.settlement) {
          data.settlement = {
            cashEntered: audit.cash.entered,
            cardEntered: audit.card.entered,
            upiEntered: audit.upi.entered,
            cashActual: audit.cash.actual,
            cardActual: audit.card.actual,
            upiActual: audit.upi.actual,
          }
        }
        await printDayReport(
          data,
          namesByUserId.get(audit.shift.userId) ?? audit.shift.userId,
          session.token,
        )
        setPrintToast(null)
      } catch (err) {
        logger.error('daily_reports.print_failed', err, { shiftId: audit.shift.id })
        setPrintToast({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not print Day Report.',
        })
      } finally {
        setPrintingId(null)
      }
    },
    [session, namesByUserId],
  )

  // Auto-dismiss the print toast after 6s if it's just an error.
  useEffect(() => {
    if (!printToast || printToast.kind !== 'error') return
    const timer = window.setTimeout(() => setPrintToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [printToast])

  const handleFlag = useCallback(async (audit: AuditShift) => {
    // Open the drawer focused on the flag composer; actual flag creation
    // happens through the composer in the drawer to keep one path.
    setSelectedShiftId(audit.shift.id)
  }, [])

  const handleExportCsv = useCallback(() => {
    const csv = auditShiftsToCsv(visibleAudits)
    const tag =
      mode === 'my'
        ? `my-shifts`
        : selectedBranches.size > 0
          ? [...selectedBranches].join('-')
          : 'all-branches'
    downloadCsv(`daily-report-${date}-${tag}.csv`, csv)
  }, [visibleAudits, date, selectedBranches, mode])

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1)
  }, [])

  // ── Keyboard shortcuts (single dispatcher) ───────────────────────────────
  const todayMax = todayIso()
  useDailyReportsHotkeys(
    {
      drawerOpen: Boolean(selectedAudit),
      cheatsheetOpen,
      canModerate,
      hasSelection: Boolean(selectedAudit),
      atToday: date >= todayMax,
    },
    {
      onPrevDay: () => setDate(shiftDateBy(date, -1)),
      onNextDay: () => setDate(shiftDateBy(date, 1)),
      onToday: () => setDate(todayMax),
      onCycleBranch: () => {
        if (enabledLocations.length === 0) return
        setSelectedBranches((prev) => {
          if (prev.size === 0) return new Set([enabledLocations[0].slug])
          const slugs = enabledLocations.map((l) => l.slug)
          const idx = slugs.indexOf([...prev][0])
          const next = slugs[(idx + 1) % slugs.length]
          return new Set([next])
        })
      },
      onPrint: () => {
        if (selectedAudit) void handlePrint(selectedAudit)
      },
      onFlag: () => {
        if (selectedAudit) void handleFlag(selectedAudit)
      },
      onToggleExport: () => setExportMenuOpen((v) => !v),
      onOpenCheatsheet: () => setCheatsheetOpen(true),
      onEscape: () => {
        if (cheatsheetOpen) setCheatsheetOpen(false)
        else if (selectedAudit) setSelectedShiftId(null)
        else if (exportMenuOpen) setExportMenuOpen(false)
      },
    },
  )

  // ── Render ────────────────────────────────────────────────────────────────
  const showOwnerHeadline = mode !== 'my'
  const ledgerEmpty = !loading && visibleAudits.length === 0
  const cashierName = selectedAudit
    ? (namesByUserId.get(selectedAudit.shift.userId) ?? selectedAudit.shift.userId)
    : ''

  return (
    <div className="dr-surface space-y-5 pb-12">
      {/* ── Discrepancy Strip first: the worst branch is the literal first
              thing on the page. Topbar follows. ─────────────────────────── */}
      {showOwnerHeadline && !loading && audits.length > 0 ? (
        <DiscrepancyStrip
          rollups={rollups}
          onSelect={(slug) => {
            setSelectedBranches((prev) => {
              if (prev.has(slug) && prev.size === 1) return new Set()
              return new Set([slug])
            })
          }}
          selectedSlug={selectedBranches.size === 1 ? [...selectedBranches][0] : null}
        />
      ) : null}

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateStepper date={date} onChange={setDate} />
          {mode !== 'my' && enabledLocations.length > 0 && (
            <div className="hidden md:block">
              <BranchChips
                branches={enabledLocations}
                selected={selectedBranches}
                onChange={setSelectedBranches}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={refresh}
            className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-panel text-muted transition-colors hover:text-text hover:border-text/30"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCheatsheetOpen(true)}
            className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-panel text-muted transition-colors hover:text-text hover:border-text/30"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span className="dr-keyhint" aria-hidden>
              ?
            </span>
          </button>
          {canModerate && (
            <ExportMenu
              onExportCsv={handleExportCsv}
              count={visibleAudits.length}
              open={exportMenuOpen}
              onOpenChange={setExportMenuOpen}
            />
          )}
        </div>
      </header>

      {mode !== 'my' && enabledLocations.length > 0 && (
        <div className="md:hidden">
          <BranchChips
            branches={enabledLocations}
            selected={selectedBranches}
            onChange={setSelectedBranches}
          />
        </div>
      )}

      {/* ── Personal header (mode='my') ────────────────────────────────── */}
      {mode === 'my' && (
        <section className="rounded-2xl border border-border bg-panel p-5">
          <p className="text-sm font-medium text-muted">Your shift on {fmtLongDate(date)}</p>
          {audits.length > 0 ? (
            <p className="mt-1 text-sm text-text">
              {audits.length} shift{audits.length === 1 ? '' : 's'} on record. Click a row to see
              your settlement breakdown and add context.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              No shifts recorded for this date. Use the date picker above to look back.
            </p>
          )}
        </section>
      )}

      {/* ── Load error (with Retry / Dismiss) ──────────────────────────── */}
      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-xl border border-critical/40 bg-critical/10 px-4 py-3 text-sm"
        >
          <div className="min-w-0 flex-1 text-critical">
            <p className="font-semibold">Couldn't load shifts</p>
            <p className="mt-0.5 text-[12px] text-critical/85">{loadError}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 rounded-md border border-critical/50 bg-base/40 px-2.5 py-1 text-[12px] font-semibold text-critical transition-colors hover:bg-critical/15"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              aria-label="Dismiss error"
              className="grid h-6 w-6 place-items-center rounded-md text-critical/80 transition-colors hover:bg-critical/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Ledger ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">
          <div className="dr-skeleton h-12 w-full" />
          <div className="dr-skeleton h-12 w-full" />
          <div className="dr-skeleton h-12 w-full" />
          <div className="dr-skeleton h-12 w-full" />
        </div>
      ) : ledgerEmpty ? (
        <div className="rounded-2xl border border-dashed border-border bg-panel/50 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-text">No shifts settled on this date</p>
          <p className="mt-1 text-xs text-muted">
            {selectedBranches.size > 0
              ? `Pick another branch or clear the filter.`
              : `Pick another date with the stepper above.`}
          </p>
        </div>
      ) : (
        <ShiftLedger
          audits={visibleAudits}
          nameByUserId={namesByUserId}
          selectedShiftId={selectedShiftId}
          onSelect={(audit) => setSelectedShiftId(audit.shift.id)}
          onPrint={handlePrint}
          onFlag={handleFlag}
          canModerate={canModerate}
          variant={mode === 'my' ? 'self' : 'audit'}
        />
      )}

      {/* ── Drawer ─────────────────────────────────────────────────────── */}
      {selectedAudit && session && (
        <ShiftDrawer
          audit={selectedAudit}
          cashierName={cashierName}
          token={session.token}
          currentUserId={session.user.id}
          canModerate={canModerate}
          onClose={() => setSelectedShiftId(null)}
          onChange={(next) => {
            setAudits((prev) => prev.map((a) => (a.shift.id === next.shift.id ? next : a)))
          }}
          onPrint={(a) => void handlePrint(a)}
          onRefresh={refresh}
        />
      )}

      {/* ── Cheatsheet ────────────────────────────────────────────────── */}
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />

      {/* ── Print toast (transient, separate slot from load errors) ───── */}
      {printToast ? (
        <div
          {...(printToast.kind === 'error'
            ? { role: 'alert' as const }
            : { role: 'status' as const })}
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div
            className={`pointer-events-auto flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-[12px] shadow-panel ${
              printToast.kind === 'error'
                ? 'border-critical/50 bg-base/95 text-critical'
                : 'border-border bg-panel/95 text-text'
            }`}
          >
            {printToast.kind === 'progress' ? (
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <X className="h-3 w-3" aria-hidden />
            )}
            <span className="font-medium">{printToast.text}</span>
            {printToast.kind === 'error' ? (
              <button
                type="button"
                onClick={() => setPrintToast(null)}
                aria-label="Dismiss"
                className="-mr-1 grid h-5 w-5 place-items-center rounded-md text-critical/70 hover:text-critical"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ── A11y live region for screen readers ───────────────────────── */}
      <div className="sr-only" aria-live="polite">
        {printingId ? 'Generating Day Report.' : ''}
      </div>
    </div>
  )
}

import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { logger } from '../../../../lib/logger'
import { listCashierIncentives } from '../../../api/incentives-firestore'
import { telecallerPerformanceApi } from '../../../api/telecaller-performance'
import {
  aggregateCashierMonth,
  buildBranchSummary,
  mapTelecallerMonth,
} from '../../../features/incentives-report/monthly-aggregator'
import { exportMonthlyExcel } from '../../../features/incentives-report/excel-export'
import { exportMonthlyPdf } from '../../../features/incentives-report/pdf-export'
import { monthLabelFromKey } from '../../../features/incentives-report/filename'
import {
  currentMonthKeyIST,
  monthBounds,
  weekKeysOverlappingMonth,
} from '../../../features/incentives-report/month-utils'
import type { MonthlyReportPayload } from '../../../features/incentives-report/types'
import type { CashierIncentiveRecord } from '../../../api/types'

interface Props {
  branchId?: string
}

export const MonthlyExportPopover = ({ branchId }: Props) => {
  const { session } = useAuth()
  const { enabledLocations } = useLocations()
  const [open, setOpen] = useState(false)
  const [monthKey, setMonthKey] = useState<string>(currentMonthKeyIST())
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [busy, setBusy] = useState(false)

  const branchLabel = branchId
    ? (enabledLocations.find((l) => l.branchId === branchId)?.displayName ?? branchId)
    : 'All Branches'

  const branchNameById = enabledLocations.reduce<Record<string, string>>((m, l) => {
    m[l.branchId] = l.displayName
    return m
  }, {})

  const handleExport = useCallback(async () => {
    setBusy(true)
    try {
      const { fromDate, toDate } = monthBounds(monthKey)
      const weekKeys = weekKeysOverlappingMonth(monthKey)
      const cashierWeekQueries = weekKeys.map((weekKey) =>
        listCashierIncentives({ weekKey, locationId: branchId, status: 'active' }),
      )
      const [weekResults, perfResult] = await Promise.all([
        Promise.all(cashierWeekQueries),
        telecallerPerformanceApi.listPerformance({ monthKey }),
      ])
      const seen = new Set<string>()
      const records: CashierIncentiveRecord[] = []
      for (const week of weekResults) {
        for (const r of week) {
          if (seen.has(r.id)) continue
          if (r.transactionDate < fromDate || r.transactionDate > toDate) continue
          seen.add(r.id)
          records.push(r)
        }
      }
      const cashiers = aggregateCashierMonth(records, branchNameById)
      const telecallers = mapTelecallerMonth(perfResult.performance)
      const payload: MonthlyReportPayload = {
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        branchLabel,
        generatedAt: new Date().toISOString(),
        generatedByName: session?.user.name ?? session?.user.id ?? 'Unknown',
        cashiers,
        telecallers,
        branchSummary: buildBranchSummary(cashiers, telecallers, branchNameById),
      }
      if (format === 'xlsx') await exportMonthlyExcel(payload)
      else exportMonthlyPdf(payload)
      setOpen(false)
    } catch (err) {
      logger.error('incentives.monthly.popover_export_failed', err)
    } finally {
      setBusy(false)
    }
  }, [monthKey, branchId, branchLabel, branchNameById, format, session])

  return (
    <div className="relative">
      <button
        className="ui-btn ui-btn-neutral inline-flex items-center gap-2 px-4 text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <Download className="h-4 w-4" /> Export Month
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-border/50 bg-panel p-4 shadow-lg">
          <p className="mb-2 text-xs font-medium text-muted">Month</p>
          <input
            type="month"
            className="mb-3 w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value || currentMonthKeyIST())}
          />
          <p className="mb-2 text-xs font-medium text-muted">Format</p>
          <select
            className="mb-3 w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF (.pdf)</option>
          </select>
          <p className="mb-3 text-[10px] text-muted">Branch: {branchLabel}</p>
          <div className="flex gap-2">
            <button
              className="ui-btn ui-btn-info flex-1 text-sm"
              disabled={busy}
              onClick={handleExport}
            >
              {busy ? 'Exporting...' : 'Export'}
            </button>
            <button
              className="ui-btn ui-btn-neutral text-sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

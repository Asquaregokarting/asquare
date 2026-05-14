import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, ExternalLink, ScanLine } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { ModulePageLayout } from '../../../components/layout/ModulePageLayout'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'
import EmptyState from '../../../../components/ui/EmptyState'
import Skeleton from '../../../../components/ui/Skeleton'
import {
  KartRecord,
  KartDeepCleanLogRecord,
  KartCondition,
  KartEngineStatus,
  KartStatus,
  subscribeKartsByLocation,
  subscribeDeepCleanHistoryByLocation,
} from '../../../features/track/services/kartService'
import {
  SCANNER_LOCATIONS,
} from '../../../features/track/scanner/types/scanner.types'
import { fmtDateTimeFullIST } from '../../../../lib/date-format'

export type KartMonitorView = 'board' | 'daily' | 'scanner'

const subnav = [
  { label: 'Status board', to: '/hr/kart-monitor' },
  { label: 'Daily cleaning', to: '/hr/kart-monitor/daily' },
  { label: 'Scanner uptime', to: '/hr/kart-monitor/scanner' },
]

const STATUS_TONE: Record<KartStatus, string> = {
  available: 'border-success/40 bg-success/10 text-success',
  under_repair: 'border-warning/40 bg-warning/10 text-warning',
}

const CONDITION_TONE: Record<KartCondition, string> = {
  good: 'border-success/30 bg-success/5 text-success',
  damaged: 'border-critical/30 bg-critical/5 text-critical',
}

const ENGINE_TONE: Record<KartEngineStatus, string> = {
  working: 'text-success',
  engine_fail: 'text-critical',
}

const todayIso = (): string => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10)
}

const KartMonitorModule = ({ view }: { view: KartMonitorView }) => {
  const { session } = useAuth()
  const [branchFilter, setBranchFilter] = useState<string>(SCANNER_LOCATIONS[0] ?? '')
  const [karts, setKarts] = useState<KartRecord[]>([])
  const [kartsLoading, setKartsLoading] = useState(true)
  const [cleanHistory, setCleanHistory] = useState<KartDeepCleanLogRecord[]>([])
  const [cleanLoading, setCleanLoading] = useState(true)

  // Subscribe to karts at the selected location. kartService writes to the
  // canonical `locations/{loc}/karts/{kartId}` subcollection — we read the
  // same source instead of maintaining a parallel HR fleet table.
  useEffect(() => {
    if (!session || !branchFilter) return
    setKartsLoading(true)
    const unsubscribe = subscribeKartsByLocation(
      branchFilter,
      (records) => {
        setKarts(records)
        setKartsLoading(false)
      },
      () => {
        setKarts([])
        setKartsLoading(false)
      },
    )
    return unsubscribe
  }, [branchFilter, session])

  useEffect(() => {
    if (!session || !branchFilter) return
    setCleanLoading(true)
    const unsubscribe = subscribeDeepCleanHistoryByLocation(
      branchFilter,
      (records) => {
        setCleanHistory(records)
        setCleanLoading(false)
      },
      () => {
        setCleanHistory([])
        setCleanLoading(false)
      },
    )
    return unsubscribe
  }, [branchFilter, session])

  const cleanedTodayByKart = useMemo(() => {
    const today = todayIso()
    const set = new Set<string>()
    cleanHistory.forEach((log) => {
      if (log.cleanedDate === today) set.add(log.kartId)
    })
    return set
  }, [cleanHistory])

  const summary = useMemo(() => {
    let available = 0
    let underRepair = 0
    let damaged = 0
    let engineFail = 0
    karts.forEach((kart) => {
      if (kart.status === 'available') available += 1
      if (kart.status === 'under_repair') underRepair += 1
      if (kart.condition === 'damaged') damaged += 1
      if (kart.engineStatus === 'engine_fail') engineFail += 1
    })
    return {
      available,
      underRepair,
      damaged,
      engineFail,
      total: karts.length,
      cleanedToday: cleanedTodayByKart.size,
    }
  }, [karts, cleanedTodayByKart])

  const title =
    view === 'daily'
      ? 'Kart Daily Cleaning'
      : view === 'scanner'
        ? 'Scanner Uptime'
        : 'Kart Status Board'
  const subtitle =
    view === 'daily'
      ? 'Deep clean log entries with photo evidence and operator sign-off.'
      : view === 'scanner'
        ? 'Per-kart scanner activity — placeholder until the scanner pipeline exposes uptime.'
        : 'Live kart roster from the canonical track inventory. Today’s cleaning compliance at a glance.'

  return (
    <ModulePageLayout
      moduleTab="KartMonitor"
      title={title}
      subtitle={subtitle}
      breadcrumbs={[
        'Pipeline',
        'HR',
        'Kart Monitor',
        view === 'board' ? 'Board' : view === 'daily' ? 'Daily' : 'Scanner',
      ]}
      subnav={subnav}
      subnavActions={
        <a
          href="/track/karts"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" /> Manage karts (Track)
        </a>
      }
    >
      <FilterBar>
        <FilterField label="Branch">
          <select
            className="ui-field min-h-10"
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
          >
            {SCANNER_LOCATIONS.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <div className="mt-4 mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="Available" value={String(summary.available)} tone="success" />
        <SummaryCard label="Under repair" value={String(summary.underRepair)} tone="warning" />
        <SummaryCard
          label="Damaged"
          value={String(summary.damaged)}
          tone={summary.damaged > 0 ? 'critical' : 'neutral'}
        />
        <SummaryCard
          label="Engine fail"
          value={String(summary.engineFail)}
          tone={summary.engineFail > 0 ? 'critical' : 'neutral'}
        />
        <SummaryCard
          label="Cleaned today"
          value={`${summary.cleanedToday}/${summary.total}`}
          tone={summary.cleanedToday < summary.total ? 'warning' : 'success'}
        />
      </div>

      {view === 'scanner' ? (
        <ScannerView />
      ) : view === 'daily' ? (
        <DailyCleaningView records={cleanHistory} loading={cleanLoading} />
      ) : (
        <StatusBoard
          karts={karts}
          loading={kartsLoading}
          cleanedTodayByKart={cleanedTodayByKart}
        />
      )}
    </ModulePageLayout>
  )
}

const StatusBoard = ({
  karts,
  loading,
  cleanedTodayByKart,
}: {
  karts: KartRecord[]
  loading: boolean
  cleanedTodayByKart: Set<string>
}) => {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    )
  }
  if (karts.length === 0) {
    return (
      <EmptyState
        title="No karts at this branch"
        description="Open Manage karts (Track) to register karts for this location."
        icon={<AlertTriangle className="h-8 w-8" />}
      />
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {karts.map((kart) => {
        const cleanedToday = cleanedTodayByKart.has(kart.id)
        return (
          <div key={kart.id} className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-foreground tabular-nums">
                  #{kart.kartNumber}
                </div>
                <div className="text-xs text-muted">
                  {kart.kartType} · {kart.location}
                </div>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                  STATUS_TONE[kart.status]
                }`}
              >
                {kart.status === 'available' ? 'Available' : 'Under repair'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
                  CONDITION_TONE[kart.condition]
                }`}
              >
                {kart.condition}
              </span>
              <span className={`tabular-nums ${ENGINE_TONE[kart.engineStatus]}`}>
                {kart.engineStatus === 'working' ? 'Engine OK' : 'Engine fail'}
              </span>
            </div>
            {kart.complaint ? (
              <p className="mt-2 text-xs text-muted line-clamp-2">⚠ {kart.complaint}</p>
            ) : null}
            <div className="mt-3 text-xs">
              {cleanedToday ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Cleaned today
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> Not cleaned today
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const DailyCleaningView = ({
  records,
  loading,
}: {
  records: KartDeepCleanLogRecord[]
  loading: boolean
}) => {
  if (loading) return <Skeleton className="h-24 w-full" />
  if (records.length === 0) {
    return (
      <EmptyState
        title="No deep clean logs yet"
        description="Operators log deep cleans from the Track module; entries appear here automatically."
        icon={<Camera className="h-8 w-8" />}
      />
    )
  }
  return (
    <div className="space-y-3">
      {records.map((record) => (
        <div key={record.id} className="rounded-xl border border-border bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-foreground">
                Kart #{record.kartNumber}{' '}
                <span className="text-xs text-muted">· {record.location}</span>
              </div>
              <div className="text-xs text-muted tabular-nums">
                {record.cleanedDate} · cleaned by {record.cleanedBy}
                {record.cleanedAt
                  ? ` · ${fmtDateTimeFullIST(record.cleanedAt.toDate().toISOString())}`
                  : ''}
              </div>
            </div>
          </div>
          {(record.photoUrls && record.photoUrls.length > 0) || record.photoUrl ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(record.photoUrls ?? [record.photoUrl]).filter(Boolean).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block h-20 w-28 overflow-hidden rounded-md border border-border bg-base/50"
                >
                  <img
                    src={url}
                    alt="Deep clean evidence"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </a>
              ))}
              {record.videoUrl ? (
                <a
                  href={record.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-20 w-28 items-center justify-center rounded-md border border-border bg-base/50 text-xs text-muted hover:text-foreground"
                >
                  ▶ Video
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const ScannerView = () => (
  <EmptyState
    title="Scanner uptime not yet wired"
    description="The scanner pipeline at /track/scanner emits per-scan events but doesn't aggregate uptime. Wire when the scanner service exposes a heartbeat."
    icon={<ScanLine className="h-8 w-8" />}
  />
)

const SummaryCard = ({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'accent' | 'warning' | 'success' | 'critical'
}) => (
  <div className="rounded-xl border border-border bg-panel p-4">
    <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    <div
      className={`mt-1 text-2xl font-semibold tabular-nums ${
        tone === 'accent'
          ? 'text-accent'
          : tone === 'warning'
            ? 'text-warning'
            : tone === 'success'
              ? 'text-success'
              : tone === 'critical'
                ? 'text-critical'
                : 'text-foreground'
      }`}
    >
      {value}
    </div>
  </div>
)

export default KartMonitorModule

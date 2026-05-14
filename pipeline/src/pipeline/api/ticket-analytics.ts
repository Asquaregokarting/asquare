import type { Ticket } from './types'

export interface BucketCount {
  key: string
  label: string
  count: number
}

/**
 * Group tickets by branchId and return the counts sorted descending.
 * The label falls back to the branch id when no display name is set.
 */
export function aggregateByBranch(tickets: ReadonlyArray<Ticket>): BucketCount[] {
  const map = new Map<string, { label: string; count: number }>()
  for (const t of tickets) {
    const key = t.branchId
    const existing = map.get(key)
    if (existing) existing.count += 1
    else map.set(key, { label: t.branchDisplayName || key, count: 1 })
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Group tickets by categoryId and return the counts sorted descending.
 * Label intentionally mirrors the id — the caller can re-label using
 * `TicketCategory[]` from `subscribeToTicketCategories` for friendlier UX.
 */
export function aggregateByCategory(tickets: ReadonlyArray<Ticket>): BucketCount[] {
  const map = new Map<string, number>()
  for (const t of tickets) map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)
}

export interface MttrResult {
  resolvedCount: number
  meanResolveSeconds: number
  medianResolveSeconds: number
}

/**
 * Mean and median time-to-resolve across the supplied tickets, in seconds.
 * Tickets without `resolvedAt` are excluded. A non-positive duration (clock
 * skew) is also dropped.
 */
export function computeMTTR(tickets: ReadonlyArray<Ticket>): MttrResult {
  const durations: number[] = []
  for (const t of tickets) {
    if (!t.resolvedAt || !t.createdAt) continue
    const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()
    if (ms > 0) durations.push(ms / 1000)
  }
  if (durations.length === 0) {
    return { resolvedCount: 0, meanResolveSeconds: 0, medianResolveSeconds: 0 }
  }
  durations.sort((a, b) => a - b)
  const sum = durations.reduce((a, b) => a + b, 0)
  const mid = Math.floor(durations.length / 2)
  const median =
    durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid]
  return {
    resolvedCount: durations.length,
    meanResolveSeconds: sum / durations.length,
    medianResolveSeconds: median,
  }
}

/**
 * Fraction of tickets that breached their resolve SLA.
 *
 * - If `resolvedAt` is set, breached when resolution happened after `resolveDueAt`.
 * - If still open and not Closed, breached when *now* is past `resolveDueAt`.
 * - Tickets without `resolveDueAt` are treated as never-breaching.
 */
export function breachRate(tickets: ReadonlyArray<Ticket>): number {
  if (tickets.length === 0) return 0
  let breached = 0
  const nowMs = Date.now()
  for (const t of tickets) {
    const dueMs = t.resolveDueAt ? new Date(t.resolveDueAt).getTime() : Infinity
    if (t.resolvedAt) {
      const resolvedMs = new Date(t.resolvedAt).getTime()
      if (resolvedMs > dueMs) breached += 1
    } else if (t.status !== 'Closed' && nowMs > dueMs) {
      breached += 1
    }
  }
  return breached / tickets.length
}

export interface HeatmapCell {
  branchId: string
  categoryId: string
  /** 0-23, IST. */
  hour: number
  count: number
}

/**
 * Build a (branch × category × hour-of-day-IST) heatmap matrix.
 * IST is UTC+5:30 with no DST.
 */
export function heatmapMatrix(tickets: ReadonlyArray<Ticket>): HeatmapCell[] {
  const map = new Map<string, HeatmapCell>()
  for (const t of tickets) {
    const d = new Date(t.createdAt)
    if (Number.isNaN(d.getTime())) continue
    // IST = UTC+5:30. Compute by adding 330 minutes to the UTC clock.
    const totalUtcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + 330
    const istHour = Math.floor(totalUtcMinutes / 60) % 24
    const key = `${t.branchId}|${t.categoryId}|${istHour}`
    const existing = map.get(key)
    if (existing) existing.count += 1
    else
      map.set(key, {
        branchId: t.branchId,
        categoryId: t.categoryId,
        hour: istHour,
        count: 1,
      })
  }
  return Array.from(map.values())
}

export interface KartFailureRow {
  kartId: string
  count: number
  lastIncidentAt: string
}

/**
 * Count kart-failure incidents per kart from `track-safety` category tickets.
 * Looks at `linkedEntities` of type `'kart'`; sorted by count descending.
 */
export function kartFailureReport(tickets: ReadonlyArray<Ticket>): KartFailureRow[] {
  const map = new Map<string, { count: number; lastIncidentAt: string }>()
  for (const t of tickets) {
    if (t.categoryId !== 'track-safety') continue
    for (const e of t.linkedEntities) {
      if (e.type !== 'kart') continue
      const existing = map.get(e.id)
      const at = t.createdAt
      if (existing) {
        existing.count += 1
        if (at > existing.lastIncidentAt) existing.lastIncidentAt = at
      } else {
        map.set(e.id, { count: 1, lastIncidentAt: at })
      }
    }
  }
  return Array.from(map.entries())
    .map(([kartId, v]) => ({ kartId, ...v }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Count tickets created on each of the last `days` (UTC-day buckets).
 * Returns oldest → newest. The most-recent bucket is always today.
 */
export function ticketsPerDay(
  tickets: ReadonlyArray<Ticket>,
  days: number,
  now: Date = new Date(),
): Array<{ date: string; count: number }> {
  if (days <= 0) return []
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)
  const buckets: Array<{ date: string; count: number }> = []
  const indexByDate = new Map<string, number>()
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    indexByDate.set(iso, buckets.length)
    buckets.push({ date: iso, count: 0 })
  }
  for (const t of tickets) {
    const d = new Date(t.createdAt)
    if (Number.isNaN(d.getTime())) continue
    const iso = d.toISOString().slice(0, 10)
    const idx = indexByDate.get(iso)
    if (idx !== undefined) buckets[idx].count += 1
  }
  return buckets
}

/**
 * Compute MTTR per branch — useful for the Owner dashboard table.
 */
export function mttrPerBranch(
  tickets: ReadonlyArray<Ticket>,
): Array<{ branchId: string; branchDisplayName: string; mttr: MttrResult }> {
  const groups = new Map<string, { branchDisplayName: string; tickets: Ticket[] }>()
  for (const t of tickets) {
    const existing = groups.get(t.branchId)
    if (existing) existing.tickets.push(t)
    else
      groups.set(t.branchId, {
        branchDisplayName: t.branchDisplayName || t.branchId,
        tickets: [t],
      })
  }
  return Array.from(groups.entries()).map(([branchId, v]) => ({
    branchId,
    branchDisplayName: v.branchDisplayName,
    mttr: computeMTTR(v.tickets),
  }))
}

/**
 * Pick the oldest unresolved ticket — used for the Incharge "Oldest open" card.
 */
export function oldestUnresolved(tickets: ReadonlyArray<Ticket>): Ticket | null {
  let oldest: Ticket | null = null
  for (const t of tickets) {
    if (t.status === 'Resolved' || t.status === 'Closed') continue
    if (!oldest || t.createdAt < oldest.createdAt) oldest = t
  }
  return oldest
}

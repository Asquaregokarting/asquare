import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ticket, TicketCategory } from '../../../api/types'
import { subscribeToTickets } from '../../../api/tickets'
import { subscribeToTicketCategories } from '../../../api/ticket-categories'
import { useAuth } from '../../../features/auth/auth-context'
import { heatmapMatrix } from '../../../api/ticket-analytics'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * Bucket a count into 9 intensity tiers (0 → 8). Tier 0 is "no tickets",
 * tiers 1-8 grow log-ishly so a single ticket is still visible.
 */
const intensity = (count: number, max: number): number => {
  if (count === 0 || max === 0) return 0
  const ratio = count / max
  // 8 buckets — boundaries at 12.5%, 25%, …, 100%.
  return Math.min(8, Math.max(1, Math.ceil(ratio * 8)))
}

const TONE: Record<number, string> = {
  0: 'bg-surface/40',
  1: 'bg-info/10',
  2: 'bg-info/20',
  3: 'bg-info/30',
  4: 'bg-info/40',
  5: 'bg-info/50',
  6: 'bg-info/60',
  7: 'bg-info/75',
  8: 'bg-info/90',
}

interface RowKey {
  branchId: string
  categoryId: string
}

const fmtRowLabel = (
  branchId: string,
  categoryId: string,
  branchLabelMap: Map<string, string>,
  categoryLabelMap: Map<string, string>,
): string => {
  const branch = branchLabelMap.get(branchId) ?? branchId
  const category = categoryLabelMap.get(categoryId) ?? categoryId
  return `${branch} · ${category}`
}

export const TicketsHeatmapView = () => {
  const { session } = useAuth()
  const role = session?.user.role
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef<(() => void) | null>(null)
  const unsubCatRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setLoading(true)
    unsubRef.current = subscribeToTickets(
      (rows) => {
        setTickets(rows)
        setLoading(false)
      },
      () => setLoading(false),
    )
    unsubCatRef.current = subscribeToTicketCategories(
      (rows) => setCategories(rows),
      () => {},
    )
    return () => {
      unsubRef.current?.()
      unsubCatRef.current?.()
    }
  }, [])

  const branchLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    tickets.forEach((t) => {
      if (!m.has(t.branchId)) m.set(t.branchId, t.branchDisplayName || t.branchId)
    })
    return m
  }, [tickets])

  const categoryLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c) => m.set(c.id, c.label))
    return m
  }, [categories])

  const cells = useMemo(() => heatmapMatrix(tickets), [tickets])

  const rows = useMemo<RowKey[]>(() => {
    const set = new Map<string, RowKey>()
    cells.forEach((c) => {
      const k = `${c.branchId}|${c.categoryId}`
      if (!set.has(k)) set.set(k, { branchId: c.branchId, categoryId: c.categoryId })
    })
    return Array.from(set.values()).sort((a, b) => {
      const al = fmtRowLabel(a.branchId, a.categoryId, branchLabelMap, categoryLabelMap)
      const bl = fmtRowLabel(b.branchId, b.categoryId, branchLabelMap, categoryLabelMap)
      return al.localeCompare(bl)
    })
  }, [cells, branchLabelMap, categoryLabelMap])

  const matrix = useMemo(() => {
    // (branchId|categoryId|hour) -> count
    const m = new Map<string, number>()
    cells.forEach((c) => {
      m.set(`${c.branchId}|${c.categoryId}|${c.hour}`, c.count)
    })
    return m
  }, [cells])

  const max = useMemo(() => cells.reduce((acc, c) => Math.max(acc, c.count), 0), [cells])

  const allowed = role === 'Owner' || role === 'Admin' || role === 'Developer'

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">Heatmap is restricted to Owner / Admin.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-surface" />
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
        <p className="text-sm text-muted">No tickets to plot yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">
          Tickets by branch · category · hour (IST)
        </h2>
        <p className="text-xs text-muted">
          Each cell shows the volume in that hour. Darker = more tickets.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border/45 bg-panel p-3">
        <table className="min-w-[780px] border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-panel pr-2 text-left text-xs font-medium text-muted">
                Branch · Category
              </th>
              {HOURS.map((h) => (
                <th key={h} className="px-1 text-center text-[10px] font-medium text-muted">
                  {h.toString().padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.branchId}|${row.categoryId}`}>
                <td
                  className="sticky left-0 z-[1] bg-panel pr-2 text-left text-xs text-text"
                  title={`${row.branchId} · ${row.categoryId}`}
                >
                  {fmtRowLabel(row.branchId, row.categoryId, branchLabelMap, categoryLabelMap)}
                </td>
                {HOURS.map((h) => {
                  const count = matrix.get(`${row.branchId}|${row.categoryId}|${h}`) ?? 0
                  const tone = TONE[intensity(count, max)]
                  return (
                    <td
                      key={h}
                      className={`h-6 w-6 rounded ${tone}`}
                      title={`${count} ticket${count === 1 ? '' : 's'} at ${h.toString().padStart(2, '0')}:00 IST`}
                      aria-label={`${count} tickets at ${h}:00`}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Max in any cell: <span className="font-semibold text-text">{max}</span>
      </p>
    </div>
  )
}

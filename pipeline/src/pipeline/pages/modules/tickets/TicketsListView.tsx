import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Role, Ticket, TicketCategory, TicketPriority, TicketStatus } from '../../../api/types'
import { subscribeToTickets, updateTicketStatus } from '../../../api/tickets'
import { subscribeToTicketCategories } from '../../../api/ticket-categories'
import { ticketsToCsv, triggerCsvDownload } from '../../../api/ticket-csv-export'
import { useAuth } from '../../../features/auth/auth-context'
import { useToast } from '../../../features/toast/toast-context'
import { FilterBar, FilterField } from '../../../components/ui/FilterBar'
import { TicketDetailModal } from './TicketDetailModal'

const TICKET_STATUS_OPTIONS: TicketStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed']
const TICKET_PRIORITY_OPTIONS: TicketPriority[] = ['Low', 'Normal', 'High', 'Critical']

const ticketStatusTone = (status: TicketStatus): string => {
  switch (status) {
    case 'Open':
      return 'bg-critical/15 text-critical'
    case 'In Progress':
      return 'bg-warning/15 text-warning'
    case 'Resolved':
      return 'bg-success/15 text-success'
    case 'Closed':
      return 'bg-muted/15 text-muted'
    default:
      return 'bg-muted/15 text-muted'
  }
}

const priorityTone = (p: TicketPriority): string => {
  switch (p) {
    case 'Critical':
      return 'bg-critical/15 text-critical'
    case 'High':
      return 'bg-warning/15 text-warning'
    case 'Normal':
      return 'bg-info/15 text-info'
    case 'Low':
      return 'bg-muted/15 text-muted'
  }
}

export const TicketsListView = ({ isOwnerOrDev }: { isOwnerOrDev: boolean }) => {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<TicketStatus | 'All'>('All')
  const [filterLocation, setFilterLocation] = useState('All')
  const [filterCategory, setFilterCategory] = useState<string>('All')
  const [filterPriority, setFilterPriority] = useState<TicketPriority | 'All'>('All')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const { success, error: toastError } = useToast()
  const { session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('openId')

  const unsubRef = useRef<(() => void) | null>(null)
  const unsubCatRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setTicketsLoading(true)
    unsubRef.current = subscribeToTickets(
      (rows) => {
        setTickets(rows)
        setTicketsLoading(false)
      },
      () => setTicketsLoading(false),
    )
    unsubCatRef.current = subscribeToTicketCategories(
      (rows) => setCategories(rows),
      () => {
        // Categories failing to load is non-fatal; the filter still works
        // with the 'All' value and per-ticket categoryId labels fall back.
      },
    )
    return () => {
      unsubRef.current?.()
      unsubCatRef.current?.()
    }
  }, [])

  const filtered = useMemo(() => {
    let result = tickets
    if (filterStatus !== 'All') result = result.filter((t) => t.status === filterStatus)
    if (filterLocation !== 'All') result = result.filter((t) => t.location === filterLocation)
    if (filterCategory !== 'All') result = result.filter((t) => t.categoryId === filterCategory)
    if (filterPriority !== 'All') result = result.filter((t) => t.priority === filterPriority)
    return result
  }, [tickets, filterStatus, filterLocation, filterCategory, filterPriority])

  const uniqueLocations = useMemo(
    () => [...new Set(tickets.map((t) => t.location))].sort(),
    [tickets],
  )

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>()
    tickets.forEach((t) => map.set(t.id, t))
    return map
  }, [tickets])

  const actor = useMemo(() => {
    const user = session?.user
    return {
      id: user?.id ?? '',
      name: user?.name ?? '',
      role: (user?.role ?? 'ThirdParty') as Role,
    }
  }, [session])

  const openTicket = openId ? ticketsById.get(openId) : undefined

  const handleOpenTicket = (ticketId: string): void => {
    const next = new URLSearchParams(searchParams)
    next.set('openId', ticketId)
    setSearchParams(next)
  }

  const handleCloseModal = (): void => {
    const next = new URLSearchParams(searchParams)
    next.delete('openId')
    setSearchParams(next)
  }

  const handleStatusChange = async (ticketId: string, newStatus: TicketStatus) => {
    setUpdatingId(ticketId)
    try {
      await updateTicketStatus(ticketId, newStatus)
      success(`Ticket ${ticketId} updated to ${newStatus}`)
    } catch {
      toastError('Failed to update ticket status')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleExportCsv = (): void => {
    const csv = ticketsToCsv(filtered)
    const today = new Date().toISOString().slice(0, 10)
    triggerCsvDownload(`tickets-${today}.csv`, csv)
  }

  const fmtTime = (iso: string): string => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      })
    } catch {
      return '-'
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterField label="Status">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as TicketStatus | 'All')}
            className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {TICKET_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Location">
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {uniqueLocations.map((loc) => {
              const t = tickets.find((tk) => tk.location === loc)
              return (
                <option key={loc} value={loc}>
                  {t?.locationDisplayName ?? loc}
                </option>
              )
            })}
          </select>
        </FilterField>
        <FilterField label="Category">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {categories
              .filter((c) => c.active)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </FilterField>
        <FilterField label="Priority">
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as TicketPriority | 'All')}
            className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm"
          >
            <option value="All">All</option>
            {TICKET_PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={ticketsLoading || filtered.length === 0}
          className="rounded-lg border border-border/70 bg-surface px-3 py-1.5 text-sm font-medium text-text transition hover:bg-surface/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export CSV ({filtered.length})
        </button>
      </div>

      {ticketsLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/45 bg-panel p-8 text-center">
          <p className="text-sm text-muted">No tickets found.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border/45">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/45 bg-surface/50">
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                    Ticket ID
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Role</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Location</th>
                  <th className="px-3 py-2.5 font-medium text-muted">Issue</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                    Raised By
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">
                    Assigned To
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Status</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-muted">Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border/30 transition hover:bg-surface/30"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(t.id)}
                        className="text-info underline-offset-2 hover:underline"
                      >
                        {t.id}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{t.role}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{t.locationDisplayName}</td>
                    <td className="max-w-[280px] truncate px-3 py-2.5" title={t.issue}>
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(t.id)}
                        className="text-left hover:text-text"
                      >
                        {t.issue}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                      {t.raisedByName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                      {t.assignedToName || 'Developer'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {isOwnerOrDev ? (
                          <select
                            value={t.status}
                            disabled={updatingId === t.id}
                            onChange={(e) =>
                              handleStatusChange(t.id, e.target.value as TicketStatus)
                            }
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ticketStatusTone(t.status)}`}
                          >
                            {TICKET_STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ticketStatusTone(t.status)}`}
                          >
                            {t.status}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${priorityTone(t.priority)}`}
                        >
                          {t.priority}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">
                      {fmtTime(t.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Showing {filtered.length} ticket{filtered.length !== 1 ? 's' : ''}
          </p>
        </>
      )}

      {openTicket ? (
        <TicketDetailModal
          open={true}
          onClose={handleCloseModal}
          ticket={openTicket}
          actor={actor}
        />
      ) : null}
    </div>
  )
}

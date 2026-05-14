import { useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { fmtDateIST } from '../../../../lib/date-format'
import { useAuth } from '../../../features/auth/auth-context'
import {
  formatBookingItems,
  formatCurrency,
  formatDateInput,
  normalizeRole,
} from './bookings-utils'
import { usePrintTicket } from './usePrintTicket'

const TicketLookupView = () => {
  const { session } = useAuth()
  const role = normalizeRole(session?.user.role)
  const actor = {
    id: session?.user.id || 'unknown',
    name: session?.user.name || 'Unknown',
    role,
  }

  const {
    printTicket,
    printing,
    reprintMessage,
    clearReprintMessage,
    reprintConfirm,
    resolveReprintConfirm,
  } = usePrintTicket(actor)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AsquareBooking[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearched(false)
    setError(null)
    try {
      const all = await asquareBookingsApi.listAdminBookings()
      const lower = q.toLowerCase()
      const digitsOnly = q.replace(/\D/g, '')
      const isDateQuery = /^\d{4}-\d{2}-\d{2}$/.test(q) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(q)

      const matched = all.filter((b) => {
        if (b.id.toLowerCase().includes(lower)) return true
        if (digitsOnly.length >= 4 && (b.userPhone ?? '').includes(digitsOnly)) return true
        if ((b.userDisplayName ?? '').toLowerCase().includes(lower)) return true
        const email = String((b as Record<string, unknown>).email ?? '')
        if (email.toLowerCase().includes(lower)) return true
        if (isDateQuery) {
          const bookingDate = formatDateInput(new Date(b.sessionDate))
          let normalizedQuery = q
          const ddmmyyyy = q.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
          if (ddmmyyyy) {
            normalizedQuery = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
          }
          if (bookingDate === normalizedQuery) return true
        }
        return false
      })

      setResults(matched)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  const handlePrint = async (booking: AsquareBooking) => {
    const result = await printTicket(booking)
    if (!result.success && result.message) {
      setError(result.message)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mx-auto max-w-xl space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSearch()
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            className="ui-field min-h-12 flex-1 text-base text-white"
            placeholder="Phone, Name, Booking ID, Email, or Date (DD/MM/YYYY)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="ui-btn ui-btn-primary min-h-12 px-6 text-base"
            disabled={searching || !query.trim()}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {error && (
          <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}

        {reprintMessage && (
          <p className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-sm text-warning">
            {reprintMessage}
            <button type="button" onClick={clearReprintMessage} className="ml-2 text-xs underline">
              Dismiss
            </button>
          </p>
        )}

        {searched && results.length === 0 ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-center text-sm text-warning">
            No bookings found for &quot;{query}&quot;
          </p>
        ) : null}

        {results.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {results.length} booking{results.length > 1 ? 's' : ''} found
            </p>
            {results.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-4 rounded-xl border border-border bg-panel p-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-bold text-text">{b.id}</p>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${b.bookingStatus === 'confirmed' || b.bookingStatus === 'completed' ? 'bg-success/20 text-success' : b.bookingStatus === 'cancelled' ? 'bg-critical/20 text-critical' : 'bg-warning/20 text-warning'}`}
                    >
                      {b.bookingStatus}
                    </span>
                  </div>
                  <p className="text-sm text-text">
                    {b.userDisplayName || 'Guest'} &middot; {b.userPhone || 'No phone'}
                  </p>
                  <p className="text-xs text-muted">{formatBookingItems(b)}</p>
                  <p className="text-xs text-muted">
                    Date: {fmtDateIST(b.sessionDate)} &middot; Amount:{' '}
                    {formatCurrency(b.finalAmount)} &middot; Payment: {b.paymentStatus}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handlePrint(b)}
                  disabled={b.paymentStatus !== 'completed' || printing}
                  className={`ui-btn min-h-10 whitespace-nowrap px-5 text-sm ${b.paymentStatus === 'completed' ? 'ui-btn-primary' : 'opacity-50 cursor-not-allowed bg-muted text-muted'}`}
                >
                  {printing
                    ? 'Printing...'
                    : b.paymentStatus === 'completed'
                      ? 'Print Ticket'
                      : 'Payment Pending'}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={reprintConfirm !== null}
        title="Reprint Ticket"
        description={
          reprintConfirm
            ? `This ticket has already been printed ${reprintConfirm.printCount} time(s) before. This reprint will be logged for admin review. Continue?`
            : ''
        }
        confirmLabel="Reprint"
        onConfirm={() => resolveReprintConfirm(true)}
        onCancel={() => resolveReprintConfirm(false)}
      />
    </div>
  )
}

export default TicketLookupView

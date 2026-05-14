// A² Waiting List — Read-only, auto-synced from bookings.serials[].
// No manual actions. Queue auto-populated from today's paid Go-Karting bookings.
// Status: pending (waiting) → completed (done). Updated when scanner verifies.

import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { initializeFirestore } from '../../../lib/firebase'
import { resolveLocation } from '../../../../lib/locations'
import {
  SCANNER_LOCATIONS,
  SCANNER_LOCATION_IDS,
  SCANNER_LOCATION_BRANCH_IDS,
  SCANNER_LOCATION_DOC_IDS,
  ScannerLocation,
} from '../scanner/types/scanner.types'
import { useLocations } from '../../../hooks/useLocations'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface QueueSerial {
  id: string
  serialNumber: number
  itemName: string
  customerName?: string
  customerPhone?: string
  invoiceNumber?: string
  status: 'waiting' | 'done'
  verifiedAt?: string
  verifiedBy?: string
}

interface WaitingKartType {
  gameSerialNumber: number
  name: string
  engineCc: string
}

const KART_TYPES: WaitingKartType[] = [
  { gameSerialNumber: 2, name: 'Adult Kart', engineCc: '270cc' },
  { gameSerialNumber: 1, name: 'Child Kart', engineCc: '200cc' },
  { gameSerialNumber: 3, name: 'Double Kart', engineCc: '270cc' },
]

const BOOKINGS_COLLECTION = 'bookings'
const LOCATION_KEY = 'waitinglist-location'

const getTodayPrefix = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const toDatePrefix = (value: unknown): string | undefined => {
  if (!value) return undefined
  if (typeof value === 'string') return value.slice(0, 10)
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return undefined
}

const isGoKartingActivity = (name: string): boolean => {
  const n = name.toLowerCase()
  return (
    n.includes('gokarting') ||
    n.includes('go-karting') ||
    n.includes('go karting') ||
    n.includes('gokart') ||
    n.includes('go-kart') ||
    n.includes('go kart')
  )
}

const classifyKartType = (itemName: string): number => {
  const n = itemName.toLowerCase()
  if (n.includes('child') || n.includes('kids') || n.includes('junior')) return 1
  if (n.includes('double')) return 3
  return 2
}

const getKartCc = (itemName: string): string => {
  const n = itemName.toLowerCase()
  if (n.includes('child') || n.includes('kids') || n.includes('junior')) return '200cc'
  return '270cc'
}

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '****'
  return '****' + digits.slice(-4)
}

const padSerial = (num: number): string => String(num).padStart(3, '0')

// ---------------------------------------------------------------------------
// Hook: subscribe to bookings → extract serial queue (read-only)
// ---------------------------------------------------------------------------

interface RawBookingDoc {
  invoiceNumber?: string
  orderNumber?: string
  userDisplayName?: string
  customerName?: string
  userName?: string
  userPhone?: string
  customerPhone?: string
  mobile?: string
  sessionDate?: unknown
  createdAt?: unknown
  paymentStatus?: string
  bookingStatus?: string
  items?: unknown[]
  billingItems?: unknown[]
  printSerials?: number[]
  serials?: Array<{
    serialId?: string
    status?: string
    verifiedAt?: string
    verifiedBy?: string
  }>
}

/** Build all possible locationId values for a given scanner location display name. */
const buildLocationIds = (location: string): string[] => {
  const ids = new Set<string>()
  const slug = SCANNER_LOCATION_IDS[location]
  const branchId = SCANNER_LOCATION_BRANCH_IDS[location]
  const docId = SCANNER_LOCATION_DOC_IDS[location]
  if (slug) ids.add(slug)
  if (branchId) ids.add(branchId)
  if (docId) ids.add(docId)
  ids.add(location)
  ids.add(location.toLowerCase())
  return Array.from(ids)
}

const useBookingSerials = (selectedLocation: string) => {
  const [serials, setSerials] = useState<QueueSerial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const db = initializeFirestore()
    if (!db) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const locationIds = buildLocationIds(selectedLocation)
    const q = query(collection(db, BOOKINGS_COLLECTION), where('locationId', 'in', locationIds))

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const today = getTodayPrefix()
        const results: QueueSerial[] = []

        for (const d of snapshot.docs) {
          const raw = d.data() as RawBookingDoc
          const ps = String(raw.paymentStatus ?? '').toLowerCase()
          const bs = String(raw.bookingStatus ?? '').toLowerCase()
          if (ps !== 'completed') continue
          if (bs !== 'confirmed' && bs !== 'completed') continue

          const bookingDate = toDatePrefix(raw.sessionDate) ?? toDatePrefix(raw.createdAt)
          if (bookingDate !== today) continue

          const customerName = raw.userDisplayName ?? raw.customerName ?? raw.userName
          const customerPhone = raw.userPhone ?? raw.customerPhone ?? raw.mobile
          const invoiceNumber = raw.invoiceNumber ?? raw.orderNumber

          const items = raw.items ?? []
          const billingItems = raw.billingItems ?? []
          const storedSerials = raw.serials ?? []
          const printSerials = Array.isArray(raw.printSerials) ? raw.printSerials : []
          const storedMap = new Map(storedSerials.map((s) => [s.serialId, s]))

          let fallbackIdx = 0
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx] as Record<string, unknown>
            const billing = billingItems[idx] as Record<string, unknown> | undefined
            const activity = item.activity as Record<string, unknown> | undefined
            const itemName = String(item.itemName ?? activity?.name ?? billing?.itemName ?? 'Item')
            const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1))
            const serialStart =
              Math.floor(
                Number(printSerials[idx] ?? billing?.serialStart ?? item.serialStart ?? 0),
              ) || 0

            if (!isGoKartingActivity(itemName)) {
              fallbackIdx += quantity
              continue
            }

            for (let unit = 0; unit < quantity; unit++) {
              const serialNumber = serialStart > 0 ? serialStart + unit : 0
              const serialId =
                serialNumber > 0
                  ? `S-${String(serialNumber).padStart(3, '0')}`
                  : `item-${fallbackIdx}`
              fallbackIdx++
              const stored = storedMap.get(serialId)

              results.push({
                id: `${d.id}_${serialId}`,
                serialNumber,
                itemName,
                customerName: customerName ? String(customerName) : undefined,
                customerPhone: customerPhone ? String(customerPhone) : undefined,
                invoiceNumber: invoiceNumber ? String(invoiceNumber) : undefined,
                status: stored?.status === 'completed' ? 'done' : 'waiting',
                verifiedAt: stored?.verifiedAt,
                verifiedBy: stored?.verifiedBy,
              })
            }
          }
        }

        results.sort((a, b) => a.serialNumber - b.serialNumber)
        setSerials(results)
        setLoading(false)
      },
      (err) => {
        setError(err.message || 'Failed to load queue.')
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [selectedLocation])

  return { serials, loading, error }
}

// ---------------------------------------------------------------------------
// Kart Queue Card (read-only)
// ---------------------------------------------------------------------------

const KartQueueCard = ({
  kart,
  serials,
  loading,
}: {
  kart: WaitingKartType
  serials: QueueSerial[]
  loading: boolean
}) => {
  const waiting = serials.filter((s) => s.status === 'waiting').length
  const done = serials.filter((s) => s.status === 'done').length

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-track-surface">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700/60">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">{kart.name}</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-white/50">
              {kart.engineCc}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-white/40">
            {done} done · {waiting} waiting · {serials.length} total
          </p>
        </div>
        <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[10px] font-medium text-gray-400 dark:bg-white/5 dark:text-white/30">
          Auto-synced
        </span>
      </div>

      <div className="p-3">
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-gray-300 dark:text-white/30">
            Loading...
          </div>
        )}

        {!loading && serials.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-gray-300 dark:text-white/30">
            No customers in queue
          </div>
        )}

        {!loading && serials.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {serials.map((serial, idx) => {
              const isDone = serial.status === 'done'
              const position = isDone
                ? null
                : serials.filter((s, i) => i < idx && s.status === 'waiting').length + 1

              return (
                <div
                  key={serial.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    isDone
                      ? 'border-emerald-500/20 bg-emerald-500/5 opacity-50'
                      : 'border-gray-100 bg-gray-50/50 dark:border-white/5 dark:bg-white/[0.02]'
                  }`}
                >
                  <div
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                      isDone ? 'bg-emerald-500/60 text-white' : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {padSerial(serial.serialNumber)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {serial.customerName ?? 'Guest'}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400 dark:text-white/35">
                      <span>{serial.itemName}</span>
                      <span>{getKartCc(serial.itemName)}</span>
                      {serial.customerPhone && <span>{maskPhone(serial.customerPhone)}</span>}
                      {isDone && serial.verifiedBy && <span>Verified by {serial.verifiedBy}</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {isDone ? (
                      <span className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-400">
                        Done
                      </span>
                    ) : (
                      <span className="rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-400">
                        #{position} in queue
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export const WaitingListAdmin = () => {
  const { isRoleLocked, allowedSlugs } = useLocations()

  // Filter locations by role-based access
  const visibleLocations = useMemo(() => {
    if (!isRoleLocked) return SCANNER_LOCATIONS
    return SCANNER_LOCATIONS.filter((name) => {
      const loc = resolveLocation(name)
      return loc && allowedSlugs.includes(loc.slug)
    })
  }, [isRoleLocked, allowedSlugs])

  const [selectedLocation, setSelectedLocation] = useState<ScannerLocation>(() => {
    const stored = localStorage.getItem(LOCATION_KEY)
    if (stored && SCANNER_LOCATIONS.includes(stored as ScannerLocation))
      return stored as ScannerLocation
    return visibleLocations[0] || SCANNER_LOCATIONS[0]
  })

  // Auto-select for restricted roles with exactly one location
  useEffect(() => {
    if (isRoleLocked && visibleLocations.length === 1 && selectedLocation !== visibleLocations[0]) {
      setSelectedLocation(visibleLocations[0])
    }
  }, [isRoleLocked, visibleLocations, selectedLocation])

  useEffect(() => {
    localStorage.setItem(LOCATION_KEY, selectedLocation)
  }, [selectedLocation])

  const { serials, loading, error } = useBookingSerials(selectedLocation)

  const serialsByType = useMemo(() => {
    const map: Record<number, QueueSerial[]> = {}
    for (const k of KART_TYPES) map[k.gameSerialNumber] = []
    for (const s of serials) {
      const type = classifyKartType(s.itemName)
      if (map[type]) map[type].push(s)
    }
    return map
  }, [serials])

  const totalWaiting = serials.filter((s) => s.status === 'waiting').length
  const totalDone = serials.filter((s) => s.status === 'done').length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-track-surface">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-track-accent-soft/80">
            Waiting List
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-white/50">
            Auto-synced from today's bookings. Verify in Scanner to mark done.
          </p>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="text-gray-600 dark:text-white/60">{serials.length} total</span>
            <span className="text-amber-400">{totalWaiting} waiting</span>
            <span className="text-emerald-400">{totalDone} done</span>
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-white/45">
            Location{isRoleLocked ? ' (Locked)' : ''}
          </span>
          <select
            value={selectedLocation}
            disabled={isRoleLocked}
            onChange={(e) => setSelectedLocation(e.target.value as ScannerLocation)}
            className="min-w-48 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-emerald-500/50 disabled:opacity-60 dark:border-gray-700 dark:bg-track-panel dark:text-white"
          >
            {visibleLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {KART_TYPES.map((kart) => (
        <KartQueueCard
          key={kart.gameSerialNumber}
          kart={kart}
          serials={serialsByType[kart.gameSerialNumber] ?? []}
          loading={loading}
        />
      ))}
    </div>
  )
}

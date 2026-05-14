import { collection, onSnapshot, query, where, Unsubscribe } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { branchIdToSlug, getAllLocations } from '../lib/locations'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaitingSlot {
    srno: number
    bookingId: string
    status: 'occupied' | 'done' | 'available'
    mobile: string | null
    customerName: string | null
    checkInTime: string | null
    kartNumber: string | null
    completedAt: string | null
}

export interface WaitingListResponse {
    gameSerialNumber: number
    branchId: string
    date: string
    slots: WaitingSlot[]
}

// ---------------------------------------------------------------------------
// Kart type mappings
// ---------------------------------------------------------------------------

export const KART_TYPES = [
    { gameSerialNumber: 2, name: 'Adult kart', icon: '🚗', color: 'from-orange-500 to-red-500', engineCc: '270cc' },
    { gameSerialNumber: 1, name: 'Child kart', icon: '🏎️', color: 'from-blue-500 to-cyan-500', engineCc: '200cc' },
    { gameSerialNumber: 3, name: 'Double Kart', icon: '👥', color: 'from-purple-500 to-pink-500', engineCc: '270cc' }
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOOKINGS_COLLECTION = 'bookings'

const toLocalDateStr = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const getTodayStr = (): string => toLocalDateStr(new Date())

/** Extract YYYY-MM-DD from any Firestore date format using LOCAL time. */
const toDatePrefix = (value: unknown): string | undefined => {
    if (!value) return undefined
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10)
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
        return toLocalDateStr((value as { toDate: () => Date }).toDate())
    }
    if (value instanceof Date && !isNaN(value.getTime())) return toLocalDateStr(value)
    return undefined
}

const GK_KEYWORDS = ['gokarting', 'go-karting', 'go karting', 'gokart', 'go-kart', 'go kart', 'go_karting', 'go_kart']

const isGoKartingText = (text: string): boolean => {
    if (!text) return false
    const lower = text.toLowerCase()
    return GK_KEYWORDS.some(kw => lower.includes(kw))
}

/** Classify kart type: 1=child, 2=adult, 3=double */
const classifyKartType = (itemName: string): number => {
    const n = itemName.toLowerCase()
    if (n.includes('child') || n.includes('kids') || n.includes('junior')) return 1
    if (n.includes('double')) return 3
    return 2
}

/** Build all location ID variants for a branchId to handle inconsistent storage. */
const buildLocationIds = (branchId: string): string[] => {
    const ids = new Set<string>()
    const slug = branchIdToSlug(branchId)
    ids.add(slug)
    ids.add(branchId)
    const loc = getAllLocations().find(l => l.branchId === branchId || l.slug === slug)
    if (loc) {
        ids.add(loc.displayName)
        ids.add(loc.displayName.toLowerCase())
        ids.add(loc.firestoreDocId)
    }
    return Array.from(ids)
}

interface RawBookingDoc {
    userDisplayName?: string
    customerName?: string
    userName?: string
    userPhone?: string
    customerPhone?: string
    mobile?: string
    sessionDate?: unknown
    createdAt?: unknown
    visitDate?: unknown
    transactionDate?: unknown
    paymentStatus?: string
    bookingStatus?: string
    items?: unknown[]
    billingItems?: unknown[]
    printSerials?: number[]
    serials?: Array<{
        serialId?: string
        status?: string
        kartNumber?: string
        rideStartedAt?: string
        verifiedAt?: string
    }>
}

interface ExtractedSerial {
    serialNumber: number
    gameSerialNumber: number
    customerName: string | null
    customerPhone: string | null
    status: 'occupied' | 'done' | 'available'
    kartNumber: string | null
    checkInTime: string | null
    completedAt: string | null
}

/** Extract serial entries from a single booking document. */
const extractSerials = (raw: RawBookingDoc): ExtractedSerial[] => {
    const customerName = raw.userDisplayName ?? raw.customerName ?? raw.userName ?? null
    const customerPhone = raw.userPhone ?? raw.customerPhone ?? raw.mobile ?? null

    const items = Array.isArray(raw.items) ? raw.items : []
    const billingItems = Array.isArray(raw.billingItems) ? raw.billingItems : []
    const printSerials = Array.isArray(raw.printSerials) ? raw.printSerials : []
    const storedSerials = raw.serials ?? []
    const storedMap = new Map(
        storedSerials.filter(s => s.serialId).map(s => [s.serialId as string, s])
    )

    const results: ExtractedSerial[] = []
    const sourceItems = items.length > 0 ? items : billingItems
    let fallbackIdx = 0

    for (let idx = 0; idx < sourceItems.length; idx++) {
        const item = sourceItems[idx] as Record<string, unknown>
        const billing = billingItems[idx] as Record<string, unknown> | undefined
        const activity = item.activity as Record<string, unknown> | undefined
        const itemName = String(item.itemName ?? activity?.name ?? billing?.itemName ?? 'Item')
        const activityCategory = String(activity?.category ?? billing?.category ?? '')
        const gameTypeId = String(activity?.gameTypeId ?? billing?.gameTypeId ?? '')
        const quantity = Math.max(1, Math.floor(Number(item.quantity ?? billing?.quantity) || 1))
        const serialStart = Math.floor(
            Number(printSerials[idx] ?? billing?.serialStart ?? item.serialStart ?? 0)
        ) || 0

        // Detect Go-Karting by serial presence OR name/category match
        const hasSerial = serialStart > 0
        const isGk = isGoKartingText(itemName) || isGoKartingText(activityCategory) || gameTypeId === '2'
        if (!hasSerial && !isGk) {
            fallbackIdx += quantity
            continue
        }

        const gameSerialNumber = classifyKartType(itemName)

        for (let unit = 0; unit < quantity; unit++) {
            const serialNumber = hasSerial ? serialStart + unit : fallbackIdx + 1
            const serialId = hasSerial
                ? `S-${String(serialNumber).padStart(3, '0')}`
                : `item-${fallbackIdx}`
            fallbackIdx++
            const stored = storedMap.get(serialId)

            let status: ExtractedSerial['status'] = 'available'
            if (stored?.status === 'completed') status = 'done'
            else if (stored?.status === 'riding') status = 'occupied'

            results.push({
                serialNumber,
                gameSerialNumber,
                customerName: customerName ? String(customerName) : null,
                customerPhone: customerPhone ? String(customerPhone) : null,
                status,
                kartNumber: stored?.kartNumber ? String(stored.kartNumber) : null,
                checkInTime: stored?.rideStartedAt ? String(stored.rideStartedAt) : null,
                completedAt: stored?.verifiedAt ? String(stored.verifiedAt) : null
            })
        }
    }

    return results
}

// ---------------------------------------------------------------------------
// Real-time subscription — reads from bookings collection
// ---------------------------------------------------------------------------

/** Subscribe to all kart types for a branch at once. */
export function subscribeAllWaitingLists(
    branchId: string,
    onData: (results: Array<{ gameSerialNumber: number; data: WaitingListResponse | null }>) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    if (!db) {
        onData(KART_TYPES.map(k => ({ gameSerialNumber: k.gameSerialNumber, data: null })))
        return () => undefined
    }

    const locationIds = buildLocationIds(branchId)

    const q = query(
        collection(db, BOOKINGS_COLLECTION),
        where('locationId', 'in', locationIds)
    )

    const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
            const today = getTodayStr()
            const byType = new Map<number, WaitingSlot[]>()
            for (const k of KART_TYPES) byType.set(k.gameSerialNumber, [])

            for (const d of snapshot.docs) {
                const raw = d.data() as RawBookingDoc
                const ps = String(raw.paymentStatus ?? '').toLowerCase()
                const bs = String(raw.bookingStatus ?? '').toLowerCase()
                if (ps !== 'completed') continue
                if (bs !== 'confirmed' && bs !== 'completed') continue

                const bookingDate =
                    toDatePrefix(raw.sessionDate) ??
                    toDatePrefix(raw.visitDate) ??
                    toDatePrefix(raw.transactionDate) ??
                    toDatePrefix(raw.createdAt)
                if (bookingDate !== today) continue

                const serials = extractSerials(raw)
                for (const serial of serials) {
                    const slots = byType.get(serial.gameSerialNumber)
                    if (slots) {
                        slots.push({
                            srno: serial.serialNumber,
                            bookingId: d.id,
                            status: serial.status,
                            mobile: serial.customerPhone,
                            customerName: serial.customerName,
                            checkInTime: serial.checkInTime,
                            kartNumber: serial.kartNumber,
                            completedAt: serial.completedAt
                        })
                    }
                }
            }

            const results = KART_TYPES.map(k => {
                const slots = byType.get(k.gameSerialNumber) ?? []
                slots.sort((a, b) => a.srno - b.srno)
                return {
                    gameSerialNumber: k.gameSerialNumber,
                    data: slots.length > 0
                        ? { gameSerialNumber: k.gameSerialNumber, branchId, date: today, slots }
                        : null
                }
            })

            onData(results)
        },
        (err) => {
            logger.error('waiting_list.snapshot_error', err)
            onError?.(err)
        }
    )

    return unsubscribe
}

/** Subscribe to a single kart type (for backward compat). */
export function subscribeWaitingList(
    branchId: string,
    gameSerialNumber: number,
    onData: (data: WaitingListResponse | null) => void,
    onError?: (error: Error) => void
): Unsubscribe {
    return subscribeAllWaitingLists(
        branchId,
        (results) => {
            const match = results.find(r => r.gameSerialNumber === gameSerialNumber)
            onData(match?.data ?? null)
        },
        onError
    )
}

// ---------------------------------------------------------------------------
// Legacy helpers (still used by dashboard UI)
// ---------------------------------------------------------------------------

/** Returns the first occupied slot number (currently serving). */
export function getCurrentServing(slots: WaitingSlot[]): number | null {
    const occupiedSlot = slots.find(s => s.status === 'occupied')
    return occupiedSlot?.srno ?? null
}

/** Returns counts by status. */
export function getSlotCounts(slots: WaitingSlot[]) {
    return {
        occupied: slots.filter(s => s.status === 'occupied').length,
        done: slots.filter(s => s.status === 'done').length,
        available: slots.filter(s => s.status === 'available').length
    }
}

/** Legacy one-shot fetch — returns empty (use subscribeAllWaitingLists). */
export async function getAllWaitingLists(_branchId: string): Promise<{
    gameSerialNumber: number
    data: WaitingListResponse | null
    error: string | null
}[]> {
    return KART_TYPES.map((kart) => ({
        gameSerialNumber: kart.gameSerialNumber,
        data: null,
        error: null
    }))
}

/**
 * Daily serial number counters for billing/booking items.
 *
 * Separate running counter per location, per day, per category — starts at 1
 * each day for each category. This means Adult, Child, and Double Kart each
 * maintain independent serial sequences (e.g., Adult: 001, 002…  Child: 001…).
 *
 * Collection: `serialCounters` in the pipeline Firestore database.
 *   Counter doc ID: `{locationId}_{YYYY-MM-DD}_{category}`
 *   Fields: { lastSerial: number, locationId, date, category }
 *
 * Collection: `serialLedger` in the pipeline Firestore database.
 *   Ledger doc ID: auto-generated
 *   Fields: { serial, locationId, date, category, documentId, itemName, quantity, assignedAt }
 */
import { doc, collection, addDoc, runTransaction } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'

const COUNTER_COLLECTION = 'serialCounters'
const LEDGER_COLLECTION = 'serialLedger'

/**
 * Extract the serial category from an item name.
 * Item names follow the format "Category — Subcategory — Variant"
 * e.g. "Gokarting — Adult — Adult 8 Laps" → "adult"
 *      "Gokarting — Child — Child 8 Laps" → "child"
 *      "Gokarting — Double — Double Kart"  → "double"
 *
 * Event-package items use a different name shape — "Halloween — Family Pack
 * — Adult 8 Laps". Without special-casing they'd land in a "family-pack"
 * bucket and the adult go-kart slot would no longer share the running
 * serial sequence with regular go-kart bookings. When the name signals
 * go-kart anywhere (including inside the variant), we re-derive the
 * category from the adult/child/double keyword and merge back to the
 * canonical bucket so serials stay in order across regular + event flows.
 *
 * Falls back to "default" for items without a recognizable subcategory.
 */
const extractSerialCategory = (itemName: string): string => {
  const lower = itemName.toLowerCase()
  if (
    lower.includes('gokart') ||
    lower.includes('go-kart') ||
    lower.includes('go kart') ||
    lower.includes('karting')
  ) {
    if (/\bdouble\b/.test(lower)) return 'double'
    if (/\bchild\b|\bkid(s)?\b/.test(lower)) return 'child'
    if (/\badult\b/.test(lower)) return 'adult'
  }

  const parts = itemName.split(' — ')
  if (parts.length >= 4) {
    return parts[2].trim().toLowerCase().replace(/\s+/g, '-')
  }
  if (parts.length >= 2) {
    return parts[1].trim().toLowerCase().replace(/\s+/g, '-')
  }
  return 'default'
}

/**
 * Atomically reserves `count` serial numbers for a given day/location/category.
 * Returns the first serial in the reserved range.
 *
 * Separate counter per location per day per category (resets to 0 at start of each day).
 * E.g. if lastSerial was 5 and count=3, returns 6 (serials 6, 7, 8).
 */
export const reserveSerials = async (
  locationId: string,
  date: string,
  item: { gameId?: string; subGameId?: string; itemName: string },
  count: number,
  category?: string,
): Promise<number> => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured')

  const cat = category ?? extractSerialCategory(item.itemName)
  const docId = `${locationId}_${date}_${cat}`
  const counterRef = doc(firestore, COUNTER_COLLECTION, docId)

  const startSerial = await runTransaction(firestore, async (txn) => {
    const snap = await txn.get(counterRef)
    const lastSerial = snap.exists() ? (snap.data() as { lastSerial: number }).lastSerial : 0
    const nextStart = lastSerial + 1
    txn.set(
      counterRef,
      { lastSerial: lastSerial + count, locationId, date, category: cat },
      { merge: true },
    )
    return nextStart
  })

  return startSerial
}

/**
 * Given a list of billing items, reserves serial numbers grouped by category.
 *
 * Items sharing the same category (Adult, Child, Double, etc.) are batched
 * into a single reserveSerials call so their serials form one contiguous range.
 * Returns an array of serialStart values aligned with the input items array.
 *
 * Also writes a ledger entry per item linking each serial range to a documentId
 * (booking ID or invoice number) for traceability.
 */
export const reserveSerialsForItems = async (
  locationId: string,
  date: string,
  items: Array<{ gameId?: string; subGameId?: string; itemName: string; quantity: number }>,
  documentId?: string,
): Promise<number[]> => {
  const firestore = initializeFirestore()
  const serialStarts: number[] = new Array(items.length).fill(0)

  // Group items by category, preserving original indices
  const categoryGroups = new Map<string, Array<{ idx: number; quantity: number }>>()
  for (let i = 0; i < items.length; i++) {
    const cat = extractSerialCategory(items[i].itemName)
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, [])
    categoryGroups.get(cat)!.push({ idx: i, quantity: items[i].quantity })
  }

  // Reserve one batch per category, distribute serialStarts back to items
  for (const [cat, group] of categoryGroups) {
    const totalQty = group.reduce((s, g) => s + g.quantity, 0)
    const batchStart = await reserveSerials(locationId, date, items[group[0].idx], totalQty, cat)
    let offset = 0
    for (const { idx, quantity } of group) {
      serialStarts[idx] = batchStart + offset
      offset += quantity
    }
  }

  // Write ledger entries linking serials to the booking/invoice
  if (firestore && documentId) {
    try {
      const ledgerRef = collection(firestore, LEDGER_COLLECTION)
      for (let i = 0; i < items.length; i++) {
        const category = extractSerialCategory(items[i].itemName)
        await addDoc(ledgerRef, {
          documentId,
          locationId,
          date,
          category,
          itemName: items[i].itemName,
          serialStart: serialStarts[i],
          serialEnd: serialStarts[i] + items[i].quantity - 1,
          quantity: items[i].quantity,
          assignedAt: new Date(),
        })
      }
    } catch {
      // Non-critical — serials still work without ledger
    }
  }

  return serialStarts
}

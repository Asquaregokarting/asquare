/**
 * Customer-side reader for the Firestore `combos` collection.
 *
 * Pipeline-side authoring lives at `src/pipeline/features/combos/` (admins
 * create combos there). The customer app must never import pipeline code,
 * so this is a thin parallel reader: same collection, narrower API,
 * customer-only.
 */

import { collection, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'

const COMBOS_COLLECTION = 'combos'

export interface ComboItemSummary {
  activityId: string
  itemName: string
  originalPrice: number
  adjustedPrice: number
}

export interface ComboSummary {
  id: string
  name: string
  locationKey: string
  items: ComboItemSummary[]
  comboPrice: number
  originalTotal: number
  /**
   * Convenience derived field. `discountPercent` may be missing on
   * fixed-price combos; in that case we compute it from the total.
   */
  savingsPercent: number
  savingsAmount: number
}

const num = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const parsed = Number(v)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const mapCombo = (id: string, raw: Record<string, unknown>): ComboSummary => {
  const items = Array.isArray(raw.items)
    ? (raw.items as Array<Record<string, unknown>>).map((item) => ({
        activityId: String(item.activityId ?? ''),
        itemName: String(item.itemName ?? ''),
        originalPrice: num(item.originalPrice),
        adjustedPrice: num(item.adjustedPrice),
      }))
    : []
  const originalTotal = num(
    raw.originalTotal,
    items.reduce((s, i) => s + i.originalPrice, 0),
  )
  const comboPrice = num(raw.comboPrice)
  const savingsAmount = Math.max(0, originalTotal - comboPrice)
  const savingsPercent = originalTotal > 0 ? Math.round((savingsAmount / originalTotal) * 100) : 0
  return {
    id,
    name: String(raw.name ?? ''),
    locationKey: String(raw.locationKey ?? ''),
    items,
    comboPrice,
    originalTotal,
    savingsPercent,
    savingsAmount,
  }
}

/**
 * Returns active combos for a given location, sorted by best savings first
 * so the most compelling deal renders in the leading slot.
 */
export const listActiveCombosForLocation = async (locationKey: string): Promise<ComboSummary[]> => {
  if (!locationKey) return []
  if (!db) return []
  const snap = await getDocs(collection(db, COMBOS_COLLECTION))
  return snap.docs
    .map((d) => ({ id: d.id, raw: d.data() as Record<string, unknown> }))
    .filter(({ raw }) => raw.status !== 'Inactive')
    .map(({ id, raw }) => mapCombo(id, raw))
    .filter((c) => c.locationKey === locationKey && c.items.length > 0)
    .sort((a, b) => b.savingsPercent - a.savingsPercent)
}

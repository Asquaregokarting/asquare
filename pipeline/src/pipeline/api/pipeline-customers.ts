/**
 * Firestore API for the pipeline "customers" collection.
 *
 * Provides fast phone-based customer lookup (O(1) via phone-as-doc-ID)
 * and upsert on booking creation. Falls back to the website API when
 * the customer is not yet in Firestore.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import { nowIso, toOptionalString, stripUndefined } from './firestore-utils'
import { lookupAsquareCustomerByPhone } from './asquare-customer-lookup'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineCustomerRecord {
  phone: string
  name: string
  email?: string
  source: 'booking' | 'billing' | 'manual'
  bookingCount: number
  lastBookingAt?: string
  lastBookingLocation?: string
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export interface CustomerLookupResult {
  record: PipelineCustomerRecord | null
  source: 'firestore' | 'website' | 'none'
}

interface UpsertCustomerParams {
  phone: string
  name: string
  email?: string
  source: 'booking' | 'billing' | 'manual'
  locationId?: string
  createdBy?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLLECTION = 'customers'

import { normalizePhone } from '../features/leads/lead-utils'

const parseDoc = (data: Record<string, unknown>): PipelineCustomerRecord => ({
  phone: String(data.phone ?? ''),
  name: String(data.name ?? ''),
  email: toOptionalString(data.email),
  source: (['booking', 'billing', 'manual'].includes(String(data.source ?? ''))
    ? String(data.source)
    : 'booking') as PipelineCustomerRecord['source'],
  bookingCount: Number(data.bookingCount ?? 0),
  lastBookingAt: toOptionalString(data.lastBookingAt),
  lastBookingLocation: toOptionalString(data.lastBookingLocation),
  createdAt: String(data.createdAt ?? ''),
  updatedAt: String(data.updatedAt ?? ''),
  createdBy: toOptionalString(data.createdBy),
})

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const pipelineCustomersApi = {
  /**
   * Look up a customer by phone number in the customers collection.
   * Uses phone as document ID for O(1) lookup.
   */
  async lookupCustomer(phone: string): Promise<PipelineCustomerRecord | null> {
    const digits = normalizePhone(phone)
    if (digits.length !== 10) return null

    const firestore = getAsquareFirestore()
    const snap = await getDoc(doc(firestore, COLLECTION, digits))
    if (!snap.exists()) return null

    return parseDoc(snap.data() as Record<string, unknown>)
  },

  /**
   * Create or update a customer record. On update, merges fields and
   * increments bookingCount.
   */
  async upsertCustomer(params: UpsertCustomerParams): Promise<void> {
    const digits = normalizePhone(params.phone)
    if (digits.length !== 10) return

    const firestore = getAsquareFirestore()
    const ref = doc(firestore, COLLECTION, digits)
    const snap = await getDoc(ref)
    const now = nowIso()

    if (snap.exists()) {
      const existing = snap.data() as Record<string, unknown>
      await setDoc(
        ref,
        stripUndefined({
          name: params.name,
          email: params.email,
          bookingCount: Number(existing.bookingCount ?? 0) + 1,
          lastBookingAt: now,
          lastBookingLocation: params.locationId,
          updatedAt: now,
        } as Record<string, unknown>),
        { merge: true },
      )
    } else {
      await setDoc(
        ref,
        stripUndefined({
          phone: digits,
          name: params.name,
          email: params.email,
          source: params.source,
          bookingCount: 1,
          lastBookingAt: now,
          lastBookingLocation: params.locationId,
          createdAt: now,
          updatedAt: now,
          createdBy: params.createdBy,
        } as Record<string, unknown>),
      )
    }
  },

  /**
   * Look up a customer in Firestore first; if not found, fall back to the
   * website API. Returns the record and its source.
   */
  async lookupWithFallback(phone: string): Promise<CustomerLookupResult> {
    const digits = normalizePhone(phone)
    if (digits.length !== 10) return { record: null, source: 'none' }

    // 1. Try Firestore customers collection
    try {
      const firestoreRecord = await pipelineCustomersApi.lookupCustomer(digits)
      if (firestoreRecord) {
        return { record: firestoreRecord, source: 'firestore' }
      }
    } catch {
      // Firestore unavailable — fall through to website API
    }

    // 2. Fallback: website API
    try {
      const websiteRecord = await lookupAsquareCustomerByPhone(digits)
      if (websiteRecord) {
        return {
          record: {
            phone: digits,
            name: websiteRecord.name,
            email: toOptionalString(websiteRecord.email),
            source: 'booking',
            bookingCount: 0,
            createdAt: '',
            updatedAt: '',
          },
          source: 'website',
        }
      }
    } catch {
      // Website API also failed
    }

    return { record: null, source: 'none' }
  },
}

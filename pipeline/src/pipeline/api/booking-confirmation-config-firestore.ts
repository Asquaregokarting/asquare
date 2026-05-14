/**
 * Booking-confirmation Interakt template config — singleton at
 *   bookingConfirmationConfig/global
 *
 * Per-sub-game `interaktTemplateId` (set in the activities editor) takes
 * precedence; this doc holds the fallback used when a sub-game has no
 * override. Required for any send to succeed once the per-activity routing
 * lands — without a default, an unset activity would silently fail.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso } from './firestore-utils'
import type { BookingConfirmationConfig } from './types'

const CONFIG_COLLECTION = 'bookingConfirmationConfig'
const CONFIG_DOC_ID = 'global'

/**
 * Sentinel default. Matches the literal that used to be hardcoded in
 * functions/lib/interakt.js so behavior doesn't regress on day 1 of the
 * rollout — a fresh deploy with no doc still resolves to the same template
 * the system was using before.
 */
export const DEFAULT_BOOKING_CONFIRMATION_CONFIG: BookingConfirmationConfig = {
  defaultTemplateId: 'booking_confirmed_ticket',
  defaultTemplateLanguage: 'en',
  updatedAt: new Date(0).toISOString(),
}

const getFirestore = () => {
  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore not configured.')
  return firestore
}

const getConfigRef = () => doc(getFirestore(), CONFIG_COLLECTION, CONFIG_DOC_ID)

export const getBookingConfirmationConfig = async (): Promise<BookingConfirmationConfig> => {
  try {
    const snap = await getDoc(getConfigRef())
    if (!snap.exists()) return { ...DEFAULT_BOOKING_CONFIRMATION_CONFIG }
    const data = snap.data() as Record<string, unknown>
    return {
      defaultTemplateId:
        String(
          data.defaultTemplateId ?? DEFAULT_BOOKING_CONFIRMATION_CONFIG.defaultTemplateId,
        ).trim() || DEFAULT_BOOKING_CONFIRMATION_CONFIG.defaultTemplateId,
      defaultTemplateLanguage:
        String(
          data.defaultTemplateLanguage ??
            DEFAULT_BOOKING_CONFIRMATION_CONFIG.defaultTemplateLanguage,
        ).trim() || DEFAULT_BOOKING_CONFIRMATION_CONFIG.defaultTemplateLanguage,
      updatedAt: String(data.updatedAt ?? DEFAULT_BOOKING_CONFIRMATION_CONFIG.updatedAt),
      updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    }
  } catch {
    return { ...DEFAULT_BOOKING_CONFIRMATION_CONFIG }
  }
}

export const updateBookingConfirmationConfig = async (
  token: string,
  patch: Partial<Pick<BookingConfirmationConfig, 'defaultTemplateId' | 'defaultTemplateLanguage'>>,
): Promise<BookingConfirmationConfig> => {
  const user = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(user.role)) {
    throw new Error('Only Owner or Admin can update booking-confirmation config.')
  }

  const current = await getBookingConfirmationConfig()
  const next: BookingConfirmationConfig = {
    defaultTemplateId: (patch.defaultTemplateId ?? current.defaultTemplateId).trim(),
    defaultTemplateLanguage: (
      patch.defaultTemplateLanguage ?? current.defaultTemplateLanguage
    ).trim(),
    updatedAt: nowIso(),
    updatedBy: user.id,
  }
  if (!next.defaultTemplateId) {
    throw new Error('defaultTemplateId is required.')
  }
  if (!next.defaultTemplateLanguage) {
    throw new Error('defaultTemplateLanguage is required.')
  }

  await setDoc(getConfigRef(), next)
  return next
}

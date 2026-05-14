import { toOptionalString } from './firestore-utils'
import { AsquareCustomerLookupRecord } from './types'

const SEARCH_API_BASE =
  (import.meta.env.VITE_ASQUARE_CUSTOMER_SEARCH_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV
    ? '/asquare-api/searchcustomer.php'
    : 'https://asquaregokarting.com/searchcustomer.php')
const SEARCH_API_KEY =
  (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_KEY as string | undefined)?.trim() || ''
const SEARCH_API_PASSWORD =
  (import.meta.env.VITE_ASQUARE_CUSTOMER_LOOKUP_PASSWORD as string | undefined)?.trim() || ''

import { normalizePhone } from '../features/leads/lead-utils'

const toSearchUrl = (phone: string): string => {
  const base = SEARCH_API_BASE.startsWith('/')
    ? `${window.location.origin}${SEARCH_API_BASE}`
    : SEARCH_API_BASE
  const requestUrl = new URL(base)
  requestUrl.searchParams.set('key', SEARCH_API_KEY)
  requestUrl.searchParams.set('pswd', SEARCH_API_PASSWORD)
  requestUrl.searchParams.set('q', phone)
  return requestUrl.toString()
}

/**
 * Parses the pipe-delimited response from searchcustomer.php.
 *
 * Format: `{tier}{phone}|$|{username}|$|{email}|$|{account_status}|$|{tier}|$|`
 *
 * The first segment is the membership tier concatenated with the user_id (phone),
 * so we strip the queried phone from the end to extract the tier.
 */
const parseSearchResponse = (raw: string, phone: string): AsquareCustomerLookupRecord | null => {
  const parts = raw.split('|$|').map((s) => s.trim())
  if (parts.length < 3) return null

  // First part is "{tier}{phone}" — extract username from the second part
  const username = parts[1] || ''
  const email = toOptionalString(parts[2])
  const accountStatus = parts[3] ?? ''

  // If no real username or account is inactive (status "0"), treat as not found
  if (!username || accountStatus === '0') return null

  // Extract the phone/user_id from the first segment
  const firstSegment = parts[0] || ''
  const userId = firstSegment.endsWith(phone) ? phone : normalizePhone(firstSegment) || phone

  return {
    id: userId,
    name: username,
    cell: phone,
    email,
    branchId: undefined,
  }
}

export const lookupAsquareCustomerByPhone = async (
  phone: string,
): Promise<AsquareCustomerLookupRecord | null> => {
  const normalizedPhone = normalizePhone(phone)
  if (normalizedPhone.length !== 10) {
    return null
  }

  const response = await fetch(toSearchUrl(normalizedPhone), { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Customer lookup failed (${response.status}).`)
  }

  const text = (await response.text()).trim()
  if (!text) return null

  // Try JSON first (in case the API format changes)
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const userId = toOptionalString(json.user_id)
    if (userId) {
      return {
        id: userId,
        name: String(json.username ?? 'Customer').trim() || 'Customer',
        cell: normalizedPhone,
        email: toOptionalString(json.email),
        branchId: undefined,
      }
    }
  } catch {
    // Not JSON — fall through to pipe-delimited parsing
  }

  return parseSearchResponse(text, normalizedPhone)
}

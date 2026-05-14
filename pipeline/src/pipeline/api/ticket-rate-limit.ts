import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'

export const CUSTOMER_RATE_LIMIT_PER_24H = 5

const TICKETS_COLLECTION = 'pipeline-tickets'

/**
 * Returns the number of tickets the given customer has created in the
 * last 24 hours. Used to enforce a 5/24h customer rate limit.
 *
 * Reads matching docs via `getDocs` rather than `getCountFromServer` so
 * we don't depend on the count aggregation API. The rate limit is small
 * (5) so the read cost is bounded — Firestore returns matching docs and
 * we just count them.
 */
export async function customerTicketCountInLast24h(userId: string): Promise<number> {
  const since = new Date()
  since.setHours(since.getHours() - 24)
  const q = query(
    collection(getAsquareFirestore(), TICKETS_COLLECTION),
    where('raisedBy', '==', userId),
    where('raisedByKind', '==', 'customer'),
    where('createdAt', '>=', Timestamp.fromDate(since)),
  )
  const snap = await getDocs(q)
  return snap.size
}

export class CustomerRateLimitError extends Error {
  constructor(public count: number) {
    super(`rate limit reached (${count}/${CUSTOMER_RATE_LIMIT_PER_24H} in last 24h)`)
    this.name = 'CustomerRateLimitError'
  }
}

export async function assertCustomerUnderRateLimit(userId: string): Promise<void> {
  const count = await customerTicketCountInLast24h(userId)
  if (count >= CUSTOMER_RATE_LIMIT_PER_24H) {
    throw new CustomerRateLimitError(count)
  }
}

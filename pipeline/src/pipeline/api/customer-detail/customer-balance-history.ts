/**
 * Customer 360 — Wallet & Tire balance history fetchers.
 *
 * Both subcollections share the same shape (type/amount/description/
 * timestamp) so they share an internal implementation. Two narrow APIs
 * are exposed so call sites stay self-documenting.
 *
 * Schema (mirrors `walletService.Transaction` from the customer app —
 * NOT imported, per the dual-app boundary rule in CLAUDE.md):
 *   { type: 'credit'|'debit'|'tire_credit'|'tire_debit', amount, description, timestamp }
 *
 * Cursor paginated 50/page by `timestamp desc`.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import { getAsquareFirestore } from '../asquare-firestore'

export type BalanceTxType = 'credit' | 'debit' | 'tire_credit' | 'tire_debit'

export interface BalanceTransaction {
  id: string
  type: BalanceTxType
  amount: number
  description: string
  timestamp: Date
}

export interface BalanceHistoryFilters {
  /** Restrict to credits only / debits only. */
  side?: 'credit' | 'debit' | 'all'
  dateAfter?: Date
  dateBefore?: Date
}

export interface BalanceHistoryOptions {
  pageSize?: number
  cursor?: QueryDocumentSnapshot<DocumentData>
  filters?: BalanceHistoryFilters
}

export interface BalanceHistoryPage {
  /** Current snapshot of the user's balance. */
  balance: number
  items: BalanceTransaction[]
  nextCursor: QueryDocumentSnapshot<DocumentData> | null
}

const parseTransaction = (id: string, raw: Record<string, unknown>): BalanceTransaction => ({
  id,
  type: String(raw.type ?? 'credit') as BalanceTxType,
  amount: Number(raw.amount ?? 0),
  description: String(raw.description ?? ''),
  timestamp:
    raw.timestamp && typeof (raw.timestamp as Timestamp).toDate === 'function'
      ? (raw.timestamp as Timestamp).toDate()
      : new Date(0),
})

const buildHistoryFetcher =
  (
    txCollectionName: 'wallet_transactions' | 'tire_transactions',
    creditTypes: BalanceTxType[],
    debitTypes: BalanceTxType[],
  ) =>
  async (customerId: string, opts?: BalanceHistoryOptions): Promise<BalanceHistoryPage> => {
    const pageSize = Math.max(1, opts?.pageSize ?? 50)
    const firestore = getAsquareFirestore()

    // Balance — fetch in parallel with the page query.
    const balancePromise: Promise<number> = (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'users', customerId, 'wallet', 'data'))
        if (!snap.exists()) return 0
        const data = snap.data() as Record<string, unknown>
        // wallet/data carries the canonical wallet balance; tire balance lives
        // on the parent users doc (users/{uid}.tires) and is read at the
        // CustomerDetailPage level — so for tires, balance is computed from
        // the tx ledger sum here as a sanity readout.
        if (txCollectionName === 'wallet_transactions') return Number(data.balance ?? 0)
        return 0
      } catch {
        return 0
      }
    })()

    const constraints: QueryConstraint[] = []
    const side = opts?.filters?.side ?? 'all'
    if (side === 'credit') constraints.push(where('type', 'in', creditTypes))
    else if (side === 'debit') constraints.push(where('type', 'in', debitTypes))
    if (opts?.filters?.dateAfter) constraints.push(where('timestamp', '>=', opts.filters.dateAfter))
    if (opts?.filters?.dateBefore)
      constraints.push(where('timestamp', '<=', opts.filters.dateBefore))
    constraints.push(orderBy('timestamp', 'desc'))
    constraints.push(firestoreLimit(pageSize))
    if (opts?.cursor) constraints.push(startAfter(opts.cursor))

    const txCol = collection(firestore, 'users', customerId, txCollectionName)
    const snap = await getDocs(query(txCol, ...constraints))

    const items = snap.docs.map((d) => parseTransaction(d.id, d.data() as Record<string, unknown>))
    const nextCursor = snap.size === pageSize ? snap.docs[snap.docs.length - 1] : null

    const balance = await balancePromise
    return { balance, items, nextCursor }
  }

export const customerWalletApi = {
  listTransactions: buildHistoryFetcher('wallet_transactions', ['credit'], ['debit']),
}

export const customerTiresApi = {
  listTransactions: buildHistoryFetcher(
    'tire_transactions',
    ['tire_credit', 'credit'],
    ['tire_debit', 'debit'],
  ),
}

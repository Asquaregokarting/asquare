/**
 * userMerge — dedup/merge primitives for duplicate users/{id} documents.
 *
 * Why this exists: the codebase has five historical id conventions (Firebase
 * Auth UID, clean phone, legacy numeric from PHP, custom slug, and `offline_`
 * prefix) that all write to `users/{id}` without coordination. A single phone
 * can end up owning multiple docs with conflicting wallet balances. This file
 * provides the pure selection/normalization logic; the actual Firestore merge
 * operations live next to their respective SDKs (client helper in
 * userService.ts, Admin-SDK script in scripts/dedup-users.ts).
 *
 * The pure functions here (`pickCanonical`, `normalizePhone`, shape checks)
 * have no Firestore dependency and are exhaustively unit-tested.
 */

export type UserDocRole = string | null | undefined

export interface CandidateUserDoc {
  id: string
  role?: UserDocRole
  phone?: string | null
  phoneNumber?: string | null
  walletBalance?: number
  createdAt?: Date | number | null
  updatedAt?: Date | number | null
  lastLoginAt?: Date | number | null
}

export type PickCanonicalResult =
  | { kind: 'picked'; canonical: CandidateUserDoc; duplicates: CandidateUserDoc[] }
  | { kind: 'skip-staff-only' }
  | { kind: 'skip-no-customers' }
  | { kind: 'error-role-has-wallet'; offenders: CandidateUserDoc[] }

const FIREBASE_UID_SHAPE = /^[A-Za-z0-9]{20,40}$/
const KNOWN_NON_UID_PREFIXES = ['offline_', 'guest-', 'mock-user-id-', 'member_']

/** Normalize a phone to its trailing 10 digits. Matches scripts/migrate-members-to-users.ts. */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return ''
  return String(input).replace(/\D/g, '').slice(-10)
}

/** True if the id looks like a Firebase Auth UID (alnum, mixed content, no known prefix). */
export function isFirebaseAuthUidShape(id: string): boolean {
  if (!id) return false
  if (!FIREBASE_UID_SHAPE.test(id)) return false
  if (/^\d+$/.test(id)) return false
  for (const prefix of KNOWN_NON_UID_PREFIXES) {
    if (id.startsWith(prefix)) return false
  }
  return true
}

function toMillis(value: Date | number | null | undefined): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return 0
}

function recency(doc: CandidateUserDoc): number {
  return Math.max(toMillis(doc.lastLoginAt), toMillis(doc.updatedAt), toMillis(doc.createdAt))
}

function pickByRecency(docs: CandidateUserDoc[]): CandidateUserDoc {
  return [...docs].sort((a, b) => recency(b) - recency(a))[0]
}

function pickByWalletThenRecency(docs: CandidateUserDoc[]): CandidateUserDoc {
  return [...docs].sort((a, b) => {
    const balanceDiff = (b.walletBalance ?? 0) - (a.walletBalance ?? 0)
    if (balanceDiff !== 0) return balanceDiff
    return recency(b) - recency(a)
  })[0]
}

/**
 * Given every user doc that matches a single normalized phone, choose the
 * canonical doc and the duplicates to merge into it.
 *
 * Rules:
 *   - Docs with a `role` field are staff accounts — never merged, never
 *     deleted. Excluded from candidate set entirely.
 *   - Tier 1: prefer Firebase Auth UID shape (most-recent wins).
 *   - Tier 2: doc id equals normalized phone (most-recent wins).
 *   - Tier 3: anything else (richest wallet, then most recent).
 *
 * Invariant: a doc with `role` AND a non-zero wallet balance is an anomaly
 * (staff shouldn't carry customer credit) — returns an error variant so the
 * caller can halt for manual review.
 */
export function pickCanonical(docs: CandidateUserDoc[]): PickCanonicalResult {
  if (docs.length === 0) return { kind: 'skip-no-customers' }

  const roleViolations = docs.filter((d) => d.role && (d.walletBalance ?? 0) > 0)
  if (roleViolations.length > 0) {
    return { kind: 'error-role-has-wallet', offenders: roleViolations }
  }

  const customers = docs.filter((d) => !d.role)
  if (customers.length === 0) return { kind: 'skip-staff-only' }
  if (customers.length === 1) {
    return { kind: 'picked', canonical: customers[0], duplicates: [] }
  }

  const tier1 = customers.filter((d) => isFirebaseAuthUidShape(d.id))
  if (tier1.length > 0) {
    const canonical = pickByRecency(tier1)
    return {
      kind: 'picked',
      canonical,
      duplicates: customers.filter((d) => d.id !== canonical.id),
    }
  }

  const tier2 = customers.filter((d) => d.id === normalizePhone(d.phone ?? d.phoneNumber))
  if (tier2.length > 0) {
    const canonical = pickByRecency(tier2)
    return {
      kind: 'picked',
      canonical,
      duplicates: customers.filter((d) => d.id !== canonical.id),
    }
  }

  const canonical = pickByWalletThenRecency(customers)
  return {
    kind: 'picked',
    canonical,
    duplicates: customers.filter((d) => d.id !== canonical.id),
  }
}

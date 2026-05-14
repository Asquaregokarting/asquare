/**
 * Daily Reports — domain types layered on top of the existing ShiftRecord.
 *
 * These types are local to the daily-reports surface — they decorate the raw
 * `ShiftRecord` with the audit-only fields the hub renders (per-method diffs,
 * total diff, comment count, review state).
 */

import type { ShiftRecord } from '../../api/shifts'

export type DiscrepancyTone = 'excess' | 'shortage' | 'settled' | 'pending'

export interface MethodDiscrepancy {
  entered: number
  actual: number
  diff: number
}

export interface ShiftReviewState {
  reviewedAt?: string
  reviewedBy?: string
  reviewedByName?: string
  flagged: boolean
  flaggedAt?: string
  flaggedBy?: string
  flaggedByName?: string
}

export interface ShiftCommentRecord {
  id: string
  shiftId: string
  authorId: string
  authorName: string
  authorRole: string
  body: string
  severity: 'comment' | 'flag'
  createdAt: string
  parentId?: string
}

/** A shift augmented with the derived audit-friendly numbers the ledger needs. */
export interface AuditShift {
  shift: ShiftRecord
  cash: MethodDiscrepancy
  card: MethodDiscrepancy
  upi: MethodDiscrepancy
  totalEntered: number
  totalActual: number
  totalDiff: number
  /** 'pending' until the cashier checks out and submits a settlement. */
  tone: DiscrepancyTone
  branchSlug: string
  branchDisplayName: string
  cashierDisplayName: string
  /** Quick lookup count — drives the "comments" badge on the ledger row. */
  commentCount: number
  /** 0 if no flagged comment exists; >0 means at least one flag is open. */
  flagCount: number
  review: ShiftReviewState
  /**
   * Present when this row is a display-merge of several same-day shifts
   * for the same cashier+branch (the residue of repeated check-in / check-
   * out attempts). `shift` carries the primary (earliest-start) sub-shift
   * and the visible totals are rolled up from every entry in `subShifts`.
   * Drawer surfaces the full list for drill-down. Absent / single-element
   * arrays mean "no merge happened".
   */
  subShifts?: AuditShift[]
}

/** Branch-level rollup that drives the Discrepancy Strip tiles. */
export interface BranchRollup {
  branchSlug: string
  branchDisplayName: string
  shiftCount: number
  reviewedCount: number
  flaggedCount: number
  totalEntered: number
  totalActual: number
  totalDiff: number
  tone: DiscrepancyTone
  /** Excess and shortage decomposed so the tile can show "₹450 excess across 2 shifts" etc. */
  excessAmount: number
  shortageAmount: number
  excessShifts: number
  shortageShifts: number
}

/** Mode the hub runs in; controls which scope of shifts are shown + which actions are enabled. */
export type HubMode = 'owner' | 'team' | 'my' | 'reports'

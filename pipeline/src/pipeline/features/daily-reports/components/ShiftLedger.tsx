import { Flag, MessageSquare, Printer } from 'lucide-react'
import { fmtDiscrepancy, fmtDuration, fmtRupees, fmtTime } from '../format'
import type { AuditShift } from '../types'

interface ShiftLedgerProps {
  audits: AuditShift[]
  /** Optional names map to render display names instead of raw userIds. */
  nameByUserId?: Map<string, string>
  selectedShiftId?: string | null
  onSelect: (audit: AuditShift) => void
  onPrint: (audit: AuditShift) => void
  onFlag: (audit: AuditShift) => void
  /** When false, hides print/flag actions (e.g. cashier viewing their own list). */
  canModerate?: boolean
  /**
   * Softer column labels for cashier self-view ("variance" instead of
   * "diff"). Audit-tone words can read as accusatory to a cashier whose
   * shift had a real shortage — and they're not the audience here.
   */
  variant?: 'audit' | 'self'
}

const renderDiff = (diff: number) => {
  const { text, tone } = fmtDiscrepancy(diff)
  return <span className={`dr-cell-diff dr-${tone}`}>{text}</span>
}

const statusPill = (audit: AuditShift) => {
  if (!audit.shift.endTime) {
    return (
      <span
        className="dr-pill"
        data-tone="in-progress"
        title="The cashier hasn't checked out yet. Settlement totals will appear once they end the shift."
      >
        In progress
      </span>
    )
  }
  if (audit.review.flagged) {
    return (
      <span
        className="dr-pill"
        data-tone="flagged"
        title="An Owner or Admin raised a concern on this shift. Open the drawer to read the flag and respond."
      >
        Flagged
      </span>
    )
  }
  if (audit.review.reviewedAt) {
    return (
      <span
        className="dr-pill"
        data-tone="reviewed"
        title="An Owner or Admin reconciled this shift's settlement. No further action needed."
      >
        Reviewed
      </span>
    )
  }
  return (
    <span className="dr-pill" title="Settlement is submitted but no Owner has signed off yet.">
      Awaiting review
    </span>
  )
}

/**
 * The audit ledger. Single dense table; every row is a shift. Discrepancy
 * column is the only colored column. Row click opens the drawer; inline
 * action buttons cover Print, Flag, Comments at-a-glance.
 */
export const ShiftLedger = ({
  audits,
  nameByUserId,
  selectedShiftId,
  onSelect,
  onPrint,
  onFlag,
  canModerate = true,
  variant = 'audit',
}: ShiftLedgerProps) => {
  const diffLabel = variant === 'self' ? 'variance' : 'diff'
  const totalLabel = variant === 'self' ? 'Total variance' : 'Total diff'
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-panel">
      <div className="overflow-x-auto">
        <table className="dr-ledger min-w-full">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Cashier</th>
              <th>Shift</th>
              <th className="dr-num">{`Cash ${diffLabel}`}</th>
              <th className="dr-num">{`Card ${diffLabel}`}</th>
              <th className="dr-num">{`UPI ${diffLabel}`}</th>
              <th className="dr-num">{totalLabel}</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {audits.map((audit) => {
              const cashierName = nameByUserId?.get(audit.shift.userId)
              const total = renderDiff(audit.totalDiff)
              const isOpen = selectedShiftId === audit.shift.id
              const isLive = !audit.shift.endTime

              return (
                <tr
                  key={audit.shift.id}
                  data-active={isOpen ? 'true' : 'false'}
                  aria-selected={isOpen ? 'true' : 'false'}
                  onClick={() => onSelect(audit)}
                  className="cursor-pointer outline-none"
                >
                  <td>
                    <div className="font-medium text-text">{audit.branchDisplayName}</div>
                  </td>
                  <td>
                    <div className="dr-cashier-meta">
                      {cashierName ? (
                        <span className="dr-cashier-name">{cashierName}</span>
                      ) : (
                        <span
                          className="dr-skeleton h-3.5 w-28 rounded-md"
                          aria-label="Loading cashier name"
                        />
                      )}
                      <span className="dr-cashier-sub">{audit.branchDisplayName}</span>
                    </div>
                  </td>
                  <td>
                    <div className="dr-cashier-meta">
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-text">
                        {fmtTime(audit.shift.startTime)} → {fmtTime(audit.shift.endTime)}
                        {audit.subShifts && audit.subShifts.length > 1 ? (
                          <span
                            className="rounded-md border border-border bg-base/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted"
                            title={`${audit.subShifts.length} check-in / check-out attempts merged into this row — open the drawer to see each one.`}
                          >
                            ×{audit.subShifts.length}
                          </span>
                        ) : null}
                      </span>
                      <span className="dr-cashier-sub">
                        {fmtDuration(audit.shift.startTime, audit.shift.endTime)}
                        {audit.shift.settlement?.totalTransactions !== undefined && (
                          <>
                            {' · '}
                            {audit.shift.settlement.totalTransactions} txn
                          </>
                        )}
                        {audit.subShifts && audit.subShifts.length > 1 ? (
                          <>
                            {' · '}
                            {audit.subShifts.length} shifts merged
                          </>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="dr-num">
                    {isLive ? <span className="dr-pending">—</span> : renderDiff(audit.cash.diff)}
                  </td>
                  <td className="dr-num">
                    {isLive ? <span className="dr-pending">—</span> : renderDiff(audit.card.diff)}
                  </td>
                  <td className="dr-num">
                    {isLive ? <span className="dr-pending">—</span> : renderDiff(audit.upi.diff)}
                  </td>
                  <td className="dr-num dr-total-cell">
                    {isLive ? (
                      <span className="dr-pending text-[12px]">
                        {fmtRupees(audit.totalEntered)} expected
                      </span>
                    ) : (
                      total
                    )}
                  </td>
                  <td>{statusPill(audit)}</td>
                  <td className="text-right">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {audit.commentCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[11px] text-muted"
                          title={`${audit.commentCount} comment${audit.commentCount === 1 ? '' : 's'}`}
                        >
                          <MessageSquare className="h-3 w-3" />
                          {audit.commentCount}
                        </span>
                      )}
                      {canModerate && !isLive && (
                        <>
                          <button
                            type="button"
                            onClick={() => onPrint(audit)}
                            className="relative grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition-colors hover:text-text hover:border-text/30"
                            title="Re-print Day Report"
                            aria-label="Re-print Day Report"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            {isOpen ? (
                              <span className="dr-keyhint" aria-hidden>
                                R
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => onFlag(audit)}
                            className="relative grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition-colors hover:text-critical hover:border-critical/50"
                            title="Flag this shift"
                            aria-label="Flag this shift"
                          >
                            <Flag className="h-3.5 w-3.5" />
                            {isOpen ? (
                              <span className="dr-keyhint" aria-hidden>
                                F
                              </span>
                            ) : null}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

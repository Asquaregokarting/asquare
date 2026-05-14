interface ProtocolAwaitingApprovalProps {
  bookingId: string
  customerName: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  rejectReason: string
  approvedBy?: string
  onPrint: () => void
  onNewTransaction: () => void
  printEnabled: boolean
  mode?: 'protocol' | 'offer'
  inline?: boolean
  onSwitchToNormal?: () => void
  onCancel?: () => void
}

const labels = {
  protocol: {
    pending: 'Protocol Request Submitted',
    approved: 'Protocol Approved!',
    rejected: 'Protocol Rejected',
    waiting: 'Waiting for Owner Approval\u2026',
    printNote: 'Print will be available after Owner approval',
    newTxn: 'New Transaction',
    startNew: 'Start New Transaction',
  },
  offer: {
    pending: 'Offer Request Submitted',
    approved: 'Offer Approved!',
    rejected: 'Offer Rejected',
    waiting: 'Waiting for Owner Approval\u2026',
    printNote: 'Print will be available after Owner approval',
    newTxn: 'New Transaction',
    startNew: 'Start New Transaction',
  },
}

const themes = {
  protocol: {
    heading: { pending: 'text-amber-700', approved: 'text-success', rejected: 'text-critical' },
    pendingBg: 'bg-amber-100',
    pendingDot: 'bg-amber-500',
    waitingText: 'text-amber-600',
  },
  offer: {
    heading: { pending: 'text-blue-700', approved: 'text-success', rejected: 'text-critical' },
    pendingBg: 'bg-blue-100',
    pendingDot: 'bg-blue-500',
    waitingText: 'text-blue-600',
  },
}

export const ProtocolAwaitingApproval = ({
  bookingId,
  customerName,
  reason,
  status,
  rejectReason,
  approvedBy,
  onPrint,
  onNewTransaction,
  printEnabled,
  mode = 'protocol',
  inline = false,
  onSwitchToNormal,
  onCancel,
}: ProtocolAwaitingApprovalProps) => {
  const l = labels[mode]
  const t = themes[mode]

  const content = (
    <div
      role="dialog"
      aria-modal={!inline}
      className={
        inline
          ? 'w-full rounded-2xl border border-border/70 bg-panel p-8 text-center shadow-lg'
          : 'relative w-full max-w-sm rounded-2xl border border-border/70 bg-panel p-8 text-center shadow-2xl'
      }
    >
      {/* ── Status Icon ── */}
      {status === 'pending' && (
        <div
          className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${t.pendingBg}`}
        >
          <span className={`h-6 w-6 animate-pulse rounded-full ${t.pendingDot}`} />
        </div>
      )}
      {status === 'approved' && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
          <svg
            className="h-7 w-7 text-success"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {status === 'rejected' && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-critical/15">
          <svg
            className="h-7 w-7 text-critical"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M18 6 6 18" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m6 6 12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* ── Heading ── */}
      <h3 className={`font-display text-xl font-bold ${t.heading[status]}`}>{l[status]}</h3>

      {/* ── Booking Details ── */}
      <div className="mt-4 space-y-1 text-sm text-muted">
        <p>
          Booking: <span className="font-semibold text-text">{bookingId}</span>
        </p>
        <p>
          Customer: <span className="font-semibold text-text">{customerName}</span>
        </p>
        <p className="italic">&ldquo;{reason}&rdquo;</p>
      </div>

      {/* ── Status-specific content ── */}
      {status === 'pending' && (
        <div className="mt-5">
          <p className={`animate-pulse text-sm font-semibold ${t.waitingText}`}>{l.waiting}</p>
        </div>
      )}

      {status === 'approved' && approvedBy && (
        <p className="mt-3 text-sm text-muted">
          Approved by: <span className="font-semibold text-text">{approvedBy}</span>
        </p>
      )}

      {status === 'rejected' && rejectReason && (
        <div className="mx-auto mt-4 max-w-xs rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-critical">
          {rejectReason}
        </div>
      )}

      {/* ── Actions ── */}
      <div className="mt-6 flex flex-col gap-2">
        {status !== 'rejected' && (
          <button
            type="button"
            disabled={!printEnabled}
            onClick={onPrint}
            className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
              printEnabled
                ? 'bg-success/90 text-white hover:bg-success'
                : 'cursor-not-allowed border border-border bg-surface text-muted opacity-60'
            }`}
            title={!printEnabled ? 'Awaiting Owner Approval' : undefined}
          >
            Print Billing
          </button>
        )}
        {!printEnabled && status === 'pending' && (
          <p className="text-xs text-muted">{l.printNote}</p>
        )}
        {status === 'pending' && inline && onSwitchToNormal && (
          <button
            type="button"
            onClick={onSwitchToNormal}
            className="w-full rounded-xl border border-primary/40 bg-primary/10 py-3 text-sm font-semibold text-primary transition-all hover:bg-primary/20"
          >
            Continue Normal POS While Waiting
          </button>
        )}
        {status === 'pending' && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl border border-critical/40 bg-critical/10 py-3 text-sm font-semibold text-critical transition-all hover:bg-critical/20"
          >
            Cancel Request
          </button>
        )}
        {(status === 'approved' || status === 'rejected') && (
          <button
            type="button"
            onClick={onNewTransaction}
            className="w-full rounded-xl border border-border/55 bg-surface py-3 text-sm font-semibold text-text transition-all hover:bg-surface/80"
          >
            {status === 'rejected' ? l.startNew : l.newTxn}
          </button>
        )}
      </div>
    </div>
  )

  if (inline) return content

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
      {content}
    </div>
  )
}

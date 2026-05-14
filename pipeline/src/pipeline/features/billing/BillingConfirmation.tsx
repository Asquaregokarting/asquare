import { QRCodeSVG } from 'qrcode.react'
import { TransactionRecord } from '../../api/types'
import logoUrl from '../../../assets/logo.webp'

const GST_NUMBER = '37AQKPB9099G3ZB'

const currency = (amount: number): string => `INR ${Math.round(amount).toLocaleString('en-IN')}`

interface BillingConfirmationProps {
  transaction: TransactionRecord
  locationLabel: string
  onDismiss: () => void
}

export const BillingConfirmation = ({
  transaction,
  locationLabel,
  onDismiss,
}: BillingConfirmationProps) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-base/75 backdrop-blur-sm">
    <div
      role="dialog"
      aria-modal="true"
      className="relative w-full max-w-sm rounded-2xl border border-border/70 bg-panel p-8 text-center shadow-2xl"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
        aria-label="Close"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      {/* Logo & Company Info */}
      <img src={logoUrl} alt="A Square Go Karting" className="mx-auto mb-2 h-16 w-auto" />
      <p className="text-xs font-semibold tracking-wide text-text">
        Anandapuram{locationLabel ? ` | ${locationLabel}` : ''}
      </p>
      <p className="text-[10px] text-muted">GST: {GST_NUMBER}</p>

      <div className="my-3 border-t border-success/30" />

      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
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

      <h3 className="font-display text-xl font-bold text-success">Billing Complete</h3>
      <p className="mt-1 text-sm text-muted">
        Invoice: <span className="font-semibold text-text">{transaction.invoiceNumber}</span>
      </p>
      <p className="text-sm text-muted">
        Total:{' '}
        <span className="text-lg font-bold text-text">{currency(transaction.totalAmount)}</span>
      </p>
      {transaction.paymentStatus === 'pending' && (
        <p className="mt-1 text-xs font-medium text-warning">
          Payment link sent — awaiting payment
        </p>
      )}

      <div className="mx-auto my-4 w-fit rounded-xl bg-white p-3 shadow-sm">
        <QRCodeSVG value={transaction.invoiceNumber} size={160} level="H" />
      </div>
      <p className="text-xs text-muted">Scan QR at Track to verify access</p>

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-xl border border-border/55 bg-surface py-3 text-sm font-semibold text-text transition-all hover:bg-surface/80"
        >
          New Transaction
        </button>
      </div>
    </div>
  </div>
)

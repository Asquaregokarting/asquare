import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AsquareBooking } from '../../../api/asquare-bookings'
import { fmtDateTimeFullIST, fmtDateIST, fmtSmartDateTimeIST } from '../../../../lib/date-format'
import { getLocationShortName } from '../../../../lib/locations'
import { formatBookingItems, formatCurrency } from './bookings-utils'

interface Props {
  booking: AsquareBooking
  onClose: () => void
  /**
   * Destructive actions are surfaced inside this modal (under a collapsed
   * "Manage" section) instead of on the table row, so an Owner has to
   * intentionally open a booking before they can refund / cancel / delete
   * it. Each callback is optional — pass only the ones the current role
   * is allowed to perform; the modal hides any button whose callback is
   * absent. The modal closes itself before invoking the callback so the
   * downstream confirm dialog isn't visually trapped underneath.
   */
  onRefund?: (booking: AsquareBooking) => void
  onCancel?: (booking: AsquareBooking) => void
  onDelete?: (booking: AsquareBooking) => void
}

const FIRST_CLASS_KEYS = new Set<string>([
  'id',
  'userId',
  'userDisplayName',
  'userPhone',
  'locationId',
  'items',
  'totalAmount',
  'discountAmount',
  'finalAmount',
  'paymentStatus',
  'bookingStatus',
  'checkInStatus',
  'paymentMethod',
  'paymentId',
  'razorpayOrderId',
  'razorpaySignature',
  'qrCode',
  'createdAt',
  'sessionDate',
  'paymentCompletedAt',
  'tires',
  'paymentLinkStatus',
  'source',
  'sourceType',
  'createdByAdminId',
  'createdByAdminName',
  'createdByRole',
  'passengers',
  'swapHistory',
])

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="grid grid-cols-[160px_1fr] gap-3 py-1.5 text-sm">
    <span className="text-muted">{label}</span>
    <span className="break-words text-text">{value ?? <span className="text-muted">—</span>}</span>
  </div>
)

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-border/60 bg-panel p-4">
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
    <div className="divide-y divide-border/30">{children}</div>
  </section>
)

const formatMaybeDate = (v: unknown): string => {
  if (v == null) return '—'
  if (v instanceof Date) return fmtDateTimeFullIST(v)
  if (typeof v === 'string') return fmtSmartDateTimeIST(v)
  if (typeof v === 'number') {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return fmtDateTimeFullIST(d)
  }
  return String(v)
}

const isDateLikeKey = (k: string): boolean => /at$|date$|time$|completed/i.test(k)

const renderPrimitive = (k: string, v: unknown): ReactNode => {
  if (v == null) return <span className="text-muted">—</span>
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (v instanceof Date) return fmtDateTimeFullIST(v)
  if (isDateLikeKey(k) && (typeof v === 'string' || typeof v === 'number')) {
    return formatMaybeDate(v)
  }
  return String(v)
}

const isPrimitive = (v: unknown): boolean =>
  v == null ||
  v instanceof Date ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean'

const titleCase = (k: string): string =>
  k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/**
 * Recursively render a structured value as label/value rows. Used for the
 * "Other" section so admins see readable fields instead of raw JSON. Caps
 * recursion depth so a runaway shape can't blow up the modal.
 */
const renderStructured = (key: string, value: unknown, depth = 0): ReactNode => {
  if (depth > 3) return <span className="text-muted">…</span>
  if (isPrimitive(value)) return renderPrimitive(key, value)

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">(empty)</span>
    if (value.every(isPrimitive)) {
      return value.map((v) => (typeof v === 'string' ? v : String(v))).join(', ')
    }
    return (
      <div className="space-y-1.5">
        {value.map((item, idx) => (
          <div
            key={idx}
            className="rounded-md border border-border/40 bg-surface px-2 py-1.5 text-xs"
          >
            <p className="mb-1 text-muted">#{idx + 1}</p>
            {renderStructured(`${key}[${idx}]`, item, depth + 1)}
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    )
    if (entries.length === 0) return <span className="text-muted">—</span>
    return (
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_1fr] gap-2 text-xs">
            <span className="text-muted">{titleCase(k)}</span>
            <span className="break-words text-text">{renderStructured(k, v, depth + 1)}</span>
          </div>
        ))}
      </div>
    )
  }

  return String(value)
}

const BookingDetailsModal = ({ booking, onClose, onRefund, onCancel, onDelete }: Props) => {
  const [showRaw, setShowRaw] = useState(false)
  // Drives the slide-in from the right: starts off-screen, shifts to 0
  // after first paint. Click-to-close and Escape both run the slide-out
  // first so the dismissal feels instantaneous yet not jarring.
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  const requestClose = () => {
    setEntered(false)
    // Match the slide-out duration before unmounting via parent.
    window.setTimeout(() => onClose(), 180)
  }

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const otherFields = useMemo(() => {
    const entries = Object.entries(booking).filter(([k]) => !FIRST_CLASS_KEYS.has(k))
    entries.sort(([a], [b]) => a.localeCompare(b))
    return entries
  }, [booking])

  const refundStatus = (booking as Record<string, unknown>).refundStatus
  const refundAmount = (booking as Record<string, unknown>).refundAmount
  const disputeStatus = (booking as Record<string, unknown>).disputeStatus

  // Right-side drawer (the file kept its historic name for backwards-
  // compatible imports/tests). Inspect+edit lives next to the list so
  // an Owner doesn't lose audit context to a centered modal overlay.
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Booking details"
    >
      <div
        onClick={requestClose}
        aria-hidden
        className={`absolute inset-0 bg-base/65 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          entered ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative flex h-full w-full max-w-[480px] flex-col overflow-hidden border-l border-border bg-surface shadow-2xl transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          entered ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold tabular-nums text-text">
              {booking.id}
            </p>
            <p className="text-xs text-muted">
              Created {fmtDateTimeFullIST(booking.createdAt)} ·{' '}
              {getLocationShortName(booking.locationId)}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="ui-btn ui-btn-neutral min-h-8 px-3 py-1 text-xs"
            aria-label="Close"
          >
            Close
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <Section title="Customer">
            <Row label="Name" value={String(booking.userDisplayName ?? '—')} />
            <Row label="Phone" value={String(booking.userPhone ?? '—')} />
            <Row
              label="User ID"
              value={<code className="font-mono text-xs">{booking.userId}</code>}
            />
          </Section>

          <Section title="Session">
            <Row label="Session date" value={fmtDateIST(booking.sessionDate)} />
            <Row
              label="Location"
              value={`${getLocationShortName(booking.locationId)} (${booking.locationId})`}
            />
            <Row
              label="Booking status"
              value={<span className="capitalize">{booking.bookingStatus}</span>}
            />
            <Row
              label="Check-in"
              value={
                booking.checkInStatus ? (
                  <span className="capitalize">{booking.checkInStatus}</span>
                ) : (
                  <span className="text-muted">Not checked in</span>
                )
              }
            />
            <Row label="Tires" value={String(booking.tires ?? 0)} />
            <Row
              label="QR code"
              value={
                booking.qrCode ? <code className="font-mono text-xs">{booking.qrCode}</code> : '—'
              }
            />
          </Section>

          <Section title="Items">
            {booking.items.length === 0 ? (
              <p className="py-2 text-sm text-muted">No items.</p>
            ) : (
              <div className="space-y-2">
                <BookingItemsList booking={booking} />
                <p className="px-1 pt-1 text-xs text-muted">{formatBookingItems(booking)}</p>
              </div>
            )}
          </Section>

          <Section title="Payment">
            <Row label="Method" value={booking.paymentMethod ?? '—'} />
            <Row
              label="Status"
              value={<span className="capitalize">{booking.paymentStatus}</span>}
            />
            <Row label="Subtotal" value={formatCurrency(booking.totalAmount)} />
            <Row label="Discount" value={formatCurrency(booking.discountAmount)} />
            <Row label="Total" value={<strong>{formatCurrency(booking.finalAmount)}</strong>} />
            <Row
              label="Paid at"
              value={
                booking.paymentCompletedAt ? fmtDateTimeFullIST(booking.paymentCompletedAt) : '—'
              }
            />
            <Row
              label="Razorpay order ID"
              value={
                booking.razorpayOrderId ? (
                  <code className="font-mono text-xs">{booking.razorpayOrderId}</code>
                ) : (
                  '—'
                )
              }
            />
            <Row
              label="Razorpay payment ID"
              value={
                booking.paymentId ? (
                  <code className="font-mono text-xs">{booking.paymentId}</code>
                ) : (
                  '—'
                )
              }
            />
            <Row
              label="Razorpay signature"
              value={
                booking.razorpaySignature ? (
                  <code className="font-mono text-xs">
                    {String(booking.razorpaySignature).slice(0, 20)}…
                  </code>
                ) : (
                  '—'
                )
              }
            />
            <Row label="Payment link status" value={booking.paymentLinkStatus ?? '—'} />
            {refundStatus != null && refundStatus !== 'None' ? (
              <Row
                label="Refund"
                value={`${String(refundStatus)}${refundAmount != null ? ` · ${formatCurrency(Number(refundAmount))}` : ''}`}
              />
            ) : null}
            {disputeStatus ? <Row label="Dispute" value={String(disputeStatus)} /> : null}
          </Section>

          <Section title="Source / Initiator">
            <Row label="Source" value={booking.source ?? '—'} />
            <Row label="Source type" value={booking.sourceType ?? '—'} />
            <Row
              label="Initiated by"
              value={booking.createdByAdminName ?? <span className="text-muted">Customer</span>}
            />
            <Row
              label="Initiator ID"
              value={
                booking.createdByAdminId ? (
                  <code className="font-mono text-xs">{booking.createdByAdminId}</code>
                ) : (
                  '—'
                )
              }
            />
            <Row label="Initiator role" value={booking.createdByRole ?? '—'} />
          </Section>

          {booking.swapHistory && booking.swapHistory.length > 0 ? (
            <Section title={`Activity Swaps (${booking.swapHistory.length})`}>
              <div className="space-y-2">
                {booking.swapHistory.map((s) => {
                  // s.at may arrive as a Firestore Timestamp, ISO string, or Date
                  // depending on read path. Normalize defensively.
                  const rawAt = s.at as unknown
                  const at =
                    rawAt instanceof Date
                      ? rawAt
                      : rawAt && typeof (rawAt as { toDate?: () => Date }).toDate === 'function'
                        ? (rawAt as { toDate: () => Date }).toDate()
                        : new Date(rawAt as string)
                  const settlementLabel =
                    s.settlement === 'wallet_credit'
                      ? 'Refunded to wallet'
                      : s.settlement === 'wallet_debit'
                        ? 'Charged from wallet'
                        : s.settlement === 'external_cash'
                          ? 'Settled externally (cash)'
                          : 'No adjustment'
                  return (
                    <div
                      key={s.eventId}
                      className="rounded-lg border border-border/40 bg-surface px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-text">
                        {s.from.activityName} → {s.to.activityName}
                      </p>
                      <p className="text-xs text-muted">
                        Qty {s.to.quantity} · Diff{' '}
                        <span
                          className={
                            s.priceDelta > 0 ? 'text-warning' : s.priceDelta < 0 ? 'text-info' : ''
                          }
                        >
                          {s.priceDelta > 0 ? '+' : ''}
                          {formatCurrency(s.priceDelta)}
                        </span>{' '}
                        · {settlementLabel}
                        {s.walletAmount ? ` (${formatCurrency(s.walletAmount)})` : ''}
                      </p>
                      <p className="text-xs text-muted">Reason: {s.reason}</p>
                      <p className="text-[11px] text-muted">
                        By {s.by.name} ({s.by.role}) · {fmtDateTimeFullIST(at)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </Section>
          ) : null}

          {booking.passengers && booking.passengers.length > 0 ? (
            <Section title="Passengers">
              <div className="space-y-2">
                {booking.passengers.map((p, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border/40 bg-surface px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-text">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.weight ? `${p.weight} kg` : '—'}
                      {p.age ? ` · ${p.age} yrs` : ''}
                      {p.gender ? ` · ${p.gender}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {otherFields.length > 0 ? (
            <Section title="Other">
              {otherFields.map(([k, v]) => (
                <Row key={k} label={titleCase(k)} value={renderStructured(k, v)} />
              ))}
            </Section>
          ) : null}

          {(() => {
            // High-stakes actions live here, behind a collapsed disclosure,
            // because the row used to surface them inline and that produced
            // misclicks. Per PRODUCT.md "action lives where the data is" —
            // the data IS this modal, the booking the Owner just clicked
            // into. The collapsed disclosure is the ceremony.
            const refundStatusStr = String(refundStatus ?? 'None')
            const canRefund =
              !!onRefund && booking.paymentStatus === 'completed' && refundStatusStr !== 'Full'
            const canCancel =
              !!onCancel &&
              booking.bookingStatus !== 'cancelled' &&
              booking.bookingStatus !== 'completed'
            const canDelete = !!onDelete && booking.bookingStatus !== 'completed'
            if (!canRefund && !canCancel && !canDelete) return null
            return (
              <details className="group rounded-xl border border-border/60 bg-panel p-3">
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted">
                  Manage
                  <span className="ml-2 font-normal normal-case tracking-normal text-muted/70">
                    refund · cancel · delete
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  {canRefund && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-surface px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">Refund</p>
                        <p className="text-xs text-muted">
                          Issue a partial or full refund (cash or wallet). Reverses the vendor
                          credit on settlement.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onRefund?.(booking)
                        }}
                        className="ui-btn ui-btn-info min-h-9 px-3 py-1.5 text-xs"
                      >
                        Refund…
                      </button>
                    </div>
                  )}
                  {canCancel && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-surface px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">Cancel</p>
                        <p className="text-xs text-muted">
                          Mark this booking as cancelled. Customer keeps their wallet/refund balance
                          separately if money moved.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onCancel?.(booking)
                        }}
                        className="ui-btn ui-btn-warning min-h-9 px-3 py-1.5 text-xs"
                      >
                        Cancel booking
                      </button>
                    </div>
                  )}
                  {canDelete && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/35 bg-warning/5 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-warning">Move to Trash</p>
                        <p className="text-xs text-muted">
                          Hides this booking from the live list. Restorable from the Trash tab.
                          Vendor ledger and invoices are untouched until permanent delete.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          onDelete?.(booking)
                        }}
                        className="ui-btn ui-btn-warning min-h-9 px-3 py-1.5 text-xs"
                      >
                        Move to Trash
                      </button>
                    </div>
                  )}
                </div>
              </details>
            )
          })()}

          <details
            open={showRaw}
            onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}
            className="rounded-xl border border-border/60 bg-panel p-3"
          >
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
              Raw JSON
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-base/55 p-3 font-mono text-[11px] text-text">
              {JSON.stringify(booking, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </div>
  )
}

// ── Item rendering ──────────────────────────────────────────────────────

type ItemView = AsquareBooking['items'][number]
type ItemMeta = {
  refunded: boolean
  unit: number
  qty: number
  lineTotal: number
  fullName: string
  comboPrefix: string | null
  childName: string
  vendorId: string | null
  breadcrumb: string
  date: string
  timeSlot: string
  duration: number
  category: string
}

const extractMeta = (item: ItemView, deriveUnit: (it: ItemView) => number): ItemMeta => {
  const refunded = (item as unknown as Record<string, unknown>).refunded === true
  const qty = Math.max(1, Math.floor(item.quantity || 1))
  const unit = deriveUnit(item)
  const fullName = item.itemName || item.activity?.name || 'Unnamed activity'
  const comboSplit = fullName.match(/^(.+?)\s+•\s+(.+)$/)
  const vendorId =
    (item as unknown as Record<string, unknown>).vendorId || item.activity?.vendorId || null
  const gameId = (item as unknown as Record<string, unknown>).gameId || item.activity?.gameTypeId
  const subGameId = (item as unknown as Record<string, unknown>).subGameId
  const variantId = (item as unknown as Record<string, unknown>).variantId
  const breadcrumb = [gameId, subGameId, variantId]
    .filter((s): s is string => typeof s === 'string' && !!s)
    .join(' / ')
  return {
    refunded,
    unit,
    qty,
    lineTotal: unit * qty,
    fullName,
    comboPrefix: comboSplit?.[1] ?? null,
    childName: comboSplit?.[2] ?? fullName,
    vendorId: typeof vendorId === 'string' && vendorId ? vendorId : null,
    breadcrumb,
    date: item.date || '',
    timeSlot: item.timeSlot || '',
    duration: item.duration || 0,
    category: item.activity?.category || '',
  }
}

type Block =
  | { kind: 'plain'; meta: ItemMeta; key: string }
  | {
      kind: 'combo'
      prefix: string
      multiplier: number
      total: number
      anyRefunded: boolean
      children: Array<{
        meta: ItemMeta
        instanceCount: number
        instanceLineTotal: number
      }>
      key: string
    }

const groupItems = (items: ItemView[], deriveUnit: (it: ItemView) => number): Block[] => {
  // Walk items in order, batching consecutive same-prefix combo items into
  // groups. Order is preserved so non-combo items stay where the user
  // expects them.
  const blocks: Block[] = []
  let i = 0
  while (i < items.length) {
    const meta = extractMeta(items[i], deriveUnit)
    if (!meta.comboPrefix) {
      blocks.push({ kind: 'plain', meta, key: `p-${i}` })
      i++
      continue
    }
    const prefix = meta.comboPrefix
    const groupStart = i
    const group: ItemMeta[] = []
    while (i < items.length) {
      const m = extractMeta(items[i], deriveUnit)
      if (m.comboPrefix !== prefix) break
      group.push(m)
      i++
    }
    // Try to detect repeats: bucket by childName, sum qty + count refunded.
    const byChild = new Map<
      string,
      { metas: ItemMeta[]; firstMeta: ItemMeta; refundedCount: number }
    >()
    for (const m of group) {
      const slot = byChild.get(m.childName) ?? {
        metas: [],
        firstMeta: m,
        refundedCount: 0,
      }
      slot.metas.push(m)
      if (m.refunded) slot.refundedCount += 1
      byChild.set(m.childName, slot)
    }
    const counts = [...byChild.values()].map((s) => s.metas.length)
    const allEqual = counts.every((c) => c === counts[0])
    const refundUniformPerChild = [...byChild.values()].every(
      (s) => s.refundedCount === 0 || s.refundedCount === s.metas.length,
    )
    if (allEqual && refundUniformPerChild && counts[0] >= 1) {
      const multiplier = counts[0]
      const children = [...byChild.values()].map((s) => {
        // All metas in this slot are the same activity; treat them as one
        // consolidated child line with quantity = sum of instance qtys.
        const instanceCount = s.metas.reduce((sum, m) => sum + m.qty, 0)
        const refunded = s.refundedCount === s.metas.length
        const consolidated: ItemMeta = {
          ...s.firstMeta,
          qty: instanceCount,
          lineTotal: s.firstMeta.unit * instanceCount,
          refunded,
        }
        return {
          meta: consolidated,
          instanceCount,
          instanceLineTotal: consolidated.lineTotal,
        }
      })
      const total = children.reduce((s, c) => s + c.instanceLineTotal, 0)
      const anyRefunded = children.some((c) => c.meta.refunded)
      blocks.push({
        kind: 'combo',
        prefix,
        multiplier,
        total,
        anyRefunded,
        children,
        key: `c-${groupStart}`,
      })
    } else {
      // Mixed refund state or uneven counts — render each line separately
      // so we never collapse truthful per-instance differences.
      for (let j = 0; j < group.length; j++) {
        blocks.push({
          kind: 'plain',
          meta: group[j],
          key: `p-${groupStart + j}`,
        })
      }
    }
  }
  return blocks
}

const PlainItemCard = ({ meta }: { meta: ItemMeta }) => (
  <div
    className={`rounded-lg border bg-surface px-3 py-2 text-sm ${
      meta.refunded ? 'border-warning/45 bg-warning/5' : 'border-border/40'
    }`}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={`font-medium text-text ${meta.refunded ? 'line-through opacity-70' : ''}`}
          >
            {meta.childName}
          </span>
          {meta.refunded ? (
            <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
              Refunded
            </span>
          ) : null}
        </div>
        {meta.breadcrumb ? (
          <p className="mt-0.5 font-mono text-[10px] text-muted">{meta.breadcrumb}</p>
        ) : null}
        {meta.date || meta.timeSlot || meta.duration || meta.category ? (
          <p className="mt-1 text-xs text-muted">
            {meta.date}
            {meta.timeSlot ? ` · ${meta.timeSlot}` : ''}
            {meta.duration ? ` · ${meta.duration} min` : ''}
            {meta.category ? ` · ${meta.category}` : ''}
          </p>
        ) : null}
        {meta.vendorId ? (
          <p className="mt-0.5 text-xs">
            <span className="text-muted">Vendor</span>{' '}
            <code className="font-mono text-[11px]">{meta.vendorId}</code>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Company-attributed</p>
        )}
      </div>
      <div className="text-right">
        <p className="font-mono text-sm text-text">{formatCurrency(meta.lineTotal)}</p>
        <p className="font-mono text-[11px] text-muted">
          {meta.qty} × {formatCurrency(meta.unit)}
        </p>
      </div>
    </div>
  </div>
)

const ComboBlockCard = ({ block }: { block: Extract<Block, { kind: 'combo' }> }) => (
  <div
    className={`rounded-lg border bg-info/5 px-3 py-2 ${
      block.anyRefunded ? 'border-warning/45' : 'border-info/40'
    }`}
  >
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full border border-info/50 bg-info/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info">
          Combo
        </span>
        <span className="font-semibold text-text">{block.prefix}</span>
        <span className="rounded border border-border/60 bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
          × {block.multiplier}
        </span>
      </div>
      <p className="font-mono text-sm font-semibold text-text">{formatCurrency(block.total)}</p>
    </div>
    <div className="space-y-1.5 border-t border-info/20 pt-2">
      {block.children.map((c, idx) => (
        <div key={idx} className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-muted">▸</span>
              <span className={c.meta.refunded ? 'line-through opacity-70' : ''}>
                {c.meta.childName}
              </span>
              {c.meta.refunded ? (
                <span className="rounded-full border border-warning/40 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-warning">
                  Refunded
                </span>
              ) : null}
            </div>
            {c.meta.breadcrumb ? (
              <p className="ml-4 font-mono text-[10px] text-muted">{c.meta.breadcrumb}</p>
            ) : null}
            <p className="ml-4 text-[11px]">
              {c.meta.vendorId ? (
                <>
                  <span className="text-muted">Vendor</span>{' '}
                  <code className="font-mono">{c.meta.vendorId}</code>
                </>
              ) : (
                <span className="text-muted">Company-attributed</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm">{formatCurrency(c.instanceLineTotal)}</p>
            <p className="font-mono text-[11px] text-muted">
              {c.instanceCount} × {formatCurrency(c.meta.unit)}
            </p>
          </div>
        </div>
      ))}
    </div>
  </div>
)

const BookingItemsList = ({ booking }: { booking: AsquareBooking }) => {
  // Per-unit-vs-line-total disambiguation via subTotal sanity (mirrors the
  // reconciliation heuristic).
  const subTotal = Number(booking.totalAmount) || 0
  const sumPriceLine = booking.items.reduce((s, it) => s + (Number(it.price) || 0), 0)
  const sumPriceUnit = booking.items.reduce(
    (s, it) => s + (Number(it.price) || 0) * Math.max(1, Math.floor(it.quantity || 1)),
    0,
  )
  const priceIsLineTotal =
    subTotal > 0 && Math.abs(sumPriceLine - subTotal) < Math.abs(sumPriceUnit - subTotal)
  const deriveUnit = (it: ItemView) => {
    if (typeof it.unitPrice === 'number' && it.unitPrice > 0) return it.unitPrice
    const qty = Math.max(1, Math.floor(it.quantity || 1))
    const price = Number(it.price) || 0
    if (priceIsLineTotal && qty > 0) return price / qty
    if (it.activity?.basePrice) return it.activity.basePrice
    return price
  }
  const blocks = groupItems(booking.items, deriveUnit)
  return (
    <>
      {blocks.map((b) =>
        b.kind === 'plain' ? (
          <PlainItemCard key={b.key} meta={b.meta} />
        ) : (
          <ComboBlockCard key={b.key} block={b} />
        ),
      )}
    </>
  )
}

export default BookingDetailsModal

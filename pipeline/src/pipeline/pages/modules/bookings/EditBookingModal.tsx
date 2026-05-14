import { useEffect, useState, type ReactNode } from 'react'
import type { AsquareBooking } from '../../../api/asquare-bookings'

const CANONICAL_PAYMENT_METHOD_BY_LOWER: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  online: 'UPI',
  card: 'Card',
  razorpay: 'Razorpay',
  link: 'Link',
  wallet: 'Wallet',
  split: 'Split',
}

const normalizePaymentMethod = (raw?: string): string => {
  if (!raw) return 'Cash'
  return CANONICAL_PAYMENT_METHOD_BY_LOWER[raw.toLowerCase()] ?? raw
}

const formatRupees = (n: number): string => `₹${Math.round(n || 0).toLocaleString('en-IN')}`

interface EditAllForm {
  bookingStatus: string
  paymentStatus: string
  paymentMethod: string
  checkInStatus: string
  userDisplayName: string
  userPhone: string
  locationId: string
  sessionDate: string
  totalAmount: string
  discountPercent: string
  tires: string
  source: string
  splitCash: string
  splitUpi: string
  splitCard: string
  items: Array<{ quantity: number; price: number; date: string; timeSlot: string }>
  passengers: Array<{ name: string; weight: string; age: string; gender: string }>
}

const emptyForm: EditAllForm = {
  bookingStatus: '',
  paymentStatus: '',
  paymentMethod: '',
  checkInStatus: '',
  userDisplayName: '',
  userPhone: '',
  locationId: '',
  sessionDate: '',
  totalAmount: '',
  discountPercent: '0',
  tires: '',
  source: '',
  splitCash: '',
  splitUpi: '',
  splitCard: '',
  items: [],
  passengers: [],
}

interface SegmentedOption {
  value: string
  label: string
}

interface SegmentedControlProps {
  label: string
  value: string
  options: SegmentedOption[]
  onChange: (next: string) => void
}

const SegmentedControl = ({ label, value, options, onChange }: SegmentedControlProps) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
      {label}
    </span>
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-panel p-1"
    >
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected ? 'true' : 'false'}
            onClick={() => onChange(opt.value)}
            className={
              selected
                ? 'min-h-7 rounded-md bg-surface px-3 py-1 text-xs font-semibold text-text shadow-sm ring-1 ring-border/60'
                : 'min-h-7 rounded-md px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-text'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  </div>
)

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</h4>
)

interface EditBookingModalProps {
  booking: AsquareBooking | null
  locations: Array<{ id: string; name: string }>
  onSave: (booking: AsquareBooking, updates: Partial<AsquareBooking>) => Promise<void>
  onClose: () => void
}

const EditBookingModal = ({ booking, locations, onSave, onClose }: EditBookingModalProps) => {
  const [form, setForm] = useState<EditAllForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!booking) return
    const formatDate = (d: Date | string | undefined) => {
      if (!d) return ''
      const dt = d instanceof Date ? d : new Date(d)
      return isNaN(dt.getTime()) ? '' : dt.toISOString().split('T')[0]
    }
    const total = booking.totalAmount ?? 0
    const discount = booking.discountAmount ?? 0
    const pct = total > 0 ? Math.round((discount / total) * 100) : 0
    setForm({
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      paymentMethod: normalizePaymentMethod(booking.paymentMethod),
      checkInStatus: booking.checkInStatus || 'pending',
      userDisplayName: booking.userDisplayName || '',
      userPhone: booking.userPhone || '',
      locationId: booking.locationId || '',
      sessionDate: formatDate(booking.sessionDate),
      totalAmount: String(total),
      discountPercent: String(pct),
      tires: String(booking.tires ?? 0),
      source: booking.source || '',
      splitCash: String((booking as Record<string, unknown>).splitCash ?? '') || '',
      splitUpi: String((booking as Record<string, unknown>).splitUpi ?? '') || '',
      splitCard: String((booking as Record<string, unknown>).splitCard ?? '') || '',
      items: (booking.items || []).map((it) => ({
        quantity: it.quantity,
        price: Math.round(
          Number(it.price ?? it.activity?.basePrice ?? 0) / Math.max(1, it.quantity),
        ),
        date: it.date || '',
        timeSlot: it.timeSlot || '',
      })),
      passengers: (booking.passengers || []).map((p) => ({
        name: p.name || '',
        weight: String(p.weight ?? ''),
        age: String(p.age ?? ''),
        gender: p.gender || '',
      })),
    })
    setError(null)
  }, [booking])

  const totalAmount = Number(form.totalAmount) || 0
  const discountPercent = Math.min(100, Math.max(0, Number(form.discountPercent) || 0))
  const discountAmount = Math.round((totalAmount * discountPercent) / 100)
  const finalAmount = Math.max(0, totalAmount - discountAmount)

  const splitCashNum = Number(form.splitCash) || 0
  const splitUpiNum = Number(form.splitUpi) || 0
  const splitCardNum = Number(form.splitCard) || 0
  const splitTotal = splitCashNum + splitUpiNum + splitCardNum
  const splitDiff = finalAmount - splitTotal
  const isSplit = form.paymentMethod === 'Split'
  const splitValid = isSplit ? Math.abs(splitDiff) < 0.01 && splitTotal > 0 : true

  const handleSave = async () => {
    if (!booking) return
    const { bookingStatus, paymentStatus, paymentMethod, checkInStatus } = form

    if (isSplit) {
      if (splitTotal <= 0) {
        setError('Split payment requires at least one amount greater than zero.')
        return
      }
      if (Math.abs(splitDiff) >= 0.01) {
        setError(
          `Split total ${formatRupees(splitTotal)} does not match final amount ${formatRupees(finalAmount)}. Please adjust.`,
        )
        return
      }
    }

    if (
      (bookingStatus === 'confirmed' || bookingStatus === 'completed') &&
      paymentStatus !== 'completed' &&
      paymentMethod !== 'Cash' &&
      !isSplit &&
      finalAmount !== 0
    ) {
      setError(
        `Cannot set booking to "${bookingStatus}". Payment is not completed and method is not Cash.`,
      )
      return
    }

    const updatedItems = booking.items.map((orig, i) => {
      const edited = form.items[i]
      if (!edited) return orig
      return {
        ...orig,
        quantity: edited.quantity,
        price: edited.price * edited.quantity,
        date: edited.date,
        timeSlot: edited.timeSlot,
      }
    })

    const updatedPassengers = form.passengers.map((p) => ({
      name: p.name,
      weight: Number(p.weight) || 0,
      ...(p.age ? { age: Number(p.age) } : {}),
      ...(p.gender ? { gender: p.gender as 'male' | 'female' | 'other' } : {}),
    }))

    const updates: Partial<AsquareBooking> = {
      bookingStatus: bookingStatus as AsquareBooking['bookingStatus'],
      paymentStatus: paymentStatus as AsquareBooking['paymentStatus'],
      paymentMethod,
      checkInStatus: checkInStatus as AsquareBooking['checkInStatus'],
      userDisplayName: form.userDisplayName,
      userPhone: form.userPhone,
      locationId: form.locationId,
      sessionDate: form.sessionDate
        ? new Date(`${form.sessionDate}T00:00:00`)
        : booking.sessionDate,
      totalAmount,
      discountAmount,
      finalAmount,
      tires: Number(form.tires) || 0,
      source: form.source,
      items: updatedItems,
      passengers: updatedPassengers,
      splitCash: isSplit ? splitCashNum || null : null,
      splitUpi: isSplit ? splitUpiNum || null : null,
      splitCard: isSplit ? splitCardNum || null : null,
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(booking, updates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  if (!booking) return null

  const splitStatus: { tone: 'ok' | 'over' | 'under'; label: string } = !isSplit
    ? { tone: 'ok', label: '' }
    : Math.abs(splitDiff) < 0.01 && splitTotal > 0
      ? { tone: 'ok', label: `Balanced at ${formatRupees(finalAmount)}` }
      : splitDiff > 0
        ? { tone: 'under', label: `${formatRupees(splitDiff)} remaining` }
        : { tone: 'over', label: `${formatRupees(Math.abs(splitDiff))} over` }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base/70 p-4 pt-10 backdrop-blur-sm">
      <div className="flex w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Sticky header — booking ID gets monospace prominence (audit-grade identifier) */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-2xl border-b border-border bg-surface/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Edit booking
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold text-text">
              {booking.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ui-btn ui-btn-neutral min-h-9 px-4 text-sm"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !splitValid}
              className="ui-btn ui-btn-primary min-h-9 px-5 text-sm"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-5">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical"
            >
              {error}
            </p>
          )}

          {/* Status — segmented controls so every option is visible at a glance */}
          <section className="space-y-3">
            <SectionHeading>Status</SectionHeading>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <SegmentedControl
                label="Booking"
                value={form.bookingStatus}
                onChange={(v) => setForm((f) => ({ ...f, bookingStatus: v }))}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'confirmed', label: 'Confirmed' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
              <SegmentedControl
                label="Payment"
                value={form.paymentStatus}
                onChange={(v) => setForm((f) => ({ ...f, paymentStatus: v }))}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'refunded', label: 'Refunded' },
                ]}
              />
              <SegmentedControl
                label="Method"
                value={form.paymentMethod}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    paymentMethod: v,
                    ...(v !== 'Split' ? { splitCash: '', splitUpi: '', splitCard: '' } : {}),
                  }))
                }
                options={[
                  { value: 'Cash', label: 'Cash' },
                  { value: 'UPI', label: 'UPI' },
                  { value: 'Card', label: 'Card' },
                  { value: 'Razorpay', label: 'Razorpay' },
                  { value: 'Link', label: 'Link' },
                  { value: 'Wallet', label: 'Wallet' },
                  { value: 'Split', label: 'Split' },
                ]}
              />
              <SegmentedControl
                label="Check-in"
                value={form.checkInStatus}
                onChange={(v) => setForm((f) => ({ ...f, checkInStatus: v }))}
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'completed', label: 'Checked-In' },
                  { value: 'boarded', label: 'Boarded' },
                ]}
              />
            </div>
          </section>

          {/* Customer & schedule — compact two-column grid */}
          <section className="space-y-3">
            <SectionHeading>Customer & schedule</SectionHeading>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Customer name
                </span>
                <input
                  className="ui-field min-h-9 w-full text-sm"
                  value={form.userDisplayName}
                  onChange={(e) => setForm((f) => ({ ...f, userDisplayName: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Phone
                </span>
                <input
                  className="ui-field min-h-9 w-full text-sm tabular-nums"
                  value={form.userPhone}
                  onChange={(e) => setForm((f) => ({ ...f, userPhone: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Location
                </span>
                <select
                  className="ui-field min-h-9 w-full text-sm"
                  value={form.locationId}
                  onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Session date
                  </span>
                  <input
                    type="date"
                    className="ui-field min-h-9 w-full text-sm tabular-nums"
                    value={form.sessionDate}
                    onChange={(e) => setForm((f) => ({ ...f, sessionDate: e.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Source
                  </span>
                  <input
                    className="ui-field min-h-9 w-full text-sm"
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Financials — receipt-style ledger with Final Amount as the dominant figure */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
              <SectionHeading>Financials</SectionHeading>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Final amount
                </p>
                <p className="mt-0.5 text-3xl font-semibold tabular-nums text-text">
                  {formatRupees(finalAmount)}
                </p>
              </div>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-1">
                <dt className="text-muted">Total amount</dt>
                <dd>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="ui-field h-9 w-36 text-right text-sm tabular-nums"
                    value={form.totalAmount}
                    onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))}
                  />
                </dd>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-1">
                <dt className="text-muted">Discount</dt>
                <dd className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      className="ui-field h-9 w-20 text-right text-sm tabular-nums"
                      value={form.discountPercent}
                      onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))}
                    />
                    <span className="text-sm text-muted">%</span>
                  </div>
                  <span className="w-28 text-right text-sm tabular-nums text-muted">
                    {discountAmount > 0 ? `−${formatRupees(discountAmount)}` : formatRupees(0)}
                  </span>
                </dd>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-1">
                <dt className="text-muted">Tires</dt>
                <dd>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="ui-field h-9 w-36 text-right text-sm tabular-nums"
                    value={form.tires}
                    onChange={(e) => setForm((f) => ({ ...f, tires: e.target.value }))}
                  />
                </dd>
              </div>
            </dl>

            {isSplit && (
              <div className="space-y-3 rounded-lg border border-border bg-panel/40 p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Split allocation
                  </p>
                  <p
                    className={
                      splitStatus.tone === 'ok'
                        ? 'text-xs font-semibold tabular-nums text-success'
                        : splitStatus.tone === 'over'
                          ? 'text-xs font-semibold tabular-nums text-critical'
                          : 'text-xs font-semibold tabular-nums text-warning'
                    }
                  >
                    {splitStatus.tone === 'ok' && '✓ '}
                    {splitStatus.tone === 'over' && '▲ '}
                    {splitStatus.tone === 'under' && '▼ '}
                    {splitStatus.label}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Cash
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="ui-field h-9 w-full text-right text-sm tabular-nums"
                      placeholder="0"
                      value={form.splitCash}
                      onChange={(e) => setForm((f) => ({ ...f, splitCash: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      UPI
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="ui-field h-9 w-full text-right text-sm tabular-nums"
                      placeholder="0"
                      value={form.splitUpi}
                      onChange={(e) => setForm((f) => ({ ...f, splitUpi: e.target.value }))}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Card
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="ui-field h-9 w-full text-right text-sm tabular-nums"
                      placeholder="0"
                      value={form.splitCard}
                      onChange={(e) => setForm((f) => ({ ...f, splitCard: e.target.value }))}
                    />
                  </label>
                </div>
                <p className="text-[11px] tabular-nums text-muted">
                  Total: {formatRupees(splitTotal)} of {formatRupees(finalAmount)}
                </p>
              </div>
            )}
          </section>

          {/* Items — header-once table, no per-row labels */}
          {form.items.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Items ({form.items.length})</SectionHeading>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-panel/40 text-[10px] uppercase tracking-[0.08em] text-muted">
                      <th className="px-3 py-2 text-left font-semibold">Activity</th>
                      <th className="w-20 px-2 py-2 text-right font-semibold">Qty</th>
                      <th className="w-28 px-2 py-2 text-right font-semibold">Unit price</th>
                      <th className="w-36 px-2 py-2 text-left font-semibold">Date</th>
                      <th className="w-24 px-2 py-2 text-left font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item, idx) => {
                      const orig = booking.items[idx]
                      return (
                        <tr key={idx} className="border-b border-border/60 last:border-b-0">
                          <td className="px-3 py-2 align-middle text-sm text-text">
                            {orig?.activity?.name ?? 'Activity'}
                          </td>
                          <td className="px-2 py-1.5 align-middle">
                            <input
                              type="number"
                              min={1}
                              aria-label={`Quantity for ${orig?.activity?.name ?? 'item'}`}
                              className="ui-field h-8 w-full text-right text-xs tabular-nums"
                              value={item.quantity}
                              onChange={(e) => {
                                const next = [...form.items]
                                next[idx] = {
                                  ...next[idx],
                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                }
                                setForm((f) => ({ ...f, items: next }))
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-middle">
                            <input
                              type="number"
                              aria-label={`Unit price for ${orig?.activity?.name ?? 'item'}`}
                              className="ui-field h-8 w-full text-right text-xs tabular-nums"
                              value={item.price}
                              onChange={(e) => {
                                const next = [...form.items]
                                next[idx] = { ...next[idx], price: Number(e.target.value) || 0 }
                                setForm((f) => ({ ...f, items: next }))
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-middle">
                            <input
                              type="date"
                              aria-label={`Date for ${orig?.activity?.name ?? 'item'}`}
                              className="ui-field h-8 w-full text-xs tabular-nums"
                              value={item.date}
                              onChange={(e) => {
                                const next = [...form.items]
                                next[idx] = { ...next[idx], date: e.target.value }
                                setForm((f) => ({ ...f, items: next }))
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-middle">
                            <input
                              aria-label={`Time slot for ${orig?.activity?.name ?? 'item'}`}
                              className="ui-field h-8 w-full text-xs tabular-nums"
                              value={item.timeSlot}
                              onChange={(e) => {
                                const next = [...form.items]
                                next[idx] = { ...next[idx], timeSlot: e.target.value }
                                setForm((f) => ({ ...f, items: next }))
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Passengers — same header-once treatment, with inline add/remove */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <SectionHeading>Passengers ({form.passengers.length})</SectionHeading>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    passengers: [...f.passengers, { name: '', weight: '', age: '', gender: '' }],
                  }))
                }
                className="ui-btn ui-btn-neutral min-h-7 px-3 text-[11px]"
              >
                + Add passenger
              </button>
            </div>
            {form.passengers.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-panel/40 text-[10px] uppercase tracking-[0.08em] text-muted">
                      <th className="px-3 py-2 text-left font-semibold">Name</th>
                      <th className="w-24 px-2 py-2 text-right font-semibold">Weight (kg)</th>
                      <th className="w-20 px-2 py-2 text-right font-semibold">Age</th>
                      <th className="w-28 px-2 py-2 text-left font-semibold">Gender</th>
                      <th className="w-20 px-2 py-2 text-right font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.passengers.map((p, idx) => (
                      <tr key={idx} className="border-b border-border/60 last:border-b-0">
                        <td className="px-3 py-1.5 align-middle">
                          <input
                            aria-label={`Passenger ${idx + 1} name`}
                            className="ui-field h-8 w-full text-xs"
                            value={p.name}
                            onChange={(e) => {
                              const next = [...form.passengers]
                              next[idx] = { ...next[idx], name: e.target.value }
                              setForm((f) => ({ ...f, passengers: next }))
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <input
                            type="number"
                            aria-label={`Passenger ${idx + 1} weight in kilograms`}
                            className="ui-field h-8 w-full text-right text-xs tabular-nums"
                            value={p.weight}
                            onChange={(e) => {
                              const next = [...form.passengers]
                              next[idx] = { ...next[idx], weight: e.target.value }
                              setForm((f) => ({ ...f, passengers: next }))
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <input
                            type="number"
                            aria-label={`Passenger ${idx + 1} age`}
                            className="ui-field h-8 w-full text-right text-xs tabular-nums"
                            value={p.age}
                            onChange={(e) => {
                              const next = [...form.passengers]
                              next[idx] = { ...next[idx], age: e.target.value }
                              setForm((f) => ({ ...f, passengers: next }))
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-middle">
                          <select
                            aria-label={`Passenger ${idx + 1} gender`}
                            className="ui-field h-8 w-full text-xs"
                            value={p.gender}
                            onChange={(e) => {
                              const next = [...form.passengers]
                              next[idx] = { ...next[idx], gender: e.target.value }
                              setForm((f) => ({ ...f, passengers: next }))
                            }}
                          >
                            <option value="">—</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right align-middle">
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                passengers: f.passengers.filter((_, i) => i !== idx),
                              }))
                            }
                            className="text-[11px] font-medium text-muted transition-colors hover:text-critical"
                            aria-label={`Remove passenger ${idx + 1}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-panel/30 px-3 py-3 text-xs text-muted">
                No passengers recorded for this booking.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default EditBookingModal

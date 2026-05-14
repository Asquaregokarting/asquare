// A² Scanner — ScanDetails.tsx
// Shows fetched billing details with per-serial selection for partial verification

import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BillLookupResult, ScanSerial } from './types/scanner.types'

interface ScanDetailsProps {
  result: BillLookupResult
  isUpdating: boolean
  isSuccess: boolean
  showPricing: boolean
  onSubmit: (selected: ScanSerial[]) => void
  onReset: () => void
}

const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN')}`

/** Derive kart engine CC from the activity/item name. */
const getKartType = (itemName: string): string | null => {
  const name = itemName.toLowerCase()
  if (name.includes('child') || name.includes('kids') || name.includes('junior')) return '200cc'
  if (name.includes('double')) return '270cc'
  if (name.includes('adult')) return '270cc'
  return null
}

const padSerial = (num: number): string => (num > 0 ? `#${String(num).padStart(3, '0')}` : '')

export const ScanDetails = ({
  result,
  isUpdating,
  isSuccess,
  showPricing,
  onSubmit,
  onReset,
}: ScanDetailsProps) => {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const pendingSerials = useMemo(
    () => result.serials.filter((s) => s.status === 'pending'),
    [result.serials],
  )

  const verifiablePending = useMemo(
    () => pendingSerials.filter((s) => s.verifiable),
    [pendingSerials],
  )

  const completedSerials = useMemo(
    () => result.serials.filter((s) => s.status === 'completed'),
    [result.serials],
  )

  const toggleItem = useCallback((serial: ScanSerial) => {
    if (!serial.verifiable) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(serial.serialId)) next.delete(serial.serialId)
      else next.add(serial.serialId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(verifiablePending.map((s) => s.serialId)))
  }, [verifiablePending])

  const deselectAll = useCallback(() => setSelected(new Set()), [])

  const selectedItems = useMemo(
    () => pendingSerials.filter((s) => selected.has(s.serialId)),
    [pendingSerials, selected],
  )

  // Success state
  if (isSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-signal-green-bright/30 bg-signal-green-bright/10 py-12 text-center"
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-signal-green-bright/20">
          <span className="text-3xl">✅</span>
        </div>
        <div>
          <p className="text-lg font-bold text-signal-green-bright">Verification Complete!</p>
          <p className="mt-1 text-sm text-white/50">
            {selectedItems.length || '—'} item(s) verified for{' '}
            {result.invoiceNumber ?? result.billingId}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="mt-2 rounded-xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50 active:scale-95 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white"
        >
          Scan Another
        </button>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Booking Details</h3>
          <p className="text-sm text-gray-500 dark:text-white/50">
            {result.customerName ? (
              <span className="text-gray-700 dark:text-white/70">{result.customerName} — </span>
            ) : null}
            <span className="font-mono text-track-accent-soft">
              {result.invoiceNumber ?? result.billingId}
            </span>
          </p>
          {showPricing && result.totalAmount != null ? (
            <p className="mt-0.5 text-xs text-gray-400 dark:text-white/40">
              Total: {formatCurrency(result.totalAmount)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:text-gray-700 dark:border-white/10 dark:text-white/50 dark:hover:text-white/70"
        >
          ← Back
        </button>
      </div>

      {/* Progress bar — only tracks verifiable (Go-Karting) serials */}
      {(() => {
        const verifiableAll = result.serials.filter((s) => s.verifiable)
        const verifiableDone = verifiableAll.filter((s) => s.status === 'completed')
        return (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-track-surface/80">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/50">
              <span>Go-Karting Verification</span>
              <span className="font-semibold text-gray-700 dark:text-white/70">
                {verifiableDone.length}/{verifiableAll.length} completed
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-signal-green-bright transition-all"
                style={{
                  width: `${verifiableAll.length > 0 ? (verifiableDone.length / verifiableAll.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )
      })()}

      {/* Already completed serials */}
      {completedSerials.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-signal-green-bright/70">
            Completed ({completedSerials.length})
          </p>
          {completedSerials.map((serial) => (
            <div
              key={serial.serialId}
              className="flex items-center justify-between rounded-xl border border-signal-green-bright/20 bg-signal-green-bright/5 px-4 py-2.5 opacity-60"
            >
              <div className="flex items-center gap-2">
                {serial.serialNumber > 0 && (
                  <span className="rounded-md bg-signal-green-bright/20 px-1.5 py-0.5 font-mono text-xs font-bold text-signal-green-bright/80">
                    {padSerial(serial.serialNumber)}
                  </span>
                )}
                <div>
                  <p className="text-sm font-medium text-white/60">{serial.itemName}</p>
                  <p className="text-xs text-white/30">
                    {getKartType(serial.itemName) ?? 'Go-Kart'} — Verified by{' '}
                    {serial.verifiedBy ?? '—'}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-signal-green-bright/20 px-2 py-0.5 text-[10px] font-semibold text-signal-green-bright">
                Done
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Pending serials — selectable */}
      {verifiablePending.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-track-accent-warm/70">
              Pending ({verifiablePending.length})
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                disabled={isUpdating}
                className="text-xs text-track-accent-warm/70 hover:text-track-accent-warm transition-colors"
              >
                Select All
              </button>
              <span className="text-white/20">|</span>
              <button
                type="button"
                onClick={deselectAll}
                disabled={isUpdating}
                className="text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <AnimatePresence>
            {verifiablePending.map((serial) => {
              const isSelected = selected.has(serial.serialId)
              const disabled = !serial.verifiable || isUpdating
              return (
                <motion.button
                  key={serial.serialId}
                  type="button"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  disabled={disabled}
                  onClick={() => toggleItem(serial)}
                  className={`flex items-center justify-between rounded-xl border px-4 text-left transition-all ${
                    !serial.verifiable
                      ? 'cursor-not-allowed border-gray-200 bg-gray-100 py-2 opacity-50 dark:border-white/5 dark:bg-track-surface/40'
                      : isSelected
                        ? 'border-track-accent-warm/40 bg-track-accent-warm/10 py-3'
                        : 'border-gray-200 bg-gray-50 py-3 hover:border-gray-300 dark:border-white/10 dark:bg-track-surface/80 dark:hover:border-white/20'
                  } disabled:opacity-50`}
                >
                  <div className="flex items-center gap-3">
                    {serial.verifiable ? (
                      <div
                        className={`flex size-5 items-center justify-center rounded-md border transition-all ${
                          isSelected
                            ? 'border-track-accent-warm bg-track-accent-warm text-white'
                            : 'border-gray-300 bg-transparent dark:border-white/20'
                        }`}
                      >
                        {isSelected ? (
                          <svg
                            className="size-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex size-5 items-center justify-center rounded-md border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5">
                        <svg
                          className="size-3 text-gray-300 dark:text-white/20"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636"
                          />
                        </svg>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        {serial.serialNumber > 0 && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                              serial.verifiable
                                ? 'bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white/70'
                                : 'bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-white/25'
                            }`}
                          >
                            {padSerial(serial.serialNumber)}
                          </span>
                        )}
                        <p
                          className={`text-sm font-semibold ${serial.verifiable ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-white/40'}`}
                        >
                          {serial.itemName}
                        </p>
                      </div>
                      {serial.verifiable && showPricing ? (
                        <p className="text-xs text-gray-500 dark:text-white/40">
                          {formatCurrency(serial.unitPrice)}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-white/40">
                          {getKartType(serial.itemName) ?? 'Go-Kart'}
                        </p>
                      )}
                    </div>
                  </div>
                  {serial.verifiable ? (
                    <span className="rounded-full bg-track-accent-warm/15 px-2 py-0.5 text-[10px] font-semibold text-track-accent-warm">
                      Pending
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/25">
                      N/A
                    </span>
                  )}
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      ) : verifiablePending.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-signal-green-bright/20 bg-signal-green-bright/5 px-4 py-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-signal-green-bright/20">
            <span className="text-lg">✅</span>
          </div>
          <p className="text-sm font-bold text-signal-green-bright">Ride Already Completed</p>
          <p className="text-xs text-white/40">
            All Go-Karting items have been verified. No further action needed.
          </p>
        </div>
      ) : null}

      {/* Submit button */}
      {verifiablePending.length > 0 ? (
        <motion.button
          type="button"
          disabled={selected.size === 0 || isUpdating}
          onClick={() => onSubmit(selectedItems)}
          whileTap={{ scale: 0.98 }}
          className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-signal-green-bright px-6 py-3 text-sm font-bold text-white shadow-lg shadow-signal-green-bright/25 transition-all hover:bg-signal-green-glow hover:shadow-signal-green-bright/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUpdating ? (
            <>
              <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Verifying...
            </>
          ) : (
            `Verify ${selected.size} Item${selected.size !== 1 ? 's' : ''}`
          )}
        </motion.button>
      ) : null}
    </div>
  )
}

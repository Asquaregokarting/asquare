import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  getLocationPrefix,
  isValidKartNumberFormat,
  KartCondition,
  KartEngineStatus,
  KartRecord,
  KartStatus,
  KartType,
} from '../services/kartService'
import { SCANNER_LOCATIONS, ScannerLocation } from '../scanner/types/scanner.types'

const STATUS_OPTIONS: Array<{ value: KartStatus; label: string }> = [
  { value: 'available', label: 'Available' },
  { value: 'under_repair', label: 'Under Repair' },
]

const CONDITION_OPTIONS: Array<{ value: KartCondition; label: string }> = [
  { value: 'good', label: 'Good' },
  { value: 'damaged', label: 'Damaged' },
]

const ENGINE_OPTIONS: Array<{ value: KartEngineStatus; label: string }> = [
  { value: 'working', label: 'Working' },
  { value: 'engine_fail', label: 'Engine Fail' },
]

const KART_TYPE_OPTIONS: Array<{ value: KartType; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'children', label: 'Children' },
]

const TYPE_LABELS: Record<KartType, string> = {
  single: 'Single',
  double: 'Double',
  children: 'Children',
}

export interface KartFormValues {
  kartNumber: string
  kartType: KartType
  location: ScannerLocation
  condition: KartCondition
  engineStatus: KartEngineStatus
  status: KartStatus
  complaint: string
}

export const KartForm = ({
  open,
  initialKart,
  existingKarts,
  selectedLocation,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean
  initialKart: KartRecord | null
  existingKarts: KartRecord[]
  selectedLocation: ScannerLocation
  submitting?: boolean
  onClose: () => void
  onSubmit: (values: KartFormValues) => Promise<void>
}) => {
  const [values, setValues] = useState<KartFormValues>({
    kartNumber: '',
    kartType: 'single',
    location: selectedLocation,
    condition: 'good',
    engineStatus: 'working',
    status: 'available',
    complaint: '',
  })

  useEffect(() => {
    if (!open) return

    setValues(
      initialKart
        ? {
            kartNumber: initialKart.kartNumber,
            kartType: initialKart.kartType,
            location: initialKart.location,
            condition: initialKart.condition,
            engineStatus: initialKart.engineStatus,
            status: initialKart.status,
            complaint: initialKart.complaint ?? '',
          }
        : {
            kartNumber: '',
            kartType: 'single',
            location: selectedLocation,
            condition: 'good',
            engineStatus: 'working',
            status: 'available',
            complaint: '',
          },
    )
  }, [initialKart, open, selectedLocation])

  const isEditing = !!initialKart
  const prefix = useMemo(() => getLocationPrefix(values.location), [values.location])
  const normalizedInput = values.kartNumber.trim().toUpperCase()

  const validationError = useMemo(() => {
    if (!normalizedInput) return null
    if (!isValidKartNumberFormat(normalizedInput, values.location)) {
      return `Must start with "${prefix}" followed by a number (e.g. ${prefix}1, ${prefix}12)`
    }
    if (!isEditing) {
      const duplicate = existingKarts.some(
        (k) => k.kartNumber.toUpperCase() === normalizedInput && k.location === values.location,
      )
      if (duplicate) return `${normalizedInput} already exists at ${values.location}`
    }
    return null
  }, [normalizedInput, values.location, prefix, isEditing, existingKarts])

  const canSubmit = isEditing
    ? !submitting
    : !submitting && !!normalizedInput && !validationError && !!values.kartType

  if (!open) return null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    await onSubmit({ ...values, kartNumber: normalizedInput })
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-base/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-track-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/80">
              {isEditing ? 'Update Kart' : 'Add Kart'}
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
              {isEditing ? initialKart.kartNumber : 'New Kart'}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white"
          >
            Close
          </button>
        </div>

        <form
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(event) => void handleSubmit(event)}
        >
          {/* Kart Number: text input for new, read-only for edit */}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">
              Kart Number
            </span>
            {isEditing ? (
              <div className="w-full rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-track-surface/60 dark:text-white/60">
                {values.kartNumber}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  value={values.kartNumber}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, kartNumber: event.target.value }))
                  }
                  placeholder={`e.g. ${prefix}1, ${prefix}2, ${prefix}10`}
                  className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${
                    validationError
                      ? 'border-red-400 dark:border-red-500'
                      : 'border-gray-200 focus:border-track-accent dark:border-gray-700'
                  } bg-white text-gray-900 dark:bg-track-surface dark:text-white`}
                  required
                  autoComplete="off"
                />
                {validationError ? (
                  <p className="text-xs text-red-500">{validationError}</p>
                ) : normalizedInput ? (
                  <p className="text-xs text-emerald-500">Valid kart number</p>
                ) : null}
              </div>
            )}
          </label>

          {/* Kart Type: dropdown for new, read-only for edit */}
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">Kart Type</span>
            {isEditing ? (
              <div className="w-full rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-track-surface/60 dark:text-white/60">
                {TYPE_LABELS[values.kartType]}
              </div>
            ) : (
              <select
                value={values.kartType}
                onChange={(event) =>
                  setValues((current) => ({ ...current, kartType: event.target.value as KartType }))
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
                required
              >
                {KART_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">Location</span>
            {isEditing ? (
              <div className="w-full rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-track-surface/60 dark:text-white/60">
                {values.location}
              </div>
            ) : (
              <select
                value={values.location}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    kartNumber: '',
                    location: event.target.value as ScannerLocation,
                  }))
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
              >
                {SCANNER_LOCATIONS.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">Condition</span>
            <select
              value={values.condition}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  condition: event.target.value as KartCondition,
                }))
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
            >
              {CONDITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">
              Engine Status
            </span>
            <select
              value={values.engineStatus}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  engineStatus: event.target.value as KartEngineStatus,
                }))
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
            >
              {ENGINE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">Status</span>
            <select
              value={values.status}
              onChange={(event) =>
                setValues((current) => ({ ...current, status: event.target.value as KartStatus }))
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium text-gray-700 dark:text-white/80">
              Complaint / Remarks
            </span>
            <textarea
              rows={3}
              value={values.complaint}
              onChange={(event) =>
                setValues((current) => ({ ...current, complaint: event.target.value }))
              }
              placeholder="Describe any damages, issues, or notes about this kart..."
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-track-accent dark:border-gray-700 dark:bg-track-surface dark:text-white"
            />
          </label>

          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-white/60 dark:hover:text-white sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70 dark:hover:border-white/20 dark:hover:text-white sm:w-auto"
            >
              {submitting ? 'Saving...' : isEditing ? 'Update Kart' : 'Add Kart'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

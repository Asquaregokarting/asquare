import { KartRecord } from '../services/kartService'

const labelize = (value: string): string =>
  value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')

const DetailField = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-track-surface/60">
    <p className="text-xs font-medium uppercase tracking-widest text-gray-500 dark:text-white/45">
      {label}
    </p>
    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
)

export const KartDetails = ({
  open,
  kart,
  onClose,
}: {
  open: boolean
  kart: KartRecord | null
  onClose: () => void
}) => {
  if (!open || !kart) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-base/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-track-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/80">
              Kart Details
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
              {kart.kartNumber}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-white/60 dark:hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DetailField label="Kart Type" value={labelize(kart.kartType)} />
          <DetailField label="Location" value={kart.location} />
          <DetailField label="Condition" value={labelize(kart.condition)} />
          <DetailField label="Engine Status" value={labelize(kart.engineStatus)} />
          <DetailField label="Status" value={labelize(kart.status)} />
          <DetailField
            label="Last Deep Clean"
            value={kart.lastDeepCleanDate || 'Not cleaned yet'}
          />
          {kart.complaint ? (
            <div className="sm:col-span-3">
              <DetailField label="Complaint / Remarks" value={kart.complaint} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

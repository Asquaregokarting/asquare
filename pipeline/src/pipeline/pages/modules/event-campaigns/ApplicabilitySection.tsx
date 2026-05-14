import type { EventCampaignApplicability } from '../../../features/event-campaigns/event-campaign-types'

interface Props {
  value: EventCampaignApplicability
  onChange: (next: EventCampaignApplicability) => void
}

const rows: Array<{
  key: keyof EventCampaignApplicability
  label: string
  description: string
}> = [
  {
    key: 'showOnline',
    label: 'Show Online',
    description: 'Visible on the customer website.',
  },
  {
    key: 'enableInBooking',
    label: 'Enable in Booking',
    description: 'Selectable during the booking flow.',
  },
  {
    key: 'enableInBilling',
    label: 'Enable in Billing (POS)',
    description: 'Selectable inside POS billing.',
  },
]

const ApplicabilitySection = ({ value, onChange }: Props) => {
  const toggle = (key: keyof EventCampaignApplicability) => {
    onChange({ ...value, [key]: !value[key] })
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Applicability</h3>
      <p className="mt-1 text-xs text-muted">
        Where this event and its packages are visible and usable.
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const id = `applicability-${row.key}`
          return (
            <label
              key={row.key}
              htmlFor={id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/50 bg-surface/60 p-3 transition-colors hover:border-accent/40"
            >
              <input
                id={id}
                type="checkbox"
                checked={value[row.key]}
                onChange={() => toggle(row.key)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{row.label}</p>
                <p className="mt-0.5 text-xs text-muted">{row.description}</p>
              </div>
            </label>
          )
        })}
      </div>
    </section>
  )
}

export default ApplicabilitySection

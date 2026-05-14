import type { EventCampaignCouponPolicy } from '../../../features/event-campaigns/event-campaign-types'

interface Props {
  value: EventCampaignCouponPolicy
  onChange: (next: EventCampaignCouponPolicy) => void
}

const rows: Array<{
  key: keyof EventCampaignCouponPolicy
  label: string
  description: string
}> = [
  {
    key: 'allowCouponUsage',
    label: 'Allow ₹150 coupon redemption',
    description:
      'When off, ₹150 member coupons cannot be applied to this event’s packages in booking or POS.',
  },
  {
    key: 'grantCoupons',
    label: 'Earn ₹150 coupons from this event',
    description:
      'When off, purchasing this event’s packages does not issue any ₹150 coupons toward the next visit.',
  },
]

const CouponPolicySection = ({ value, onChange }: Props) => {
  const toggle = (key: keyof EventCampaignCouponPolicy) => {
    onChange({ ...value, [key]: !value[key] })
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Coupon Policy</h3>
      <p className="mt-1 text-xs text-muted">
        Both default to off — event packages do not interact with ₹150 coupons unless explicitly
        enabled.
      </p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const id = `coupon-policy-${row.key}`
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

export default CouponPolicySection

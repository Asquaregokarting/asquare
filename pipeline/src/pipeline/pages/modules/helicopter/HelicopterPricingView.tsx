import { FormEvent, useCallback, useEffect, useState } from 'react'
import { DataTable } from '../../../components/ui/DataTable'
import { DetailPanel } from '../../../components/ui/DetailPanel'
import { SummaryCards } from '../../../components/ui/SummaryCards'
import {
  createHelicopterActivity,
  createHelicopterPayment,
  getHelicopterConfig,
  getHelicopterCounter,
  listHelicopterActivities,
  listHelicopterPayments,
  updateHelicopterActivity,
  updateHelicopterConfig,
  updateHelicopterCounter,
} from '../../../api/helicopter'
import type {
  HelicopterActivityRecord,
  HelicopterConfigRecord,
  HelicopterCounterRecord,
  HelicopterPaymentRecord,
} from '../../../api/types'
import { currency } from './helicopter-shared'
import { useAuth } from '../../../features/auth/auth-context'
import { logger } from '../../../../lib/logger'

const HelicopterPricingView = () => {
  const { session } = useAuth()
  const canMutate = session?.user.role === 'Owner' || session?.user.role === 'Admin'
  const [activities, setActivities] = useState<HelicopterActivityRecord[]>([])
  const [payments, setPayments] = useState<HelicopterPaymentRecord[]>([])
  const [counter, setCounter] = useState<HelicopterCounterRecord | null>(null)
  const [config, setConfig] = useState<HelicopterConfigRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [actives, pays, c, cfg] = await Promise.all([
        listHelicopterActivities(canMutate),
        listHelicopterPayments({ limit: 200 }),
        getHelicopterCounter(),
        getHelicopterConfig(),
      ])
      setActivities(actives)
      setPayments(pays)
      setCounter(c)
      setConfig(cfg)
    } catch (err) {
      logger.error('helicopter.pricing.load_failed', err)
      setError(err instanceof Error ? err.message : 'Failed to load pricing.')
    } finally {
      setLoading(false)
    }
  }, [canMutate])

  useEffect(() => {
    void load()
  }, [load])

  const onSendPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canMutate || !session) return
    const form = new FormData(event.currentTarget)
    try {
      await createHelicopterPayment(session.token, {
        customerName: String(form.get('customerName') ?? ''),
        phone: String(form.get('phone') ?? ''),
        activityId: String(form.get('activityId') ?? ''),
        discountPercentage: Number(form.get('discountPercentage') ?? 0),
      })
      ;(event.currentTarget as HTMLFormElement).reset()
      setSuccess('Payment link created.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send payment.')
    }
  }

  const onCreateActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canMutate) return
    const form = new FormData(event.currentTarget)
    try {
      await createHelicopterActivity({
        name: String(form.get('name') ?? ''),
        amount: Number(form.get('amount') ?? 0),
        status: (form.get('status') as 'Active' | 'Inactive') ?? 'Active',
      })
      ;(event.currentTarget as HTMLFormElement).reset()
      setSuccess('Activity added.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add activity.')
    }
  }

  const onToggleActivity = async (activity: HelicopterActivityRecord) => {
    if (!canMutate) return
    try {
      await updateHelicopterActivity(activity.id, {
        status: activity.status === 'Active' ? 'Inactive' : 'Active',
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle.')
    }
  }

  const onSaveCounter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canMutate) return
    const form = new FormData(event.currentTarget)
    try {
      await updateHelicopterCounter({
        earlyBirdThreshold: Number(form.get('earlyBirdThreshold') ?? 0),
        earlyBirdPrice: Number(form.get('earlyBirdPrice') ?? 0),
        regularPrice: Number(form.get('regularPrice') ?? 0),
      })
      setSuccess('Early-bird pricing saved.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing.')
    }
  }

  const onToggleEarlyBird = async () => {
    if (!canMutate || !config || !session) return
    try {
      await updateHelicopterConfig({ earlyBirdEnabled: !config.earlyBirdEnabled }, session.user.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle.')
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      )}

      <SummaryCards
        items={[
          {
            id: 'packages',
            label: 'Packages',
            value: String(activities.length),
            tone: 'info',
          },
          {
            id: 'payments',
            label: 'Payments sent',
            value: String(payments.length),
            tone: 'success',
          },
          {
            id: 'paid',
            label: 'Paid',
            value: String(payments.filter((p) => p.status === 'Paid').length),
            tone: 'muted',
          },
          {
            id: 'revenue',
            label: 'Revenue (paid)',
            value: currency(
              payments
                .filter((p) => p.status === 'Paid')
                .reduce((sum, p) => sum + p.finalAmount, 0),
            ),
            tone: 'warning',
          },
        ]}
      />

      {counter && (
        <DetailPanel title="Early-bird pricing">
          <form className="grid grid-cols-2 gap-2 md:grid-cols-5" onSubmit={onSaveCounter}>
            <div>
              <label className="block text-xs text-muted">Threshold (seats)</label>
              <input
                className="ui-field min-h-10"
                type="number"
                name="earlyBirdThreshold"
                defaultValue={counter.earlyBirdThreshold}
                min={0}
                disabled={!canMutate}
              />
            </div>
            <div>
              <label className="block text-xs text-muted">Early-bird price</label>
              <input
                className="ui-field min-h-10"
                type="number"
                name="earlyBirdPrice"
                defaultValue={counter.earlyBirdPrice}
                min={0}
                disabled={!canMutate}
              />
            </div>
            <div>
              <label className="block text-xs text-muted">Regular price</label>
              <input
                className="ui-field min-h-10"
                type="number"
                name="regularPrice"
                defaultValue={counter.regularPrice}
                min={0}
                disabled={!canMutate}
              />
            </div>
            <div>
              <label className="block text-xs text-muted">Sold so far</label>
              <input
                className="ui-field min-h-10"
                type="number"
                value={counter.count}
                disabled
                readOnly
              />
            </div>
            <div className="flex items-end gap-2">
              {canMutate && (
                <button type="submit" className="ui-btn ui-btn-primary min-h-10 px-3">
                  Save
                </button>
              )}
              {canMutate && config && (
                <button
                  type="button"
                  onClick={() => void onToggleEarlyBird()}
                  className="ui-btn ui-btn-neutral min-h-10 px-3"
                >
                  Early-bird: {config.earlyBirdEnabled ? 'On' : 'Off'}
                </button>
              )}
            </div>
          </form>
        </DetailPanel>
      )}

      <div className={`grid grid-cols-1 gap-4 ${canMutate ? 'xl:grid-cols-2' : ''}`}>
        {canMutate && (
          <DetailPanel title="Send payment link">
            <form className="grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={onSendPayment}>
              <input
                className="ui-field min-h-10"
                name="customerName"
                placeholder="Customer name"
                required
              />
              <input
                className="ui-field min-h-10"
                name="phone"
                placeholder="Phone number"
                required
              />
              <select className="ui-field min-h-10" name="activityId" required>
                <option value="">Select package</option>
                {activities
                  .filter((a) => a.status === 'Active')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({currency(a.amount)})
                    </option>
                  ))}
              </select>
              <input
                className="ui-field min-h-10"
                name="discountPercentage"
                type="number"
                min={0}
                max={100}
                defaultValue={0}
                placeholder="Discount %"
              />
              <button type="submit" className="ui-btn ui-btn-primary min-h-10 md:col-span-2">
                Send payment
              </button>
            </form>
          </DetailPanel>
        )}

        <DetailPanel title="Package catalog">
          {canMutate && (
            <form
              className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4"
              onSubmit={onCreateActivity}
            >
              <input
                className="ui-field min-h-10"
                name="name"
                placeholder="Package name"
                required
              />
              <input
                className="ui-field min-h-10"
                name="amount"
                type="number"
                min={1}
                placeholder="Amount"
                required
              />
              <select className="ui-field min-h-10" name="status" defaultValue="Active">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <button type="submit" className="ui-btn ui-btn-primary min-h-10">
                Add
              </button>
            </form>
          )}
          <DataTable<HelicopterActivityRecord>
            columns={[
              { key: 'name', header: 'Package', render: (a) => a.name },
              { key: 'amount', header: 'Amount', render: (a) => currency(a.amount) },
              { key: 'status', header: 'Status', render: (a) => a.status },
              {
                key: 'actions',
                header: 'Actions',
                render: (a) =>
                  canMutate ? (
                    <button
                      type="button"
                      onClick={() => void onToggleActivity(a)}
                      className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                    >
                      Toggle
                    </button>
                  ) : (
                    <span className="text-xs text-muted">Read-only</span>
                  ),
              },
            ]}
            rows={activities}
            rowKey={(a) => a.id}
            emptyMessage={loading ? 'Loading packages...' : 'No packages configured.'}
          />
        </DetailPanel>
      </div>

      <DataTable<HelicopterPaymentRecord>
        columns={[
          { key: 'customer', header: 'Customer', render: (p) => p.customerName },
          { key: 'phone', header: 'Phone', render: (p) => p.phone },
          { key: 'activity', header: 'Package', render: (p) => p.activityName },
          { key: 'base', header: 'Base', render: (p) => currency(p.baseAmount) },
          { key: 'discount', header: 'Discount', render: (p) => `${p.discountPercentage}%` },
          { key: 'final', header: 'Final', render: (p) => currency(p.finalAmount) },
          { key: 'status', header: 'Status', render: (p) => p.status },
          { key: 'created', header: 'Created', render: (p) => p.createdAt?.slice(0, 19) || '—' },
        ]}
        rows={payments}
        rowKey={(p) => p.id}
        emptyMessage={loading ? 'Loading payments...' : 'No payments yet.'}
      />
    </div>
  )
}

export default HelicopterPricingView

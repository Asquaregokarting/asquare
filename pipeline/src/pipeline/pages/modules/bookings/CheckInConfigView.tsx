import { useCallback, useEffect, useState } from 'react'
import { CheckInConfig, asquareCheckinApi } from '../../../api/asquare-checkin'

const CheckInConfigView = () => {
  const [config, setConfig] = useState<CheckInConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [newTiming, setNewTiming] = useState('')

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await asquareCheckinApi.getConfig()
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load check-in config.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      await asquareCheckinApi.saveConfig(config)
      setSuccess('Check-in configuration saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      {error && (
        <p className="mb-4 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-4 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading configuration...</p>
      ) : config ? (
        <div className="space-y-6">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Slot Capacity (passengers per slot)
            </label>
            <input
              type="number"
              className="ui-field min-h-10 w-40"
              value={config.slotCapacity}
              onChange={(e) =>
                setConfig((prev) =>
                  prev ? { ...prev, slotCapacity: Number(e.target.value) } : prev,
                )
              }
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
              Available Timings
            </label>
            <div className="flex flex-wrap gap-2">
              {config.availableTimings.map((t, i) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-1 text-sm text-text"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() =>
                      setConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              availableTimings: prev.availableTimings.filter((_, idx) => idx !== i),
                            }
                          : prev,
                      )
                    }
                    className="text-critical hover:text-critical/80"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                className="ui-field min-h-10 w-40"
                placeholder="e.g. 09:00 AM"
                value={newTiming}
                onChange={(e) => setNewTiming(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  if (newTiming.trim() && config) {
                    setConfig({
                      ...config,
                      availableTimings: [...config.availableTimings, newTiming.trim()],
                    })
                    setNewTiming('')
                  }
                }}
                className="ui-btn ui-btn-neutral min-h-10 px-3 text-sm"
              >
                Add
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSave()}
            className="ui-btn ui-btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default CheckInConfigView

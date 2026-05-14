import { useEffect, useMemo, useState } from 'react'
import { Save, RotateCcw, Undo2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { LeadAutomationConfig } from '../../../api/types'
import { useLeadConfig } from '../../../features/leads/useLeadConfig'
import { DEFAULT_AUTOMATION_CONFIG } from '../../../features/leads/lead-constants'

type WeightKey = keyof LeadAutomationConfig['autoScoreWeights']
type ThresholdKey = keyof LeadAutomationConfig['scoreThresholds']

const WEIGHT_LABELS: Record<WeightKey, string> = {
  recencyWeight: 'Recency',
  frequencyWeight: 'Frequency',
  spendWeight: 'Spend',
  channelWeight: 'Channel',
}

const isEqualConfig = (a: LeadAutomationConfig, b: LeadAutomationConfig): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

interface ValidationResult {
  errors: string[]
  warnings: string[]
}

const validate = (draft: LeadAutomationConfig): ValidationResult => {
  const errors: string[] = []
  const warnings: string[] = []

  const weightSum = Object.values(draft.autoScoreWeights).reduce((s, w) => s + w, 0)
  if (weightSum !== 100) {
    errors.push(`Score weights must sum to 100 (currently ${weightSum}).`)
  }

  if (draft.scoreThresholds.warmMin >= draft.scoreThresholds.hotMin) {
    errors.push('Warm threshold must be below Hot threshold.')
  }
  if (draft.scoreThresholds.hotMin > 100 || draft.scoreThresholds.hotMin < 0) {
    errors.push('Hot threshold must be between 0 and 100.')
  }
  if (draft.scoreThresholds.warmMin > 100 || draft.scoreThresholds.warmMin < 0) {
    errors.push('Warm threshold must be between 0 and 100.')
  }

  if (draft.leadsPageSize < 50 || draft.leadsPageSize > 500) {
    errors.push('Pipeline page size must be between 50 and 500.')
  }
  if (draft.freshLeadWindowSeconds < 0 || draft.freshLeadWindowSeconds > 600) {
    errors.push('Fresh-lead window must be between 0 and 600 seconds.')
  }

  if (draft.noAnswerWhatsappThreshold < 1 || draft.noAnswerWhatsappThreshold > 10) {
    errors.push('No-answer threshold must be between 1 and 10.')
  }
  if (draft.autoCloseInactiveDays < 7 || draft.autoCloseInactiveDays > 90) {
    errors.push('Auto-close inactive days must be between 7 and 90.')
  }
  if (draft.abandonedCartHours < 1 || draft.abandonedCartHours > 168) {
    errors.push('Abandoned-cart hours must be between 1 and 168.')
  }

  if (draft.enableAutoClose && draft.autoCloseInactiveDays < 14) {
    warnings.push('Auto-close under 14 days may close leads still being worked.')
  }

  return { errors, warnings }
}

// ── Reusable row primitives ────────────────────────────────────────────────
const Row = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <div className="flex flex-wrap items-start justify-between gap-2 py-2">
    <div className="min-w-0 flex-1">
      <span className="text-sm text-text">{label}</span>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

const Toggle = ({
  on,
  busy,
  ariaLabel,
  onClick,
}: {
  on: boolean
  busy: boolean
  ariaLabel: string
  onClick: () => void
}) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    aria-pressed={on ? 'true' : 'false'}
    aria-label={ariaLabel}
    className={
      on
        ? 'ui-btn ui-btn-success min-h-8 px-3 text-xs'
        : 'ui-btn ui-btn-neutral min-h-8 px-3 text-xs'
    }
  >
    {on ? 'Enabled' : 'Disabled'}
  </button>
)

const NumberField = ({
  value,
  min,
  max,
  busy,
  ariaLabel,
  onChange,
  suffix,
}: {
  value: number
  min: number
  max: number
  busy: boolean
  ariaLabel: string
  onChange: (n: number) => void
  suffix?: string
}) => (
  <div className="flex items-center gap-1.5">
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={busy}
      aria-label={ariaLabel}
      className="ui-field w-20 text-center tabular-nums"
    />
    {suffix && <span className="text-xs text-muted">{suffix}</span>}
  </div>
)

const Section = ({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) => (
  <div className="ui-panel p-4">
    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
    {hint && <p className="mt-1 mb-2 text-[11px] leading-snug text-muted">{hint}</p>}
    <div className="mt-2 divide-y divide-border/30">{children}</div>
  </div>
)

// ── View ───────────────────────────────────────────────────────────────────
const LeadConfigView = () => {
  const { config, loading, error, busy, success, setSuccess, updateConfig } = useLeadConfig()
  const [draft, setDraft] = useState<LeadAutomationConfig | null>(null)

  // Hydrate the local draft when the server config arrives or refreshes after a save.
  useEffect(() => {
    if (config) setDraft(config)
  }, [config])

  const isDirty = useMemo(
    () => (config && draft ? !isEqualConfig(draft, config) : false),
    [draft, config],
  )

  const validation = useMemo<ValidationResult>(
    () => (draft ? validate(draft) : { errors: [], warnings: [] }),
    [draft],
  )
  const canSave = isDirty && validation.errors.length === 0 && !busy

  const weightSum = useMemo(
    () => (draft ? Object.values(draft.autoScoreWeights).reduce((s, w) => s + w, 0) : 0),
    [draft],
  )

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted">Loading config...</div>
  }
  if (error) {
    return (
      <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
        {error}
      </div>
    )
  }
  if (!draft || !config) return null

  // ── Field setters (operate on draft, never on server config directly) ────
  const setField = <K extends keyof LeadAutomationConfig>(
    key: K,
    value: LeadAutomationConfig[K],
  ) => {
    setSuccess(null)
    setDraft({ ...draft, [key]: value })
  }
  const setWeight = (key: WeightKey, value: number) => {
    setSuccess(null)
    setDraft({ ...draft, autoScoreWeights: { ...draft.autoScoreWeights, [key]: value } })
  }
  const setThreshold = (key: ThresholdKey, value: number) => {
    setSuccess(null)
    setDraft({ ...draft, scoreThresholds: { ...draft.scoreThresholds, [key]: value } })
  }

  const onSave = () => {
    if (!canSave) return
    void updateConfig(draft)
  }
  const onDiscard = () => {
    setSuccess(null)
    setDraft(config)
  }
  const onReset = () => {
    setSuccess(null)
    setDraft({ ...DEFAULT_AUTOMATION_CONFIG })
  }

  return (
    <div className="max-w-3xl ui-section-stack pb-24">
      {success && (
        <div className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </div>
      )}

      {/* ── Auto-Assignment ── */}
      <Section title="Auto-Assignment" hint="Distribute new leads across telecallers on shift.">
        <Row
          label="Auto-assign new leads"
          hint="Round-robin across active telecallers. If nobody is on shift the lead stays unassigned for admin review."
        >
          <Toggle
            on={draft.enableAutoAssign}
            busy={busy}
            ariaLabel="Auto-assign new leads"
            onClick={() => setField('enableAutoAssign', !draft.enableAutoAssign)}
          />
        </Row>
      </Section>

      {/* ── WhatsApp Automation ── */}
      <Section title="WhatsApp Automation" hint="Send follow-up messages when calls go unanswered.">
        <Row label="Auto WhatsApp follow-up">
          <Toggle
            on={draft.enableAutoWhatsapp}
            busy={busy}
            ariaLabel="Auto WhatsApp follow-up"
            onClick={() => setField('enableAutoWhatsapp', !draft.enableAutoWhatsapp)}
          />
        </Row>
        <Row
          label="No-answer threshold"
          hint="Consecutive unanswered calls before WhatsApp triggers."
        >
          <NumberField
            value={draft.noAnswerWhatsappThreshold}
            min={1}
            max={10}
            busy={busy}
            ariaLabel="No-answer threshold"
            onChange={(n) => setField('noAnswerWhatsappThreshold', n)}
            suffix="calls"
          />
        </Row>
      </Section>

      {/* ── Auto-Close ── */}
      <Section title="Auto-Close" hint="Close inactive leads automatically.">
        <Row label="Auto-close inactive leads">
          <Toggle
            on={draft.enableAutoClose}
            busy={busy}
            ariaLabel="Auto-close inactive leads"
            onClick={() => setField('enableAutoClose', !draft.enableAutoClose)}
          />
        </Row>
        <Row
          label="Days of inactivity before close"
          hint="Counted from the lead's last activity timestamp."
        >
          <NumberField
            value={draft.autoCloseInactiveDays}
            min={7}
            max={90}
            busy={busy}
            ariaLabel="Days of inactivity before close"
            onChange={(n) => setField('autoCloseInactiveDays', n)}
            suffix="days"
          />
        </Row>
      </Section>

      {/* ── Lead Detection ── */}
      <Section title="Lead Detection" hint="When to convert customer signals into leads.">
        <Row
          label="Abandoned-cart threshold"
          hint="Hours a cart can sit before it's surfaced as a recoverable lead."
        >
          <NumberField
            value={draft.abandonedCartHours}
            min={1}
            max={168}
            busy={busy}
            ariaLabel="Abandoned-cart threshold (hours)"
            onChange={(n) => setField('abandonedCartHours', n)}
            suffix="hrs"
          />
        </Row>
      </Section>

      {/* ── Scoring Weights ── */}
      <Section
        title="Scoring Weights"
        hint="How much each factor contributes to the auto-score. Must sum to 100."
      >
        {(Object.keys(WEIGHT_LABELS) as WeightKey[]).map((key) => (
          <Row key={key} label={WEIGHT_LABELS[key]}>
            <NumberField
              value={draft.autoScoreWeights[key]}
              min={0}
              max={100}
              busy={busy}
              ariaLabel={`${WEIGHT_LABELS[key]} weight`}
              onChange={(n) => setWeight(key, n)}
              suffix="%"
            />
          </Row>
        ))}
        <div className="flex items-center justify-between pt-2 mt-2">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Total
          </span>
          <span
            className={`inline-flex items-center gap-1 text-sm tabular-nums font-semibold ${
              weightSum === 100 ? 'text-success' : 'text-critical'
            }`}
          >
            {weightSum === 100 ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {weightSum} / 100
          </span>
        </div>
      </Section>

      {/* ── Score Thresholds ── */}
      <Section
        title="Score Thresholds"
        hint="Cut-off scores that decide the Hot / Warm / Cold band."
      >
        <Row label="Hot minimum">
          <NumberField
            value={draft.scoreThresholds.hotMin}
            min={0}
            max={100}
            busy={busy}
            ariaLabel="Hot minimum score"
            onChange={(n) => setThreshold('hotMin', n)}
          />
        </Row>
        <Row label="Warm minimum" hint="Anything below this is Cold.">
          <NumberField
            value={draft.scoreThresholds.warmMin}
            min={0}
            max={100}
            busy={busy}
            ariaLabel="Warm minimum score"
            onChange={(n) => setThreshold('warmMin', n)}
          />
        </Row>
      </Section>

      {/* ── Display & Limits ── */}
      <Section
        title="Display & Limits"
        hint="UI behaviour: pipeline page size and the New-lead glow."
      >
        <Row
          label="Pipeline page size"
          hint="Max leads loaded into the kanban before the truncation banner appears."
        >
          <NumberField
            value={draft.leadsPageSize}
            min={50}
            max={500}
            busy={busy}
            ariaLabel="Pipeline page size"
            onChange={(n) => setField('leadsPageSize', n)}
            suffix="leads"
          />
        </Row>
        <Row
          label="Fresh-lead window"
          hint="Animated border on cards newer than this. 0 disables the effect."
        >
          <NumberField
            value={draft.freshLeadWindowSeconds}
            min={0}
            max={600}
            busy={busy}
            ariaLabel="Fresh-lead window in seconds"
            onChange={(n) => setField('freshLeadWindowSeconds', n)}
            suffix="sec"
          />
        </Row>
      </Section>

      {/* ── Save bar (sticky) ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/45 bg-panel/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-panel/85 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-2xl sm:rounded-xl sm:border sm:shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-xs">
            {validation.errors.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-critical">
                <AlertTriangle size={14} />
                {validation.errors[0]}
                {validation.errors.length > 1 && (
                  <span className="text-muted"> + {validation.errors.length - 1} more</span>
                )}
              </span>
            ) : isDirty ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={14} />
                Unsaved changes
                {validation.warnings.length > 0 && (
                  <span className="text-muted"> · {validation.warnings[0]}</span>
                )}
              </span>
            ) : (
              <span className="text-muted">All changes saved.</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="ui-btn ui-btn-neutral min-h-9 px-3 text-xs"
              title="Reset every field to the platform defaults"
            >
              <RotateCcw size={13} className="mr-1" /> Reset
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={!isDirty || busy}
              className="ui-btn ui-btn-neutral min-h-9 px-3 text-xs"
            >
              <Undo2 size={13} className="mr-1" /> Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="ui-btn ui-btn-primary min-h-9 px-4 text-xs font-semibold"
            >
              <Save size={13} className="mr-1" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LeadConfigView

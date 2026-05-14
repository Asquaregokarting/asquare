import { Flag, ShieldCheck } from 'lucide-react'
import { fmtRupees } from '../format'
import type { BranchRollup } from '../types'

interface DiscrepancyStripProps {
  rollups: BranchRollup[]
  /** Optional click hook: filters the ledger to that branch. */
  onSelect?: (branchSlug: string) => void
  selectedSlug?: string | null
}

const ZERO_TONES = new Set<BranchRollup['tone']>(['settled', 'pending'])

/**
 * Headline strip: the eye lands on branches that need attention. Settled and
 * pending branches collapse to a quiet inline footer so they don't compete
 * with a real shortage for visual weight.
 *
 * No identical-card grid, no decorative gradients, no hero-metric pattern.
 * The colored numeral itself does the work; chrome stays out of the way.
 */
export const DiscrepancyStrip = ({ rollups, onSelect, selectedSlug }: DiscrepancyStripProps) => {
  const attention = rollups.filter((r) => !ZERO_TONES.has(r.tone))
  const settled = rollups.filter((r) => r.tone === 'settled')
  const pending = rollups.filter((r) => r.tone === 'pending')
  const allClear = attention.length === 0 && settled.length === rollups.length && rollups.length > 0

  return (
    <section aria-label="Branch discrepancy summary" className="space-y-2.5">
      {/* All-clear path: a single calm headline, never a grid. */}
      {allClear ? (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-success" />
          <p className="text-sm">
            <span className="font-semibold text-success">All branches settled.</span>{' '}
            <span className="text-muted">
              {rollups.reduce((sum, r) => sum + r.shiftCount, 0)} shifts reconciled · zero
              discrepancy.
            </span>
          </p>
        </div>
      ) : null}

      {/* Branches needing attention: each gets a wide horizontal row with
          the diff as the largest type on the page, branch + sub on the
          left. Width is fixed to 100%; tiles stack one per row on mobile,
          two per row on tablet, three per row on desktop. We never repeat
          the same identical card 4-up. */}
      {attention.length > 0 ? (
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {attention.map((tile) => (
            <DiscrepancyRow
              key={tile.branchSlug}
              tile={tile}
              isSelected={selectedSlug === tile.branchSlug}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}

      {/* Settled + pending footer: dense inline list, low contrast,
          deliberately quiet. Click to filter, same as attention rows. */}
      {(settled.length > 0 || pending.length > 0) && !allClear ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-panel/60 px-4 py-2.5 text-[12px]">
          {settled.length > 0 ? (
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-3 w-3 text-success/80" aria-hidden />
              <span className="text-muted">Settled</span>
              <SettledList tiles={settled} onSelect={onSelect} selectedSlug={selectedSlug} />
            </span>
          ) : null}
          {pending.length > 0 ? (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-muted/60" />
              <span className="text-muted">In progress</span>
              <SettledList tiles={pending} onSelect={onSelect} selectedSlug={selectedSlug} />
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

interface DiscrepancyRowProps {
  tile: BranchRollup
  isSelected: boolean
  onSelect?: (branchSlug: string) => void
}

const DiscrepancyRow = ({ tile, isSelected, onSelect }: DiscrepancyRowProps) => {
  const isExcess = tile.tone === 'excess'
  const sign = isExcess ? '+' : '−'
  const glyph = isExcess ? '▲' : '▼'
  const toneClass = isExcess ? 'dr-excess' : 'dr-shortage'
  const amount = fmtRupees(Math.abs(tile.totalDiff))

  const subParts: string[] = []
  if (tile.excessShifts > 0) subParts.push(`${tile.excessShifts} excess`)
  if (tile.shortageShifts > 0) subParts.push(`${tile.shortageShifts} short`)
  subParts.push(`${tile.shiftCount} shift${tile.shiftCount === 1 ? '' : 's'}`)
  // Flag count intentionally omitted from the subline — the trailing
  // <Flag /> icon at the right edge already communicates this.

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(tile.branchSlug)}
        aria-pressed={isSelected ? 'true' : 'false'}
        className={`group flex w-full items-baseline gap-3 rounded-xl border bg-panel px-4 py-3 text-left transition-colors ${
          isSelected ? 'border-text/60 ring-1 ring-text/40' : 'border-border hover:border-text/30'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="dr-tile-label">{tile.branchDisplayName}</p>
          <p className="mt-0.5 text-[11px] tabular-nums text-muted">{subParts.join(' · ')}</p>
        </div>
        <div
          className={`dr-strip-amount dr-mono dr-tabular ${toneClass}`}
          aria-label={`${isExcess ? 'Excess' : 'Shortage'} ${amount}`}
        >
          <span aria-hidden>{glyph}</span>
          <span className="ml-1.5">
            {sign}₹{amount.replace('₹', '')}
          </span>
        </div>
        {tile.flaggedCount > 0 ? (
          <Flag
            className="ml-2 h-3.5 w-3.5 shrink-0 text-critical"
            aria-label={`${tile.flaggedCount} flagged`}
          />
        ) : null}
      </button>
    </li>
  )
}

interface SettledListProps {
  tiles: BranchRollup[]
  onSelect?: (branchSlug: string) => void
  selectedSlug?: string | null
}

const SettledList = ({ tiles, onSelect, selectedSlug }: SettledListProps) => (
  <span className="flex flex-wrap items-center gap-1.5">
    {tiles.map((tile, idx) => (
      <span key={tile.branchSlug} className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelect?.(tile.branchSlug)}
          aria-pressed={selectedSlug === tile.branchSlug ? 'true' : 'false'}
          className={`text-[12px] font-medium transition-colors ${
            selectedSlug === tile.branchSlug
              ? 'text-text underline underline-offset-4'
              : 'text-text/80 hover:text-text'
          }`}
        >
          {tile.branchDisplayName}
        </button>
        <span className="text-[11px] text-muted tabular-nums">
          {tile.shiftCount === 0
            ? '—'
            : `${tile.shiftCount} shift${tile.shiftCount === 1 ? '' : 's'}`}
        </span>
        {idx < tiles.length - 1 ? <span className="text-muted/50">·</span> : null}
      </span>
    ))}
  </span>
)

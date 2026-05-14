import { Pause, Play, MapPin } from 'lucide-react'
import type { BranchLocation } from '../../../../types'

interface Props {
  locations: BranchLocation[]
  selectedKeys: string[]
  disabledKeys: string[]
  onChange: (keys: string[]) => void
  onDisabledChange: (keys: string[]) => void
}

const LocationSelectionSection = ({
  locations,
  selectedKeys,
  disabledKeys,
  onChange,
  onDisabledChange,
}: Props) => {
  const allSelected = locations.length > 0 && selectedKeys.length === locations.length
  const liveCount = selectedKeys.filter((k) => !disabledKeys.includes(k)).length
  const pausedCount = selectedKeys.filter((k) => disabledKeys.includes(k)).length

  const toggleSelected = (slug: string) => {
    if (selectedKeys.includes(slug)) {
      onChange(selectedKeys.filter((k) => k !== slug))
      if (disabledKeys.includes(slug)) {
        onDisabledChange(disabledKeys.filter((k) => k !== slug))
      }
    } else {
      onChange([...selectedKeys, slug])
    }
  }

  const togglePaused = (slug: string) => {
    if (disabledKeys.includes(slug)) {
      onDisabledChange(disabledKeys.filter((k) => k !== slug))
    } else {
      onDisabledChange([...disabledKeys, slug])
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Locations <span className="text-critical">*</span>
          </h3>
          <p className="mt-1 text-xs text-muted">
            Tap a location to add it to the campaign. Use the pause control to keep a location in
            the campaign but hide it from POS, booking and the public page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedKeys.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> {liveCount} live
              {pausedCount > 0 && (
                <>
                  <span className="text-border">/</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {pausedCount} paused
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : locations.map((l) => l.slug))}
            className="text-xs font-semibold text-accent hover:underline"
          >
            {allSelected ? 'Clear All' : 'Select All'}
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {locations.map((loc) => {
          const selected = selectedKeys.includes(loc.slug)
          const paused = selected && disabledKeys.includes(loc.slug)

          if (!selected) {
            return (
              <button
                key={loc.slug}
                type="button"
                onClick={() => toggleSelected(loc.slug)}
                className="group flex h-full items-center gap-2 rounded-xl border border-dashed border-border/70 bg-panel/30 px-3 py-3 text-left text-sm font-semibold text-muted transition hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
              >
                <MapPin className="h-4 w-4 opacity-60 group-hover:opacity-100" />
                <span className="truncate">{loc.shortName ?? loc.slug}</span>
              </button>
            )
          }

          return (
            <div
              key={loc.slug}
              className={`relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                paused
                  ? 'border-warning/40 bg-warning/5 text-text/70'
                  : 'border-accent/50 bg-accent/10 text-accent'
              }`}
            >
              <button
                type="button"
                onClick={() => toggleSelected(loc.slug)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left font-semibold"
                title="Remove from campaign"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${paused ? 'bg-warning' : 'bg-success'}`}
                />
                <span className="truncate">{loc.shortName ?? loc.slug}</span>
              </button>
              <button
                type="button"
                onClick={() => togglePaused(loc.slug)}
                title={paused ? 'Resume location' : 'Pause location'}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
                  paused
                    ? 'bg-warning/20 text-warning hover:bg-warning/30'
                    : 'bg-surface text-muted hover:bg-warning/10 hover:text-warning'
                }`}
              >
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
            </div>
          )
        })}
      </div>

      {selectedKeys.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-border/50 bg-panel/30 px-3 py-2 text-xs text-muted">
          Select at least one location for this event campaign.
        </p>
      )}
      {liveCount === 0 && selectedKeys.length > 0 && (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          All selected locations are paused. POS, booking and the public page will treat this
          campaign as unavailable until at least one location is resumed.
        </p>
      )}
    </section>
  )
}

export default LocationSelectionSection

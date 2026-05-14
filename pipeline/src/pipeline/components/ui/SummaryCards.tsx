import { KpiCard } from './KpiCard'

export interface SummaryCardItem {
  id: string
  label: string
  value: string
  tone: 'success' | 'warning' | 'critical' | 'info' | 'muted'
}

/**
 * Tight horizontal strip of KPI cells. No 2.6rem hero-metric tiles, no
 * matching-card grid where every cell looks like a poster. Cells are
 * 60-70px tall and read like a status bar, not a brochure.
 *
 * Layout: 2 columns on phone, 4 across from sm up. We deliberately keep
 * the same column count from sm so the row never wraps to a half-empty
 * second row on a wide monitor.
 */
export const SummaryCards = ({ items }: { items: SummaryCardItem[] }) => (
  <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {items.map((item) => (
      <KpiCard key={item.id} label={item.label} value={item.value} tone={item.tone} />
    ))}
  </section>
)

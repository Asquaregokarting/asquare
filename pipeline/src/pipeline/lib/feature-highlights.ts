/**
 * Feature Highlight Registry
 *
 * Add a single entry to mark a feature as "New" in the UI.
 * Badges auto-expire after `durationDays` (default 5).
 *
 * Usage in nav:  getActiveHighlightsForLabel("Billing").length > 0
 * Usage inline:  isFeatureNew("offers-mode")
 */

interface FeatureHighlight {
  /** Unique key, e.g. "offers-mode" */
  id: string;
  /** Nav item label to match (e.g. "Billing", "Reports") */
  label: string;
  /** Release date in ISO format: "YYYY-MM-DD" */
  releasedAt: string;
  /** Days to show badge (default 5) */
  durationDays?: number;
}

export const FEATURE_HIGHLIGHTS: FeatureHighlight[] = [
  // Sidebar nav labels
  { id: "restricted-mode", label: "Billing", releasedAt: "2026-04-03" },
  { id: "offers-mode", label: "Billing", releasedAt: "2026-04-03" },
  { id: "city-office-report", label: "Reports", releasedAt: "2026-04-03" },
  { id: "offer-approvals", label: "Bookings", releasedAt: "2026-04-03" },
  { id: "city-office-dashboard", label: "Dashboard", releasedAt: "2026-04-03" },
  // Subnav tab labels
  { id: "offers-subnav", label: "Offers", releasedAt: "2026-04-03" },
  { id: "game-revenue-subnav", label: "Game Revenue", releasedAt: "2026-04-03" },
];

function isWithinWindow(releasedAt: string, durationDays: number): boolean {
  const now = new Date();
  const released = new Date(releasedAt + "T00:00:00");
  const expiry = new Date(released);
  expiry.setDate(expiry.getDate() + durationDays);
  return now >= released && now <= expiry;
}

/** Check if any active highlights exist for a given nav label. */
export function getActiveHighlightsForLabel(label: string): FeatureHighlight[] {
  return FEATURE_HIGHLIGHTS.filter(
    (f) => f.label === label && isWithinWindow(f.releasedAt, f.durationDays ?? 5)
  );
}

/** Check if a specific feature ID is within its "new" window. */
export function isFeatureNew(id: string): boolean {
  const f = FEATURE_HIGHLIGHTS.find((h) => h.id === id);
  if (!f) return false;
  return isWithinWindow(f.releasedAt, f.durationDays ?? 5);
}

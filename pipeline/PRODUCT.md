# Product

## Register

product

## Users

The primary viewer is the **Owner** of A Square GoKarting (and Admins delegated to audit duty). They sit at a desktop or laptop, usually during business hours in office light, and they're auditing cashiers at scale: 4 branches (Vizag, Kakinada, Rajahmundry, Srikakulam), several Cashier shifts per branch per day, each ending in a settlement they entered at the till. The Owner needs to spot drift across all branches in seconds, drill into any specific shift to verify or dispute the cashier's numbers, re-print the day report for archival or proof, flag a discrepancy with a comment for follow-up, and export the full picture to PDF or CSV for the accountant.

Cashiers and shift leads are secondary viewers — they see only their own shift history at `/shifts/my`. The same surface should serve them, gated by role.

## Product Purpose

A daily-reports hub that turns raw `shifts` and `bookings` data into an **audit-grade view of every cashier-submitted settlement** across every branch. Success means: an Owner can land on this surface in the morning, see at a glance which branches and which cashiers had Excess or Shortage yesterday, drill in within one click, leave a flagged comment, re-print the day report if needed, and export the day's roll-up — all without ever waiting for a page to load or hunting through a navigation tree.

This is a tool, not a marketing surface. Density and precision win over hero moments and decoration.

## Brand Personality

**Confident · Operational · Sharp.**

Voice is the auditor's voice: terse, unambiguous, factual. Numbers are formatted with monospace tabular figures so they line up vertically. Discrepancy is the loudest signal in the room; everything else stays quiet so the discrepancy can stand out.

The customer-app side of A Square is playful (the orange `#FF6B00` energy of go-karts). The admin side, this surface, is the opposite register: consequential, calm, slightly cold. An auditor's room, not a showroom.

## Anti-references

This surface must not look like:

- **Generic admin templates** (Material Tailwind, AdminKit, AdminLTE, Soft UI) — bland, identical-cards-everywhere, no opinion. The biggest failure mode for "build me a dashboard."
- **The SaaS hero-metric template** — giant gradient numbers in identical cards, "Total Revenue" / "Total Users" / "Total Orders" with up-arrow deltas. A category cliché that hides operational signal under decoration.
- **Default-theme Grafana / hacker dashboards** — neon green on black, monospace everywhere, terminal aesthetics. Wrong register for a financial audit tool.
- **Cluttered Bloomberg-terminal walls of numbers** — density without hierarchy. We want density **with** hierarchy.
- **Anything childish or playful** — the orange/go-kart energy belongs on the customer side. This surface is grown-up.

## Design Principles

1. **Discrepancy is the loudest signal.** Excess and Shortage values get the most chromatic and typographic weight on the page. Everything else (timestamps, IDs, transaction counts, names) stays in low-contrast neutral. The Owner should see a red Shortage number from across a 27-inch monitor before they read a single label.

2. **Density with hierarchy, not density alone.** A long list of shifts on screen is fine — but the eye must always know where to land first. Use scale, weight, and color budget to lead the eye, never grid lines or borders or background colors fighting for attention.

3. **Tabular figures, always.** Every monetary value, count, and timestamp uses tabular-numerals so columns of numbers line up to the digit. Vertical scanning is the Owner's primary mode; we make it physically easy.

4. **Action lives where the data is.** Re-print, flag/comment, and export are inline on the row or shift drawer — not buried in a "..." menu, not in a separate "actions" page. Operational tools surface their power.

5. **Numbers earn their decoration.** Color is reserved for state (Excess green, Shortage red, neutral text grey). No gradient text, no decorative gradient backgrounds, no glassmorphism, no rainbow charts. Color is signal, never garnish.

## Accessibility & Inclusion

- **WCAG AAA** for all text and meaningful UI: minimum 7:1 contrast for body text, 4.5:1 for large text and inactive states. Achievable in dark mode by leaning on near-white text (`oklch(0.97 0.01 250)`) on near-black panels (`oklch(0.18 0.005 250)`); achievable in light mode by tightening neutrals toward true near-black.
- **Full keyboard navigation**: every action (re-print, flag, export, drill-in, branch filter, date jump) reachable without a mouse. Visible focus rings (≥2px, high contrast) on every interactive element.
- **Reduced motion respected**: `prefers-reduced-motion` disables non-essential transitions; data updates and drawers fall back to instant.
- **Color-blind safe**: Excess and Shortage are encoded with **both** color (green/red) and a leading sign or icon (`▲ +₹` / `▼ −₹`), never color alone.
- **Tabular figures + monospace IDs** also help users with mild visual fatigue scan long lists without losing place.

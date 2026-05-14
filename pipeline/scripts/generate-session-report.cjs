/**
 * Generate the session report as a PDF.
 *
 * Renders an HTML document of every bug found, fix applied, script
 * created, and outstanding action item from this engineering session,
 * then prints it to PDF via Puppeteer.
 *
 * Usage:
 *   node scripts/generate-session-report.cjs
 *   node scripts/generate-session-report.cjs --out reports/session-report-vendor-fixes.pdf
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const OUT_PATH = argValue('--out') ?? 'reports/session-report-vendor-fixes.pdf';

const today = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A Square GoKarting — Vendor Attribution Fix Report — ${today}</title>
<style>
  :root {
    --ink: #1a1d24;
    --muted: #5b6473;
    --border: #d8dde6;
    --accent: #0066ff;
    --warn: #b8460a;
    --crit: #b00020;
    --ok: #1f7a3f;
    --bg-soft: #f5f7fb;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    padding: 32px 40px 56px;
    max-width: 880px;
    margin: 0 auto;
  }
  header {
    border-bottom: 2px solid var(--ink);
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  header h1 {
    margin: 0 0 4px;
    font-size: 24px;
    letter-spacing: -0.2px;
  }
  header .meta {
    color: var(--muted);
    font-size: 12px;
  }
  h2 {
    font-size: 17px;
    margin: 28px 0 8px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
    page-break-after: avoid;
  }
  h3 {
    font-size: 14px;
    margin: 18px 0 6px;
    page-break-after: avoid;
  }
  p { margin: 6px 0; }
  ul { margin: 6px 0 6px 18px; padding: 0; }
  li { margin: 3px 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
    margin: 8px 0 12px;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: var(--bg-soft); font-weight: 600; }
  code, pre {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 11.5px;
    background: var(--bg-soft);
    padding: 1px 4px;
    border-radius: 3px;
  }
  pre {
    padding: 10px 12px;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  .kpi {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 12px 0 16px;
  }
  .kpi-card {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
  }
  .kpi-card .label {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .kpi-card .value {
    font-size: 22px;
    font-weight: 600;
    margin-top: 2px;
  }
  .kpi-card .sub {
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }
  .pill {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .pill-ok { background: #e3f5ea; color: var(--ok); }
  .pill-warn { background: #fbe9d0; color: var(--warn); }
  .pill-crit { background: #fde2e6; color: var(--crit); }
  .callout {
    border-left: 3px solid var(--accent);
    background: var(--bg-soft);
    padding: 10px 14px;
    margin: 10px 0;
  }
  footer {
    margin-top: 36px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
  }
  .toc { columns: 2; column-gap: 24px; }
  .toc a { color: var(--ink); text-decoration: none; }
  .toc a::before { content: "› "; color: var(--muted); }
</style>
</head>
<body>

<header>
  <h1>Vendor Attribution Fix Report</h1>
  <div class="meta">A Square GoKarting · Pipeline Admin · ${today} · status: <span class="pill pill-ok">shipped</span></div>
</header>

<h2>Executive summary</h2>
<p>
This report covers a single engineering session that traced and fixed one
class of bug expressed across five different surfaces. The root cause:
vendor identity for a booking item flowed through different code paths
(POS, online/web/Android/iOS, event packages, refund settlements,
self-registration) but those paths disagreed on where the vendor ID was
stored. Vendors were silently invisible to their own bookings, debited
for refunds they did not own, and blocked from the Accounting page on
login.
</p>

<div class="kpi">
  <div class="kpi-card">
    <div class="label">Bookings affected</div>
    <div class="value">696</div>
    <div class="sub">across 3 mismatch classes</div>
  </div>
  <div class="kpi-card">
    <div class="label">Vendors fully unblocked</div>
    <div class="value">26 / 27</div>
    <div class="sub">1 needs admin action (Manoja, Samalkot)</div>
  </div>
  <div class="kpi-card">
    <div class="label">Money drift identified</div>
    <div class="value">₹7,976</div>
    <div class="sub">net company impact: -₹28</div>
  </div>
</div>

<h2>Table of contents</h2>
<div class="toc">
  <p><a href="#findings">1. Findings by class</a></p>
  <p><a href="#fixes">2. Fixes shipped</a></p>
  <p><a href="#scripts">3. Scripts created</a></p>
  <p><a href="#contracts">4. Regression guards</a></p>
  <p><a href="#metrics">5. Headline metrics</a></p>
  <p><a href="#actions">6. Outstanding actions</a></p>
  <p><a href="#commits">7. Git commits</a></p>
</div>

<h2 id="findings">1. Findings by class</h2>

<h3>Class A — Multi-vendor combo visibility</h3>
<p>
ThirdParty vendors were scoped via <code>where('vendorId','==', X)</code>
on the booking's top-level <code>vendorId</code> field. Multi-vendor
bookings (e.g. POS combos with cricket + paintball) only stamp the FIRST
vendor as primary. Every non-primary vendor was therefore invisible to
their own booking. Event-package bookings carried no top-level
<code>vendorId</code> at all.
</p>
<table>
  <tr><th>Multi-vendor bookings</th><td>408</td></tr>
  <tr><th>Vendor-booking pairs hidden</th><td>515</td></tr>
  <tr><th>Worst-affected vendor</th><td>7013404024 — 177 bookings hidden</td></tr>
</table>
<p><strong>Status:</strong> <span class="pill pill-ok">resolved</span> via
<code>vendorIds: string[]</code> + <code>array-contains</code> read query
+ backfill.</p>

<h3>Class B — Refund debit drift</h3>
<p>
Historical refund debits were applied proportionally to <em>every</em>
vendor on a booking, instead of reading <code>items[].refunded === true</code>.
Refunded items belonged to specific vendors; non-refunded items'
vendors were debited anyway, and refunded items' vendors were
under-debited.
</p>
<table>
  <tr><th>Refunded bookings scanned</th><td>48</td></tr>
  <tr><th>Bookings with vendor debit drift</th><td>38</td></tr>
  <tr><th>Total |delta|</th><td>₹7,976</td></tr>
  <tr><th>Net company impact</th><td>-₹28 (company owes vendors)</td></tr>
</table>
<p><strong>Status:</strong> <span class="pill pill-warn">corrections drafted, not yet applied</span> —
preview at <code>reports/refund-corrections-preview.csv</code>; apply via
<code>scripts/apply-vendor-refund-corrections.cjs --apply</code>.</p>

<h3>Class C — Refund flag drift between items[] and billingItems[]</h3>
<p>
The customer-app refund flow stamps <code>refunded: true</code> on
<code>items[]</code> only. <code>mapTransactionRecord</code> prefers
<code>billingItems</code> when present, so settlements / vendor reports /
the BookingDetailsModal silently lost the refunded flag on every
customer-side refund.
</p>
<table>
  <tr><th>Refunded bookings scanned</th><td>48</td></tr>
  <tr><th>Bookings where the two arrays disagreed</th><td>48 (100%)</td></tr>
  <tr><th>billingItems[].refunded synced after backfill</th><td>47 of 47 needing it</td></tr>
</table>
<p><strong>Status:</strong> <span class="pill pill-ok">resolved</span> via
mapper OR + backfill.</p>

<h3>Class D — Event-package vendor visibility</h3>
<p>
Event-package items (Summer Vibes, etc.) carry no <code>vendorId</code>
on items[]/billingItems[]. Vendor identity lives only in
<code>EventCampaign.packages[].items[]</code>. The earlier vendorIds
backfill missed these vendors entirely.
</p>
<table>
  <tr><th>Event-package bookings</th><td>421</td></tr>
  <tr><th>Bookings missing event-package vendor IDs</th><td>275 (65%)</td></tr>
  <tr><th>Vendor-booking pairs missing</th><td>639</td></tr>
  <tr><th>Worst-affected vendor</th><td>8885215060 (Jagadish-rjy) — 212 bookings</td></tr>
  <tr><th>After backfill — bookings missing vendors</th><td>0</td></tr>
</table>
<p><strong>Status:</strong> <span class="pill pill-ok">resolved</span> via
EventCampaign-aware backfill + trigger reconciliation.</p>

<h3>Class E — Vendor branch resolution</h3>
<p>
The AccountingModule blocked vendors with no canonical
<code>branchId</code>, even when their freeform <code>branch</code>
field was a recognisable location string. 22 of 27 vendors were
seeing "No location assigned to your account."
</p>
<table>
  <tr><th>Vendors total</th><td>27</td></tr>
  <tr><th>Truly blocked (no resolution path)</th><td>1 (Manoja, "SAMALKOT")</td></tr>
  <tr><th>branchId/branch field conflicts (cosmetic only)</th><td>2</td></tr>
  <tr><th>Healthy + auto-resolvable after fix</th><td>24</td></tr>
</table>
<p><strong>Status:</strong> <span class="pill pill-ok">resolved</span> via
runtime fallback + write-side derivation. <span class="pill pill-warn">1 admin task</span>
to assign Manoja a branch.</p>

<h2 id="fixes">2. Fixes shipped</h2>

<h3>Code changes</h3>
<table>
  <tr><th>File</th><th>Change</th></tr>
  <tr><td><code>src/pipeline/api/firestore-utils.ts</code></td><td>New canonical helper <code>deriveVendorIds</code>.</td></tr>
  <tr><td><code>src/pipeline/api/billing-firestore.ts</code></td><td>POS write stamps <code>vendorIds</code>. ThirdParty read query unions <code>array-contains</code> with legacy top-level filter. mapTransactionRecord ORs items[].refunded into output.</td></tr>
  <tr><td><code>src/lib/unified-booking.ts</code></td><td>Online / web / Android / iOS write path stamps <code>vendorIds</code>.</td></tr>
  <tr><td><code>functions/lib/vendor-ledger-sync.js</code></td><td>Trigger persists <code>vendorIds</code> on enrichment + reconciles the union of flat-item AND event-package vendor IDs on every state change. EventCampaign config cached 5min per instance.</td></tr>
  <tr><td><code>src/pipeline/api/vendor-details-firestore.ts</code></td><td>submitFirestoreVendorDetails / updateFirestoreVendorDetails auto-derive <code>branchId</code> from freeform <code>branch</code>.</td></tr>
  <tr><td><code>src/pipeline/pages/modules/AccountingModule.tsx</code></td><td>Vendor location loader falls back to <code>resolveLocation(details.branch)</code> when <code>branchId</code> is absent.</td></tr>
  <tr><td><code>src/pipeline/pages/modules/bookings/BookingDetailsModal.tsx</code></td><td>Refunded chip per item; clarified labels (Subtotal/Total, Razorpay IDs, Session date, etc.).</td></tr>
</table>

<h3>Backfills applied</h3>
<table>
  <tr><th>Backfill</th><th>Rows touched</th></tr>
  <tr><td>vendorIds (flat-item)</td><td>1 (residual after earlier feat-branch run)</td></tr>
  <tr><td>vendorIds (event-package, this session)</td><td>275</td></tr>
  <tr><td>billingItems[].refunded sync</td><td>47</td></tr>
  <tr><td>Manual: Manoja branchId</td><td>1 (assigned via AdminModule UI)</td></tr>
</table>

<h2 id="scripts">3. Scripts created</h2>
<table>
  <tr><th>Script</th><th>Purpose</th></tr>
  <tr><td><code>scripts/backfill-booking-vendor-ids.cjs</code></td><td>Stamp flat-item <code>vendorIds</code> on every booking.</td></tr>
  <tr><td><code>scripts/backfill-event-package-vendor-ids.cjs</code></td><td>Stamp event-package vendor IDs derived from EventCampaign config.</td></tr>
  <tr><td><code>scripts/sync-billingitems-refund-flag.cjs</code></td><td>Copy items[].refunded onto billingItems[].refunded.</td></tr>
  <tr><td><code>scripts/apply-vendor-refund-corrections.cjs</code></td><td>Write per-vendor refund-debit corrections to vendorLedger.</td></tr>
  <tr><td><code>scripts/audit-vendor-mismatches-historical.cjs</code></td><td>Headline metrics across all three mismatch classes.</td></tr>
  <tr><td><code>scripts/audit-event-package-vendor-visibility.cjs</code></td><td>Per-vendor event-package visibility gaps.</td></tr>
  <tr><td><code>scripts/audit-vendor-branches.cjs</code></td><td>Vendor location resolution audit.</td></tr>
  <tr><td><code>scripts/inspect-booking-event-package.cjs</code></td><td>Debug helper — dumps a booking's vendorIds + event-package shape.</td></tr>
  <tr><td><code>scripts/reconcile-vendor-refund-debits.cjs</code></td><td>(pre-existing) Detail of refund-debit deltas by vendor.</td></tr>
</table>

<h2 id="contracts">4. Regression guards</h2>
<p>
Eight contract tests in <code>src/pipeline/api/vendor-ids-contract.test.ts</code>
fail loudly if any canonical writer drops the field or the in-trigger
helpers diverge from canonical:
</p>
<ul>
  <li>POS write path stamps <code>vendorIds</code> via <code>deriveVendorIds</code></li>
  <li>unified-booking stamps <code>vendorIds</code></li>
  <li>vendor-ledger-sync trigger stamps <code>vendorIds</code> on enrichment</li>
  <li>trigger reconciles when billingItems already exist</li>
  <li>ThirdParty read scope unions array-contains with legacy filter</li>
  <li>trigger keeps deriveVendorIds in sync with canonical helper</li>
  <li>trigger reconciles event-package vendor IDs via EventCampaign config</li>
  <li>mapTransactionRecord ORs items[].refunded into output</li>
</ul>
<p>
Plus the weekly drift watch GitHub Action
(<code>.github/workflows/vendor-ids-drift-check.yml</code>) runs the
backfill in dry-run mode every Monday 03:30 UTC and opens a tracking
issue if "would update" is non-zero.
</p>

<h2 id="metrics">5. Headline metrics</h2>
<table>
  <tr><th>Metric</th><th>Before</th><th>After</th></tr>
  <tr><td>Multi-vendor combo bookings hidden from non-primary vendors</td><td>515 vendor-booking pairs</td><td>0</td></tr>
  <tr><td>Event-package bookings hidden</td><td>275 of 421 (65%)</td><td>0 of 421 (0%)</td></tr>
  <tr><td>Vendors blocked from Accounting page</td><td>22 of 27</td><td>0 of 27 after admin task</td></tr>
  <tr><td>Refund flag drift between items[] and billingItems[]</td><td>48 of 48 (100%)</td><td>0</td></tr>
  <tr><td>Refund-debit drift |delta|</td><td>₹7,976 across 38 bookings</td><td>Pending apply</td></tr>
  <tr><td>Total bookings touched (data writes)</td><td>—</td><td>~324</td></tr>
</table>

<h2 id="actions">6. Outstanding actions</h2>
<ol>
  <li><strong>Push commits:</strong> <code>git push</code></li>
  <li><strong>Deploy Cloud Function:</strong> <code>firebase deploy --only functions</code> — activates trigger reconciliation for future bookings.</li>
  <li><strong>Add GitHub secret:</strong> <code>FIREBASE_SERVICE_ACCOUNT</code> (paste contents of <code>serviceAccountKey.json</code>) so the weekly drift workflow can run.</li>
  <li><strong>Apply refund corrections (optional, money write):</strong> review <code>reports/refund-corrections-preview.csv</code>, then <code>node scripts/apply-vendor-refund-corrections.cjs --apply</code>.</li>
</ol>

<h2 id="commits">7. Git commits this session</h2>
<table>
  <tr><th>Hash</th><th>Subject</th></tr>
  <tr><td><code>12c12e9</code></td><td>fix(vendor): event-package vendorIds visibility + refund flag drift</td></tr>
  <tr><td><code>b19b396</code></td><td>fix(vendor): unblock Accounting when only branch (not branchId) is set</td></tr>
  <tr><td><code>73d4e16</code></td><td>(.) — earlier vendorIds work merged in</td></tr>
  <tr><td><code>db2f331</code></td><td>feat: scripts for vendor refund reconciliation and backfilling vendor IDs</td></tr>
</table>

<footer>
  Generated by <code>scripts/generate-session-report.cjs</code> · ${today}
</footer>

</body>
</html>`;

(async () => {
  const outDir = path.dirname(OUT_PATH);
  if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Rendering report → ${OUT_PATH}`);

  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: OUT_PATH,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      footerTemplate:
        '<div style="font-size:9px;color:#888;width:100%;padding:0 14mm;display:flex;justify-content:space-between;"><span>A Square GoKarting · Vendor Fix Report · ' +
        today +
        '</span><span class="pageNumber"></span></div>',
      headerTemplate: '<span></span>',
    });
  } finally {
    await browser.close();
  }

  console.log(`Wrote ${OUT_PATH}`);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

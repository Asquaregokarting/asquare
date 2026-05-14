/**
 * Per-vendor report of bookings that were NOT credited until today's
 * event-package backfill (`backfill-event-package-vendor-credits.cjs`).
 *
 * The data source is the preview CSV produced by the backfill's dry-run.
 * For each row, we look up:
 *   - vendor name (from `vendorDetails`)
 *   - booking transaction date + invoice number + customer phone
 *
 * Output:
 *   - reports/uncredited-vendor-bookings.csv  (one row per (vendor, booking))
 *   - per-vendor totals printed to stdout
 *   - optional PDF via puppeteer (see the sibling generate-* scripts).
 *
 * Usage:
 *   node scripts/report-uncredited-bookings.cjs
 *   node scripts/report-uncredited-bookings.cjs --in reports/event-credits-preview.csv
 *   node scripts/report-uncredited-bookings.cjs --pdf reports/uncredited-vendor-bookings.pdf
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const IN_PATH = argValue('--in') ?? 'reports/event-credits-preview.csv';
const OUT_CSV = argValue('--csv') ?? 'reports/uncredited-vendor-bookings.csv';
const OUT_PDF = argValue('--pdf'); // optional

const DATABASE_ID = 'asquare-app-db';

const keyPath = path.resolve('serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.');
  process.exit(1);
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
});
const db = admin.firestore();
db.settings({ databaseId: DATABASE_ID });

const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pad = (s, w) => String(s ?? '').padEnd(w);
const padR = (s, w) => String(s ?? '').padStart(w);

const dateOnly = (raw) => {
  if (!raw) return '';
  if (typeof raw === 'object' && typeof raw.toDate === 'function') {
    try { return raw.toDate().toISOString().slice(0, 10); } catch { return ''; }
  }
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

(async () => {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Input CSV ${IN_PATH} not found. Run:`);
    console.error(`  node scripts/backfill-event-package-vendor-credits.cjs --csv ${IN_PATH}`);
    process.exit(1);
  }

  // 1. Load CSV rows.
  const csv = fs.readFileSync(IN_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
  csv.shift(); // header
  const rows = csv.map((line) => {
    const [bookingId, vendorId, current, expectedTotal, expectedBase, expectedGst, delta] =
      line.split(',');
    return {
      bookingId,
      vendorId,
      current: Number(current) || 0,
      expectedTotal: Number(expectedTotal) || 0,
      expectedBase: Number(expectedBase) || 0,
      expectedGst: Number(expectedGst) || 0,
      delta: Number(delta) || 0,
    };
  }).filter((r) => r.delta > 0);
  console.log(`\nLoaded ${rows.length} additive corrections from ${IN_PATH}.`);

  // 2. Resolve vendor names + booking metadata.
  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const bookingIds = [...new Set(rows.map((r) => r.bookingId))];

  const vendorMeta = new Map();
  await Promise.all(
    vendorIds.map(async (vid) => {
      try {
        const snap = await db.collection('vendorDetails').doc(vid).get();
        if (snap.exists) {
          const d = snap.data() || {};
          vendorMeta.set(vid, {
            name: d.vendorName || d.userName || vid,
            type: d.vendorType || 'ThirdParty',
            branch: d.branch || '',
          });
        } else {
          vendorMeta.set(vid, { name: vid, type: 'ThirdParty', branch: '' });
        }
      } catch {
        vendorMeta.set(vid, { name: vid, type: 'ThirdParty', branch: '' });
      }
    }),
  );

  const bookingMeta = new Map();
  // Firestore `in` clause supports up to 30 IDs per query; chunk.
  const chunks = [];
  for (let i = 0; i < bookingIds.length; i += 30) chunks.push(bookingIds.slice(i, i + 30));
  for (const chunk of chunks) {
    const refs = chunk.map((id) => db.collection('bookings').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const d = snap.exists ? (snap.data() || {}) : {};
      bookingMeta.set(snap.id, {
        date: dateOnly(d.transactionDate ?? d.createdAt ?? d.sessionDate),
        invoiceNumber: d.invoiceNumber || d.billingId || snap.id,
        customerName: d.customerName || d.userDisplayName || '',
        customerPhone: d.customerPhone || d.userPhone || '',
        finalAmount: Number(d.finalAmount ?? d.totalAmount ?? 0),
        source: d.source || '',
      });
    }
  }

  // 3. Group per vendor.
  const byVendor = new Map();
  for (const r of rows) {
    const list = byVendor.get(r.vendorId) ?? [];
    list.push(r);
    byVendor.set(r.vendorId, list);
  }

  // 4. Per-vendor summary to stdout.
  const sortedVendors = [...byVendor.entries()].sort((a, b) => {
    const totalA = a[1].reduce((s, r) => s + r.delta, 0);
    const totalB = b[1].reduce((s, r) => s + r.delta, 0);
    return totalB - totalA;
  });

  let grandTotal = 0;
  console.log(`\n─── per-vendor totals (sorted by amount) ─────────────────────`);
  console.log(pad('vendor', 30) + pad('id', 13) + pad('branch', 14) + padR('bookings', 10) + padR('total', 12));
  console.log('─'.repeat(80));
  for (const [vid, list] of sortedVendors) {
    const total = list.reduce((s, r) => s + r.delta, 0);
    grandTotal += total;
    const meta = vendorMeta.get(vid) || { name: vid, branch: '' };
    console.log(
      pad(meta.name.slice(0, 28), 30) +
        pad(vid, 13) +
        pad(meta.branch.slice(0, 12), 14) +
        padR(list.length, 10) +
        padR(inr(total), 12),
    );
  }
  console.log('─'.repeat(80));
  console.log(pad('TOTAL', 30) + pad('', 13) + pad('', 14) + padR(rows.length, 10) + padR(inr(grandTotal), 12));

  // 5. Detailed CSV.
  const dir = path.dirname(OUT_CSV);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const csvLines = [
    'vendorName,vendorId,vendorBranch,bookingId,bookingDate,invoiceNumber,customerName,customerPhone,bookingFinalAmount,creditAmount,creditBase,creditGst',
  ];
  for (const [vid, list] of sortedVendors) {
    const meta = vendorMeta.get(vid) || { name: vid, branch: '' };
    const sortedList = [...list].sort((a, b) => {
      const da = bookingMeta.get(a.bookingId)?.date ?? '';
      const dbk = bookingMeta.get(b.bookingId)?.date ?? '';
      return da.localeCompare(dbk);
    });
    for (const r of sortedList) {
      const b = bookingMeta.get(r.bookingId) || {};
      const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      csvLines.push(
        [
          cell(meta.name),
          vid,
          cell(meta.branch),
          r.bookingId,
          b.date ?? '',
          cell(b.invoiceNumber ?? ''),
          cell(b.customerName ?? ''),
          b.customerPhone ?? '',
          b.finalAmount ?? 0,
          r.delta,
          r.expectedBase,
          r.expectedGst,
        ].join(','),
      );
    }
  }
  fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf-8');
  console.log(`\nDetailed CSV: ${OUT_CSV} (${rows.length} rows across ${sortedVendors.length} vendors)`);

  // 6. Optional PDF.
  if (OUT_PDF) {
    const puppeteer = require('puppeteer');
    const html = renderHtml(sortedVendors, vendorMeta, bookingMeta, grandTotal);
    const browser = await puppeteer.launch({ headless: 'new' });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: OUT_PDF,
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
        displayHeaderFooter: true,
        footerTemplate:
          '<div style="font-size:9px;color:#888;width:100%;padding:0 14mm;display:flex;justify-content:space-between;"><span>Uncredited vendor bookings</span><span class="pageNumber"></span></div>',
        headerTemplate: '<span></span>',
      });
    } finally {
      await browser.close();
    }
    console.log(`PDF written: ${OUT_PDF}`);
  }

  console.log('\nDone.\n');
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

function renderHtml(sortedVendors, vendorMeta, bookingMeta, grandTotal) {
  const inrFmt = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const today = new Date().toISOString().slice(0, 10);
  const sections = sortedVendors
    .map(([vid, list]) => {
      const meta = vendorMeta.get(vid) || { name: vid, type: '', branch: '' };
      const total = list.reduce((s, r) => s + r.delta, 0);
      const sortedList = [...list].sort((a, b) => {
        const da = bookingMeta.get(a.bookingId)?.date ?? '';
        const dbk = bookingMeta.get(b.bookingId)?.date ?? '';
        return da.localeCompare(dbk);
      });
      const rows = sortedList
        .map((r) => {
          const b = bookingMeta.get(r.bookingId) || {};
          return `<tr>
              <td>${b.date ?? ''}</td>
              <td><code>${r.bookingId}</code></td>
              <td>${escapeHtml(b.invoiceNumber ?? '')}</td>
              <td>${escapeHtml(b.customerName ?? '')}</td>
              <td>${b.customerPhone ?? ''}</td>
              <td style="text-align:right">${inrFmt(r.expectedBase)}</td>
              <td style="text-align:right">${inrFmt(r.expectedGst)}</td>
              <td style="text-align:right;font-weight:600">${inrFmt(r.delta)}</td>
            </tr>`;
        })
        .join('');
      return `<section style="page-break-inside:avoid;">
          <h2 style="margin:18px 0 4px;">${escapeHtml(meta.name)} <span style="font-weight:400;color:#5b6473;">· ${vid} · ${meta.branch || '—'}</span></h2>
          <p style="margin:0 0 6px;color:#5b6473;font-size:12px;">Type: ${meta.type || 'ThirdParty'} · Bookings: ${list.length} · Total credited: <strong>${inrFmt(total)}</strong></p>
          <table>
            <thead>
              <tr><th>Date</th><th>Booking</th><th>Invoice</th><th>Customer</th><th>Phone</th><th>Base</th><th>GST</th><th>Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Uncredited vendor bookings</title>
    <style>
      body { font: 12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#1a1d24; padding:24px 32px; max-width:880px; margin:0 auto; }
      header { border-bottom: 2px solid #1a1d24; padding-bottom: 10px; margin-bottom: 14px; }
      header h1 { margin:0; font-size:21px; }
      header .meta { color:#5b6473; font-size:11px; margin-top:3px; }
      table { border-collapse:collapse; width:100%; font-size:11px; margin-bottom:6px; }
      th,td { border:1px solid #d8dde6; padding:4px 6px; vertical-align:top; }
      th { background:#f5f7fb; text-align:left; }
      code { font-family:"SFMono-Regular",Consolas,monospace; font-size:10.5px; }
      .grand { font-weight:600; font-size:14px; color:#1a1d24; margin-top:18px; padding-top:8px; border-top:2px solid #1a1d24; }
    </style></head><body>
    <header>
      <h1>Uncredited vendor bookings — historical event-package credits</h1>
      <div class="meta">A Square GoKarting · Generated ${today} · ${sortedVendors.length} vendor${sortedVendors.length === 1 ? '' : 's'}, ${sortedVendors.reduce((s, [, list]) => s + list.length, 0)} (vendor, booking) credit row${sortedVendors.length === 1 ? '' : 's'}</div>
    </header>
    <p style="font-size:12px;color:#5b6473;">
      Each row is a historical booking where the vendor's event-package contribution was never credited to <code>vendorLedger</code>.
      The trigger's <code>aggregateByVendor</code> skipped items without a per-item <code>vendorId</code>; event-package items
      (Summer Vibes etc.) carry no item-level <code>vendorId</code> — vendor identity lives only in the
      <code>EventCampaign.packages[].items[]</code> config. Customer-online bookings flowing through Razorpay were credited via
      <code>event-package-ledger.ts</code>; POS bookings were not. Today's backfill closed the gap.
    </p>
    ${sections}
    <p class="grand">Grand total credited today: ${inrFmt(grandTotal)}</p>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

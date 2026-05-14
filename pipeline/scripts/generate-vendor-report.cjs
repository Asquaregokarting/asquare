const fs = require("fs");
const path = require("path");

const data = JSON.parse(fs.readFileSync(path.join(process.env.TEMP, "vendor_report_data.json"), "utf8"));

const docs = data.filter(r => r.document).map(r => {
  const f = r.document.fields || {};
  const ex = (v) => {
    if (!v) return null;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.arrayValue) return (v.arrayValue.values || []).map(ex);
    if (v.mapValue) { const o = {}; for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = ex(val); return o; }
    return null;
  };
  const result = {};
  for (const [k, v] of Object.entries(f)) result[k] = ex(v);
  result._id = r.document.name.split("/").pop();
  return result;
});

const days = {
  "2026-03-29": { label: "Saturday, March 29", bookings: [] },
  "2026-03-30": { label: "Sunday, March 30", bookings: [] },
  "2026-03-31": { label: "Monday, March 31", bookings: [] },
};

docs.forEach(b => {
  const d = (b.transactionDate || "").slice(0, 10);
  if (days[d]) days[d].bookings.push(b);
});

for (const d of Object.values(days)) {
  d.bookings.sort((a, b) => a._id.localeCompare(b._id));
}

const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

function calcDay(bookings) {
  let tRev = 0, tVB = 0, tVG = 0, tVT = 0, tCB = 0, tCG = 0, tCT = 0;
  const byMethod = {};
  for (const b of bookings) {
    const amt = b.finalAmount || b.totalAmount || 0;
    tRev += amt;
    tVB += b.vendorBase || 0;
    tVG += b.vendorGst || 0;
    tVT += b.vendorTotal || 0;
    tCB += b.companyBase || 0;
    tCG += b.companyGst || 0;
    tCT += b.companyTotal || 0;
    const m = b.paymentMethod || "Other";
    if (!byMethod[m]) byMethod[m] = { n: 0, rev: 0, vt: 0, ct: 0 };
    byMethod[m].n++;
    byMethod[m].rev += amt;
    byMethod[m].vt += b.vendorTotal || 0;
    byMethod[m].ct += b.companyTotal || 0;
  }
  return { tRev, tVB, tVG, tVT, tCB, tCG, tCT, byMethod, n: bookings.length };
}

function getItemName(b) {
  const items = Array.isArray(b.items) ? b.items : [];
  return items.map(i => {
    let name = (i.itemName || "?")
      .replace(/TRAMPOLINE PARK — TRAMPOLINE PARK — /g, "")
      .replace(/SOCKS FOR TRAMPOLINE PARK — SOCKS FOR TRAMPOLINE PARK — /g, "Socks - ");
    const qty = i.quantity || 1;
    return qty > 1 ? `${name} x${qty}` : name;
  }).join(" + ");
}

const allTotals = calcDay(docs);

let dayCards = "";
let grandTotals = { tRev: 0, tVB: 0, tVG: 0, tVT: 0, tCB: 0, tCG: 0, tCT: 0, n: 0 };

for (const [dateKey, day] of Object.entries(days)) {
  const t = calcDay(day.bookings);
  grandTotals.tRev += t.tRev;
  grandTotals.tVB += t.tVB;
  grandTotals.tVG += t.tVG;
  grandTotals.tVT += t.tVT;
  grandTotals.tCB += t.tCB;
  grandTotals.tCG += t.tCG;
  grandTotals.tCT += t.tCT;
  grandTotals.n += t.n;

  let rows = "";
  day.bookings.forEach((b, idx) => {
    const amt = b.finalAmount || b.totalAmount || 0;
    const vt = b.vendorTotal || 0;
    const ct = b.companyTotal || 0;
    const method = b.paymentMethod || "?";
    const methodClass = method === "Cash" ? "cash" : method === "UPI" ? "upi" : "card";
    const itemName = getItemName(b);

    rows += `
      <div class="booking-row">
        <div class="booking-header">
          <span class="booking-num">#${idx + 1}</span>
          <span class="booking-id">${b._id}</span>
          <span class="method-badge ${methodClass}">${method}</span>
        </div>
        <div class="booking-items">${itemName}</div>
        <div class="booking-amounts">
          <div class="amount-cell"><span class="label">Revenue</span><span class="value">${fmt(amt)}</span></div>
          <div class="amount-cell vendor"><span class="label">Vendor</span><span class="value">${fmt(vt)}</span></div>
          <div class="amount-cell company"><span class="label">Company</span><span class="value">${fmt(ct)}</span></div>
        </div>
      </div>`;
  });

  let methodRows = "";
  for (const [m, v] of Object.entries(t.byMethod).sort((a, b) => b[1].n - a[1].n)) {
    const methodClass = m === "Cash" ? "cash" : m === "UPI" ? "upi" : "card";
    methodRows += `
      <div class="method-row">
        <span class="method-badge ${methodClass}">${m}</span>
        <span class="method-count">${v.n} bookings</span>
        <span class="method-amt">${fmt(v.rev)}</span>
        <span class="method-vendor">${fmt(v.vt)}</span>
        <span class="method-company">${fmt(v.ct)}</span>
      </div>`;
  }

  dayCards += `
    <div class="day-card">
      <div class="day-header">
        <div class="day-date">${day.label}</div>
        <div class="day-count">${t.n} bookings</div>
      </div>

      <div class="day-summary">
        <div class="summary-row total-rev">
          <span class="label">Total Revenue</span>
          <span class="value">${fmt(t.tRev)}</span>
        </div>
        <div class="split-grid">
          <div class="split-card vendor-split">
            <div class="split-title">Vendor (80%)</div>
            <div class="split-main">${fmt(t.tVT)}</div>
            <div class="split-detail">Base ${fmt(t.tVB)} + GST ${fmt(t.tVG)}</div>
          </div>
          <div class="split-card company-split">
            <div class="split-title">Company (20%)</div>
            <div class="split-main">${fmt(t.tCT)}</div>
            <div class="split-detail">Base ${fmt(t.tCB)} + GST ${fmt(t.tCG)}</div>
          </div>
        </div>
      </div>

      <div class="method-summary">
        <div class="method-header-row">
          <span></span><span>Count</span><span>Revenue</span><span>Vendor</span><span>Company</span>
        </div>
        ${methodRows}
      </div>

      <div class="bookings-list">
        <div class="section-title">Booking Details</div>
        ${rows}
      </div>
    </div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vendor Report — Manoja (9985526034)</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a; color: #e4e4e7;
    max-width: 430px; margin: 0 auto; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @media print {
    body { background: #0a0a0a; max-width: 100%; }
    .day-card { break-inside: avoid; }
  }

  .report-header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    padding: 24px 20px 20px;
    border-bottom: 1px solid #27272a;
  }
  .report-logo { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #71717a; margin-bottom: 4px; }
  .report-title { font-size: 20px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .report-subtitle { font-size: 13px; color: #a1a1aa; }
  .report-period {
    margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap;
  }
  .period-badge {
    background: #27272a; border: 1px solid #3f3f46; border-radius: 6px;
    padding: 6px 12px; font-size: 12px; color: #d4d4d8;
  }

  .grand-total {
    background: #18181b; margin: 16px 12px; border-radius: 12px;
    border: 1px solid #27272a; overflow: hidden;
  }
  .grand-total-header {
    padding: 14px 16px; font-size: 13px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 1px; color: #71717a;
    border-bottom: 1px solid #27272a;
  }
  .grand-total-body { padding: 16px; }
  .grand-revenue {
    font-size: 28px; font-weight: 800; color: #fff;
    text-align: center; margin-bottom: 16px;
  }
  .grand-revenue span { font-size: 13px; color: #71717a; display: block; margin-bottom: 4px; font-weight: 500; }
  .grand-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grand-split-card {
    border-radius: 8px; padding: 12px; text-align: center;
  }
  .grand-split-card.vendor { background: #052e16; border: 1px solid #14532d; }
  .grand-split-card.company { background: #1e1b4b; border: 1px solid #312e81; }
  .grand-split-card .gs-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .grand-split-card.vendor .gs-label { color: #4ade80; }
  .grand-split-card.company .gs-label { color: #818cf8; }
  .grand-split-card .gs-value { font-size: 20px; font-weight: 700; color: #fff; }
  .grand-split-card .gs-detail { font-size: 11px; color: #71717a; margin-top: 4px; }
  .grand-bookings {
    margin-top: 12px; text-align: center; font-size: 13px; color: #a1a1aa;
  }
  .grand-bookings strong { color: #fff; }

  .day-card {
    margin: 16px 12px; background: #18181b; border-radius: 12px;
    border: 1px solid #27272a; overflow: hidden;
  }
  .day-header {
    padding: 14px 16px; display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid #27272a; background: #1c1c22;
  }
  .day-date { font-size: 15px; font-weight: 700; color: #fff; }
  .day-count { font-size: 12px; color: #a1a1aa; background: #27272a; padding: 4px 10px; border-radius: 20px; }

  .day-summary { padding: 16px; border-bottom: 1px solid #27272a; }
  .summary-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .summary-row .label { font-size: 13px; color: #a1a1aa; }
  .summary-row .value { font-size: 20px; font-weight: 700; color: #fff; }

  .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .split-card { border-radius: 8px; padding: 10px 12px; }
  .vendor-split { background: #052e16; border: 1px solid #14532d; }
  .company-split { background: #1e1b4b; border: 1px solid #312e81; }
  .split-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .vendor-split .split-title { color: #4ade80; }
  .company-split .split-title { color: #818cf8; }
  .split-main { font-size: 18px; font-weight: 700; color: #fff; margin: 2px 0; }
  .split-detail { font-size: 10px; color: #71717a; }

  .method-summary { padding: 12px 16px; border-bottom: 1px solid #27272a; }
  .method-header-row {
    display: grid; grid-template-columns: 80px 55px 1fr 1fr 1fr;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #52525b;
    padding-bottom: 6px; border-bottom: 1px solid #27272a; margin-bottom: 6px;
  }
  .method-row {
    display: grid; grid-template-columns: 80px 55px 1fr 1fr 1fr;
    font-size: 12px; color: #d4d4d8; padding: 5px 0; align-items: center;
  }
  .method-count { color: #a1a1aa; }
  .method-vendor { color: #4ade80; }
  .method-company { color: #818cf8; }

  .method-badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .method-badge.cash { background: #422006; color: #fb923c; }
  .method-badge.upi { background: #042f2e; color: #2dd4bf; }
  .method-badge.card { background: #1e1b4b; color: #a78bfa; }

  .section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
    color: #52525b; padding: 12px 16px 8px; font-weight: 600;
  }

  .bookings-list { padding-bottom: 4px; }
  .booking-row {
    padding: 10px 16px; border-bottom: 1px solid #1f1f23;
  }
  .booking-row:last-child { border-bottom: none; }
  .booking-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .booking-num { font-size: 11px; color: #52525b; font-weight: 600; min-width: 20px; }
  .booking-id { font-size: 10px; color: #52525b; font-family: 'SF Mono', monospace; flex: 1; }
  .booking-items { font-size: 13px; color: #d4d4d8; margin-bottom: 6px; line-height: 1.3; }
  .booking-amounts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .amount-cell { background: #27272a; border-radius: 6px; padding: 6px 8px; text-align: center; }
  .amount-cell .label { display: block; font-size: 9px; text-transform: uppercase; color: #71717a; letter-spacing: 0.5px; }
  .amount-cell .value { display: block; font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .amount-cell.vendor { background: #052e16; border: 1px solid #14532d; }
  .amount-cell.vendor .value { color: #4ade80; }
  .amount-cell.company { background: #1e1b4b; border: 1px solid #312e81; }
  .amount-cell.company .value { color: #818cf8; }

  .footer {
    padding: 20px 16px; text-align: center; font-size: 11px; color: #3f3f46;
    border-top: 1px solid #27272a; margin-top: 8px;
  }
</style>
</head>
<body>

<div class="report-header">
  <div class="report-logo">A Square GoKarting</div>
  <div class="report-title">Vendor Settlement Report</div>
  <div class="report-subtitle">Manoja — Mann Prakriti Groups (9985526034)</div>
  <div class="report-period">
    <div class="period-badge">Kakinada Branch</div>
    <div class="period-badge">Trampoline Park</div>
    <div class="period-badge">80% Revenue Share</div>
  </div>
</div>

<div class="grand-total">
  <div class="grand-total-header">3-Day Grand Total — Mar 29–31, 2026</div>
  <div class="grand-total-body">
    <div class="grand-revenue">
      <span>Total Revenue</span>
      ${fmt(grandTotals.tRev)}
    </div>
    <div class="grand-split">
      <div class="grand-split-card vendor">
        <div class="gs-label">Vendor Share</div>
        <div class="gs-value">${fmt(grandTotals.tVT)}</div>
        <div class="gs-detail">Base ${fmt(grandTotals.tVB)} + GST ${fmt(grandTotals.tVG)}</div>
      </div>
      <div class="grand-split-card company">
        <div class="gs-label">Company Share</div>
        <div class="gs-value">${fmt(grandTotals.tCT)}</div>
        <div class="gs-detail">Base ${fmt(grandTotals.tCB)} + GST ${fmt(grandTotals.tCG)}</div>
      </div>
    </div>
    <div class="grand-bookings"><strong>${grandTotals.n}</strong> total bookings across 3 days</div>
  </div>
</div>

${dayCards}

<div class="footer">
  Generated on ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short" })} IST<br>
  A Square GoKarting — Vendor Settlement System
</div>

</body>
</html>`;

const outPath = path.join(process.env.TEMP, "vendor_report.html");
fs.writeFileSync(outPath, html, "utf8");
console.log("HTML report written to: " + outPath);

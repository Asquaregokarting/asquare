/**
 * Printable Cashier Shift Report — generates an HTML report and prints via hidden iframe.
 * Layout: Shift info + Sales Summary + Payment Breakdown + Variance.
 * Optimised for A4 print.
 */
import type { ShiftRecord } from "../../api/shifts";
import { logger } from "../../../lib/logger";

const fmtCurrency = (v: number): string => `\u20B9${Math.round(v).toLocaleString("en-IN")}`;

const formatReportDate = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr || "Unknown Date";
  const day = d.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()} - ${days[d.getDay()]}`;
};

const formatTime = (isoStr?: string): string => {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
};

const buildShiftReportHtml = (shift: ShiftRecord, cashierName: string): string => {
  const s = shift.settlement;
  const revenue = s ? (s.cashActual + s.cardActual + s.upiActual) : 0;

  const cashVariance = s ? (s.cashEntered - s.cashActual) : 0;
  const cardVariance = s ? (s.cardEntered - s.cardActual) : 0;
  const upiVariance = s ? (s.upiEntered - s.upiActual) : 0;
  const totalVariance = cashVariance + cardVariance + upiVariance;

  const isMatched = s
    ? s.cashEntered === s.cashActual && s.cardEntered === s.cardActual && s.upiEntered === s.upiActual
    : false;

  const varianceColor = (v: number) => v === 0 ? "#333" : v > 0 ? "#16a34a" : "#dc2626";

  const locationDisplay = shift.locationName || shift.locationId || "—";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cashier Shift Report - ${cashierName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #fff;
      color: #1a1a1a;
      font-size: 13px;
      line-height: 1.5;
      padding: 32px 40px;
    }
    @media print {
      body { padding: 20px 24px; }
      @page { margin: 15mm 12mm; size: A4; }
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0066FF;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 700;
      color: #0066FF;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .header h2 {
      font-size: 14px;
      font-weight: 600;
      color: #555;
    }
    .shift-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 24px;
      margin-bottom: 24px;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
    }
    .shift-info .row {
      display: flex;
      gap: 8px;
    }
    .shift-info .label {
      font-weight: 600;
      color: #555;
      min-width: 80px;
    }
    .shift-info .value {
      color: #1a1a1a;
      font-weight: 500;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #333;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      margin-top: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      text-align: left;
      padding: 8px 12px;
      background: #f0f4ff;
      border-bottom: 2px solid #0066FF;
      font-size: 12px;
      font-weight: 600;
      color: #333;
    }
    th:last-child { text-align: right; }
    td {
      padding: 7px 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 13px;
    }
    td:last-child { text-align: right; font-weight: 600; }
    .status-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .status-matched { background: #dcfce7; color: #16a34a; }
    .status-mismatch { background: #fee2e2; color: #dc2626; }
    .footer {
      text-align: center;
      color: #888;
      font-size: 10px;
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>A SQUARE GOKARTING</h1>
    <h2>Cashier Day Sales Report</h2>
  </div>

  <div class="shift-info">
    <div class="row"><span class="label">Cashier:</span><span class="value">${cashierName}</span></div>
    <div class="row"><span class="label">Location:</span><span class="value">${locationDisplay}</span></div>
    <div class="row"><span class="label">Date:</span><span class="value">${formatReportDate(shift.shiftDate)}</span></div>
    <div class="row"><span class="label">Shift:</span><span class="value">${formatTime(shift.startTime)} – ${shift.endTime ? formatTime(shift.endTime) : "Active"}</span></div>
  </div>

  <div class="section-title">Sales Summary</div>
  <table>
    <thead>
      <tr><th>Item</th><th>Value</th></tr>
    </thead>
    <tbody>
      <tr><td>Total Transactions</td><td>${s?.totalTransactions ?? "—"}</td></tr>
      <tr><td>Total Revenue</td><td>${fmtCurrency(revenue)}</td></tr>
    </tbody>
  </table>

  <div class="section-title">Payment Breakdown (Entered / Actual)</div>
  <table>
    <thead>
      <tr><th>Method</th><th>Entered</th><th>Actual</th></tr>
    </thead>
    <tbody>
      <tr><td>Cash</td><td style="text-align:right;">${fmtCurrency(s?.cashEntered ?? 0)}</td><td>${fmtCurrency(s?.cashActual ?? 0)}</td></tr>
      <tr><td>Card</td><td style="text-align:right;">${fmtCurrency(s?.cardEntered ?? 0)}</td><td>${fmtCurrency(s?.cardActual ?? 0)}</td></tr>
      <tr><td>UPI</td><td style="text-align:right;">${fmtCurrency(s?.upiEntered ?? 0)}</td><td>${fmtCurrency(s?.upiActual ?? 0)}</td></tr>
    </tbody>
  </table>

  <div class="section-title">Variance</div>
  <table>
    <thead>
      <tr><th>Method</th><th>Difference</th></tr>
    </thead>
    <tbody>
      <tr><td>Cash</td><td style="color:${varianceColor(cashVariance)}">${fmtCurrency(cashVariance)}</td></tr>
      <tr><td>Card</td><td style="color:${varianceColor(cardVariance)}">${fmtCurrency(cardVariance)}</td></tr>
      <tr><td>UPI</td><td style="color:${varianceColor(upiVariance)}">${fmtCurrency(upiVariance)}</td></tr>
      <tr style="border-top:2px solid #333;"><td style="font-weight:700;">Total Variance</td><td style="font-weight:700; color:${varianceColor(totalVariance)}">${fmtCurrency(totalVariance)}</td></tr>
    </tbody>
  </table>

  <div style="margin-top:16px; text-align:center;">
    <span class="status-badge ${isMatched ? "status-matched" : "status-mismatch"}">
      ${isMatched ? "Matched \u2713" : "Mismatch \u2717"}
    </span>
  </div>

  <div class="footer">
    ${s?.settledAt ? `Settled at ${formatTime(s.settledAt)} &bull; ` : ""}Generated at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
  </div>
</body>
</html>`;
};

/**
 * Generate and print the Cashier Shift Report via a hidden iframe.
 */
export const printCashierShiftReport = (shift: ShiftRecord, cashierName: string): void => {
  let html: string;
  try {
    html = buildShiftReportHtml(shift, cashierName);
  } catch (err) {
    logger.error('shift_report.html_generation_failed', err);
    throw new Error("Failed to generate shift report content.");
  }

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = "800px";
  iframe.style.height = "1200px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    logger.warn('shift_report.iframe_unavailable_fallback');
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    document.body.removeChild(iframe);
    return;
  }

  try {
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
  } catch (err) {
    logger.error('shift_report.iframe_write_failed', err);
    document.body.removeChild(iframe);
    throw new Error("Failed to render shift report for printing.");
  }

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      logger.error('shift_report.print_dialog_failed', err);
    }
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* already removed */ }
    }, 1000);
  }, 300);
};

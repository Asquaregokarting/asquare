/**
 * Recalculate all bookings for vendor 9985526034 (Manoja) from 80% to 82% share.
 *
 * Usage:
 *   node scripts/recalc-vendor-share.cjs              # dry-run
 *   node scripts/recalc-vendor-share.cjs --execute     # apply changes
 */

const API_KEY = "AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo";
const PROJECT = "a-square-6720c";
const DB = "asquare-app-db";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB}/documents`;

const VENDOR_ID = "9985526034";
const OLD_SHARE = 80;
const NEW_SHARE = 82;
const GST_PERCENT = 18;
const EXECUTE = process.argv.includes("--execute");

const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "boolean") return { booleanValue: val };
  return { stringValue: String(val) };
}

function extractValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(extractValue);
  if (v.mapValue) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = extractValue(val);
    return o;
  }
  return null;
}

function computeSplit(totalAmount, sharePercent) {
  const baseAmount = Math.round((totalAmount * 100) / (100 + GST_PERCENT));
  const gstAmount = totalAmount - baseAmount;
  const vendorBase = Math.round(baseAmount * sharePercent / 100);
  const vendorGst = Math.round(gstAmount * sharePercent / 100);
  return {
    baseAmount, gstAmount,
    vendorBase, vendorGst, vendorTotal: vendorBase + vendorGst,
    companyBase: baseAmount - vendorBase,
    companyGst: gstAmount - vendorGst,
    companyTotal: (baseAmount - vendorBase) + (gstAmount - vendorGst),
  };
}

async function patchDoc(path, fields) {
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join("&");
  const url = `${BASE}/${path}?key=${API_KEY}&${updateMask}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
  const resp = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Patch ${path} failed (${resp.status}): ${await resp.text()}`);
}

async function deleteDoc(path) {
  const resp = await fetch(`${BASE}/${path}?key=${API_KEY}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Delete ${path} failed (${resp.status}): ${await resp.text()}`);
}

async function createDoc(collectionPath, docId, fields) {
  const url = `${BASE}/${collectionPath}?key=${API_KEY}&documentId=${docId}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = toFirestoreValue(v);
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Create ${collectionPath}/${docId} failed (${resp.status}): ${await resp.text()}`);
}

async function main() {
  console.log("=== Recalculate Vendor Share: " + OLD_SHARE + "% → " + NEW_SHARE + "% ===");
  console.log("Vendor: " + VENDOR_ID + " (Manoja / Mann Prakriti Groups)");
  console.log("Mode: " + (EXECUTE ? "EXECUTE" : "DRY-RUN") + "\n");

  // 1. Fetch all bookings
  const resp = await fetch(`${BASE}:runQuery?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "bookings" }],
        where: { fieldFilter: { field: { fieldPath: "vendorId" }, op: "EQUAL", value: { stringValue: VENDOR_ID } } },
        limit: 500,
      },
    }),
  });
  const data = await resp.json();
  const bookings = data.filter(r => r.document).map(r => {
    const f = r.document.fields || {};
    const result = {};
    for (const [k, v] of Object.entries(f)) result[k] = extractValue(v);
    result._id = r.document.name.split("/").pop();
    return result;
  });

  bookings.sort((a, b) => (a._id || "").localeCompare(b._id || ""));
  console.log("Found " + bookings.length + " bookings\n");

  let totalOldVendor = 0, totalNewVendor = 0, totalOldCompany = 0, totalNewCompany = 0;
  let updated = 0, skipped = 0;

  console.log("#  | ORDER                        | AMOUNT | OLD VENDOR | NEW VENDOR | OLD COMPANY | NEW COMPANY | DIFF");
  console.log("-".repeat(115));

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    const totalAmount = b.finalAmount || b.totalAmount || 0;
    const oldVT = b.vendorTotal || 0;
    const oldCT = b.companyTotal || 0;

    const newSplit = computeSplit(totalAmount, NEW_SHARE);

    totalOldVendor += oldVT;
    totalNewVendor += newSplit.vendorTotal;
    totalOldCompany += oldCT;
    totalNewCompany += newSplit.companyTotal;

    const diff = newSplit.vendorTotal - oldVT;
    const diffStr = diff > 0 ? "+" + diff : String(diff);

    console.log(
      String(i + 1).padStart(2) + " | " +
      (b._id || "").padEnd(29) + "| " +
      String(totalAmount).padStart(6) + " | " +
      String(oldVT).padStart(10) + " | " +
      String(newSplit.vendorTotal).padStart(10) + " | " +
      String(oldCT).padStart(11) + " | " +
      String(newSplit.companyTotal).padStart(11) + " | " +
      diffStr
    );

    if (EXECUTE) {
      // Update booking
      await patchDoc(`bookings/${b._id}`, {
        vendorBase: newSplit.vendorBase,
        vendorGst: newSplit.vendorGst,
        vendorTotal: newSplit.vendorTotal,
        companyBase: newSplit.companyBase,
        companyGst: newSplit.companyGst,
        companyTotal: newSplit.companyTotal,
        vendorSharePercent: NEW_SHARE,
        shareRecalculatedAt: new Date().toISOString(),
        shareRecalculationReason: `Revenue share changed from ${OLD_SHARE}% to ${NEW_SHARE}%`,
      });

      // Update vendor ledger: delete old, create new
      const ledgerId = `le-${b._id}-${VENDOR_ID}`;
      try {
        await deleteDoc(`vendorLedger/${ledgerId}`);
      } catch { /* might not exist */ }

      await createDoc("vendorLedger", ledgerId, {
        id: ledgerId,
        vendorId: VENDOR_ID,
        vendorBase: newSplit.vendorBase,
        vendorGst: newSplit.vendorGst,
        amount: newSplit.vendorTotal,
        type: "credit",
        referenceId: b._id,
        invoiceNumber: b._id,
        locationId: b.locationId || "",
        date: b.transactionDate || b.createdAt || "",
        createdAt: new Date().toISOString(),
      });

      updated++;
    }
  }

  console.log("-".repeat(115));
  console.log("\n=== SUMMARY ===\n");
  console.log("Bookings processed: " + bookings.length);
  console.log("");
  console.log("                     OLD (" + OLD_SHARE + "%)       NEW (" + NEW_SHARE + "%)       DIFFERENCE");
  console.log("  Vendor Total:    " + fmt(totalOldVendor).padStart(10) + "      " + fmt(totalNewVendor).padStart(10) + "      " + fmt(totalNewVendor - totalOldVendor));
  console.log("  Company Total:   " + fmt(totalOldCompany).padStart(10) + "      " + fmt(totalNewCompany).padStart(10) + "      " + fmt(totalNewCompany - totalOldCompany));
  console.log("");
  console.log("  Vendor gains:  " + fmt(totalNewVendor - totalOldVendor) + " more");
  console.log("  Company loses: " + fmt(totalOldCompany - totalNewCompany) + " less");

  if (EXECUTE) {
    console.log("\n✓ All " + updated + " bookings and ledger entries updated.");
  } else {
    console.log("\nDRY-RUN: No changes made. Run with --execute to apply.");
  }
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });

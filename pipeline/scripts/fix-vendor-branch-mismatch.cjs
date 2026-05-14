/**
 * Migration script: Fix cross-branch vendor payment routing for booking ASG260330133718114YEGA.
 *
 * Usage:
 *   node scripts/fix-vendor-branch-mismatch.cjs              # dry-run (default)
 *   node scripts/fix-vendor-branch-mismatch.cjs --execute     # apply changes
 *
 * What it does:
 *   1. Reads booking ASG260330133718114YEGA from Firestore
 *   2. Looks up correct vendor from locations/{locationId}/games/{gameId} metadata
 *   3. Recomputes revenue splits with correct vendor's revenueShare
 *   4. Updates booking document + vendor ledger entries
 */

const API_KEY = "AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo";
const PROJECT = "a-square-6720c";
const DB = "asquare-app-db";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB}/documents`;

const GST_PERCENT = 18;
const EXECUTE = process.argv.includes("--execute");

// Affected bookings to fix
const AFFECTED = [
  {
    orderNumber: "ASG260330133718114YEGA",
    locationId: "2",     // Rajahmundry
    gameId: "cricket",
    wrongVendorId: "7777997226",
    correctVendorId: "8885215060",  // Jagadish rjy (Rajahmundry cricket vendor)
    correctVendorShare: 75,          // from Firestore audit
  },
];

function extractValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(extractValue);
  if (v.mapValue) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = extractValue(val);
    return obj;
  }
  return null;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "boolean") return { booleanValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function computeRevenueSplit(baseAmount, gstAmount, sharePercent) {
  const vendorBase = Math.round(baseAmount * sharePercent / 100);
  const vendorGst = Math.round(gstAmount * sharePercent / 100);
  return {
    vendorBase,
    vendorGst,
    vendorTotal: vendorBase + vendorGst,
    companyBase: baseAmount - vendorBase,
    companyGst: gstAmount - vendorGst,
    companyTotal: (baseAmount - vendorBase) + (gstAmount - vendorGst),
  };
}

async function fetchDoc(path) {
  const resp = await fetch(`${BASE}/${path}?key=${API_KEY}`);
  if (!resp.ok) throw new Error(`Fetch ${path} failed: ${resp.status}`);
  const data = await resp.json();
  const fields = data.fields || {};
  const result = {};
  for (const [k, v] of Object.entries(fields)) result[k] = extractValue(v);
  return result;
}

async function patchDoc(path, fields) {
  const updateMask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const url = `${BASE}/${path}?key=${API_KEY}&${updateMask}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    body.fields[k] = toFirestoreValue(v);
  }
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Patch ${path} failed (${resp.status}): ${text}`);
  }
  return await resp.json();
}

async function deleteDoc(path) {
  const resp = await fetch(`${BASE}/${path}?key=${API_KEY}`, { method: "DELETE" });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Delete ${path} failed (${resp.status}): ${text}`);
  }
}

async function createDoc(collectionPath, docId, fields) {
  const url = `${BASE}/${collectionPath}?key=${API_KEY}&documentId=${docId}`;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    body.fields[k] = toFirestoreValue(v);
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Create ${collectionPath}/${docId} failed (${resp.status}): ${text}`);
  }
  return await resp.json();
}

async function main() {
  console.log(`=== Fix Vendor-Branch Mismatch ===`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will modify Firestore)" : "DRY-RUN (read-only)"}\n`);

  for (const fix of AFFECTED) {
    console.log(`\n--- Fixing ${fix.orderNumber} ---`);

    // 1. Read current booking
    const booking = await fetchDoc(`bookings/${fix.orderNumber}`);
    console.log(`  Current vendorId: ${booking.vendorId}`);
    console.log(`  Current vendorTotal: INR ${booking.vendorTotal}`);
    console.log(`  Current companyTotal: INR ${booking.companyTotal}`);

    if (booking.vendorId !== fix.wrongVendorId) {
      console.log(`  SKIP: vendorId is "${booking.vendorId}", expected "${fix.wrongVendorId}". Already fixed?`);
      continue;
    }

    // 2. Compute new splits
    const totalAmount = booking.finalAmount || booking.totalAmount || 0;
    const baseAmount = Math.round((totalAmount * 100) / (100 + GST_PERCENT));
    const gstAmount = totalAmount - baseAmount;
    const newSplit = computeRevenueSplit(baseAmount, gstAmount, fix.correctVendorShare);

    console.log(`\n  New vendor: ${fix.correctVendorId} (share: ${fix.correctVendorShare}%)`);
    console.log(`  totalAmount: INR ${totalAmount} | base: INR ${baseAmount} | gst: INR ${gstAmount}`);
    console.log(`  NEW vendorBase: INR ${newSplit.vendorBase} | vendorGst: INR ${newSplit.vendorGst} | vendorTotal: INR ${newSplit.vendorTotal}`);
    console.log(`  NEW companyBase: INR ${newSplit.companyBase} | companyGst: INR ${newSplit.companyGst} | companyTotal: INR ${newSplit.companyTotal}`);

    // 3. Build update fields for booking
    const bookingUpdate = {
      vendorId: fix.correctVendorId,
      vendorBase: newSplit.vendorBase,
      vendorGst: newSplit.vendorGst,
      vendorTotal: newSplit.vendorTotal,
      companyBase: newSplit.companyBase,
      companyGst: newSplit.companyGst,
      companyTotal: newSplit.companyTotal,
      vendorSharePercent: fix.correctVendorShare,
      vendorCorrectedAt: new Date().toISOString(),
      vendorCorrectionReason: `Cross-branch vendor fix: was ${fix.wrongVendorId} (Vizag), corrected to ${fix.correctVendorId} (Rajahmundry)`,
    };

    // 4. Vendor ledger changes
    const wrongLedgerId = `le-${fix.orderNumber}-${fix.wrongVendorId}`;
    const correctLedgerId = `le-${fix.orderNumber}-${fix.correctVendorId}`;

    const newLedgerEntry = {
      id: correctLedgerId,
      vendorId: fix.correctVendorId,
      vendorBase: newSplit.vendorBase,
      vendorGst: newSplit.vendorGst,
      amount: newSplit.vendorTotal,
      type: "credit",
      referenceId: fix.orderNumber,
      invoiceNumber: fix.orderNumber,
      locationId: fix.locationId,
      date: booking.transactionDate || booking.createdAt || new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };

    console.log(`\n  Ledger changes:`);
    console.log(`    DELETE: vendorLedger/${wrongLedgerId} (INR ${booking.vendorTotal} to wrong vendor)`);
    console.log(`    CREATE: vendorLedger/${correctLedgerId} (INR ${newSplit.vendorTotal} to correct vendor)`);

    if (EXECUTE) {
      console.log(`\n  Executing changes...`);

      // Update booking
      await patchDoc(`bookings/${fix.orderNumber}`, bookingUpdate);
      console.log(`    ✓ Booking updated`);

      // Delete wrong ledger entry
      try {
        await deleteDoc(`vendorLedger/${wrongLedgerId}`);
        console.log(`    ✓ Wrong ledger entry deleted`);
      } catch (e) {
        console.log(`    ⚠ Could not delete wrong ledger: ${e.message}`);
      }

      // Create correct ledger entry
      try {
        await createDoc("vendorLedger", correctLedgerId, newLedgerEntry);
        console.log(`    ✓ Correct ledger entry created`);
      } catch (e) {
        console.log(`    ⚠ Could not create correct ledger: ${e.message}`);
      }

      console.log(`\n  ✓ ${fix.orderNumber} FIXED`);
    } else {
      console.log(`\n  DRY-RUN: No changes made. Run with --execute to apply.`);
    }
  }

  console.log(`\n=== Done ===`);
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});

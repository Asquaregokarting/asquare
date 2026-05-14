/**
 * Audit script: Find all bookings where vendorId's registered branch
 * doesn't match the booking's locationId (cross-branch vendor mismatch).
 *
 * Run from functions/ dir (has firebase-admin installed):
 *   cd functions && node ../scripts/audit-vendor-branch.cjs
 */
const { execSync } = require("child_process");

// Get access token from Firebase CLI
function getAccessToken() {
  try {
    // firebase login:ci gives a token, but we can use the existing login
    const result = execSync("firebase login:ci --no-localhost 2>/dev/null", { encoding: "utf8", timeout: 5000 });
    return result.trim();
  } catch {
    // Fall back to trying to get token from gcloud or firebase internals
    return null;
  }
}

const PROJECT_ID = "a-square-6720c";
const DATABASE_ID = "asquare-app-db";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

// Branch normalization map
const BRANCH_MAP = {
  "visakhapatnam": "0", "vizag": "0", "0": "0",
  "kakinada": "1", "1": "1",
  "rajahmundry": "2", "rajamahendravaram": "2", "2": "2",
  "guntur": "3", "3": "3",
  "vijayawada": "4", "4": "4",
};
const BRANCH_NAMES = {
  "0": "Visakhapatnam", "1": "Kakinada", "2": "Rajahmundry", "3": "Guntur", "4": "Vijayawada",
};

function normalizeBranch(val) {
  if (!val) return null;
  return BRANCH_MAP[String(val).toLowerCase().trim()] ?? null;
}

// Extract value from Firestore REST API field format
function extractValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.nullValue !== undefined) return null;
  if (field.timestampValue !== undefined) return field.timestampValue;
  if (field.arrayValue) return (field.arrayValue.values || []).map(extractValue);
  if (field.mapValue) {
    const obj = {};
    for (const [k, v] of Object.entries(field.mapValue.fields || {})) {
      obj[k] = extractValue(v);
    }
    return obj;
  }
  return null;
}

function extractDoc(doc) {
  const fields = doc.fields || {};
  const result = {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = extractValue(v);
  }
  result._id = doc.name.split("/").pop();
  return result;
}

async function firestoreQuery(collectionId, structuredQuery) {
  const url = `${BASE_URL}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      ...structuredQuery,
    },
  };

  // Use Firebase CLI token
  let token;
  try {
    token = execSync("npx firebase-tools login:ci --token 2>/dev/null || echo ''", { encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    // Use Application Default Credentials via gcloud
  }

  const headers = { "Content-Type": "application/json" };

  // Try fetching with API key (for collections with public read rules)
  const apiKey = "AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo";
  const resp = await fetch(`${url}?key=${apiKey}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Firestore query failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return data.filter((r) => r.document).map((r) => extractDoc(r.document));
}

async function listCollection(collectionId, pageSize = 300) {
  const apiKey = "AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo";
  const allDocs = [];
  let pageToken = null;

  do {
    let url = `${BASE_URL}/${collectionId}?key=${apiKey}&pageSize=${pageSize}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`List ${collectionId} failed (${resp.status}): ${text}`);
    }
    const data = await resp.json();
    const docs = (data.documents || []).map(extractDoc);
    allDocs.push(...docs);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allDocs;
}

async function main() {
  console.log("=== Vendor-Branch Mismatch Audit ===\n");

  // 1. Load all vendor profiles
  console.log("Loading vendor profiles...");
  const vendorDocs = await listCollection("vendorDetails");
  const vendors = new Map();
  for (const v of vendorDocs) {
    vendors.set(v._id, {
      name: v.vendorName || v.userName || v._id,
      branch: v.branch || "",
      normalizedBranch: normalizeBranch(v.branch),
      revenueShare: v.revenueShare,
      vendorType: v.vendorType,
    });
  }
  console.log(`Found ${vendors.size} vendors:\n`);
  for (const [id, v] of vendors) {
    console.log(`  ${id}: ${v.name} | branch: "${v.branch}" → normalized: ${v.normalizedBranch} (${BRANCH_NAMES[v.normalizedBranch] || "?"}) | share: ${v.revenueShare}%`);
  }

  // 2. Query bookings with vendorId using structured query
  console.log("\n\nLoading bookings with vendorId...");
  const bookings = await firestoreQuery("bookings", {
    where: {
      fieldFilter: {
        field: { fieldPath: "vendorId" },
        op: "NOT_EQUAL",
        value: { stringValue: "" },
      },
    },
    limit: 500,
  });
  console.log(`Found ${bookings.length} bookings with vendorId set.\n`);

  const mismatches = [];
  const matched = [];

  for (const b of bookings) {
    const orderNumber = b._id;
    const bookingLocationId = b.locationId || b.branchId || "";
    const normalizedBookingBranch = normalizeBranch(bookingLocationId);
    const vendorId = b.vendorId;
    if (!vendorId) continue;

    const vendor = vendors.get(vendorId);

    if (!vendor) {
      mismatches.push({
        orderNumber,
        issue: "VENDOR_NOT_FOUND",
        vendorId,
        bookingBranch: bookingLocationId,
        normalizedBookingBranch,
        vendorBranch: "N/A",
        normalizedVendorBranch: null,
        transactionDate: b.transactionDate || b.createdAt || "",
        totalAmount: b.finalAmount || b.totalAmount || 0,
        vendorTotal: b.vendorTotal || 0,
        paymentStatus: b.paymentStatus || "",
        bookingStatus: b.bookingStatus || "",
      });
      continue;
    }

    const normalizedVendorBranch = vendor.normalizedBranch;

    if (normalizedBookingBranch && normalizedVendorBranch && normalizedBookingBranch !== normalizedVendorBranch) {
      const items = Array.isArray(b.items) ? b.items : [];
      mismatches.push({
        orderNumber,
        issue: "BRANCH_MISMATCH",
        vendorId,
        vendorName: vendor.name,
        bookingBranch: `${bookingLocationId} (${BRANCH_NAMES[normalizedBookingBranch] || "?"})`,
        vendorBranch: `${vendor.branch} (${BRANCH_NAMES[normalizedVendorBranch] || "?"})`,
        normalizedBookingBranch,
        normalizedVendorBranch,
        transactionDate: b.transactionDate || b.createdAt || "",
        totalAmount: b.finalAmount || b.totalAmount || 0,
        vendorTotal: b.vendorTotal || 0,
        vendorBase: b.vendorBase || 0,
        vendorGst: b.vendorGst || 0,
        companyTotal: b.companyTotal || 0,
        paymentStatus: b.paymentStatus || "",
        bookingStatus: b.bookingStatus || "",
        paymentMethod: b.paymentMethod || "",
        items: items.map((item, idx) => ({
          idx,
          name: item.itemName || "?",
          vendorId: item.vendorId,
          vendorTotal: item.vendorTotal || 0,
          companyTotal: item.companyTotal || 0,
        })),
      });
    } else {
      matched.push(orderNumber);
    }
  }

  // 3. Print results
  console.log("=".repeat(80));
  console.log(`RESULTS: ${mismatches.length} MISMATCHES, ${matched.length} correctly matched\n`);

  if (mismatches.length === 0) {
    console.log("No cross-branch vendor mismatches found.");
  } else {
    for (const m of mismatches) {
      console.log(`ORDER: ${m.orderNumber}`);
      console.log(`  Issue: ${m.issue}`);
      console.log(`  Date: ${m.transactionDate}`);
      console.log(`  Booking Branch: ${m.bookingBranch}`);
      console.log(`  Vendor: ${m.vendorName || m.vendorId} (registered at: ${m.vendorBranch})`);
      console.log(`  Amount: INR ${m.totalAmount} | Vendor gets: INR ${m.vendorTotal} | Company gets: INR ${m.companyTotal}`);
      console.log(`  Payment: ${m.paymentMethod} | Status: ${m.paymentStatus} | Booking: ${m.bookingStatus}`);
      if (m.items?.length > 0) {
        for (const item of m.items) {
          console.log(`    [${item.idx}] ${item.name} | vendor: INR ${item.vendorTotal} | company: INR ${item.companyTotal}`);
        }
      }
      console.log("");
    }

    const totalMisrouted = mismatches.reduce((s, m) => s + (m.vendorTotal || 0), 0);
    console.log("=".repeat(80));
    console.log("SUMMARY:");
    console.log(`  Mismatched bookings: ${mismatches.length}`);
    console.log(`  Total misrouted to wrong vendor: INR ${Math.round(totalMisrouted)}`);
    console.log(`  Affected vendors: ${[...new Set(mismatches.map(m => `${m.vendorName || m.vendorId}`))].join(", ")}`);
  }

  // 4. Check vendorLedger for mismatched bookings
  if (mismatches.length > 0) {
    console.log("\nChecking vendorLedger entries...");
    for (const m of mismatches) {
      try {
        const ledger = await firestoreQuery("vendorLedger", {
          where: {
            fieldFilter: {
              field: { fieldPath: "referenceId" },
              op: "EQUAL",
              value: { stringValue: m.orderNumber },
            },
          },
          limit: 10,
        });
        if (ledger.length > 0) {
          console.log(`  ${m.orderNumber}: ${ledger.length} ledger entries`);
          for (const le of ledger) {
            console.log(`    ${le._id}: vendorId=${le.vendorId} type=${le.type} amount=INR ${le.amount}`);
          }
        } else {
          console.log(`  ${m.orderNumber}: No ledger entries`);
        }
      } catch (e) {
        console.log(`  ${m.orderNumber}: Ledger check failed - ${e.message}`);
      }
    }
  }

  console.log("\n=== Audit Complete ===");
}

main().catch((err) => {
  console.error("Audit failed:", err.message);
  process.exit(1);
});

const fs = require("fs");
const API_KEY = "AIzaSyD2oTrz2cxLn9w3TEhj1GKkzz0WSShVjCo";
const PROJECT = "a-square-6720c";
const DB = "asquare-app-db";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB}/documents`;

function extractValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.mapValue) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = extractValue(val);
    return obj;
  }
  if (v.arrayValue) return (v.arrayValue.values || []).map(extractValue);
  return JSON.stringify(v);
}

async function main() {
  const locations = ["0", "1", "2", "3", "4"];
  const names = { "0": "Visakhapatnam", "1": "Kakinada", "2": "Rajahmundry", "3": "Guntur", "4": "Vijayawada" };

  // Check cricket game at each location
  for (const loc of locations) {
    console.log(`\n=== Location ${loc} (${names[loc]}) ===`);
    try {
      const resp = await fetch(`${BASE}/locations/${loc}/games/cricket?key=${API_KEY}`);
      if (!resp.ok) {
        console.log(`  Cricket game not found (${resp.status})`);
        continue;
      }
      const data = await resp.json();
      const fields = data.fields || {};
      console.log(`  name: ${extractValue(fields.name)}`);
      const meta = extractValue(fields.metadata);
      if (meta) {
        console.log(`  metadata.vendorId: ${meta.vendorId || "none"}`);
        console.log(`  metadata.vendorUserId: ${meta.vendorUserId || "none"}`);
        console.log(`  metadata.vendorBranchId: ${meta.vendorBranchId || "none"}`);
        console.log(`  metadata.vendorName: ${meta.vendorName || "none"}`);
      } else {
        console.log("  No metadata");
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Also check PADDLER BOAT at locations 1 and 2
  console.log("\n\n--- Checking PADDLER BOAT game ---");
  for (const loc of locations) {
    console.log(`\n=== Location ${loc} (${names[loc]}) ===`);
    // List games at this location
    try {
      const resp = await fetch(`${BASE}/locations/${loc}/games?key=${API_KEY}&pageSize=50`);
      if (!resp.ok) { console.log(`  No games (${resp.status})`); continue; }
      const data = await resp.json();
      const docs = data.documents || [];
      for (const doc of docs) {
        const gameName = extractValue(doc.fields?.name);
        const gameId = doc.name.split("/").pop();
        const meta = extractValue(doc.fields?.metadata);
        if (meta?.vendorId || meta?.vendorUserId) {
          console.log(`  Game: ${gameName} (id: ${gameId})`);
          console.log(`    vendorId: ${meta.vendorId || "none"}`);
          console.log(`    vendorBranchId: ${meta.vendorBranchId || "none"}`);
          console.log(`    vendorName: ${meta.vendorName || "none"}`);
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
}

main().catch(console.error);

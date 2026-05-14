#!/usr/bin/env node
/**
 * Bundle size budget enforcer.
 *
 * Reads dist/assets/*.js and fails the process with a non-zero exit if any
 * chunk exceeds its budget. Run this AFTER `npm run build` (the chunks have
 * to exist on disk).
 *
 * Budgets are deliberately generous on first introduction so the build does
 * not regress. Tighten them as bundle work progresses.
 *
 * Usage: node scripts/check-bundle-size.mjs
 */

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = join(process.cwd(), 'dist', 'assets')

// Budgets in KB (uncompressed). Pattern is matched against the filename
// AFTER the hash is stripped (e.g. `vendor-3d-abc123.js` → `vendor-3d`).
const BUDGETS_KB = {
  'vendor-react': 250,
  'vendor-firebase-auth': 350,
  'vendor-firebase-firestore': 600,
  'vendor-3d': 1600,
  'vendor-ui': 250,
  'vendor-lottie': 350,
  'vendor-query': 100,
  // Catch-all for the entry chunk
  index: 1500,
}

if (!existsSync(ASSETS_DIR)) {
  console.error(`bundle-size: ${ASSETS_DIR} does not exist — run \`npm run build\` first.`)
  process.exit(1)
}

const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))

let failed = false
const rows = []

for (const file of files) {
  const path = join(ASSETS_DIR, file)
  const sizeKb = statSync(path).size / 1024

  // Strip hash + extension: foo-bar-abc123.js → foo-bar
  const base = file.replace(/-[A-Za-z0-9_]+\.js$/, '').replace(/\.js$/, '')

  const budgetKb = BUDGETS_KB[base]
  if (budgetKb === undefined) {
    rows.push({ file, sizeKb, budgetKb: '—', status: 'no budget' })
    continue
  }

  const ok = sizeKb <= budgetKb
  rows.push({
    file,
    sizeKb,
    budgetKb,
    status: ok ? 'ok' : 'OVER',
  })

  if (!ok) failed = true
}

// Pretty-print results
console.log('Bundle size report:')
for (const r of rows) {
  const sz = `${r.sizeKb.toFixed(0)}kb`.padStart(7)
  const bd = typeof r.budgetKb === 'number' ? `${r.budgetKb}kb`.padStart(7) : '       '
  console.log(`  ${r.status.padEnd(9)} ${sz}  / ${bd}  ${r.file}`)
}

if (failed) {
  console.error('\nbundle-size: one or more chunks exceeded their budget.')
  process.exit(1)
}
console.log('\nbundle-size: all chunks within budget.')

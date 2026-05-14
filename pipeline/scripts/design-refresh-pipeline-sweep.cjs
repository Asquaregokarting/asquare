#!/usr/bin/env node
/**
 * Final sweep of arbitrary Tailwind hex values across src/pipeline — swap to
 * the design-system tokens now exposed in tailwind.config.js.
 *
 * Idempotent.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const swaps = [
  ['[#8A8A9A]', 'portal-muted'],
  ['[#15151E]', 'portal-panel'],
  ['[#E10600]', 'instagram'],
  ['[#0066FF]', 'primary-500'],
  ['[#FF6B00]', 'secondary-500'],
  ['[#00C853]', 'signal-green-bright'],
  ['[#7CFFB2]', 'signal-green-glow'],
  ['[#FF1744]', 'signal-red-hot'],
  ['[#FFB300]', 'signal-amber'],
  ['[#0a1628]', 'signal-navy-deep'],
  ['[#FF8F35]', 'track-accent-warm'],
  ['[#FF6B35]', 'track-accent'],
];

const root = path.resolve(process.cwd(), 'src/pipeline');

// Use git ls-files to enumerate tracked TS/TSX only (skip tests).
const listing = execSync(
  'git ls-files "src/pipeline/**/*.tsx" "src/pipeline/**/*.ts"',
  { cwd: process.cwd(), encoding: 'utf-8' },
);
const files = listing
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !/\.test\.(t|j)sx?$/.test(f));

let totalHits = 0;
const touched = [];

for (const rel of files) {
  const p = path.resolve(process.cwd(), rel);
  let content;
  try { content = fs.readFileSync(p, 'utf-8'); } catch { continue; }
  const before = content;
  let fileHits = 0;

  for (const [needle, token] of swaps) {
    while (content.includes(needle)) {
      content = content.replace(needle, token);
      fileHits++;
    }
  }

  if (content !== before) {
    fs.writeFileSync(p, content, 'utf-8');
    totalHits += fileHits;
    touched.push([rel, fileHits]);
  }
}

touched.forEach(([f, n]) => console.log('  ' + f + '  (' + n + ')'));
console.log('\nTotal swaps: ' + totalHits + '   (files touched: ' + touched.length + ')');

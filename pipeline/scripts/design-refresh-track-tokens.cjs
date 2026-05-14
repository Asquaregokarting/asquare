#!/usr/bin/env node
/**
 * One-shot design-system refresh: replace bg-[#XXXXXX]-style arbitrary
 * Tailwind values with the new track-* tokens in the track/karts + scanner
 * + waitingList modules.
 *
 * Idempotent — re-running after tokens are in place is a no-op.
 */
const fs = require('fs');
const path = require('path');

const files = [
  'src/pipeline/features/track/karts/KartDeepClean.tsx',
  'src/pipeline/features/track/karts/KartDetails.tsx',
  'src/pipeline/features/track/karts/KartForm.tsx',
  'src/pipeline/features/track/karts/KartList.tsx',
  'src/pipeline/features/track/karts/KartPhotoHistory.tsx',
  'src/pipeline/features/track/karts/KartReportModal.tsx',
  'src/pipeline/features/track/karts/KartReportsViewer.tsx',
  'src/pipeline/features/track/karts/KartsDashboard.tsx',
  'src/pipeline/features/track/scanner/components/LocationSelect.tsx',
  'src/pipeline/features/track/scanner/components/ManualBillingInput.tsx',
  'src/pipeline/features/track/scanner/components/SerialSelector.tsx',
  'src/pipeline/features/track/scanner/components/ShiftBanner.tsx',
  'src/pipeline/features/track/scanner/components/ShiftEndVerification.tsx',
  'src/pipeline/features/track/scanner/components/ShiftStartVerification.tsx',
  'src/pipeline/features/track/scanner/Dashboard.tsx',
  'src/pipeline/features/track/scanner/HistoryView.tsx',
  'src/pipeline/features/track/scanner/QRScannerView.tsx',
  'src/pipeline/features/track/scanner/ScanDetails.tsx',
  'src/pipeline/features/track/scanner/ScannerModule.tsx',
  'src/pipeline/features/track/waitingList/WaitingListDashboard.tsx',
  'src/pipeline/pages/modules/TrackModule.tsx',
];

// Each pair: [Tailwind-arbitrary-substring, token-name]
// We search for the whole `[#HEX]` substring and swap it for the token.
const swaps = [
  ['[#0F0F1A]', 'track-panel'],
  ['[#1A1A2E]', 'track-surface'],
  ['[#11162A]', 'track-surface-alt'],
  ['[#FF6B35]', 'track-accent'],
  ['[#FF8F66]', 'track-accent-soft'],
];

const cwd = process.cwd();
let totalHits = 0;

for (const rel of files) {
  const p = path.resolve(cwd, rel);
  if (!fs.existsSync(p)) {
    console.warn('skip (missing): ' + rel);
    continue;
  }
  let content = fs.readFileSync(p, 'utf-8');
  const before = content;
  let fileHits = 0;

  for (const [needle, token] of swaps) {
    // Replace every occurrence of the literal substring.
    while (content.includes(needle)) {
      content = content.replace(needle, token);
      fileHits++;
    }
  }

  if (content !== before) {
    fs.writeFileSync(p, content, 'utf-8');
    totalHits += fileHits;
    console.log('  ' + rel + '  (' + fileHits + ' hits)');
  }
}

console.log('\nTotal replacements: ' + totalHits);
